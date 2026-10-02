import { redondear } from "../lib/dinero.js";
import { aDate } from "../lib/fechas.js";
import { METODOS_PAGO, normalizarVenta } from "./ventas.js";
import { calcularCajaTurno } from "./caja.js";
import { totalizarEgresos } from "./egresos.js";

function enRango(fecha, desde, hasta) {
  return fecha != null && fecha >= desde && fecha <= hasta;
}

/**
 * Calcula los totales del panel de administración, con el mismo criterio que el cierre de turno:
 *
 * - Las ventas de productos se totalizan por método de pago; las recargas SUBE van aparte
 *   (no se suman de nuevo en el método con que se cobraron). Total ventas = métodos + SUBE.
 * - Cada turno muestra su cierre completo (calcularCajaTurno) con todos sus movimientos,
 *   aunque alguno caiga fuera del rango de fechas filtrado.
 */
export function calcularResumen({ turnos, ventas, egresos, guardados = [], desde, hasta, empleadoId = "" }) {
  const filtrar = (lista) => (empleadoId ? lista.filter((x) => x.empleadoId === empleadoId) : lista);

  const turnosFiltrados = filtrar(turnos);
  const todasLasVentas = filtrar(ventas.map(normalizarVenta));
  const todosLosEgresos = filtrar(egresos);
  const todosLosGuardados = filtrar(guardados);

  const ventasDelRango = todasLasVentas.filter((v) => enRango(aDate(v.timestamp), desde, hasta));
  const egresosDelRango = todosLosEgresos.filter((e) => enRango(aDate(e.fecha), desde, hasta));
  const guardadosDelRango = todosLosGuardados.filter((g) => enRango(aDate(g.fecha), desde, hasta));

  const porMetodo = Object.fromEntries(METODOS_PAGO.map((m) => [m, 0]));
  let sube = 0;
  for (const v of ventasDelRango) {
    if (v.tipo === "sube") sube += v.total;
    else if (v.metodoPago in porMetodo) porMetodo[v.metodoPago] += v.total;
  }
  for (const m of METODOS_PAGO) porMetodo[m] = redondear(porMetodo[m]);

  const totalVentas = redondear(METODOS_PAGO.reduce((s, m) => s + porMetodo[m], 0) + sube);
  // Todos los egresos del período (de la caja y de la caja de guardado), por tipo y por origen.
  const egresosTotales = totalizarEgresos(egresosDelRango);
  const totalEgresos = egresosTotales.total;
  const totalGuardado = redondear(guardadosDelRango.reduce((s, g) => s + (Number(g.monto) || 0), 0));

  const filasTurnos = turnosFiltrados.map((t) => {
    const caja = calcularCajaTurno({
      cajaInicial: t.cajaInicial,
      ventas: todasLasVentas.filter((v) => v.turnoId === t.id),
      egresos: todosLosEgresos.filter((e) => e.turnoId === t.id),
      guardados: todosLosGuardados.filter((g) => g.turnoId === t.id),
    });

    return {
      id: t.id,
      empleadoId: t.empleadoId,
      empleado: t.empleadoNombre || t.empleadoId,
      abierto: t.estado === "abierto",
      apertura: aDate(t.fechaApertura),
      cierre: aDate(t.fechaCierre),
      cerradoPor: t.cerradoPorNombre && t.cerradoPor !== t.empleadoId ? t.cerradoPorNombre : null,
      cajaInicial: caja.cajaInicial,
      efectivo: caja.porMetodo["Efectivo"],
      mercadoPago: caja.porMetodo["Mercado Pago"],
      tarjeta: caja.porMetodo["Tarjeta"],
      sube: caja.sube,
      totalVentas: caja.totalVentas,
      egresos: caja.egresos,
      guardado: caja.guardado,
      total: caja.total,
    };
  });

  return {
    porMetodo,
    sube: redondear(sube),
    totalVentas,
    totalEgresos,
    egresosTotales,
    totalGuardado,
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
