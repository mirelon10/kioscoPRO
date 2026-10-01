import { $, h, filaVacia, mostrar } from "../lib/dom.js";
import { formatearMoneda } from "../lib/dinero.js";
import { fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { calcularResumen, empleadosDeTurnos } from "../core/resumen.js";
import { productosConStockBajo } from "../core/productos.js";
import { obtenerMovimientos } from "../data/reportes.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
import { avisar, mostrarError } from "../ui.js";
import { renderTablaEgresos } from "./egresos.js";
import { renderStock } from "./stock.js";

const selectEmpleado = $("admin-empleado");
const btnResumen = $("btn-ver-ventas");
const btnStock = $("btn-ver-stock");

/** Último período consultado: cambiar de empleado filtra sin volver a leer Firestore. */
let movimientos = null;

export function iniciarAdmin() {
  btnResumen.addEventListener("click", () => mostrarPestania("resumen"));
  btnStock.addEventListener("click", () => mostrarPestania("stock"));

  $("form-filtro-admin").addEventListener("submit", (e) => {
    e.preventDefault();
    cargarResumen();
  });
  selectEmpleado.addEventListener("change", renderResumen);

  alCambiarSesion((_, cambios) => {
    if ("productos" in cambios) renderAlertasStock();
  });
}

export function reiniciarAdmin() {
  const hoy = fechaLocalISO();
  $("admin-desde").value = hoy;
  $("admin-hasta").value = hoy;
  selectEmpleado.replaceChildren(h("option", { value: "" }, "Todos los empleados"));
  movimientos = null;
  mostrarPestania("resumen", { cargar: false });
}

export function abrirAdmin() {
  renderAlertasStock();
  cargarResumen();
}

function mostrarPestania(pestania, { cargar = true } = {}) {
  const esResumen = pestania === "resumen";
  mostrar($("admin-resumen-view"), esResumen);
  mostrar($("admin-stock-view"), !esResumen);

  for (const [boton, activo] of [[btnResumen, esResumen], [btnStock, !esResumen]]) {
    boton.classList.toggle("btn-primary", activo);
    boton.classList.toggle("btn-secondary", !activo);
    boton.setAttribute("aria-selected", String(activo));
  }

  if (!cargar) return;
  if (esResumen) cargarResumen();
  else renderStock();
}

function renderAlertasStock() {
  const bajos = esAdmin() ? productosConStockBajo(sesion.productos) : [];
  mostrar($("alerta-stock-admin"), bajos.length > 0);
  $("lista-alertas-stock").replaceChildren(
    ...bajos.map((p) => h("li", {}, `${p.nombre} (quedan: `, h("strong", {}, p.stock), ")")),
  );
}

// ---------- Resumen de caja ----------

function rangoSeleccionado() {
  const desde = $("admin-desde").value;
  const hasta = $("admin-hasta").value;
  if (!desde || !hasta) return null;
  return { desde: inicioDelDia(desde), hasta: finDelDia(hasta) };
}

async function cargarResumen() {
  const rango = rangoSeleccionado();
  if (!rango) return avisar("Fechas incompletas", "Elegí las fechas desde y hasta.");
  if (rango.desde > rango.hasta) return avisar("Fechas inválidas", "La fecha desde es posterior a la fecha hasta.");

  try {
    movimientos = { ...(await obtenerMovimientos(rango.desde, rango.hasta)), ...rango };
    renderOpcionesEmpleado(empleadosDeTurnos(movimientos.turnos));
    renderResumen();
  } catch (error) {
    mostrarError(error, "No se pudo cargar el resumen.");
  }
}

function renderOpcionesEmpleado(empleados) {
  const seleccionado = selectEmpleado.value;
  selectEmpleado.replaceChildren(
    h("option", { value: "" }, "Todos los empleados"),
    ...empleados.map((e) => h("option", { value: e.id }, e.nombre)),
  );
  if (empleados.some((e) => e.id === seleccionado)) selectEmpleado.value = seleccionado;
}

function renderResumen() {
  if (!movimientos) return;
  const r = calcularResumen({ ...movimientos, empleadoId: selectEmpleado.value });

  $("metric-efectivo").textContent = formatearMoneda(r.porMetodo["Efectivo"]);
  $("metric-mp").textContent = formatearMoneda(r.porMetodo["Mercado Pago"]);
  $("metric-tarjeta").textContent = formatearMoneda(r.porMetodo["Tarjeta"]);
  $("metric-sube").textContent = formatearMoneda(r.sube);
  $("metric-ventas").textContent = formatearMoneda(r.totalVentas);
  $("metric-egresos").textContent = formatearMoneda(r.totalEgresos);
  $("metric-neto").textContent = formatearMoneda(r.neto);

  renderTurnos(r.turnos);
  renderTablaEgresos($("tabla-egresos-admin"), r.egresos);
}

function renderTurnos(filas) {
  const tbody = $("tabla-turnos");
  if (filas.length === 0) return filaVacia(tbody, 9, "No hay turnos en el período.");

  tbody.replaceChildren(
    ...filas.map((t) => {
      let celdaDiferencia = h("td", { class: "num text-muted" }, "-");
      if (t.diferencia != null) {
        const signo = t.diferencia > 0 ? "+" : "";
        const clase = t.diferencia < 0 ? "text-danger" : "text-success";
        celdaDiferencia = h("td", { class: `num ${clase}` }, h("strong", {}, signo + formatearMoneda(t.diferencia)));
      }
      return h(
        "tr",
        {},
        h("td", {}, t.empleado),
        h("td", {}, formatearFechaHora(t.apertura)),
        h("td", {}, t.cierre ? formatearFechaHora(t.cierre) : h("span", { class: "badge" }, "Abierto")),
        h("td", { class: "num" }, formatearMoneda(t.cajaInicial)),
        h("td", { class: "num" }, formatearMoneda(t.efectivo)),
        h("td", { class: "num" }, formatearMoneda(t.egresos)),
        h("td", { class: "num" }, formatearMoneda(t.esperado)),
        h("td", { class: "num" }, t.cajaFinal != null ? formatearMoneda(t.cajaFinal) : "-"),
        celdaDiferencia,
      );
    }),
  );
}
