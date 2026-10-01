import { $, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto, redondear } from "../lib/dinero.js";
import { formatearFechaHora, horasDesde } from "../lib/fechas.js";
import { calcularCajaTurno } from "../core/caja.js";
import { abrirTurno, cerrarTurno } from "../data/turnos.js";
import { sesion, alCambiarSesion } from "../estado.js";
import { avisar, confirmar, conBoton, notificarExito } from "../ui.js";

const formAbrir = $("vista-abrir-turno");
const formCerrar = $("vista-cerrar-turno");
const inputContado = $("cajaFinal");

/** Si el empleado escribió un monto, no se lo pisamos cuando entra una venta nueva. */
let contadoEditado = false;
let esperadoActual = null;

export function iniciarTurno() {
  formAbrir.addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? formAbrir.querySelector("button"), alAbrir);
  });
  formCerrar.addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? formCerrar.querySelector("button"), alCerrar);
  });
  inputContado.addEventListener("input", () => {
    contadoEditado = true;
    renderDiferencia();
  });

  alCambiarSesion((_, cambios) => {
    if ("turno" in cambios || "movimientosTurno" in cambios) render();
  });
  render();
}

function render() {
  const turno = sesion.turno;
  mostrar(formAbrir, !turno);
  mostrar(formCerrar, !!turno);

  const estado = $("estado-turno");
  estado.textContent = turno ? "● Turno abierto" : "○ Sin turno abierto";
  estado.classList.toggle("abierto", !!turno);

  if (!turno) {
    contadoEditado = false;
    esperadoActual = null;
    inputContado.value = "";
    return;
  }

  $("txt-fecha-apertura").textContent = `Abierto el ${formatearFechaHora(turno.fechaApertura)}`;
  mostrar($("aviso-turno-largo"), horasDesde(turno.fechaApertura) >= 24);
  renderCaja(turno, sesion.movimientosTurno);
}

function renderCaja(turno, movimientos) {
  const boton = formCerrar.querySelector("button[type=submit]");

  if (!movimientos) {
    for (const id of ["caja-efectivo", "caja-egresos", "caja-esperado"]) $(id).textContent = "Calculando…";
    $("caja-inicial").textContent = formatearMoneda(turno.cajaInicial);
    $("caja-otros").textContent = "";
    boton.disabled = true;
    esperadoActual = null;
    return;
  }

  const caja = calcularCajaTurno({ cajaInicial: turno.cajaInicial, ...movimientos });
  esperadoActual = caja.esperado;
  boton.disabled = false;

  $("caja-inicial").textContent = formatearMoneda(caja.cajaInicial);
  $("caja-efectivo").textContent = formatearMoneda(caja.efectivo);
  $("caja-egresos").textContent = formatearMoneda(caja.egresos);
  $("caja-esperado").textContent = formatearMoneda(caja.esperado);
  $("caja-otros").textContent =
    `${caja.cantidadVentas} venta(s) en el turno. ` +
    `Mercado Pago y tarjeta: ${formatearMoneda(caja.otrosMedios)} (no entran a la caja).`;

  if (!contadoEditado) inputContado.value = caja.esperado.toFixed(2);
  renderDiferencia();
}

function renderDiferencia() {
  const el = $("caja-diferencia");
  const contado = parsearMonto(inputContado.value);
  if (esperadoActual == null || !(contado >= 0)) {
    el.textContent = "";
    return;
  }
  const diferencia = redondear(contado - esperadoActual);
  el.className = `diferencia-preview ${diferencia < 0 ? "text-danger" : diferencia > 0 ? "text-success" : ""}`;
  el.textContent =
    diferencia === 0
      ? "Coincide con lo esperado."
      : `${diferencia < 0 ? "Faltante" : "Sobrante"} de ${formatearMoneda(Math.abs(diferencia))}.`;
}

async function alAbrir() {
  const input = $("cajaInicial");
  const cajaInicial = parsearMonto(input.value);
  if (!(cajaInicial >= 0)) return avisar("Monto inválido", "Ingresá cuánto dinero hay en la caja (puede ser 0).");

  await abrirTurno(sesion.usuario, cajaInicial);
  input.value = "";
  contadoEditado = false;
  notificarExito("Turno abierto");
}

async function alCerrar() {
  const cajaContada = parsearMonto(inputContado.value);
  if (!(cajaContada >= 0)) return avisar("Monto inválido", "Ingresá el efectivo contado en la caja.");

  const diferencia = esperadoActual == null ? 0 : redondear(cajaContada - esperadoActual);
  const detalle =
    diferencia === 0
      ? "Coincide con lo esperado."
      : `${diferencia < 0 ? "Faltante" : "Sobrante"} de ${formatearMoneda(Math.abs(diferencia))}.`;

  const ok = await confirmar({
    titulo: "¿Cerrar turno?",
    texto: `Declarás ${formatearMoneda(cajaContada)} en caja. ${detalle} No se puede modificar después.`,
    boton: "Cerrar turno",
  });
  if (!ok) return;

  const resultado = await cerrarTurno(sesion.turno.id, cajaContada);
  contadoEditado = false;
  notificarExito(`Turno cerrado · esperado ${formatearMoneda(resultado.esperado)}`);
}
