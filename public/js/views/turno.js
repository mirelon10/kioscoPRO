import { $, h, mostrar, filaVacia } from "../lib/dom.js";
import { formatearMoneda, parsearMonto } from "../lib/dinero.js";
import { aDate, formatearFechaHora, horasDesde } from "../lib/fechas.js";
import { calcularCajaTurno } from "../core/caja.js";
import { abrirTurno, cerrarTurno } from "../data/turnos.js";
import { registrarGuardado } from "../data/cajaGuardado.js";
import { sesion, alCambiarSesion } from "../estado.js";
import { avisar, confirmar, conBoton, mostrarDetalle, notificarExito, notificarRegistro } from "../ui.js";
import { desgloseCierre } from "./desglose.js";

const formAbrir = $("vista-abrir-turno");
const formCerrar = $("vista-cerrar-turno");
const formGuardado = $("form-guardado");

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
  formGuardado.addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? formGuardado.querySelector("button"), alGuardar);
  });

  alCambiarSesion((_, cambios) => {
    if ("turno" in cambios || "movimientosTurno" in cambios) render();
    if ("saldoGuardado" in cambios) renderSaldo();
  });
  render();
}

function render() {
  const turno = sesion.turno;
  mostrar(formAbrir, !turno);
  mostrar(formCerrar, !!turno);
  mostrar($("caja-guardado"), !!turno);

  const estado = $("estado-turno");
  estado.textContent = turno ? "● Turno abierto" : "○ Sin turno abierto";
  estado.classList.toggle("abierto", !!turno);

  if (!turno) {
    cajaActual = null;
    return;
  }

  $("txt-fecha-apertura").textContent = `Abierto el ${formatearFechaHora(turno.fechaApertura)}`;
  mostrar($("aviso-turno-largo"), horasDesde(turno.fechaApertura) >= 24);
  renderCaja(turno, sesion.movimientosTurno);
}

function renderCaja(turno, movimientos) {
  const botonCerrar = formCerrar.querySelector("button[type=submit]");
  const botonGuardar = formGuardado.querySelector("button[type=submit]");
  const contenedor = $("cierre-desglose");

  if (!movimientos) {
    contenedor.replaceChildren(h("p", { class: "text-muted" }, "Calculando…"));
    botonCerrar.disabled = botonGuardar.disabled = true;
    cajaActual = null;
    return;
  }

  cajaActual = calcularCajaTurno({ cajaInicial: turno.cajaInicial, ...movimientos });
  botonCerrar.disabled = botonGuardar.disabled = false;
  contenedor.replaceChildren(desgloseCierre(cajaActual));
  renderGuardados(movimientos.guardados);
}

function renderSaldo() {
  $("saldo-guardado-turno").textContent = sesion.saldoGuardado == null ? "—" : formatearMoneda(sesion.saldoGuardado);
}

function renderGuardados(guardados) {
  const tbody = $("tabla-guardados");
  $("total-guardado").textContent = formatearMoneda(cajaActual.guardado);
  if (guardados.length === 0) return filaVacia(tbody, 2, "Todavía no guardaste plata en este turno.");

  const ordenados = [...guardados].sort((a, b) => (aDate(b.fecha) ?? 0) - (aDate(a.fecha) ?? 0));
  tbody.replaceChildren(
    ...ordenados.map((g) =>
      h(
        "tr",
        {},
        h("td", {}, aDate(g.fecha)?.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) ?? "-"),
        h("td", { class: "num" }, formatearMoneda(g.monto)),
      ),
    ),
  );
}

async function alAbrir() {
  const input = $("cajaInicial");
  const cajaInicial = parsearMonto(input.value);
  if (!(cajaInicial >= 0)) return avisar("Monto inválido", "Ingresá cuánto dinero hay en la caja (puede ser 0).");

  const pendiente = await abrirTurno(sesion.usuario, cajaInicial);
  input.value = "";
  notificarRegistro("Turno abierto", pendiente);
}

async function alGuardar() {
  if (!sesion.turno || !cajaActual) return;
  const input = $("guardado-monto");
  const monto = parsearMonto(input.value);
  if (!(monto > 0)) return avisar("Monto inválido", "Ingresá cuánta plata pasás a la caja de guardado.");
  if (monto > cajaActual.efectivoEnCaja) {
    return avisar(
      "No alcanza el efectivo",
      `En la caja hay ${formatearMoneda(cajaActual.efectivoEnCaja)} en efectivo. No podés guardar más que eso.`,
    );
  }

  const ok = await confirmar({
    titulo: "¿Pasar a la caja de guardado?",
    texto: `Guardás ${formatearMoneda(monto)} en efectivo. Se resta del total del turno y no se puede deshacer.`,
    boton: "Guardar",
  });
  if (!ok) return;

  await registrarGuardado({ turnoId: sesion.turno.id, usuario: sesion.usuario, monto });
  input.value = "";
  notificarExito(`${formatearMoneda(monto)} en la caja de guardado`);
}

async function alCerrar() {
  // Se guarda antes de cerrar: al cerrarse, el turno deja de escucharse y cajaActual vuelve a null.
  const caja = cajaActual;
  if (!caja) return avisar("Calculando", "Esperá a que termine de calcularse la caja del turno.");

  const ok = await confirmar({
    titulo: "¿Cerrar turno?",
    texto: "Revisá el cierre. Una vez cerrado no se puede modificar.",
    contenido: desgloseCierre(caja),
    boton: "Cerrar turno",
  });
  if (!ok) return;

  const pendiente = await cerrarTurno(sesion.turno, caja, sesion.usuario);
  mostrarDetalle({
    titulo: pendiente ? "Turno cerrado sin conexión (se sube al volver internet)" : "Turno cerrado",
    contenido: desgloseCierre(caja),
  });
}
