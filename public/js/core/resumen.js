import { redondear } from "../lib/dinero.js";
import { aDate } from "../lib/fechas.js";
import { METODOS_PAGO, normalizarVenta } from "./ventas.js";
import { cajaDesdeResumen, calcularCajaTurno } from "./caja.js";
import { totalizarEgresos } from "./egresos.js";

/**
 * Calcula los totales del panel de administración, con el mismo criterio que el cierre de turno.
 *
 * El período son los turnos abiertos entre `desde` y `hasta`: cada turno suma completo, con todos
 * sus movimientos (aunque alguno caiga después de `hasta`, como en un turno que pasa la medianoche).
 *
 * - Un turno cerrado con `resumen` guardado no necesita sus ventas (ver resumenDeCaja).
 * - Uno sin resumen (abierto, o cerrado antes de que existiera) se calcula con sus ventas, si
 *   están en `turnosCalculados` (null = todos). Si no, queda pendiente: se lista sin montos y
 *   no suma a los totales.
 * - Las ventas de productos se totalizan por método de pago; las recargas SUBE van aparte
 *   (no se suman de nuevo en el método con que se cobraron). Total ventas = métodos + SUBE.
 */
export function calcularResumen({ turnos, ventas = [], egresos, guardados = [], empleadoId = "", turnosCalculados = null }) {
  const filtrar = (lista) => (empleadoId ? lista.filter((x) => x.empleadoId === empleadoId) : lista);
  const deTurno = (lista, id) => lista.filter((x) => x.turnoId === id);

  const todasLasVentas = ventas.map(normalizarVenta);

  const filasTurnos = filtrar(turnos).map((t) => {
    let caja = null;
    if (t.resumen) caja = cajaDesdeResumen(t.cajaInicial, t.resumen);
    else if (!turnosCalculados || turnosCalculados.has(t.id)) {
      caja = calcularCajaTurno({
        cajaInicial: t.cajaInicial,
        ventas: deTurno(todasLasVentas, t.id),
        egresos: deTurno(egresos, t.id),
        guardados: deTurno(guardados, t.id),
      });
    }

    return {
      id: t.id,
      empleadoId: t.empleadoId,
      empleado: t.empleadoNombre || t.empleadoId,
      abierto: t.estado === "abierto",
      apertura: aDate(t.fechaApertura),
      cierre: aDate(t.fechaCierre),
      cerradoPor: t.cerradoPorNombre && t.cerradoPor !== t.empleadoId ? t.cerradoPorNombre : null,
      cajaInicial: Number(t.cajaInicial) || 0,
      caja,
      pendiente: caja === null,
      efectivo: caja?.porMetodo["Efectivo"] ?? null,
      mercadoPago: caja?.porMetodo["Mercado Pago"] ?? null,
      tarjeta: caja?.porMetodo["Tarjeta"] ?? null,
      sube: caja?.sube ?? null,
      totalVentas: caja?.totalVentas ?? null,
      egresos: caja?.egresos ?? null,
      guardado: caja?.guardado ?? null,
      total: caja?.total ?? null,
    };
  });

  const calculados = filasTurnos.filter((f) => !f.pendiente);
  const ids = new Set(calculados.map((f) => f.id));

  const porMetodo = Object.fromEntries(
    METODOS_PAGO.map((m) => [m, redondear(calculados.reduce((s, f) => s + f.caja.porMetodo[m], 0))]),
  );
  const sube = redondear(calculados.reduce((s, f) => s + f.sube, 0));
  const totalVentas = redondear(METODOS_PAGO.reduce((s, m) => s + porMetodo[m], 0) + sube);

  // Todos los egresos de los turnos (de la caja y de la caja de guardado), por tipo y por origen.
  const egresosDelPeriodo = egresos.filter((e) => ids.has(e.turnoId));
  const egresosTotales = totalizarEgresos(egresosDelPeriodo);
  const totalGuardado = redondear(guardados.filter((g) => ids.has(g.turnoId)).reduce((s, g) => s + (Number(g.monto) || 0), 0));

  return {
    porMetodo,
    sube,
    totalVentas,
    totalEgresos: egresosTotales.total,
    egresosTotales,
    totalGuardado,
    neto: redondear(totalVentas - egresosTotales.total),
    turnos: filasTurnos,
    turnosPendientes: filasTurnos.length - calculados.length,
    egresos: egresosDelPeriodo.sort((a, b) => (aDate(b.fecha) ?? 0) - (aDate(a.fecha) ?? 0)),
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
