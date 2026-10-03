import { db, collection, doc, onSnapshot, runTransaction, serverTimestamp } from "../firebase.js";
import { aCentavos, formatearMoneda } from "../lib/dinero.js";
import { ErrorNegocio } from "../core/errores.js";
import { estaOnline } from "./conexion.js";

/**
 * Caja de guardado: el efectivo que se saca del cajón durante los turnos.
 *
 * cajaGuardado/saldo = { saldoCentavos, movColeccion, movId, actualizado } lleva el saldo acumulado
 * entre turnos. Cada cambio se hace en una transacción junto con el movimiento que lo explica
 * (un guardado, un egreso pagado con la caja de guardado o un ajuste del admin), y las reglas
 * verifican que el saldo cambie exactamente en ese monto y que nunca quede negativo.
 */
const saldoRef = doc(db, "cajaGuardado", "saldo");

const leerSaldoCentavos = (snap) => (snap.exists() ? snap.data().saldoCentavos : 0);

/** Escucha el saldo en tiempo real (en pesos). */
export function escucharSaldoGuardado(alCambiar, alFallar) {
  return onSnapshot(saldoRef, (snap) => alCambiar(leerSaldoCentavos(snap) / 100), alFallar);
}

/**
 * Escribe un movimiento y actualiza el saldo en la misma transacción.
 * `armarMovimiento(saldoAnteriorCentavos)` devuelve los datos del movimiento y el saldo nuevo.
 * Necesita conexión: el saldo se lee del servidor para que dos cajas no se pisen.
 */
async function moverSaldo(coleccion, armarMovimiento) {
  if (!estaOnline()) {
    throw new ErrorNegocio("La caja de guardado necesita conexión a internet. Volvé a intentar cuando vuelva.");
  }
  const movRef = doc(collection(db, coleccion));
  return runTransaction(db, async (tx) => {
    const anterior = leerSaldoCentavos(await tx.get(saldoRef));
    const { datos, nuevoSaldoCentavos } = armarMovimiento(anterior);
    tx.set(movRef, datos);
    tx.set(saldoRef, { saldoCentavos: nuevoSaldoCentavos, movColeccion: coleccion, movId: movRef.id, actualizado: serverTimestamp() });
    return { id: movRef.id, saldo: nuevoSaldoCentavos / 100 };
  });
}

/** Pasa efectivo del cajón del turno a la caja de guardado. */
export function registrarGuardado({ turnoId, usuario, monto }) {
  return moverSaldo("guardados", (anterior) => ({
    datos: { turnoId, empleadoId: usuario.uid, empleadoNombre: usuario.email, monto, fecha: serverTimestamp() },
    nuevoSaldoCentavos: anterior + aCentavos(monto),
  }));
}

/** Paga un egreso con la plata de la caja de guardado (no sale del cajón del turno). */
export function registrarEgresoDesdeGuardado({ turnoId, usuario, monto, motivo, tipo }) {
  return moverSaldo("egresos", (anterior) => {
    const nuevo = anterior - aCentavos(monto);
    if (nuevo < 0) {
      throw new ErrorNegocio(`En la caja de guardado hay ${formatearMoneda(anterior / 100)}. No alcanza para pagar ${formatearMoneda(monto)}.`);
    }
    return {
      datos: { turnoId, empleadoId: usuario.uid, empleadoNombre: usuario.email, monto, motivo, tipo, origen: "guardado", fecha: serverTimestamp() },
      nuevoSaldoCentavos: nuevo,
    };
  });
}

/** El admin fija el saldo (por ejemplo, al contar la caja o cuando el dueño retira plata). Queda registrado. */
export function ajustarSaldoGuardado({ usuario, saldoNuevo, motivo }) {
  return moverSaldo("ajustesGuardado", (anterior) => ({
    datos: {
      saldoAnteriorCentavos: anterior,
      saldoNuevoCentavos: aCentavos(saldoNuevo),
      motivo,
      adminId: usuario.uid,
      adminNombre: usuario.email,
      fecha: serverTimestamp(),
    },
    nuevoSaldoCentavos: aCentavos(saldoNuevo),
  }));
}
