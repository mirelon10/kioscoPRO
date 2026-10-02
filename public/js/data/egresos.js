import { db, collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from "../firebase.js";
import { registrarEgresoDesdeGuardado } from "./cajaGuardado.js";

const egresosCol = collection(db, "egresos");

/**
 * Registra un egreso clasificado como costo fijo o variable.
 * Con origen "guardado" se paga con la caja de guardado (descuenta su saldo, no el cajón del turno).
 */
export function registrarEgreso({ turnoId, usuario, monto, motivo, tipo, origen = "caja" }) {
  if (origen === "guardado") return registrarEgresoDesdeGuardado({ turnoId, usuario, monto, motivo, tipo });
  return addDoc(egresosCol, {
    turnoId,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    monto,
    motivo,
    tipo,
    origen: "caja",
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
