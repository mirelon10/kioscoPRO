import { db, waitForPendingWrites } from "../firebase.js";
import { conLimiteDeTiempo, TiempoAgotado } from "../lib/espera.js";
import { mensajeDeError } from "../core/errores.js";

/**
 * Trabajo sin conexión.
 *
 * Firestore guarda cada escritura en el dispositivo (IndexedDB, ver firebase.js) y la sube sola
 * cuando vuelve internet, en el mismo orden en que se hizo, aunque se recargue la página.
 * Pero la promesa de la escritura recién se resuelve cuando el servidor la confirma: sin internet
 * quedaría colgada. Por eso, sin conexión no se espera la confirmación: la escritura queda
 * pendiente y, si el servidor la rechaza al subirla, se avisa.
 *
 * Las transacciones (runTransaction) no funcionan sin conexión: necesitan leer del servidor.
 */

/** Cuánto se espera la confirmación del servidor antes de dar la escritura por pendiente. */
const ESPERA_CONFIRMACION_MS = 5000;
/** Al arrancar, si hay escrituras de una sesión anterior sin subir, se avisa pasado este tiempo. */
const ESPERA_AVISO_INICIAL_MS = 1500;

/** navigator.onLine solo detecta que no hay red; con wifi sin internet da true (para eso está el límite de tiempo). */
export const estaOnline = () => navigator.onLine !== false;

// ---------- Estado (para el indicador de la barra lateral) ----------

let sincronizando = false;
let generacion = 0;
const suscriptores = new Set();

const notificar = () => {
  const estado = { online: estaOnline(), sincronizando };
  for (const fn of suscriptores) fn(estado);
};

/** @returns {() => void} función para desuscribirse */
export function alCambiarConexion(fn) {
  suscriptores.add(fn);
  fn({ online: estaOnline(), sincronizando });
  return () => suscriptores.delete(fn);
}

export const haySincronizacionPendiente = () => sincronizando;

window.addEventListener("online", notificar);
window.addEventListener("offline", notificar);

/** Marca que hay escrituras sin confirmar hasta que el servidor confirme todas. */
function seguirSincronizacion(demoraAviso = 0) {
  const gen = ++generacion;
  const aviso = setTimeout(() => {
    if (gen !== generacion) return;
    sincronizando = true;
    notificar();
  }, demoraAviso);

  // Espera todas las escrituras hechas hasta ahora. Se rechaza si cambia el usuario.
  waitForPendingWrites(db)
    .catch(() => {})
    .finally(() => {
      if (gen !== generacion) return;
      clearTimeout(aviso);
      sincronizando = false;
      notificar();
    });
}

/** Al iniciar sesión: muestra si quedaron escrituras sin subir de una sesión anterior. */
export function revisarPendientesAlIniciar() {
  seguirSincronizacion(ESPERA_AVISO_INICIAL_MS);
}

// ---------- Avisos de escrituras rechazadas después ----------

let avisarProblema = ({ titulo, texto }) => console.warn(titulo, texto);

/** main.js conecta acá cómo mostrarle al usuario los problemas que aparecen al sincronizar. */
export function alProblemaDeSincronizacion(fn) {
  avisarProblema = fn;
}

export function reportarProblema(titulo, texto, error) {
  if (error) console.error(error);
  avisarProblema({ titulo, texto });
}

const reportarRechazo = (descripcion) => (error) =>
  reportarProblema(
    "No se pudo subir un movimiento hecho sin conexión",
    `${descripcion}: ${mensajeDeError(error, "el servidor lo rechazó.")}`,
    error,
  );

/**
 * Deja una escritura ya hecha siguiéndose en segundo plano.
 * @param {Promise} escritura  promesa de setDoc / addDoc / batch.commit()
 * @param {string} descripcion  qué se escribió, para el aviso si el servidor la rechaza
 * @param {(error) => void} [alRechazar]  reemplaza el aviso por defecto
 */
export function seguirPendiente(escritura, descripcion, alRechazar = reportarRechazo(descripcion)) {
  escritura.catch(alRechazar);
  seguirSincronizacion();
}

/**
 * Espera que el servidor confirme la escritura, salvo que no haya conexión o tarde demasiado:
 * en ese caso la deja pendiente (Firestore la sube sola al volver internet).
 * Si el servidor la rechaza a tiempo, el error se propaga como antes.
 *
 * @returns {Promise<boolean>} true si quedó pendiente de subir
 */
export async function esperarConfirmacion(escritura, descripcion) {
  if (estaOnline()) {
    try {
      await conLimiteDeTiempo(escritura, ESPERA_CONFIRMACION_MS);
      return false;
    } catch (error) {
      if (!(error instanceof TiempoAgotado)) throw error;
    }
  }
  seguirPendiente(escritura, descripcion);
  return true;
}
