import { $, h, icono, filaVacia, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto } from "../lib/dinero.js";
import { fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { calcularResumen, empleadosDeTurnos } from "../core/resumen.js";
import { calcularCajaTurno } from "../core/caja.js";
import { armarExcelResumen } from "../core/exportacion.js";
import { productosConStockBajo } from "../core/productos.js";
import { obtenerMovimientos } from "../data/reportes.js";
import { cerrarTurno, obtenerMovimientosTurno } from "../data/turnos.js";
import { descargarExcel } from "../lib/excel.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
import { avisar, conBoton, formularioModal, mostrarDetalle, mostrarError, notificarExito } from "../ui.js";
import { desgloseCierre } from "./desglose.js";

const selectEmpleado = $("admin-empleado");
const btnExcel = $("btn-exportar-excel");

/** Último período consultado: cambiar de empleado filtra sin volver a leer Firestore. */
let movimientos = null;

export function iniciarAdmin() {
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
}

export function abrirAdmin() {
  renderAlertasStock();
  cargarResumen();
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
  if (filas.length === 0) return filaVacia(tbody, 14, "No hay turnos en el período.");

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
        h("td", { class: "num" }, formatearMoneda(t.mercadoPago)),
        h("td", { class: "num" }, formatearMoneda(t.tarjeta)),
        h("td", { class: "num" }, formatearMoneda(t.sube)),
        h("td", { class: "num" }, h("strong", {}, formatearMoneda(t.totalVentas))),
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
    <div id="cierre-desglose"></div>
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
      campo("desglose").replaceChildren(desgloseCierre(caja));
      campo("contado").value = caja.esperado.toFixed(2);
    },
    leer: (popup) => {
      const contado = parsearMonto(popup.querySelector("#cierre-contado").value);
      return contado >= 0 ? { contado } : "Ingresá el efectivo contado (puede ser 0).";
    },
  });
  if (!datos) return;

  await cerrarTurno(turno, datos.contado, sesion.usuario);
  mostrarDetalle({ titulo: "Turno cerrado", contenido: desgloseCierre(caja, { contado: datos.contado }) });
  await cargarResumen();
}
