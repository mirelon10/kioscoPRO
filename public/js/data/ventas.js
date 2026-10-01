import { llamarFuncion } from "../firebase.js";

/**
 * Cobra una venta en el servidor (función registrarVenta): ahí se validan el stock
 * y los precios reales, se calcula el total y el vuelto, y se descuenta el stock.
 *
 * @param {{ turnoId: string, carrito: Array<{productoId: string, cantidad: number}>, metodoPago: string, montoRecibido?: number }} datos
 * @returns {Promise<{ id: string, total: number, vuelto: number|null }>}
 */
export function registrarVenta({ turnoId, carrito, metodoPago, montoRecibido = null }) {
  return llamarFuncion("registrarVenta", { turnoId, items: carrito, metodoPago, montoRecibido });
}

/** @returns {Promise<{ id: string, total: number }>} */
export function registrarRecargaSube({ turnoId, monto, metodoPago }) {
  return llamarFuncion("registrarRecargaSube", { turnoId, monto, metodoPago });
}
