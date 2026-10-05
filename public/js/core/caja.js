import { formatearMoneda, redondear } from "../lib/dinero.js";
import { METODOS_PAGO, armarVenta, normalizarVenta } from "./ventas.js";
import { ErrorNegocio } from "./errores.js";
import { normalizarEgreso } from "./egresos.js";

const sumar = (lista, campo) => redondear(lista.reduce((s, x) => s + (Number(x[campo]) || 0), 0));

/**
 * Cierre de caja de un turno, todo en un solo total:
 *
 *   ventas de productos por método (Efectivo, Mercado Pago, Tarjeta) + recargas SUBE
 *   − caja inicial − egresos − caja de guardado = total
 *
 * Las recargas SUBE van en su propia línea: no se suman de nuevo en el método con que se cobraron.
 * Solo cuentan los egresos pagados con la caja: los pagados con la caja de guardado no salen del cajón.
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
  const totalEgresos = sumar(egresos.map(normalizarEgreso).filter((e) => e.origen === "caja"), "monto");
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

/**
 * Resumen que se guarda en el turno al cerrarlo (turnos/{id}.resumen). Con él, el panel del admin
 * no vuelve a leer las ventas del turno: con miles de ventas por día, leerlas en cada consulta
 * agotaría la cuota diaria gratuita de lecturas.
 */
export function resumenDeCaja(caja) {
  return {
    efectivo: caja.porMetodo["Efectivo"],
    mercadoPago: caja.porMetodo["Mercado Pago"],
    tarjeta: caja.porMetodo["Tarjeta"],
    sube: caja.sube,
    totalVentas: caja.totalVentas,
    egresos: caja.egresos,
    guardado: caja.guardado,
    total: caja.total,
    cantidadVentas: caja.cantidadVentas,
  };
}

/** Caja de un turno cerrado a partir de su resumen guardado (el inverso de resumenDeCaja). */
export function cajaDesdeResumen(cajaInicial, r) {
  return {
    porMetodo: { Efectivo: r.efectivo, "Mercado Pago": r.mercadoPago, Tarjeta: r.tarjeta },
    sube: r.sube,
    totalVentas: r.totalVentas,
    cajaInicial: Number(cajaInicial) || 0,
    egresos: r.egresos,
    guardado: r.guardado,
    total: r.total,
    cantidadVentas: r.cantidadVentas,
  };
}

/** Vuelto de un pago en efectivo. `falta` > 0 si el cliente no entregó suficiente. */
export function calcularVuelto(total, montoRecibido) {
  const recibido = Number(montoRecibido);
  if (!Number.isFinite(recibido)) return { vuelto: null, falta: null };
  const diferencia = redondear(recibido - total);
  return diferencia >= 0 ? { vuelto: diferencia, falta: 0 } : { vuelto: null, falta: -diferencia };
}

/**
 * Arma la venta (armarVenta) y verifica el pago. En efectivo, `montoRecibido` es obligatorio
 * y tiene que cubrir el total real, que puede diferir del carrito en pantalla.
 *
 * @returns {{ lineas: object[], total: number, nuevosStocks: number[], vuelto: number|null }}
 */
export function armarCobro(carrito, productos, metodoPago, montoRecibido) {
  const venta = armarVenta(carrito, productos);
  if (metodoPago !== "Efectivo") return { ...venta, vuelto: null };

  const pago = calcularVuelto(venta.total, montoRecibido);
  if (pago.vuelto === null) {
    throw new ErrorNegocio(
      `El pago no alcanza: el total es ${formatearMoneda(venta.total)}` +
        (pago.falta ? ` y faltan ${formatearMoneda(pago.falta)}.` : "."),
    );
  }
  return { ...venta, vuelto: pago.vuelto };
}
