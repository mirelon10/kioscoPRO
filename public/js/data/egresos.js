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

/**
 * Egresos entre dos fechas. Si se pasa empleadoId, filtra en el servidor
 * (obligatorio para empleados: las reglas solo les dejan leer los propios).
 */
export async function listarEgresos({ desde, hasta, empleadoId = null }) {
  const filtros = [where("fecha", ">=", desde), where("fecha", "<=", hasta), orderBy("fecha", "desc")];
  if (empleadoId) filtros.unshift(where("empleadoId", "==", empleadoId));

  const snap = await getDocs(query(egresosCol, ...filtros));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
