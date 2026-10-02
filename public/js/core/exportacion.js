import { aDate, fechaLocalISO } from "../lib/fechas.js";
import { ORIGENES_EGRESO, etiquetaTipoEgreso, normalizarEgreso } from "./egresos.js";

const fechaCorta = (fecha) => fecha.toLocaleDateString("es-AR");

/**
 * Arma las hojas del Excel del resumen de caja a partir de calcularResumen().
 * @returns {{ nombreArchivo: string, hojas: object[] }}
 */
export function armarExcelResumen(resumen, { desde, hasta, empleado = "Todos los empleados", generado = new Date() }) {
  const periodo = `${fechaCorta(desde)} al ${fechaCorta(hasta)}`;

  const hojaResumen = {
    nombre: "Resumen",
    anchos: [34, 18],
    columnasMoneda: [1],
    filaDesde: 5,
    filas: [
      ["Resumen de caja"],
      ["Período", periodo],
      ["Empleado", empleado],
      ["Generado", generado],
      [],
      ["Concepto", "Monto"],
      ["Ventas en efectivo", resumen.porMetodo["Efectivo"]],
      ["Ventas con Mercado Pago", resumen.porMetodo["Mercado Pago"]],
      ["Ventas con tarjeta", resumen.porMetodo["Tarjeta"]],
      ["Recargas SUBE", resumen.sube],
      ["Total ventas", resumen.totalVentas],
      ["Total egresos", resumen.totalEgresos],
      ["  Costos fijos", resumen.egresosTotales.fijos],
      ["  Costos variables", resumen.egresosTotales.variables],
      ["  Sin clasificar", resumen.egresosTotales.sinClasificar],
      ["  Pagados con la caja de guardado", resumen.egresosTotales.desdeGuardado],
      ["Caja de guardado", resumen.totalGuardado],
      ["Neto (ventas − egresos)", resumen.neto],
    ],
  };

  const hojaTurnos = {
    nombre: "Turnos",
    anchos: [28, 17, 17, 10, 14, 14, 14, 14, 14, 14, 14, 14, 14, 28],
    columnasMoneda: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    filaDesde: 1,
    filas: [
      [
        "Empleado", "Apertura", "Cierre", "Estado", "Caja inicial",
        "Ventas efectivo", "Ventas Mercado Pago", "Ventas tarjeta", "Recargas SUBE", "Total ventas",
        "Egresos", "Caja de guardado", "Total", "Cerrado por",
      ],
      ...resumen.turnos.map((t) => [
        t.empleado,
        t.apertura ?? "",
        t.cierre ?? "",
        t.abierto ? "Abierto" : "Cerrado",
        t.cajaInicial,
        t.efectivo,
        t.mercadoPago,
        t.tarjeta,
        t.sube,
        t.totalVentas,
        t.egresos,
        t.guardado,
        t.total,
        t.cerradoPor ?? "",
      ]),
    ],
  };

  const hojaEgresos = {
    nombre: "Egresos",
    anchos: [17, 28, 40, 16, 18, 14],
    columnasMoneda: [5],
    filaDesde: 1,
    filas: [
      ["Fecha", "Empleado", "Motivo", "Tipo", "Pagado con", "Monto"],
      ...resumen.egresos.map(normalizarEgreso).map((e) => [
        aDate(e.fecha) ?? "",
        e.empleadoNombre || e.empleadoId || "",
        e.motivo ?? "",
        etiquetaTipoEgreso(e.tipo),
        ORIGENES_EGRESO[e.origen],
        e.monto,
      ]),
    ],
  };

  return {
    nombreArchivo: `resumen-caja_${fechaLocalISO(desde)}_a_${fechaLocalISO(hasta)}.xlsx`,
    hojas: [hojaResumen, hojaTurnos, hojaEgresos],
  };
}
