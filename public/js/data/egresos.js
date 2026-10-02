import { db, collection, doc, setDoc, getDocs, query, where, orderBy, serverTimestamp } from "../firebase.js";
import { formatearMoneda } from "../lib/dinero.js";
import { registrarEgresoDesdeGuardado } from "./cajaGuardado.js";
import { esperarConfirmacion } from "./conexion.js";

const egresosCol = collection(db, "egresos");

/**
 * Registra un egreso clasificado como costo fijo o variable.
 * Con origen "guardado" se paga con la caja de guardado (descuenta su saldo, no el cajón del turno):
 * eso necesita conexión. Pagado con la caja del turno, sin conexión queda pendiente de subir.
 *
 * @returns {Promise<boolean>} true si quedó pendiente de subir
 */
export async function registrarEgreso({ turnoId, usuario, monto, motivo, tipo, origen = "caja" }) {
  if (origen === "guardado") {
    await registrarEgresoDesdeGuardado({ turnoId, usuario, monto, motivo, tipo });
    return false;
  }
  const escritura = setDoc(doc(egresosCol), {
    turnoId,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    monto,
    motivo,
    tipo,
    origen: "caja",
    fecha: serverTimestamp(),
  });
  return esperarConfirmacion(escritura, `Egreso de ${formatearMoneda(monto)} (${motivo})`);
}

/** Egresos de todos los empleados entre dos fechas (solo admin: las reglas lo exigen). */
export async function listarEgresos({ desde, hasta }) {
  const snap = await getDocs(
    query(egresosCol, where("fecha", ">=", desde), where("fecha", "<=", hasta), orderBy("fecha", "desc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
