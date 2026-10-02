import { redondear } from "../lib/dinero.js";
import { METODOS_PAGO, normalizarVenta } from "./ventas.js";

const sumar = (lista, campo) => redondear(lista.reduce((s, x) => s + (Number(x[campo]) || 0), 0));

/**
 * Cierre de caja de un turno, todo en un solo total:
 *
 *   ventas de productos por método (Efectivo, Mercado Pago, Tarjeta) + recargas SUBE
 *   − caja inicial − egresos − caja de guardado = total
 *
 * Las recargas SUBE van en su propia línea: no se suman de nuevo en el método con que se cobraron.
 *
 * `efectivoEnCaja` es la plata física que debería quedar en el cajón (caja inicial + todo lo cobrado
 * en efectivo, SUBE incluida, − egresos − guardado). No se muestra: sirve para no guardar más plata
 * de la que hay y se registra al cerrar.
 *
 * La usan la pantalla de turno y el panel de administración, así ambos muestran lo mismo.
 */
export function calcularCajaTurno({ cajaInicial, ventas, egresos, guardados = [] }) {
  const normalizadas = ventas.map(normalizarVenta);

  const porMetodo = Object.fromEntries(METODOS_PAGO.map((m) => [m, 0]));
  let sube = 0;
  let efectivoCobrado = 0;
  for (const v of normalizadas) {
    if (v.tipo === "sube") sube += v.total;
    else if (v.metodoPago in porMetodo) porMetodo[v.metodoPago] += v.total;
    if (v.metodoPago === "Efectivo") efectivoCobrado += v.total;
  }
  for (const m of METODOS_PAGO) porMetodo[m] = redondear(porMetodo[m]);

  const inicial = Number(cajaInicial) || 0;
  const totalVentas = redondear(METODOS_PAGO.reduce((s, m) => s + porMetodo[m], 0) + sube);
  const totalEgresos = sumar(egresos, "monto");
  const guardado = sumar(guardados, "monto");

  return {
    porMetodo,
    sube: redondear(sube),
    totalVentas,
    cajaInicial: inicial,
    egresos: totalEgresos,
    guardado,
    total: redondear(totalVentas - inicial - totalEgresos - guardado),
    efectivoEnCaja: redondear(inicial + efectivoCobrado - totalEgresos - guardado),
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
