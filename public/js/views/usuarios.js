import { $, h, filaVacia } from "../lib/dom.js";
import { formatearFechaHora } from "../lib/fechas.js";
import { ROLES_ASIGNABLES, generarClave, validarAlta } from "../core/usuarios.js";
import { ErrorNegocio } from "../core/errores.js";
import { cambiarRol, crearUsuario, obtenerUsuarios } from "../data/usuarios.js";
import { estaOnline } from "../data/conexion.js";
import { sesion, esAdmin } from "../estado.js";
import { avisar, confirmar, conBoton, mostrarDetalle, mostrarError, notificarExito } from "../ui.js";

// Alta de usuarios y cambio de rol (solo el admin). Las cuentas no se borran desde el navegador:
// para quitarle el acceso a alguien se le pone "Sin acceso".

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
}

export async function cargarUsuarios() {
  if (!esAdmin()) return;
  let usuarios;
  try {
    usuarios = await obtenerUsuarios();
  } catch (error) {
    return mostrarError(error, "No se pudo cargar la lista de usuarios.");
  }
  if (usuarios.length === 0) return filaVacia(tbody, 3, "Todavía no hay usuarios cargados.");

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
      h("p", { class: "text-muted" }, "Anotala y entregásela en persona: no se vuelve a mostrar."),
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
