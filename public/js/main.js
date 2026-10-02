import { auth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "./firebase.js";
import { $, mostrar } from "./lib/dom.js";
import { mensajeDeError } from "./core/errores.js";
import { escucharProductos } from "./data/productos.js";
import { escucharSaldoGuardado } from "./data/cajaGuardado.js";
import { adoptarTurnoSinCandado, escucharTurnoActivo, escucharMovimientosTurno } from "./data/turnos.js";
import { sesion, actualizarSesion, esAdmin } from "./estado.js";
import { avisar, mostrarError } from "./ui.js";
import { iniciarPos, vaciarPos, enfocarBuscador } from "./views/pos.js";
import { iniciarTurno } from "./views/turno.js";
import { iniciarEgresos, cargarEgresos, reiniciarFiltrosEgresos } from "./views/egresos.js";
import { iniciarAdmin, reiniciarAdmin, abrirAdmin } from "./views/admin.js";
import { iniciarStock, renderStock } from "./views/stock.js";

const ROLES = { admin: "Administrador", empleado: "Empleado" };

/** Listeners de Firestore activos: se cortan al cerrar sesión (si no, fallan por permisos). */
let desuscribir = [];
/** Se incrementa en cada cambio de sesión para descartar respuestas que lleguen tarde. */
let generacion = 0;

// ---------- Arranque ----------

iniciarPos();
iniciarTurno();
iniciarEgresos();
iniciarAdmin();
iniciarStock();

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => irA(btn.dataset.target));
});
$("form-login").addEventListener("submit", iniciarSesion);
$("btn-logout").addEventListener("click", cerrarSesion);

onAuthStateChanged(auth, async (usuario) => {
  const gen = ++generacion;
  detenerListeners();

  if (!usuario) {
    actualizarSesion({ usuario: null, rol: null, turno: null, movimientosTurno: null, productos: [], saldoGuardado: null });
    vaciarPos();
    return mostrarPantalla("login");
  }

  try {
    const rol = await leerRol(usuario);
    if (gen !== generacion) return;

    if (!ROLES[rol]) {
      $("login-error").textContent = "Tu usuario no tiene un rol asignado. Pedile al administrador que te habilite.";
      return signOut(auth);
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

/** Lee el rol (custom claim). Fuerza la renovación del token para tomar roles recién asignados. */
async function leerRol(usuario) {
  try {
    return (await usuario.getIdTokenResult(true)).claims.rol;
  } catch {
    // Sin internet: usar el token en caché.
    return (await usuario.getIdTokenResult()).claims.rol;
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
    await signInWithEmailAndPassword(auth, email, password);
    $("login-password").value = "";
  } catch (err) {
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
  try {
    await signOut(auth);
  } catch (error) {
    mostrarError(error);
  }
}

function escucharDatos(uid, gen) {
  const vigente = () => gen === generacion;
  const alFallar = (mensaje) => (error) => vigente() && mostrarError(error, mensaje);

  desuscribir.push(
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

  adoptarTurnoSinCandado(uid)
    .catch((error) => console.error("No se pudo revisar turnos anteriores", error))
    .finally(() => {
      if (!vigente()) return;
      desuscribir.push(escucharTurnoActivo(uid, alCambiarTurno, alFallar("No se pudo cargar tu turno.")));
    });
}

function detenerListeners() {
  desuscribir.forEach((fn) => fn());
  desuscribir = [];
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
  $("user-rol").textContent = ROLES[sesion.rol];
  mostrar($("nav-admin"), esAdmin());
  reiniciarFiltrosEgresos();
  reiniciarAdmin();
  vaciarPos();
  irA("sec-pos");
}

function irA(seccion) {
  if (seccion === "sec-admin" && !esAdmin()) return;

  document.querySelectorAll(".nav-btn").forEach((b) => {
    const activo = b.dataset.target === seccion;
    b.classList.toggle("active", activo);
    if (activo) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view-section").forEach((s) => mostrar(s, s.id === seccion));

  if (seccion === "sec-pos") enfocarBuscador();
  if (seccion === "sec-egresos") cargarEgresos();
  if (seccion === "sec-stock") renderStock();
  if (seccion === "sec-admin") abrirAdmin();
}
