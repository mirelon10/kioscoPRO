import { $, h, icono, filaVacia, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto } from "../lib/dinero.js";
import { fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { calcularResumen, empleadosDeTurnos } from "../core/resumen.js";
import { calcularCajaTurno } from "../core/caja.js";
import { armarExcelResumen } from "../core/exportacion.js";
import { productosConStockBajo } from "../core/productos.js";
import { obtenerMovimientos } from "../data/reportes.js";
import { cerrarTurno, obtenerMovimientosTurno } from "../data/turnos.js";
import { estaOnline } from "../data/conexion.js";
import { descargarExcel } from "../lib/excel.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
import { avisar, confirmar, conBoton, formularioModal, mostrarDetalle, mostrarError, notificarExito } from "../ui.js";
import { ajustarSaldoGuardado } from "../data/cajaGuardado.js";
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

  const btnAjustar = $("btn-ajustar-saldo");
  btnAjustar.addEventListener("click", () => conBoton(btnAjustar, ajustarSaldo));

  alCambiarSesion((_, cambios) => {
    if ("productos" in cambios) renderAlertasStock();
    if ("saldoGuardado" in cambios) renderSaldoGuardado();
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
  renderSaldoGuardado();
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
  $("metric-egresos-detalle").textContent =
    `Fijos ${formatearMoneda(r.egresosTotales.fijos)} · Variables ${formatearMoneda(r.egresosTotales.variables)}` +
    (r.egresosTotales.sinClasificar ? ` · Sin clasificar ${formatearMoneda(r.egresosTotales.sinClasificar)}` : "");
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

// ---------- Caja de guardado ----------

function renderSaldoGuardado() {
  $("admin-saldo-guardado").textContent = sesion.saldoGuardado == null ? "—" : formatearMoneda(sesion.saldoGuardado);
}

const FORMULARIO_AJUSTE_SALDO = `
  <div class="swal-form">
    <p id="ajuste-saldo-actual" class="text-muted"></p>
    <label>Saldo real en la caja de guardado $<input id="ajuste-saldo-nuevo" type="number" min="0" step="0.01" class="swal2-input" inputmode="decimal"></label>
    <label>Motivo<input id="ajuste-saldo-motivo" class="swal2-input" maxlength="200" placeholder="Ej: retiro del dueño, conteo de la caja"></label>
  </div>`;

/** El admin fija el saldo (conteo de la caja, retiro del dueño). Queda registrado con el motivo. */
async function ajustarSaldo() {
  const actual = sesion.saldoGuardado ?? 0;
  const datos = await formularioModal({
    titulo: "Ajustar saldo de la caja de guardado",
    boton: "Guardar ajuste",
    contenido: FORMULARIO_AJUSTE_SALDO,
    alAbrir: (popup) => {
      popup.querySelector("#ajuste-saldo-actual").textContent = `Saldo actual en el sistema: ${formatearMoneda(actual)}`;
      popup.querySelector("#ajuste-saldo-nuevo").value = actual.toFixed(2);
    },
    leer: (popup) => {
      const saldoNuevo = parsearMonto(popup.querySelector("#ajuste-saldo-nuevo").value);
      const motivo = popup.querySelector("#ajuste-saldo-motivo").value.trim();
      if (!(saldoNuevo >= 0)) return "Ingresá el saldo real (puede ser 0).";
      if (!motivo) return "Indicá el motivo del ajuste.";
      if (saldoNuevo === actual) return "El saldo ya es ese.";
      return { saldoNuevo, motivo };
    },
  });
  if (!datos) return;

  await ajustarSaldoGuardado({ usuario: sesion.usuario, ...datos });
  notificarExito(`Saldo de la caja de guardado: ${formatearMoneda(datos.saldoNuevo)}`);
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
  // Sin conexión no se ven las ventas que el empleado haya subido mientras tanto: el cierre daría mal.
  if (!estaOnline()) return avisar("Sin conexión", "Para cerrar el turno de otro empleado hace falta internet.");

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
