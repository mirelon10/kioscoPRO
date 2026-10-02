import { redondear } from "../lib/dinero.js";

/** Clasificación de los egresos. Los viejos no la tienen: se muestran como "Sin clasificar". */
export const TIPOS_EGRESO = { fijo: "Costo fijo", variable: "Costo variable" };

/** De dónde sale la plata: del cajón del turno o de la caja de guardado. */
export const ORIGENES_EGRESO = { caja: "Caja", guardado: "Caja de guardado" };

export const etiquetaTipoEgreso = (tipo) => TIPOS_EGRESO[tipo] ?? "Sin clasificar";

/** Lleva egresos viejos (sin tipo ni origen) al formato actual: se pagaban con la caja. */
export function normalizarEgreso(egreso) {
  return {
    ...egreso,
    tipo: egreso.tipo in TIPOS_EGRESO ? egreso.tipo : null,
    origen: egreso.origen === "guardado" ? "guardado" : "caja",
    monto: Number(egreso.monto) || 0,
  };
}

/** Totales de una lista de egresos, por tipo y por origen. */
export function totalizarEgresos(egresos) {
  const t = { total: 0, fijos: 0, variables: 0, sinClasificar: 0, desdeCaja: 0, desdeGuardado: 0 };
  for (const e of egresos.map(normalizarEgreso)) {
    t.total += e.monto;
    if (e.tipo === "fijo") t.fijos += e.monto;
    else if (e.tipo === "variable") t.variables += e.monto;
    else t.sinClasificar += e.monto;
    if (e.origen === "guardado") t.desdeGuardado += e.monto;
    else t.desdeCaja += e.monto;
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, redondear(v)]));
}
