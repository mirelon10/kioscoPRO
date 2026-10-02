import { $, h, filaVacia, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto } from "../lib/dinero.js";
import { aDate, fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { ORIGENES_EGRESO, TIPOS_EGRESO, etiquetaTipoEgreso, normalizarEgreso, totalizarEgresos } from "../core/egresos.js";
import { listarEgresos, registrarEgreso } from "../data/egresos.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
import { avisar, confirmar, conBoton, mostrarError, notificarExito } from "../ui.js";

export function iniciarEgresos() {
  $("form-egreso").addEventListener("submit", (e) => {
    e.preventDefault();
    // Dos botones: "Pagar con la caja" y "Pagar con caja de guardado".
    const boton = e.submitter ?? e.target.querySelector("button");
    conBoton(boton, () => alRegistrar(e.target, boton.dataset.origen ?? "caja"));
  });
  $("form-filtro-egresos").addEventListener("submit", (e) => {
    e.preventDefault();
    cargarEgresos();
  });

  alCambiarSesion((_, cambios) => {
    if ("turno" in cambios || "movimientosTurno" in cambios || "rol" in cambios) renderEgresosTurno();
    if ("saldoGuardado" in cambios) renderSaldo();
  });
}

export function reiniciarFiltrosEgresos() {
  const hoy = fechaLocalISO();
  $("egresos-desde").value = hoy;
  $("egresos-hasta").value = hoy;
  // La búsqueda por fecha es solo para administradores.
  mostrar($("egresos-historial"), esAdmin());
  renderEgresosTurno();
  renderSaldo();
}

function renderSaldo() {
  $("egreso-saldo-guardado").textContent = sesion.saldoGuardado == null ? "—" : formatearMoneda(sesion.saldoGuardado);
}

const celdasEgreso = (e) => [
  h("td", {}, e.motivo ?? ""),
  h("td", {}, h("span", { class: `badge badge-${e.tipo ?? "sin-tipo"}` }, etiquetaTipoEgreso(e.tipo))),
  h("td", {}, ORIGENES_EGRESO[e.origen]),
  h("td", { class: "num" }, formatearMoneda(e.monto)),
];

/** "Costos fijos $ · Costos variables $ · De la caja de guardado $" */
function detalleTotales(t) {
  const partes = [`Costos fijos ${formatearMoneda(t.fijos)}`, `Costos variables ${formatearMoneda(t.variables)}`];
  if (t.sinClasificar) partes.push(`Sin clasificar ${formatearMoneda(t.sinClasificar)}`);
  partes.push(`Pagado con caja de guardado ${formatearMoneda(t.desdeGuardado)}`);
  return partes.join(" · ");
}

/** Egresos del turno abierto, en tiempo real (vienen de la sesión, sin consultas extra). */
function renderEgresosTurno() {
  mostrar($("egresos-turno"), !!sesion.turno);
  if (!sesion.turno) return;

  const tbody = $("tabla-egresos-turno");
  const egresos = (sesion.movimientosTurno?.egresos ?? [])
    .map(normalizarEgreso)
    .sort((a, b) => (aDate(b.fecha) ?? 0) - (aDate(a.fecha) ?? 0));

  if (egresos.length === 0) {
    filaVacia(tbody, 5, sesion.movimientosTurno ? "Todavía no registraste egresos en este turno." : "Cargando…");
  } else {
    tbody.replaceChildren(
      ...egresos.map((e) =>
        h("tr", {}, h("td", {}, aDate(e.fecha)?.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) ?? "-"), ...celdasEgreso(e)),
      ),
    );
  }
  const totales = totalizarEgresos(egresos);
  $("total-egresos-turno").textContent = formatearMoneda(totales.total);
  $("detalle-egresos-turno").textContent = egresos.length ? detalleTotales(totales) : "";
}

/** Historial por fecha (solo admin; las reglas igual le impedirían a un empleado ver egresos ajenos). */
export async function cargarEgresos() {
  if (!esAdmin()) return;
  const desde = $("egresos-desde").value;
  const hasta = $("egresos-hasta").value;
  if (!desde || !hasta) return;

  try {
    const egresos = (await listarEgresos({ desde: inicioDelDia(desde), hasta: finDelDia(hasta) })).map(normalizarEgreso);
    const tbody = $("tabla-egresos-body");
    if (egresos.length === 0) {
      filaVacia(tbody, 6, "No hay egresos en el período.");
    } else {
      tbody.replaceChildren(
        ...egresos.map((e) =>
          h("tr", {}, h("td", {}, formatearFechaHora(e.fecha)), h("td", {}, e.empleadoNombre || e.empleadoId || "Desconocido"), ...celdasEgreso(e)),
        ),
      );
    }
    const totales = totalizarEgresos(egresos);
    $("total-egresos-lista").textContent = formatearMoneda(totales.total);
    $("detalle-egresos-lista").textContent = egresos.length ? detalleTotales(totales) : "";
  } catch (error) {
    mostrarError(error, "No se pudieron cargar los egresos.");
  }
}

async function alRegistrar(form, origen) {
  if (!sesion.turno) return avisar("Turno cerrado", "Abrí un turno antes de registrar un egreso.");

  const motivo = $("egreso-motivo").value.trim();
  const monto = parsearMonto($("egreso-monto").value);
  const tipo = $("egreso-tipo").value;
  if (!motivo) return avisar("Falta el motivo", "Indicá el motivo del egreso.");
  if (!(monto > 0)) return avisar("Monto inválido", "Ingresá un monto mayor a 0.");
  if (!(tipo in TIPOS_EGRESO)) return avisar("Falta el tipo", "Elegí si es un costo fijo o un costo variable.");

  if (origen === "guardado") {
    const saldo = sesion.saldoGuardado ?? 0;
    if (monto > saldo) {
      return avisar("No alcanza", `En la caja de guardado hay ${formatearMoneda(saldo)}. No alcanza para pagar ${formatearMoneda(monto)}.`);
    }
    const ok = await confirmar({
      titulo: "¿Pagar con la caja de guardado?",
      texto: `${motivo}: ${formatearMoneda(monto)} (${TIPOS_EGRESO[tipo].toLowerCase()}). Se descuenta del saldo de la caja de guardado, no de la caja del turno.`,
      boton: "Pagar",
    });
    if (!ok) return;
  }

  await registrarEgreso({ turnoId: sesion.turno.id, usuario: sesion.usuario, monto, motivo, tipo, origen });
  form.reset();
  notificarExito(origen === "guardado" ? "Egreso pagado con la caja de guardado" : "Egreso registrado");
  cargarEgresos();
}
