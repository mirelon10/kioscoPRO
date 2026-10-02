const formateador = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Redondea a centavos para evitar errores acumulados de punto flotante (0.1 + 0.2). */
export function redondear(monto) {
  return Math.round((Number(monto) + Number.EPSILON) * 100) / 100;
}

export function formatearMoneda(monto) {
  return formateador.format(Number(monto) || 0);
}

/** Convierte el valor de un input a número. Devuelve NaN si no es un monto válido. */
export function parsearMonto(valor) {
  if (typeof valor === "number") return valor;
  const texto = String(valor ?? "").trim().replace(",", ".");
  if (texto === "") return NaN;
  const numero = Number(texto);
  return Number.isFinite(numero) ? redondear(numero) : NaN;
}

export function calcularPrecioVenta(costo, margenPorcentaje) {
  return redondear((Number(costo) || 0) * (1 + (Number(margenPorcentaje) || 0) / 100));
}

/**
 * Pesos a centavos enteros. El saldo de la caja de guardado se guarda en centavos para que
 * las sumas y restas sean exactas (las reglas de Firestore usan la misma cuenta: math.round(monto * 100)).
 */
export function aCentavos(monto) {
  return Math.round(Number(monto) * 100);
}
