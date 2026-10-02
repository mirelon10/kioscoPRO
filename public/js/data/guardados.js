import { db, collection, addDoc, serverTimestamp } from "../firebase.js";

const guardadosCol = collection(db, "guardados");

/**
 * Pasa efectivo de la caja a la caja de guardado durante el turno.
 * Se resta del total del cierre. Es inmutable, como los egresos.
 */
export function registrarGuardado({ turnoId, usuario, monto }) {
  return addDoc(guardadosCol, {
    turnoId,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    monto,
    fecha: serverTimestamp(),
  });
}
