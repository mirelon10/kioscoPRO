import { $, h, icono, filaVacia, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto, redondear } from "../lib/dinero.js";
import { fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { calcularResumen, empleadosDeTurnos } from "../core/resumen.js";
import { calcularCajaTurno } from "../core/caja.js";
import { armarExcelResumen } from "../core/exportacion.js";
import { productosConStockBajo } from "../core/productos.js";
import { obtenerMovimientos } from "../data/reportes.js";
import { cerrarTurno, obtenerMovimientosTurno } from "../data/turnos.js";
import { descargarExcel } from "../lib/excel.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
import { avisar, conBoton, formularioModal, mostrarError, notificarExito } from "../ui.js";
import { renderStock } from "./stock.js";

const selectEmpleado = $("admin-empleado");
const btnResumen = $("btn-ver-ventas");
const btnStock = $("btn-ver-stock");
const btnExcel = $("btn-exportar-excel");

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
  btnExcel.addEventListener("click", () => conBoton(btnExcel, exportarExcel));

  $("tabla-turnos").addEventListener("click", (e) => {
    const boton = e.target.closest("button[data-cerrar-turno]");
    if (boton) conBoton(boton, () => cerrarTurnoDesdeAdmin(boton.dataset.cerrarTurno));
  });

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
  btnExcel.disabled = true;
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

function resumenActual() {
  return movimientos && calcularResumen({ ...movimientos, empleadoId: selectEmpleado.value });
}

function renderResumen() {
  const r = resumenActual();
  if (!r) return;

  $("metric-efectivo").textContent = formatearMoneda(r.porMetodo["Efectivo"]);
  $("metric-mp").textContent = formatearMoneda(r.porMetodo["Mercado Pago"]);
  $("metric-tarjeta").textContent = formatearMoneda(r.porMetodo["Tarjeta"]);
  $("metric-sube").textContent = formatearMoneda(r.sube);
  $("metric-ventas").textContent = formatearMoneda(r.totalVentas);
  $("metric-egresos").textContent = formatearMoneda(r.totalEgresos);
  $("metric-neto").textContent = formatearMoneda(r.neto);

  renderTurnos(r.turnos);
  btnExcel.disabled = false;
}

function renderTurnos(filas) {
  const tbody = $("tabla-turnos");
  if (filas.length === 0) return filaVacia(tbody, 10, "No hay turnos en el período.");

  tbody.replaceChildren(
    ...filas.map((t) => {
      let celdaDiferencia = h("td", { class: "num text-muted" }, "-");
      if (t.diferencia != null) {
        const signo = t.diferencia > 0 ? "+" : "";
        const clase = t.diferencia < 0 ? "text-danger" : "text-success";
        celdaDiferencia = h("td", { class: `num ${clase}` }, h("strong", {}, signo + formatearMoneda(t.diferencia)));
      }
      const celdaCierre = t.cierre
        ? h("td", {}, formatearFechaHora(t.cierre), t.cerradoPor ? h("small", { class: "text-muted d-block" }, `por ${t.cerradoPor}`) : null)
        : h("td", {}, h("span", { class: "badge badge-abierto" }, "Abierto"));
      const celdaAcciones = h(
        "td",
        { class: "acciones" },
        t.abierto
          ? h(
              "button",
              { type: "button", class: "btn btn-warning btn-sm", dataset: { cerrarTurno: t.id }, "aria-label": `Cerrar el turno de ${t.empleado}` },
              icono("lock"),
              " Cerrar",
            )
          : null,
      );
      return h(
        "tr",
        {},
        h("td", {}, t.empleado),
        h("td", {}, formatearFechaHora(t.apertura)),
        celdaCierre,
        h("td", { class: "num" }, formatearMoneda(t.cajaInicial)),
        h("td", { class: "num" }, formatearMoneda(t.efectivo)),
        h("td", { class: "num" }, formatearMoneda(t.egresos)),
        h("td", { class: "num" }, formatearMoneda(t.esperado)),
        h("td", { class: "num" }, t.cajaFinal != null ? formatearMoneda(t.cajaFinal) : "-"),
        celdaDiferencia,
        celdaAcciones,
      );
    }),
  );
}

// ---------- Exportar a Excel ----------

async function exportarExcel() {
  const r = resumenActual();
  if (!r) return avisar("Sin datos", "Filtrá un período antes de exportar.");

  const empleado = selectEmpleado.selectedOptions[0]?.textContent ?? "Todos los empleados";
  const { nombreArchivo, hojas } = armarExcelResumen(r, { desde: movimientos.desde, hasta: movimientos.hasta, empleado });
  await descargarExcel(nombreArchivo, hojas);
  notificarExito("Excel descargado");
}

// ---------- Cierre de un turno por el admin ----------

// Los valores se cargan con textContent en alAbrir (nunca interpolados en el HTML).
const FORMULARIO_CIERRE = `
  <div class="swal-form">
    <p id="cierre-empleado" class="text-muted"></p>
    <dl class="desglose">
      <div><dt>Caja inicial</dt><dd id="cierre-inicial"></dd></div>
      <div><dt>+ Ventas en efectivo</dt><dd id="cierre-efectivo"></dd></div>
      <div><dt>− Egresos</dt><dd id="cierre-egresos"></dd></div>
      <div class="desglose-total"><dt>= Efectivo esperado</dt><dd id="cierre-esperado"></dd></div>
    </dl>
    <label>Efectivo contado en caja
      <input id="cierre-contado" type="number" min="0" step="0.01" class="swal2-input">
    </label>
  </div>`;

async function cerrarTurnoDesdeAdmin(turnoId) {
  const turno = movimientos?.turnos.find((t) => t.id === turnoId);
  if (!turno) return;

  // Lectura fresca: el empleado pudo haber vendido después de cargar el resumen.
  const caja = calcularCajaTurno({ cajaInicial: turno.cajaInicial, ...(await obtenerMovimientosTurno(turno)) });

  const datos = await formularioModal({
    titulo: "Cerrar turno",
    boton: "Cerrar turno",
    contenido: FORMULARIO_CIERRE,
    alAbrir: (popup) => {
      const campo = (id) => popup.querySelector(`#cierre-${id}`);
      campo("empleado").textContent = `${turno.empleadoNombre || turno.empleadoId} · abierto el ${formatearFechaHora(turno.fechaApertura)}`;
      campo("inicial").textContent = formatearMoneda(caja.cajaInicial);
      campo("efectivo").textContent = formatearMoneda(caja.efectivo);
      campo("egresos").textContent = formatearMoneda(caja.egresos);
      campo("esperado").textContent = formatearMoneda(caja.esperado);
      campo("contado").value = caja.esperado.toFixed(2);
    },
    leer: (popup) => {
      const contado = parsearMonto(popup.querySelector("#cierre-contado").value);
      return contado >= 0 ? { contado } : "Ingresá el efectivo contado (puede ser 0).";
    },
  });
  if (!datos) return;

  const resultado = await cerrarTurno(turnoId, datos.contado);
  const diferencia = redondear(resultado.diferencia);
  notificarExito(
    diferencia === 0 ? "Turno cerrado sin diferencias" : `Turno cerrado · diferencia ${diferencia > 0 ? "+" : ""}${formatearMoneda(diferencia)}`,
  );
  await cargarResumen();
}
