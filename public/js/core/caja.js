import { redondear } from "../lib/dinero.js";
import { normalizarVenta } from "./ventas.js";

/**
 * Efectivo que debería haber en la caja de un turno:
 *   caja inicial + ventas en efectivo (incluye recargas SUBE) − egresos.
 *
 * La usan la pantalla de cierre de turno y el panel de administración, así ambos
 * muestran exactamente el mismo número.
 */
export function calcularCajaTurno({ cajaInicial, ventas, egresos }) {
  const normalizadas = ventas.map(normalizarVenta);
  const efectivo = redondear(
    normalizadas.filter((v) => v.metodoPago === "Efectivo").reduce((s, v) => s + v.total, 0),
  );
  const otrosMedios = redondear(
    normalizadas.filter((v) => v.metodoPago !== "Efectivo").reduce((s, v) => s + v.total, 0),
  );
  const totalEgresos = redondear(egresos.reduce((s, e) => s + (Number(e.monto) || 0), 0));
  const inicial = Number(cajaInicial) || 0;

  return {
    cajaInicial: inicial,
    efectivo,
    otrosMedios,
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
