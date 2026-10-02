import { h } from "../lib/dom.js";
import { formatearMoneda } from "../lib/dinero.js";

const fila = (concepto, monto, clase = null) =>
  h("div", { class: clase }, h("dt", {}, concepto), h("dd", {}, formatearMoneda(monto)));

/**
 * Cierre de un turno en un solo bloque (a partir de calcularCajaTurno):
 * lo vendido por método de pago y en recargas SUBE, menos la caja inicial, los egresos
 * y lo pasado a la caja de guardado, en un único total.
 *
 * Lo usan la pantalla de turno, el cierre desde el panel admin y el resumen final,
 * así los tres muestran lo mismo.
 */
export function desgloseCierre(caja) {
  return h(
    "div",
    { class: "cierre-detalle" },
    h("h4", { class: "desglose-titulo" }, `Cierre del turno (${caja.cantidadVentas} ventas)`),
    h(
      "dl",
      { class: "desglose", "aria-label": "Cierre del turno" },
      fila("Efectivo", caja.porMetodo["Efectivo"]),
      fila("Mercado Pago", caja.porMetodo["Mercado Pago"]),
      fila("Tarjeta", caja.porMetodo["Tarjeta"]),
      fila("Recargas SUBE", caja.sube),
      fila("− Caja inicial", caja.cajaInicial, "desglose-resta desglose-separador"),
      fila("− Egresos", caja.egresos, "desglose-resta"),
      fila("− Caja de guardado", caja.guardado, "desglose-resta"),
      fila("= TOTAL", caja.total, "desglose-total"),
    ),
  );
}
