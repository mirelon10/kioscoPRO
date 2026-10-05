import { $, h, icono, filaVacia } from "../lib/dom.js";
import { formatearFechaHora } from "../lib/fechas.js";
import { ROLES_ASIGNABLES, LARGO_MINIMO_CLAVE, generarClave, validarAlta, validarClaveNueva } from "../core/usuarios.js";
import { ErrorNegocio } from "../core/errores.js";
import { cambiarClaveTemporal, cambiarRol, crearUsuario, eliminarUsuario, obtenerUsuarios } from "../data/usuarios.js";
import { estaOnline } from "../data/conexion.js";
import { sesion, esAdmin } from "../estado.js";
import { avisar, confirmar, conBoton, formularioModal, mostrarDetalle, mostrarError, notificarExito } from "../ui.js";

// Alta, cambio de rol y eliminación de usuarios (solo el admin). Para quitarle el acceso a alguien
// por un tiempo se le pone "Sin acceso"; eliminarlo lo saca de la lista (ver eliminarUsuario).

const form = $("form-nuevo-usuario");
const tbody = $("tabla-usuarios");

export function iniciarUsuarios() {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? form.querySelector("button"), alCrear);
  });

  tbody.addEventListener("change", (e) => {
    const select = e.target.closest("select[data-usuario]");
    if (select) conBoton(select, () => alCambiarRol(select));
  });

  tbody.addEventListener("click", (e) => {
    const boton = e.target.closest("button[data-eliminar]");
    if (boton) conBoton(boton, () => alEliminar(boton));
  });
}

export async function cargarUsuarios() {
  if (!esAdmin()) return;
  let usuarios;
  try {
    usuarios = await obtenerUsuarios();
  } catch (error) {
    return mostrarError(error, "No se pudo cargar la lista de usuarios.");
  }
  if (usuarios.length === 0) return filaVacia(tbody, 4, "Todavía no hay usuarios cargados.");

  tbody.replaceChildren(
    ...usuarios.map((u) => {
      const propio = u.id === sesion.usuario.uid;
      const select = h(
        "select",
        {
          class: "input-modern input-rol",
          "aria-label": `Rol de ${u.email}`,
          dataset: { usuario: u.id, email: u.email, rol: u.rol },
          disabled: propio,
          title: propio ? "No podés cambiar tu propio rol" : null,
        },
        ...Object.entries(ROLES_ASIGNABLES).map(([valor, texto]) => h("option", { value: valor, selected: u.rol === valor }, texto)),
      );
      return h(
        "tr",
        {},
        h("td", {}, u.email, propio ? h("small", { class: "text-muted d-block" }, "(vos)") : null),
        h("td", {}, select),
        h("td", {}, formatearFechaHora(u.fecha)),
        h(
          "td",
          { class: "acciones" },
          propio
            ? null
            : h(
                "button",
                {
                  type: "button",
                  class: "btn btn-danger btn-sm",
                  title: "Eliminar usuario",
                  "aria-label": `Eliminar a ${u.email}`,
                  dataset: { eliminar: u.id, email: u.email },
                },
                icono("xmark"),
              ),
        ),
      );
    }),
  );
}

async function alCrear() {
  if (!estaOnline()) return avisar("Sin conexión", "Para crear usuarios hace falta internet.");
  const datos = validarAlta({ email: $("usuario-email").value, rol: $("usuario-rol").value });
  if (datos.error) return avisar("Datos inválidos", datos.error);

  const clave = generarClave();
  try {
    await crearUsuario({ ...datos, clave }, sesion.usuario);
  } catch (error) {
    throw traducirErrorAlta(error);
  }

  form.reset();
  mostrarDetalle({
    titulo: "Usuario creado",
    contenido: h(
      "div",
      { class: "alta-usuario" },
      h("p", {}, `${datos.email} ya puede entrar como ${ROLES_ASIGNABLES[datos.rol].toLowerCase()} con esta contraseña temporal:`),
      h("code", { class: "clave-temporal" }, clave),
      h("p", { class: "text-muted" }, "Anotala y entregásela en persona: no se vuelve a mostrar. Al entrar por primera vez, el sistema le pide que elija su propia contraseña."),
    ),
  });
  await cargarUsuarios();
}

function traducirErrorAlta(error) {
  const mensajes = {
    "auth/email-already-in-use":
      "Ya existe una cuenta con ese email. Si es de alguien que usaba el sistema antes, va a aparecer en la lista cuando vuelva a entrar.",
    "auth/admin-restricted-operation":
      "Firebase no deja crear cuentas: hay que habilitar el registro en Authentication → Settings → User actions.",
    "auth/operation-not-allowed": "El acceso con email y contraseña está desactivado en Firebase Authentication.",
  };
  return mensajes[error?.code] ? new ErrorNegocio(mensajes[error.code]) : error;
}

async function alCambiarRol(select) {
  const { usuario, email, rol: anterior } = select.dataset;
  const nuevo = select.value;
  const quitaAcceso = nuevo === "ninguno";

  const ok = await confirmar({
    titulo: quitaAcceso ? `¿Quitarle el acceso a ${email}?` : `¿Cambiar el rol de ${email}?`,
    texto: quitaAcceso
      ? "No va a poder entrar ni usar el sistema. Se puede volver a habilitar cuando quieras."
      : `Pasa de ${ROLES_ASIGNABLES[anterior] ?? anterior} a ${ROLES_ASIGNABLES[nuevo]}. El cambio se aplica enseguida.`,
    boton: quitaAcceso ? "Quitar acceso" : "Cambiar rol",
    peligro: quitaAcceso || nuevo === "admin",
  });
  if (!ok) {
    select.value = anterior;
    return;
  }

  try {
    await cambiarRol(usuario, nuevo, sesion.usuario);
  } catch (error) {
    select.value = anterior;
    throw error;
  }
  select.dataset.rol = nuevo;
  notificarExito(`${email}: ${ROLES_ASIGNABLES[nuevo]}`);
}

async function alEliminar(boton) {
  const { eliminar: uid, email } = boton.dataset;
  if (!estaOnline()) return avisar("Sin conexión", "Para eliminar usuarios hace falta internet.");

  const ok = await confirmar({
    titulo: `¿Eliminar a ${email}?`,
    texto:
      "No va a poder entrar más al sistema y deja de aparecer en esta lista. Sus ventas, turnos y egresos quedan registrados. " +
      "Si tiene un turno abierto, cerralo desde Administración.",
    boton: "Eliminar",
    peligro: true,
  });
  if (!ok) return;

  await eliminarUsuario(uid, sesion.usuario);
  notificarExito(`${email} eliminado`);
  await cargarUsuarios();
}

// ---------- Contraseña temporal ----------

const FORMULARIO_CLAVE_NUEVA = `
  <div class="swal-form">
    <p class="text-muted">Entraste con la contraseña temporal que te dio el administrador. Elegí tu propia contraseña:
      desde ahora vas a entrar con esa.</p>
    <label id="clave-actual-campo">Contraseña temporal<input id="clave-actual" type="password" class="swal2-input" autocomplete="current-password"></label>
    <label>Contraseña nueva (mínimo ${LARGO_MINIMO_CLAVE} caracteres)<input id="clave-nueva" type="password" class="swal2-input" autocomplete="new-password"></label>
    <label>Repetí la contraseña nueva<input id="clave-repetida" type="password" class="swal2-input" autocomplete="new-password"></label>
  </div>`;

/**
 * Le pide al usuario que reemplace su contraseña temporal. `claveActual`: la que acaba de usar para
 * entrar (si la sesión venía abierta de antes, se le pide).
 * @returns {Promise<boolean>} false si eligió salir sin cambiarla
 */
export async function pedirClaveNueva(usuario, claveActual = null) {
  for (;;) {
    const datos = await formularioModal({
      titulo: "Elegí tu contraseña",
      contenido: FORMULARIO_CLAVE_NUEVA,
      boton: "Guardar contraseña",
      cancelar: "Salir",
      obligatorio: true,
      alAbrir: (popup) => {
        if (claveActual) popup.querySelector("#clave-actual-campo").hidden = true;
      },
      leer: (popup) => {
        const r = validarClaveNueva({
          actual: claveActual ?? popup.querySelector("#clave-actual").value,
          nueva: popup.querySelector("#clave-nueva").value,
          repetida: popup.querySelector("#clave-repetida").value,
        });
        return r.error ?? r;
      },
    });
    if (!datos) return false;

    try {
      await cambiarClaveTemporal(usuario, datos.actual, datos.nueva);
      notificarExito("Contraseña guardada");
      return true;
    } catch (error) {
      const claveIncorrecta = ["auth/invalid-credential", "auth/wrong-password"].includes(error?.code);
      if (claveIncorrecta) claveActual = null; // que la escriba
      await mostrarError(
        claveIncorrecta ? new ErrorNegocio("La contraseña temporal no es correcta.") : error,
        "No se pudo cambiar la contraseña. Volvé a intentar.",
      );
    }
  }
}
