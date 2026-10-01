import { db, collection, doc, setDoc, runTransaction, serverTimestamp } from "../firebase.js";
import { armarVenta } from "../core/ventas.js";
import { calcularVuelto } from "../core/caja.js";
import { ErrorNegocio } from "../core/errores.js";
import { formatearMoneda, redondear } from "../lib/dinero.js";

const ventasCol = collection(db, "ventas");

/**
 * Registra una venta y descuenta el stock en una transacción: lee los precios y el stock
 * vigentes, y si dos cajas venden el último producto a la vez, una de las dos falla en
 * lugar de dejar stock negativo.
 *
 * En efectivo, `montoRecibido` es obligatorio y tiene que cubrir el total real.
 *
 * @param {{ turnoId: string, usuario: object, carrito: Array<{productoId: string, cantidad: number}>, metodoPago: string, montoRecibido?: number|null }} datos
 * @returns {Promise<{ id: string, total: number, vuelto: number|null }>}
 */
export function registrarVenta({ turnoId, usuario, carrito, metodoPago, montoRecibido = null }) {
  const ventaRef = doc(ventasCol);
  const enEfectivo = metodoPago === "Efectivo";

  return runTransaction(db, async (tx) => {
    const refs = carrito.map((item) => doc(db, "productos", item.productoId));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const { lineas, total, nuevosStocks } = armarVenta(
      carrito,
      snaps.map((s) => (s.exists() ? s.data() : null)),
    );

    // El total se recalcula con los precios de la base: puede diferir del carrito en pantalla.
    let vuelto = null;
    if (enEfectivo) {
      const pago = calcularVuelto(total, montoRecibido);
      if (pago.vuelto === null) {
        throw new ErrorNegocio(
          `El pago no alcanza: el total es ${formatearMoneda(total)}` +
            (pago.falta ? ` y faltan ${formatearMoneda(pago.falta)}.` : "."),
        );
      }
      vuelto = pago.vuelto;
    }

    refs.forEach((ref, i) => tx.update(ref, { stock: nuevosStocks[i] }));
    tx.set(ventaRef, {
      tipo: "productos",
      turnoId,
      empleadoId: usuario.uid,
      empleadoNombre: usuario.email,
      metodoPago,
      items: lineas,
      total,
      montoRecibido: enEfectivo ? redondear(montoRecibido) : null,
      vuelto,
      timestamp: serverTimestamp(),
    });

    return { id: ventaRef.id, total, vuelto };
  });
}

export async function registrarRecargaSube({ turnoId, usuario, monto, metodoPago }) {
  const total = redondear(monto);
  const ventaRef = doc(ventasCol);
  await setDoc(ventaRef, {
    tipo: "sube",
    turnoId,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    metodoPago,
    items: [{ nombre: "Recarga SUBE", precio: total, cantidad: 1, subtotal: total }],
    total,
    montoRecibido: null,
    vuelto: null,
    timestamp: serverTimestamp(),
  });
  return { id: ventaRef.id, total };
}
