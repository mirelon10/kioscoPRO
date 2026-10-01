/**
 * Fecha local en formato YYYY-MM-DD (para <input type="date">).
 * No usar toISOString(): devuelve la fecha en UTC y después de las 21 h en Argentina ya es "mañana".
 */
export function fechaLocalISO(fecha = new Date()) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

export function inicioDelDia(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  return new Date(anio, mes - 1, dia, 0, 0, 0, 0);
}

export function finDelDia(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  return new Date(anio, mes - 1, dia, 23, 59, 59, 999);
}

/** Acepta Timestamp de Firestore, Date, string ISO o milisegundos. Devuelve null si no es válida. */
export function aDate(valor) {
  if (valor == null) return null;
  if (typeof valor.toDate === "function") return valor.toDate();
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export function formatearFechaHora(valor) {
  const fecha = aDate(valor);
  return fecha ? fecha.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "-";
}

export function horasDesde(valor, ahora = new Date()) {
  const fecha = aDate(valor);
  return fecha ? (ahora.getTime() - fecha.getTime()) / 3_600_000 : 0;
}
