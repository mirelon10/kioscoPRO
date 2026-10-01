import {
  db,
  collection,
  doc,
  getDoc,
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
    await batch.commit();
  } catch (error) {
    // Las reglas rechazan crear el candado si ya existe.
    if (error.code === "permission-denied") throw new ErrorNegocio("Ya tenés un turno abierto.");
    throw error;
  }
  return turnoRef.id;
}

export async function cerrarTurno(uid, turnoId, cajaFinal) {
  const batch = writeBatch(db);
  batch.update(doc(turnosCol, turnoId), {
    estado: "cerrado",
    cajaFinal,
    fechaCierre: serverTimestamp(),
  });
  batch.delete(candado(uid));
  await batch.commit();
}
