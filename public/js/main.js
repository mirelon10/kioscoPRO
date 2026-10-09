import {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  borrarDatosLocales,
  hayBorradoPendiente,
  esPcCaja,
  contarEscriturasSinSubir,
} from "./firebase.js";
import { $, mostrar, etiquetarTablasParaCelular } from "./lib/dom.js";
import { mensajeDeError } from "./core/errores.js";
import { ROLES } from "./core/usuarios.js";
import { escucharProductos } from "./data/productos.js";
import { leerUsuarioGuardado, registrarRolPropio, escucharRolPropio } from "./data/usuarios.js";
import { escucharSaldoGuardado } from "./data/cajaGuardado.js";
import { adoptarTurnoSinCandado, escucharTurnoActivo, escucharMovimientosTurno } from "./data/turnos.js";
import {
  alCambiarConexion,
  alProblemaDeSincronizacion,
  estaOnline,
  haySincronizacionPendiente,
  revisarPendientesAlIniciar,
} from "./data/conexion.js";
import { sesion, actualizarSesion, esAdmin } from "./estado.js";
import { avisar, mostrarError } from "./ui.js";
import { conLimiteDeTiempo } from "./lib/espera.js";
import { iniciarPos, vaciarPos, enfocarBuscador } from "./views/pos.js";
import { iniciarTurno } from "./views/turno.js";
import { iniciarEgresos, cargarEgresos, reiniciarFiltrosEgresos } from "./views/egresos.js";
import { iniciarAdmin, reiniciarAdmin, abrirAdmin } from "./views/admin.js";
import { iniciarStock, renderStock, cargarMovimientosStock } from "./views/stock.js";
import { iniciarUsuarios, cargarUsuarios, pedirClaveNueva } from "./views/usuarios.js";
import { iniciarInstalacion } from "./views/instalar.js";

/** Secciones que solo ve el admin. */
const SECCIONES_ADMIN = ["sec-admin", "sec-usuarios"];

/** Listeners de Firestore activos: se cortan al cerrar sesión (si no, fallan por permisos). */
let desuscribir = [];
/** Se incrementa en cada cambio de sesión para descartar respuestas que lleguen tarde. */
let generacion = 0;
/**
 * Contraseña con la que se acaba de entrar desde el formulario: si es la temporal, sirve para
 * cambiarla sin volver a pedirla. Se descarta apenas se usa.
 */
let claveDelLogin = null;

// ---------- Arranque ----------

iniciarPos();
iniciarTurno();
iniciarEgresos();
iniciarAdmin();
iniciarStock();
iniciarUsuarios();
iniciarInstalacion();
etiquetarTablasParaCelular();

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => irA(btn.dataset.target));
});
$("form-login").addEventListener("submit", iniciarSesion);
$("btn-logout").addEventListener("click", cerrarSesion);

alCambiarConexion(renderConexion);

// Guarda la app en el dispositivo para poder abrirla sin internet (ver sw.js).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("No se pudo activar el modo sin conexión", error));
}
// Ventas o egresos hechos sin conexión que el servidor rechazó al subirlos.
alProblemaDeSincronizacion(({ titulo, texto }) => avisar(titulo, texto));

// Cerrar la pestaña o el navegador con el turno abierto: el navegador pregunta si salir (su propio
// cartel, el texto no se puede cambiar). Si elige quedarse, se lo lleva a cerrar el turno.
// Algunos navegadores de celular no muestran el cartel.
window.addEventListener("beforeunload", (e) => {
  if (!sesion.turno) return;
  e.preventDefault();
  e.returnValue = ""; // navegadores viejos
  // Este temporizador corre solo si la página sigue abierta (eligió quedarse).
  setTimeout(() => {
    irA("sec-turnos");
    avisar("Tenés un turno abierto", "Cerralo antes de salir del sistema, así la caja queda bien.");
  }, 0);
});

onAuthStateChanged(auth, async (usuario) => {
  const gen = ++generacion;
  detenerListeners();

  if (!usuario) {
    // Un cierre de sesión anterior no pudo borrar los datos locales: se reintenta una vez por pestaña.
    if (hayBorradoPendiente() && !reintentoDeBorradoHecho()) return borrarDatosLocales();
    actualizarSesion({ usuario: null, rol: null, turno: null, movimientosTurno: null, productos: [], saldoGuardado: null });
    vaciarPos();
    return mostrarPantalla("login");
  }

  const clave = claveDelLogin;
  claveDelLogin = null;

  try {
    const { rol, claveTemporal, eliminado } = await leerUsuario(usuario);
    if (gen !== generacion) return;

    if (eliminado) {
      $("login-error").textContent = "Tu usuario fue eliminado del sistema.";
      // Se borra la cuenta para que el admin pueda volver a usar el email. Si la sesión venía de
      // antes, Firebase no lo permite: queda para la próxima vez que entre.
      return deleteUser(usuario).catch(() => signOut(auth));
    }
    if (!ROLES[rol]) {
      $("login-error").textContent = "Tu usuario no tiene un rol asignado. Pedile al administrador que te habilite.";
      return signOut(auth);
    }

    if (claveTemporal) {
      mostrarPantalla("login");
      const cambiada = await pedirClaveNueva(usuario, clave);
      if (gen !== generacion) return;
      if (!cambiada) {
        $("login-error").textContent = "Para usar el sistema tenés que elegir tu contraseña.";
        return signOut(auth);
      }
    }

    actualizarSesion({ usuario, rol });
    prepararApp();
    mostrarPantalla("app");
    escucharDatos(usuario.uid, gen);
  } catch (error) {
    console.error(error);
    $("login-error").textContent = mensajeDeError(error, "No se pudo verificar tu usuario.");
    signOut(auth);
  }
});

// ---------- Sesión ----------

const ESPERA_TOKEN_MS = 5000;
const claveRol = (uid) => `kiosco.rol.${uid}`;

/**
 * Lee el usuario: primero el documento de Firestore (usuarios/{uid}, lo maneja el admin desde la app);
 * si todavía no tiene documento, el rol del token (usuarios de antes) y le crea el documento con ese rol.
 * El rol solo decide qué pantallas se ven: los permisos los imponen las reglas.
 * @returns {Promise<{ rol: string, claveTemporal?: boolean, eliminado?: boolean }>}
 */
async function leerUsuario(usuario) {
  const guardado = await leerUsuarioGuardado(usuario.uid, ESPERA_TOKEN_MS);
  if (guardado != null) {
    recordarRol(usuario.uid, guardado.rol);
    return guardado;
  }
  const rol = await leerRolDelToken(usuario);
  if (guardado === undefined && ROLES[rol] && estaOnline()) {
    registrarRolPropio(usuario, rol).catch((error) => console.warn("No se pudo pasar el rol a Firestore", error));
  }
  return { rol };
}

/**
 * Rol del custom claim. Fuerza la renovación del token para tomar roles recién asignados.
 * Sin internet usa el token en caché y, si ya venció (dura 1 hora), el último rol conocido en
 * este equipo.
 */
async function leerRolDelToken(usuario) {
  try {
    const rol = (await conLimiteDeTiempo(usuario.getIdTokenResult(true), ESPERA_TOKEN_MS)).claims.rol;
    recordarRol(usuario.uid, rol);
    return rol;
  } catch (error) {
    try {
      return (await conLimiteDeTiempo(usuario.getIdTokenResult(), ESPERA_TOKEN_MS)).claims.rol;
    } catch {
      const rol = rolRecordado(usuario.uid);
      if (rol) return rol;
      throw error;
    }
  }
}

function recordarRol(uid, rol) {
  try {
    if (rol) localStorage.setItem(claveRol(uid), rol);
    else localStorage.removeItem(claveRol(uid));
  } catch {
    // almacenamiento bloqueado: sin conexión habrá que esperar a tener internet
  }
}

function olvidarRol(uid) {
  try {
    localStorage.removeItem(claveRol(uid));
  } catch {
    // almacenamiento bloqueado
  }
}

function rolRecordado(uid) {
  try {
    return localStorage.getItem(claveRol(uid));
  } catch {
    return null;
  }
}

async function iniciarSesion(e) {
  e.preventDefault();
  const boton = e.submitter ?? e.target.querySelector("button");
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const error = $("login-error");

  if (!email || !password) {
    error.textContent = "Completá email y contraseña.";
    return;
  }

  error.textContent = "";
  boton.disabled = true;
  try {
    claveDelLogin = password;
    await signInWithEmailAndPassword(auth, email, password);
    $("login-password").value = "";
  } catch (err) {
    claveDelLogin = null;
    error.textContent = mensajeDeError(err, "No se pudo iniciar sesión.");
  } finally {
    boton.disabled = false;
  }
}

async function cerrarSesion() {
  if (sesion.turno) {
    avisar("Turno abierto", "Cerrá tu turno en 'Caja y turnos' antes de salir del sistema.");
    return irA("sec-turnos");
  }
  // El indicador solo sigue lo escrito desde esta pestaña: también se cuentan las escrituras sin
  // subir de otras pestañas, que se perderían al borrar los datos locales.
  if (haySincronizacionPendiente() || (await contarEscriturasSinSubir()) > 0) {
    avisar("Hay movimientos sin subir", "Esperá a que vuelva internet y se suban antes de salir del sistema.");
    return;
  }

  const { uid } = sesion.usuario;
  try {
    await signOut(auth);
  } catch (error) {
    return mostrarError(error);
  }
  olvidarRol(uid);
  // PC de la caja: se conserva la copia local (ver esPcCaja). La recarga deja la pantalla limpia igual.
  if (esPcCaja()) return location.reload();
  // PC compartida: que no queden en el navegador los datos de quien salió.
  await borrarDatosLocales();
}

/** Marca (en esta pestaña) que ya se reintentó el borrado, para no recargar en bucle si vuelve a fallar. */
function reintentoDeBorradoHecho() {
  try {
    if (sessionStorage.getItem("kiosco.reintentoBorrado")) return true;
    sessionStorage.setItem("kiosco.reintentoBorrado", "1");
    return false;
  } catch {
    return true;
  }
}

function escucharDatos(uid, gen) {
  const vigente = () => gen === generacion;
  revisarPendientesAlIniciar();
  const alFallar = (mensaje) => (error) => vigente() && mostrarError(error, mensaje);

  desuscribir.push(
    escucharRolPropio(uid, (rol) => vigente() && alCambiarRol(rol)),
    escucharProductos((productos) => vigente() && actualizarSesion({ productos }), alFallar("No se pudo cargar el catálogo.")),
    escucharSaldoGuardado(
      (saldoGuardado) => vigente() && actualizarSesion({ saldoGuardado }),
      alFallar("No se pudo cargar el saldo de la caja de guardado."),
    ),
  );

  // Mientras haya un turno abierto se escuchan sus ventas y egresos (caja calculada en vivo).
  let turnoEscuchado = null;
  let dejarMovimientos = () => {};
  desuscribir.push(() => dejarMovimientos());

  const alCambiarTurno = (turno) => {
    if (!vigente()) return;
    if (turno?.id !== turnoEscuchado) {
      turnoEscuchado = turno?.id ?? null;
      dejarMovimientos();
      dejarMovimientos = () => {};
      actualizarSesion({ movimientosTurno: null });
      if (turno) {
        dejarMovimientos = escucharMovimientosTurno(
          turno,
          (movimientosTurno) => vigente() && actualizarSesion({ movimientosTurno }),
          alFallar("No se pudieron cargar los movimientos del turno."),
        );
      }
    }
    actualizarSesion({ turno });
  };

  // Sin conexión se saltea: consulta al servidor y solo sirve para turnos de antes de la migración.
  (estaOnline() ? adoptarTurnoSinCandado(uid) : Promise.resolve())
    .catch((error) => console.error("No se pudo revisar turnos anteriores", error))
    .finally(() => {
      if (!vigente()) return;
      desuscribir.push(escucharTurnoActivo(uid, alCambiarTurno, alFallar("No se pudo cargar tu turno.")));
    });
}

/** El admin le cambió el rol a este usuario mientras tenía la sesión abierta. */
function alCambiarRol(rol) {
  if (rol === sesion.rol) return;
  if (!ROLES[rol]) {
    $("login-error").textContent = "Un administrador te quitó el acceso al sistema.";
    return signOut(auth);
  }
  recordarRol(sesion.usuario.uid, rol);
  actualizarSesion({ rol });
  aplicarRol();
  const visible = document.querySelector(".view-section:not(.hidden)")?.id;
  if (SECCIONES_ADMIN.includes(visible) && !esAdmin()) irA("sec-pos");
  avisar("Cambió tu rol", `Ahora sos ${ROLES[rol].toLowerCase()}.`);
}

function detenerListeners() {
  desuscribir.forEach((fn) => fn());
  desuscribir = [];
}

function renderConexion({ online, sincronizando }) {
  const estado = $("estado-conexion");
  mostrar(estado, !online || sincronizando);
  estado.classList.toggle("sincronizando", online && sincronizando);
  if (!online) {
    estado.textContent = sincronizando
      ? "⚠ Sin conexión · hay movimientos por subir"
      : "⚠ Sin conexión · las ventas se guardan en este equipo";
  } else if (sincronizando) {
    estado.textContent = "↻ Subiendo movimientos…";
  }
}

// ---------- Pantallas y navegación ----------

function mostrarPantalla(pantalla) {
  mostrar($("splash"), false);
  mostrar($("login-screen"), pantalla === "login");
  mostrar($("app-screen"), pantalla === "app");
  if (pantalla === "login") $("login-email").focus();
}

function prepararApp() {
  $("user-display").textContent = sesion.usuario.email;
  aplicarRol();
  reiniciarFiltrosEgresos();
  reiniciarAdmin();
  vaciarPos();
  irA("sec-pos");
}

function aplicarRol() {
  $("user-rol").textContent = ROLES[sesion.rol];
  mostrar($("nav-admin"), esAdmin());
  mostrar($("nav-usuarios"), esAdmin());
}

function irA(seccion) {
  if (SECCIONES_ADMIN.includes(seccion) && !esAdmin()) return;

  document.querySelectorAll(".nav-btn").forEach((b) => {
    const activo = b.dataset.target === seccion;
    b.classList.toggle("active", activo);
    if (activo) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view-section").forEach((s) => mostrar(s, s.id === seccion));

  if (seccion === "sec-pos") enfocarBuscador();
  if (seccion === "sec-egresos") cargarEgresos();
  if (seccion === "sec-stock") {
    renderStock();
    cargarMovimientosStock();
  }
  if (seccion === "sec-admin") abrirAdmin();
  if (seccion === "sec-usuarios") cargarUsuarios();
}
