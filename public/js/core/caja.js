import { redondear } from "../lib/dinero.js";
import { METODOS_PAGO, normalizarVenta } from "./ventas.js";

/**
 * Cierre de caja de un turno:
 *   - lo vendido por método de pago (Efectivo, Mercado Pago, Tarjeta) y el total,
 *   - las recargas SUBE (ya incluidas en el método con que se cobraron),
 *   - el efectivo que debería haber en la caja: caja inicial + ventas en efectivo − egresos.
 *
 * La usan la pantalla de cierre de turno y el panel de administración, así ambos
 * muestran exactamente los mismos números.
 */
export function calcularCajaTurno({ cajaInicial, ventas, egresos }) {
  const normalizadas = ventas.map(normalizarVenta);

  const porMetodo = Object.fromEntries(METODOS_PAGO.map((m) => [m, 0]));
  let sube = 0;
  for (const v of normalizadas) {
    if (v.metodoPago in porMetodo) porMetodo[v.metodoPago] += v.total;
    if (v.tipo === "sube") sube += v.total;
  }
  for (const m of METODOS_PAGO) porMetodo[m] = redondear(porMetodo[m]);

  const efectivo = porMetodo["Efectivo"];
  const totalEgresos = redondear(egresos.reduce((s, e) => s + (Number(e.monto) || 0), 0));
  const inicial = Number(cajaInicial) || 0;

  return {
    cajaInicial: inicial,
    porMetodo,
    sube: redondear(sube),
    totalVentas: redondear(METODOS_PAGO.reduce((s, m) => s + porMetodo[m], 0)),
    efectivo,
    egresos: totalEgresos,
    esperado: redondear(inicial + efectivo - totalEgresos),
    cantidadVentas: normalizadas.length,
  };
}

/** Vuelto de un pago en efectivo. `falta` > 0 si el cliente no entregó suficiente. */
export function calcularVuelto(total, montoRecibido) {
  const recibido = Number(montoRecibido);
  if (!Number.isFinite(recibido)) return { vuelto: null, falta: null };
  const diferencia = redondear(recibido - total);
  return diferencia >= 0 ? { vuelto: diferencia, falta: 0 } : { vuelto: null, falta: -diferencia };
}
