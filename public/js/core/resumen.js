import { redondear } from "../lib/dinero.js";
import { aDate } from "../lib/fechas.js";
import { METODOS_PAGO, normalizarVenta } from "./ventas.js";
import { calcularCajaTurno } from "./caja.js";

function enRango(fecha, desde, hasta) {
  return fecha != null && fecha >= desde && fecha <= hasta;
}

/**
 * Calcula los totales del panel de administración.
 *
 * - Los totales por método de pago incluyen las recargas SUBE (es plata que entró).
 * - `sube` es un desglose informativo, no se suma de nuevo al total.
 * - La diferencia de caja de cada turno usa todas sus ventas en efectivo (también las SUBE),
 *   aunque caigan fuera del rango de fechas filtrado.
 */
export function calcularResumen({ turnos, ventas, egresos, desde, hasta, empleadoId = "" }) {
  const filtrar = (lista) => (empleadoId ? lista.filter((x) => x.empleadoId === empleadoId) : lista);

  const turnosFiltrados = filtrar(turnos);
  const todasLasVentas = filtrar(ventas.map(normalizarVenta));
  const todosLosEgresos = filtrar(egresos);

  const ventasDelRango = todasLasVentas.filter((v) => enRango(aDate(v.timestamp), desde, hasta));
  const egresosDelRango = todosLosEgresos.filter((e) => enRango(aDate(e.fecha), desde, hasta));

  const porMetodo = Object.fromEntries(METODOS_PAGO.map((m) => [m, 0]));
  let sube = 0;
  for (const v of ventasDelRango) {
    if (v.metodoPago in porMetodo) porMetodo[v.metodoPago] += v.total;
    if (v.tipo === "sube") sube += v.total;
  }
  for (const m of METODOS_PAGO) porMetodo[m] = redondear(porMetodo[m]);

  const totalVentas = redondear(METODOS_PAGO.reduce((s, m) => s + porMetodo[m], 0));
  const totalEgresos = redondear(egresosDelRango.reduce((s, e) => s + (Number(e.monto) || 0), 0));

  const filasTurnos = turnosFiltrados.map((t) => {
    const caja = calcularCajaTurno({
      cajaInicial: t.cajaInicial,
      ventas: todasLasVentas.filter((v) => v.turnoId === t.id),
      egresos: todosLosEgresos.filter((e) => e.turnoId === t.id),
    });
    const cerrado = t.estado === "cerrado" && t.cajaFinal != null;

    return {
      id: t.id,
      empleadoId: t.empleadoId,
      empleado: t.empleadoNombre || t.empleadoId,
      abierto: t.estado === "abierto",
      apertura: aDate(t.fechaApertura),
      cierre: aDate(t.fechaCierre),
      cerradoPor: t.cerradoPorNombre && t.cerradoPor !== t.empleadoId ? t.cerradoPorNombre : null,
      cajaInicial: caja.cajaInicial,
      cajaFinal: cerrado ? Number(t.cajaFinal) : null,
      efectivo: caja.efectivo,
      mercadoPago: caja.porMetodo["Mercado Pago"],
      tarjeta: caja.porMetodo["Tarjeta"],
      totalVentas: caja.totalVentas,
      sube: caja.sube,
      egresos: caja.egresos,
      esperado: caja.esperado,
      diferencia: cerrado ? redondear(Number(t.cajaFinal) - caja.esperado) : null,
    };
  });

  return {
    porMetodo,
    sube: redondear(sube),
    totalVentas,
    totalEgresos,
    neto: redondear(totalVentas - totalEgresos),
    turnos: filasTurnos,
    egresos: egresosDelRango.sort((a, b) => (aDate(b.fecha) ?? 0) - (aDate(a.fecha) ?? 0)),
  };
}

/** Lista única de empleados [{ id, nombre }] a partir de los turnos. */
export function empleadosDeTurnos(turnos) {
  const mapa = new Map();
  for (const t of turnos) {
    if (t.empleadoId && !mapa.has(t.empleadoId)) mapa.set(t.empleadoId, t.empleadoNombre || t.empleadoId);
  }
  return [...mapa].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
