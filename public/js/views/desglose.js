import { h } from "../lib/dom.js";
import { formatearMoneda, redondear } from "../lib/dinero.js";

const fila = (concepto, monto, clase = null) =>
  h("div", { class: clase }, h("dt", {}, concepto), h("dd", {}, typeof monto === "number" ? formatearMoneda(monto) : monto));

/**
 * Desglose completo del cierre de un turno (a partir de calcularCajaTurno):
 * lo vendido por método de pago y el efectivo que tiene que haber en la caja.
 * Con `contado` agrega lo declarado y la diferencia.
 *
 * Lo usan la pantalla de cierre, el cierre desde el panel admin y el resumen final,
 * así los tres muestran lo mismo.
 */
export function desgloseCierre(caja, { contado = null } = {}) {
  const ventas = h(
    "dl",
    { class: "desglose", "aria-label": "Ventas del turno por método de pago" },
    fila("Efectivo", caja.porMetodo["Efectivo"]),
    fila("Mercado Pago", caja.porMetodo["Mercado Pago"]),
    fila("Tarjeta", caja.porMetodo["Tarjeta"]),
    fila("= Total vendido", caja.totalVentas, "desglose-total"),
    fila("Recargas SUBE (incluidas arriba)", caja.sube, "desglose-nota"),
  );

  const efectivo = h(
    "dl",
    { class: "desglose", "aria-label": "Efectivo en caja" },
    fila("Caja inicial", caja.cajaInicial),
    fila("+ Ventas en efectivo", caja.efectivo),
    fila("− Egresos", caja.egresos),
    fila("= Efectivo esperado", caja.esperado, "desglose-total"),
  );

  if (contado != null) {
    const diferencia = redondear(contado - caja.esperado);
    efectivo.append(
      fila("Efectivo contado", contado),
      fila(
        diferencia === 0 ? "Diferencia" : diferencia < 0 ? "Faltante" : "Sobrante",
        diferencia === 0 ? "Sin diferencia" : formatearMoneda(Math.abs(diferencia)),
        diferencia < 0 ? "text-danger" : diferencia > 0 ? "text-success" : null,
      ),
    );
  }

  return h(
    "div",
    { class: "cierre-detalle" },
    h("h4", { class: "desglose-titulo" }, `Ventas del turno (${caja.cantidadVentas})`),
    ventas,
    h("h4", { class: "desglose-titulo" }, "Efectivo en caja"),
    efectivo,
    h("p", { class: "text-muted desglose-pie" }, "Mercado Pago y tarjeta no entran a la caja: se controlan en sus resúmenes."),
  );
}
