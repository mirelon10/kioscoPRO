import { $, h, filaVacia, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto, redondear } from "../lib/dinero.js";
import { aDate, fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { listarEgresos, registrarEgreso } from "../data/egresos.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
import { avisar, conBoton, mostrarError, notificarExito } from "../ui.js";

const sumar = (egresos) => redondear(egresos.reduce((s, e) => s + (Number(e.monto) || 0), 0));

export function iniciarEgresos() {
  $("form-egreso").addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? e.target.querySelector("button"), () => alRegistrar(e.target));
  });
  $("form-filtro-egresos").addEventListener("submit", (e) => {
    e.preventDefault();
    cargarEgresos();
  });

  alCambiarSesion((_, cambios) => {
    if ("turno" in cambios || "movimientosTurno" in cambios || "rol" in cambios) renderEgresosTurno();
  });
}

export function reiniciarFiltrosEgresos() {
  const hoy = fechaLocalISO();
  $("egresos-desde").value = hoy;
  $("egresos-hasta").value = hoy;
  // La búsqueda por fecha es solo para administradores.
  mostrar($("egresos-historial"), esAdmin());
  renderEgresosTurno();
}

/** Egresos del turno abierto, en tiempo real (vienen de la sesión, sin consultas extra). */
function renderEgresosTurno() {
  mostrar($("egresos-turno"), !!sesion.turno);
  if (!sesion.turno) return;

  const tbody = $("tabla-egresos-turno");
  const egresos = [...(sesion.movimientosTurno?.egresos ?? [])].sort(
    (a, b) => (aDate(b.fecha) ?? 0) - (aDate(a.fecha) ?? 0),
  );

  if (egresos.length === 0) {
    filaVacia(tbody, 3, sesion.movimientosTurno ? "Todavía no registraste egresos en este turno." : "Cargando…");
  } else {
    tbody.replaceChildren(
      ...egresos.map((e) =>
        h(
          "tr",
          {},
          h("td", {}, aDate(e.fecha)?.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) ?? "-"),
          h("td", {}, e.motivo ?? ""),
          h("td", { class: "num" }, formatearMoneda(e.monto)),
        ),
      ),
    );
  }
  $("total-egresos-turno").textContent = formatearMoneda(sumar(egresos));
}

/** Historial por fecha (solo admin; las reglas igual le impedirían a un empleado ver egresos ajenos). */
export async function cargarEgresos() {
  if (!esAdmin()) return;
  const desde = $("egresos-desde").value;
  const hasta = $("egresos-hasta").value;
  if (!desde || !hasta) return;

  try {
    const egresos = await listarEgresos({ desde: inicioDelDia(desde), hasta: finDelDia(hasta) });
    const tbody = $("tabla-egresos-body");
    if (egresos.length === 0) {
      filaVacia(tbody, 4, "No hay egresos en el período.");
    } else {
      tbody.replaceChildren(
        ...egresos.map((e) =>
          h(
            "tr",
            {},
            h("td", {}, formatearFechaHora(e.fecha)),
            h("td", {}, e.empleadoNombre || e.empleadoId || "Desconocido"),
            h("td", {}, e.motivo ?? ""),
            h("td", { class: "num" }, formatearMoneda(e.monto)),
          ),
        ),
      );
    }
    $("total-egresos-lista").textContent = formatearMoneda(sumar(egresos));
  } catch (error) {
    mostrarError(error, "No se pudieron cargar los egresos.");
  }
}

async function alRegistrar(form) {
  if (!sesion.turno) return avisar("Turno cerrado", "Abrí un turno antes de registrar un egreso.");

  const motivo = $("egreso-motivo").value.trim();
  const monto = parsearMonto($("egreso-monto").value);
  if (!motivo) return avisar("Falta el motivo", "Indicá el motivo del egreso.");
  if (!(monto > 0)) return avisar("Monto inválido", "Ingresá un monto mayor a 0.");

  await registrarEgreso({ turnoId: sesion.turno.id, usuario: sesion.usuario, monto, motivo });
  form.reset();
  notificarExito("Egreso registrado");
  cargarEgresos();
}
