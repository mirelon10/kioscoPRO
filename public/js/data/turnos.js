import {
  db,
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  setDoc,
  query,
  where,
  limit,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from "../firebase.js";
import { ErrorNegocio } from "../core/errores.js";
import { esperarConfirmacion, estaOnline } from "./conexion.js";

const turnosCol = collection(db, "turnos");
// turnosActivos/{uid} = { turnoId }: candado que garantiza un solo turno abierto por empleado.
const candado = (uid) => doc(db, "turnosActivos", uid);

/**
 * Turnos abiertos antes de la migración no tienen candado. Si el empleado tiene uno,
 * se le crea el candado para que la app lo reconozca.
 */
export async function adoptarTurnoSinCandado(uid) {
  if ((await getDoc(candado(uid))).exists()) return;

  const snap = await getDocs(
    query(turnosCol, where("empleadoId", "==", uid), where("estado", "==", "abierto"), limit(1)),
  );
  if (!snap.empty) await setDoc(candado(uid), { turnoId: snap.docs[0].id });
}

/**
 * Escucha el turno abierto del empleado (también se actualiza si lo abre/cierra en otra pestaña).
 * @returns {() => void} función para dejar de escuchar
 */
export function escucharTurnoActivo(uid, alCambiar, alFallar) {
  let turnoId = null;
  let dejarDeEscucharTurno = () => {};

  // Se escucha el candado y, dentro, el documento del turno. Con onSnapshot (y no getDoc)
  // la apertura se ve al instante con la escritura local, sin carreras contra el servidor.
  const dejarDeEscucharCandado = onSnapshot(
    candado(uid),
    (snap) => {
      const nuevoId = snap.exists() ? snap.data().turnoId : null;
      if (nuevoId === turnoId) return;

      turnoId = nuevoId;
      dejarDeEscucharTurno();
      dejarDeEscucharTurno = () => {};
      if (!turnoId) return alCambiar(null);

      dejarDeEscucharTurno = onSnapshot(
        doc(turnosCol, turnoId),
        (turnoSnap) => {
          const datos = turnoSnap.data({ serverTimestamps: "estimate" });
          alCambiar(datos?.estado === "abierto" ? { id: turnoSnap.id, ...datos } : null);
        },
        alFallar,
      );
    },
    alFallar,
  );

  return () => {
    dejarDeEscucharCandado();
    dejarDeEscucharTurno();
  };
}

/**
 * Sin conexión el turno queda abierto en el dispositivo y se sube al volver internet.
 * @returns {Promise<boolean>} true si quedó pendiente de subir
 */
export async function abrirTurno(usuario, cajaInicial) {
  const turnoRef = doc(turnosCol);
  const batch = writeBatch(db);
  batch.set(turnoRef, {
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    cajaInicial,
    estado: "abierto",
    fechaApertura: serverTimestamp(),
  });
  batch.set(candado(usuario.uid), { turnoId: turnoRef.id });

  try {
    return await esperarConfirmacion(batch.commit(), "Apertura de turno");
  } catch (error) {
    // Las reglas rechazan crear el candado si ya existe.
    if (error.code === "permission-denied") throw new ErrorNegocio("Ya tenés un turno abierto.");
    throw error;
  }
}

/**
 * Cierra un turno guardando quién lo cerró, y libera el candado.
 * `efectivoEnCaja` (cajaFinal) es el efectivo que queda en el cajón según el sistema.
 * El admin puede cerrar el turno de otro empleado (las reglas lo verifican).
 * El desglose no se guarda: el panel lo recalcula siempre desde los movimientos del turno.
 *
 * Sin conexión el cierre queda pendiente. Firestore sube las escrituras en orden, así que el
 * cierre llega después de las ventas y egresos hechos antes sin conexión (si llegara primero,
 * las reglas las rechazarían por turno cerrado).
 * @returns {Promise<boolean>} true si quedó pendiente de subir
 */
export async function cerrarTurno(turno, efectivoEnCaja, usuario) {
  const batch = writeBatch(db);
  batch.update(doc(turnosCol, turno.id), {
    estado: "cerrado",
    cajaFinal: efectivoEnCaja,
    fechaCierre: serverTimestamp(),
    cerradoPor: usuario.uid,
    cerradoPorNombre: usuario.email,
  });
  // Solo si el candado apunta a este turno (un turno viejo puede no tenerlo).
  const candadoSnap = await (estaOnline() ? getDoc : getDocFromCache)(candado(turno.empleadoId));
  if (candadoSnap.exists() && candadoSnap.data().turnoId === turno.id) batch.delete(candado(turno.empleadoId));
  return esperarConfirmacion(batch.commit(), "Cierre de turno");
}

// ---------- Ventas, egresos y caja de guardado de un turno (para calcular la caja) ----------

// Se filtra también por empleadoId: las reglas solo dejan al empleado leer lo suyo.
const delTurno = (coleccion, turno) =>
  query(collection(db, coleccion), where("turnoId", "==", turno.id), where("empleadoId", "==", turno.empleadoId));

const datosDe = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));

/**
 * Escucha en tiempo real las ventas, egresos y guardados del turno abierto: el cierre
 * y las listas del empleado se actualizan solos.
 * @returns {() => void} función para dejar de escuchar
 */
export function escucharMovimientosTurno(turno, alCambiar, alFallar) {
  const movimientos = { ventas: null, egresos: null, guardados: null };
  const avisar = () => {
    if (movimientos.ventas && movimientos.egresos && movimientos.guardados) alCambiar({ ...movimientos });
  };
  const dejarVentas = onSnapshot(delTurno("ventas", turno), (s) => { movimientos.ventas = datosDe(s); avisar(); }, alFallar);
  const dejarEgresos = onSnapshot(delTurno("egresos", turno), (s) => { movimientos.egresos = datosDe(s); avisar(); }, alFallar);
  const dejarGuardados = onSnapshot(delTurno("guardados", turno), (s) => { movimientos.guardados = datosDe(s); avisar(); }, alFallar);
  return () => {
    dejarVentas();
    dejarEgresos();
    dejarGuardados();
  };
}

/** Lectura única, para que el admin vea la caja de un turno ajeno antes de cerrarlo. */
export async function obtenerMovimientosTurno(turno) {
  const [ventas, egresos, guardados] = await Promise.all(
    ["ventas", "egresos", "guardados"].map((coleccion) => getDocs(delTurno(coleccion, turno))),
  );
  return { ventas: datosDe(ventas), egresos: datosDe(egresos), guardados: datosDe(guardados) };
}
