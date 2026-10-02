import { $, h, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto, redondear } from "../lib/dinero.js";
import { formatearFechaHora, horasDesde } from "../lib/fechas.js";
import { calcularCajaTurno } from "../core/caja.js";
import { abrirTurno, cerrarTurno } from "../data/turnos.js";
import { sesion, alCambiarSesion } from "../estado.js";
import { avisar, confirmar, conBoton, mostrarDetalle, notificarExito } from "../ui.js";
import { desgloseCierre } from "./desglose.js";

const formAbrir = $("vista-abrir-turno");
const formCerrar = $("vista-cerrar-turno");
const inputContado = $("cajaFinal");

/** Si el empleado escribió un monto, no se lo pisamos cuando entra una venta nueva. */
let contadoEditado = false;
/** Caja calculada del turno abierto (calcularCajaTurno), o null mientras carga. */
let cajaActual = null;

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
    cajaActual = null;
    inputContado.value = "";
    return;
  }

  $("txt-fecha-apertura").textContent = `Abierto el ${formatearFechaHora(turno.fechaApertura)}`;
  mostrar($("aviso-turno-largo"), horasDesde(turno.fechaApertura) >= 24);
  renderCaja(turno, sesion.movimientosTurno);
}

function renderCaja(turno, movimientos) {
  const boton = formCerrar.querySelector("button[type=submit]");
  const contenedor = $("cierre-desglose");

  if (!movimientos) {
    contenedor.replaceChildren(h("p", { class: "text-muted" }, "Calculando…"));
    boton.disabled = true;
    cajaActual = null;
    renderDiferencia();
    return;
  }

  cajaActual = calcularCajaTurno({ cajaInicial: turno.cajaInicial, ...movimientos });
  boton.disabled = false;
  contenedor.replaceChildren(desgloseCierre(cajaActual));

  if (!contadoEditado) inputContado.value = cajaActual.esperado.toFixed(2);
  renderDiferencia();
}

function renderDiferencia() {
  const el = $("caja-diferencia");
  const contado = parsearMonto(inputContado.value);
  if (cajaActual == null || !(contado >= 0)) {
    el.textContent = "";
    return;
  }
  const diferencia = redondear(contado - cajaActual.esperado);
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

  // Se guarda antes de cerrar: al cerrarse, el turno deja de escucharse y cajaActual vuelve a null.
  const caja = cajaActual;
  if (!caja) return avisar("Calculando", "Esperá a que termine de calcularse la caja del turno.");

  const ok = await confirmar({
    titulo: "¿Cerrar turno?",
    texto: "Revisá el detalle. Una vez cerrado no se puede modificar.",
    contenido: desgloseCierre(caja, { contado: cajaContada }),
    boton: "Cerrar turno",
  });
  if (!ok) return;

  await cerrarTurno(sesion.turno, cajaContada, sesion.usuario);
  contadoEditado = false;
  mostrarDetalle({ titulo: "Turno cerrado", contenido: desgloseCierre(caja, { contado: cajaContada }) });
}
