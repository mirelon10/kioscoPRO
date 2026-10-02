import { aDate, fechaLocalISO } from "../lib/fechas.js";

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
      ["Total ventas", resumen.totalVentas],
      ["  de las cuales, recargas SUBE", resumen.sube],
      ["Total egresos", resumen.totalEgresos],
      ["Neto (ventas − egresos)", resumen.neto],
    ],
  };

  const hojaTurnos = {
    nombre: "Turnos",
    anchos: [28, 17, 17, 10, 14, 14, 14, 14, 14, 16, 14, 14, 14, 14, 28],
    columnasMoneda: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    filaDesde: 1,
    filas: [
      [
        "Empleado", "Apertura", "Cierre", "Estado", "Caja inicial",
        "Ventas efectivo", "Ventas Mercado Pago", "Ventas tarjeta", "Total ventas", "Recargas SUBE (incluidas)",
        "Egresos", "Esperado", "Contado", "Diferencia", "Cerrado por",
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
        t.totalVentas,
        t.sube,
        t.egresos,
        t.esperado,
        t.cajaFinal ?? "",
        t.diferencia ?? "",
        t.cerradoPor ?? "",
      ]),
    ],
  };

  const hojaEgresos = {
    nombre: "Egresos",
    anchos: [17, 28, 40, 14],
    columnasMoneda: [3],
    filaDesde: 1,
    filas: [
      ["Fecha", "Empleado", "Motivo", "Monto"],
      ...resumen.egresos.map((e) => [aDate(e.fecha) ?? "", e.empleadoNombre || e.empleadoId || "", e.motivo ?? "", Number(e.monto) || 0]),
    ],
  };

  return {
    nombreArchivo: `resumen-caja_${fechaLocalISO(desde)}_a_${fechaLocalISO(hasta)}.xlsx`,
    hojas: [hojaResumen, hojaTurnos, hojaEgresos],
  };
}
