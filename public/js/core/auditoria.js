import { redondear } from "../lib/dinero.js";

// Ventas para revisar: inconsistencias que la app nunca genera sola. Pueden indicar una venta
// cargada a mano (saltando la app) para registrar menos plata o descontar otro stock.
// Las reglas de Firestore no pueden recorrer los ítems de una venta, así que esto se controla acá.

const distinto = (a, b) => Math.abs(redondear(a) - redondear(b)) >= 0.01;

/**
 * @param {object[]} ventas  ventas tal cual vienen de Firestore
 * @param {object[]} productos  catálogo actual (para comparar con el costo)
 * @returns {Array<{ venta: object, problemas: string[] }>}  solo las ventas con algún problema
 */
export function revisarVentas(ventas, productos) {
  const porId = new Map(productos.map((p) => [p.id, p]));
  return ventas
    .map((venta) => ({ venta, problemas: problemasDeVenta(venta, porId) }))
    .filter((r) => r.problemas.length > 0);
}

function problemasDeVenta(venta, productosPorId) {
  const problemas = [];
  const items = Array.isArray(venta.items) ? venta.items : [];
  const total = Number(venta.total);

  if (items.length === 0) problemas.push("No tiene productos.");

  for (const item of items) {
    const nombre = item.nombre || "un producto";
    const precio = Number(item.precio);
    const cantidad = Number(item.cantidad);
    const subtotal = Number(item.subtotal);

    if (!Number.isInteger(cantidad) || cantidad < 1) problemas.push(`Cantidad inválida en ${nombre}: ${item.cantidad}.`);
    if (!(precio >= 0)) problemas.push(`Precio inválido en ${nombre}: ${item.precio}.`);
    else if (distinto(precio * cantidad, subtotal)) {
      problemas.push(`El subtotal de ${nombre} no da: ${cantidad} × ${precio} ≠ ${subtotal}.`);
    }

    const producto = item.productoId ? productosPorId.get(item.productoId) : null;
    if (producto && producto.precioCompra > 0 && precio < producto.precioCompra) {
      problemas.push(`${nombre} se vendió a ${precio}, por debajo del costo actual (${producto.precioCompra}).`);
    }
  }

  const suma = items.reduce((s, item) => s + (Number(item.subtotal) || 0), 0);
  if (items.length > 0 && distinto(suma, total)) {
    problemas.push(`El total (${redondear(total)}) no coincide con la suma de los productos (${redondear(suma)}).`);
  }

  if (venta.montoRecibido != null && venta.vuelto != null && distinto(venta.montoRecibido - total, venta.vuelto)) {
    problemas.push(`El vuelto no da: pagó ${venta.montoRecibido}, total ${redondear(total)}, vuelto ${venta.vuelto}.`);
  }

  // productoIds dice de qué productos se descontó stock: tiene que coincidir con lo vendido.
  if (Array.isArray(venta.productoIds)) {
    const vendidos = new Set(items.map((i) => i.productoId).filter(Boolean));
    const descontados = new Set(venta.productoIds);
    const iguales = vendidos.size === descontados.size && [...vendidos].every((id) => descontados.has(id));
    if (!iguales) problemas.push("Los productos vendidos no coinciden con los que descontaron stock.");
  }

  return problemas;
}
