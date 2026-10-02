import { $, h, icono, filaVacia, mostrar } from "../lib/dom.js";
import { formatearMoneda } from "../lib/dinero.js";
import { fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { calcularResumen, empleadosDeTurnos } from "../core/resumen.js";
import { calcularCajaTurno } from "../core/caja.js";
import { armarExcelResumen } from "../core/exportacion.js";
import { productosConStockBajo } from "../core/productos.js";
import { obtenerMovimientos } from "../data/reportes.js";
import { cerrarTurno, obtenerMovimientosTurno } from "../data/turnos.js";
import { descargarExcel } from "../lib/excel.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
import { avisar, confirmar, conBoton, mostrarDetalle, mostrarError, notificarExito } from "../ui.js";
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
  $("metric-guardado").textContent = formatearMoneda(r.totalGuardado);
  $("metric-neto").textContent = formatearMoneda(r.neto);

  renderTurnos(r.turnos);
  btnExcel.disabled = false;
}

function renderTurnos(filas) {
  const tbody = $("tabla-turnos");
  if (filas.length === 0) return filaVacia(tbody, 13, "No hay turnos en el período.");

  tbody.replaceChildren(
    ...filas.map((t) => {
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
        h("td", { class: "num" }, formatearMoneda(t.guardado)),
        h("td", { class: "num" }, h("strong", {}, formatearMoneda(t.total))),
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

async function cerrarTurnoDesdeAdmin(turnoId) {
  const turno = movimientos?.turnos.find((t) => t.id === turnoId);
  if (!turno) return;

  // Lectura fresca: el empleado pudo haber vendido después de cargar el resumen.
  const caja = calcularCajaTurno({ cajaInicial: turno.cajaInicial, ...(await obtenerMovimientosTurno(turno)) });

  const ok = await confirmar({
    titulo: "Cerrar turno",
    texto: `${turno.empleadoNombre || turno.empleadoId} · abierto el ${formatearFechaHora(turno.fechaApertura)}`,
    contenido: desgloseCierre(caja),
    boton: "Cerrar turno",
  });
  if (!ok) return;

  await cerrarTurno(turno, Math.max(0, caja.efectivoEnCaja), sesion.usuario);
  mostrarDetalle({ titulo: "Turno cerrado", contenido: desgloseCierre(caja) });
  await cargarResumen();
}
