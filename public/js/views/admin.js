import { $, h, icono, filaVacia, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto } from "../lib/dinero.js";
import { aDate, fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { calcularResumen, empleadosDeTurnos } from "../core/resumen.js";
import { calcularCajaTurno } from "../core/caja.js";
import { armarExcelResumen } from "../core/exportacion.js";
import { productosConStockBajo } from "../core/productos.js";
import { revisarVentas } from "../core/auditoria.js";
import { contarVentas, obtenerMovimientos, obtenerVentas } from "../data/reportes.js";
import { cerrarTurno, guardarResumenTurno, obtenerMovimientosTurno, obtenerVentasTurno } from "../data/turnos.js";
import { estaOnline } from "../data/conexion.js";
import { descargarExcel } from "../lib/excel.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
import { avisar, confirmar, conBoton, formularioModal, mostrarDetalle, mostrarError, notificarExito } from "../ui.js";
import { ajustarSaldoGuardado } from "../data/cajaGuardado.js";
import { esPcCaja, marcarPcCaja } from "../firebase.js";
import { desgloseCierre } from "./desglose.js";

const selectEmpleado = $("admin-empleado");
const btnExcel = $("btn-exportar-excel");
const btnRevisar = $("btn-revisar-ventas");

/** Último período consultado: cambiar de empleado filtra sin volver a leer Firestore. */
let movimientos = null;
/** Ventas del período, si el admin pidió revisarlas (se leen a pedido: son miles). */
let ventasRevisadas = null;

export function iniciarAdmin() {
  $("form-filtro-admin").addEventListener("submit", (e) => {
    e.preventDefault();
    cargarResumen();
  });
  selectEmpleado.addEventListener("change", renderResumen);
  btnExcel.addEventListener("click", () => conBoton(btnExcel, exportarExcel));
  btnRevisar.addEventListener("click", () => conBoton(btnRevisar, revisarVentasDelPeriodo));

  $("tabla-turnos").addEventListener("click", (e) => {
    const cerrar = e.target.closest("button[data-cerrar-turno]");
    if (cerrar) conBoton(cerrar, () => cerrarTurnoDesdeAdmin(cerrar.dataset.cerrarTurno));
    const calcular = e.target.closest("button[data-calcular-turno]");
    if (calcular) conBoton(calcular, () => calcularTurno(calcular.dataset.calcularTurno));
  });

  const btnAjustar = $("btn-ajustar-saldo");
  btnAjustar.addEventListener("click", () => conBoton(btnAjustar, ajustarSaldo));

  $("pc-caja").addEventListener("change", (e) => {
    if (!marcarPcCaja(e.target.checked)) {
      e.target.checked = esPcCaja();
      return avisar("No se pudo guardar", "Este navegador no deja guardar la configuración.");
    }
    notificarExito(e.target.checked ? "Esta PC conserva el catálogo al salir" : "Esta PC borra sus datos al salir");
  });

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
  ventasRevisadas = null;
  btnExcel.disabled = true;
  btnRevisar.disabled = true;
}

export function abrirAdmin() {
  $("pc-caja").checked = esPcCaja();
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
    ventasRevisadas = null;
    renderOpcionesEmpleado(empleadosDeTurnos(movimientos.turnos));
    renderResumen();
    guardarResumenesFaltantes();
  } catch (error) {
    mostrarError(error, "No se pudo cargar el resumen.");
  }
}

/**
 * Turnos cerrados antes de que se guardara el resumen: se calcularon con sus ventas y se les
 * guarda el resumen, así la próxima consulta no vuelve a leerlas.
 */
function guardarResumenesFaltantes() {
  if (!esAdmin() || movimientos.sinResumen.length === 0) return;
  const filas = calcularResumen(movimientos).turnos;
  for (const t of movimientos.sinResumen) {
    const caja = filas.find((f) => f.id === t.id)?.caja;
    if (caja) guardarResumenTurno(t.id, caja).catch((error) => console.warn("No se pudo guardar el resumen del turno", t.id, error));
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

  const avisoPendientes = $("admin-aviso-pendientes");
  avisoPendientes.textContent =
    r.turnosPendientes === 1
      ? "Hay 1 turno abierto que no está incluido en los totales: tocá «Calcular» en la tabla de turnos."
      : `Hay ${r.turnosPendientes} turnos abiertos que no están incluidos en los totales: tocá «Calcular» en la tabla de turnos.`;
  mostrar(avisoPendientes, r.turnosPendientes > 0);

  renderTurnos(r.turnos);
  renderVentasParaRevisar();
  btnExcel.disabled = false;
  btnRevisar.disabled = false;
}

// ---------- Ventas para revisar ----------
// Revisarlas implica leer cada venta del período (1 lectura por venta): se hace solo a pedido,
// avisando antes cuántas son.

async function revisarVentasDelPeriodo() {
  if (!movimientos) return;
  const { desde, hasta } = movimientos;
  const cantidad = await contarVentas(desde, hasta);
  if (cantidad === 0) {
    ventasRevisadas = [];
    return renderVentasParaRevisar();
  }

  const ok = await confirmar({
    titulo: "¿Revisar las ventas del período?",
    texto:
      `Son ${cantidad.toLocaleString("es-AR")} ventas. Revisarlas usa ${cantidad.toLocaleString("es-AR")} lecturas de las 50.000 gratuitas por día. ` +
      "Conviene revisar de a un día.",
    boton: "Revisar",
  });
  if (!ok) return;

  ventasRevisadas = await obtenerVentas(desde, hasta);
  renderVentasParaRevisar();
}

function renderVentasParaRevisar() {
  const tbody = $("tabla-ventas-revisar");
  if (!ventasRevisadas) return filaVacia(tbody, 4, "Tocá «Revisar ventas» para controlar las ventas del período.");

  const empleadoId = selectEmpleado.value;
  const ventas = ventasRevisadas.filter((v) => {
    const fecha = aDate(v.timestamp);
    return (!empleadoId || v.empleadoId === empleadoId) && fecha != null && fecha >= movimientos.desde && fecha <= movimientos.hasta;
  });
  const marcadas = revisarVentas(ventas, sesion.productos);
  if (marcadas.length === 0) return filaVacia(tbody, 4, "No hay ventas con datos que no cierren en el período.");

  tbody.replaceChildren(
    ...marcadas.map(({ venta, problemas }) =>
      h(
        "tr",
        {},
        h("td", {}, formatearFechaHora(venta.timestamp)),
        h("td", {}, venta.empleadoNombre || venta.empleadoId),
        h("td", { class: "num" }, formatearMoneda(Number(venta.total) || 0)),
        h("td", {}, h("ul", { class: "lista-problemas" }, ...problemas.map((p) => h("li", {}, p)))),
      ),
    ),
  );
}

const monto = (valor) => (valor == null ? "—" : formatearMoneda(valor));

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
        t.pendiente
          ? h(
              "button",
              { type: "button", class: "btn btn-secondary btn-sm", dataset: { calcularTurno: t.id }, "aria-label": `Calcular la caja del turno de ${t.empleado}` },
              icono("calculator"),
              " Calcular",
            )
          : null,
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
        h("td", { class: "num" }, monto(t.efectivo)),
        h("td", { class: "num" }, monto(t.mercadoPago)),
        h("td", { class: "num" }, monto(t.tarjeta)),
        h("td", { class: "num" }, monto(t.sube)),
        h("td", { class: "num" }, h("strong", {}, monto(t.totalVentas))),
        h("td", { class: "num" }, monto(t.egresos)),
        h("td", { class: "num" }, monto(t.guardado)),
        h("td", { class: "num" }, h("strong", {}, monto(t.total))),
        celdaAcciones,
      );
    }),
  );
}

/** Turno abierto: lee sus ventas (1 lectura por venta) y lo suma a los totales. */
async function calcularTurno(turnoId) {
  const turno = movimientos?.turnos.find((t) => t.id === turnoId);
  if (!turno) return;
  const ventas = await obtenerVentasTurno(turno);
  movimientos.ventas = [...movimientos.ventas.filter((v) => v.turnoId !== turnoId), ...ventas];
  movimientos.turnosCalculados.add(turnoId);
  renderResumen();
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

  await cerrarTurno(turno, caja, sesion.usuario);
  mostrarDetalle({ titulo: "Turno cerrado", contenido: desgloseCierre(caja) });
  await cargarResumen();
}
