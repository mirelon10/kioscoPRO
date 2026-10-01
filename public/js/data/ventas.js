import { db, collection, doc, setDoc, runTransaction, serverTimestamp } from "../firebase.js";
import { armarVenta } from "../core/ventas.js";
import { redondear } from "../lib/dinero.js";

const ventasCol = collection(db, "ventas");

/**
 * Registra una venta y descuenta el stock en una transacción: si dos cajas venden
 * el último producto a la vez, una de las dos falla en lugar de dejar stock negativo.
 *
 * @param {{ turnoId: string, usuario: object, carrito: Array<{productoId: string, cantidad: number}>, metodoPago: string }} datos
 * @returns {Promise<{ id: string, total: number }>}
 */
export function registrarVenta({ turnoId, usuario, carrito, metodoPago }) {
  const ventaRef = doc(ventasCol);

  return runTransaction(db, async (tx) => {
    const refs = carrito.map((item) => doc(db, "productos", item.productoId));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const { lineas, total, nuevosStocks } = armarVenta(
      carrito,
      snaps.map((s) => (s.exists() ? s.data() : null)),
    );

    refs.forEach((ref, i) => tx.update(ref, { stock: nuevosStocks[i] }));
    tx.set(ventaRef, {
      tipo: "productos",
      turnoId,
      empleadoId: usuario.uid,
      empleadoNombre: usuario.email,
      metodoPago,
      items: lineas,
      total,
      timestamp: serverTimestamp(),
    });

    return { id: ventaRef.id, total };
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
    timestamp: serverTimestamp(),
  });
  return { id: ventaRef.id, total };
}
