import { db, collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from "../firebase.js";

const egresosCol = collection(db, "egresos");

export function registrarEgreso({ turnoId, usuario, monto, motivo }) {
  return addDoc(egresosCol, {
    turnoId,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    monto,
    motivo,
    fecha: serverTimestamp(),
  });
}

/** Egresos de todos los empleados entre dos fechas (solo admin: las reglas lo exigen). */
export async function listarEgresos({ desde, hasta }) {
  const snap = await getDocs(
    query(egresosCol, where("fecha", ">=", desde), where("fecha", "<=", hasta), orderBy("fecha", "desc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
