import { redondear } from "../lib/dinero.js";
import { ErrorNegocio } from "./errores.js";

export const METODOS_PAGO = ["Efectivo", "Mercado Pago", "Tarjeta"];

/**
 * Arma las líneas de una venta con los precios y el stock VIGENTES en la base
 * (no los que tenía el carrito en pantalla).
 *
 * @param {Array<{productoId: string, cantidad: number}>} carrito
 * @param {Array<object|null>} productos  datos actuales de cada producto, en el mismo orden (null si no existe)
 * @returns {{ lineas: object[], total: number, nuevosStocks: number[] }}
 */
export function armarVenta(carrito, productos) {
  if (carrito.length === 0) throw new ErrorNegocio("El carrito está vacío.");

  const lineas = carrito.map((item, i) => {
    const producto = productos[i];
    if (!producto) throw new ErrorNegocio("Un producto del carrito ya no existe. Quitalo y volvé a intentar.");
    if (!Number.isInteger(item.cantidad) || item.cantidad < 1) {
      throw new ErrorNegocio(`Cantidad inválida para ${producto.nombre}.`);
    }
    if (producto.stock < item.cantidad) {
      throw new ErrorNegocio(`Stock insuficiente de ${producto.nombre} (quedan ${producto.stock}).`);
    }
    return {
      productoId: item.productoId,
      nombre: producto.nombre,
      precio: producto.precio,
      cantidad: item.cantidad,
      subtotal: redondear(producto.precio * item.cantidad),
    };
  });

  return {
    lineas,
    total: redondear(lineas.reduce((suma, l) => suma + l.subtotal, 0)),
    nuevosStocks: carrito.map((item, i) => productos[i].stock - item.cantidad),
  };
}

/**
 * Lleva ventas viejas al formato actual. Antes la SUBE se guardaba con metodoPago "Sube";
 * ahora es tipo "sube" y el método es cómo pagó el cliente (las viejas se cobraban en efectivo).
 */
export function normalizarVenta(venta) {
  const esSubeVieja = venta.metodoPago === "Sube";
  let metodoPago = venta.metodoPago;
  if (esSubeVieja) metodoPago = "Efectivo";
  if (metodoPago === "Mercadopago") metodoPago = "Mercado Pago";

  return {
    ...venta,
    tipo: venta.tipo ?? (esSubeVieja ? "sube" : "productos"),
    metodoPago,
    total: Number(venta.total) || 0,
  };
}
