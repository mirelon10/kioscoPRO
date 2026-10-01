import { $, h, filaVacia } from "../lib/dom.js";
import { formatearMoneda, parsearMonto, redondear } from "../lib/dinero.js";
import { fechaLocalISO, finDelDia, formatearFechaHora, inicioDelDia } from "../lib/fechas.js";
import { listarEgresos, registrarEgreso } from "../data/egresos.js";
import { sesion, esAdmin } from "../estado.js";
import { avisar, conBoton, mostrarError, notificarExito } from "../ui.js";

const tbody = $("tabla-egresos-body");

export function iniciarEgresos() {
  $("form-egreso").addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? e.target.querySelector("button"), () => alRegistrar(e.target));
  });
  $("form-filtro-egresos").addEventListener("submit", (e) => {
    e.preventDefault();
    cargarEgresos();
  });
}

export function reiniciarFiltrosEgresos() {
  const hoy = fechaLocalISO();
  $("egresos-desde").value = hoy;
  $("egresos-hasta").value = hoy;
}

export async function cargarEgresos() {
  const desde = $("egresos-desde").value;
  const hasta = $("egresos-hasta").value;
  if (!desde || !hasta) return;

  try {
    const egresos = await listarEgresos({
      desde: inicioDelDia(desde),
      hasta: finDelDia(hasta),
      // El admin ve todos; el empleado solo los suyos (también lo exigen las reglas).
      empleadoId: esAdmin() ? null : sesion.usuario.uid,
    });
    renderTablaEgresos(tbody, egresos);
    $("total-egresos-lista").textContent = formatearMoneda(
      redondear(egresos.reduce((s, e) => s + (Number(e.monto) || 0), 0)),
    );
  } catch (error) {
    mostrarError(error, "No se pudieron cargar los egresos.");
  }
}

/** Tabla de egresos compartida con el panel de administración. */
export function renderTablaEgresos(cuerpo, egresos) {
  if (egresos.length === 0) return filaVacia(cuerpo, 4, "No hay egresos en el período.");
  cuerpo.replaceChildren(
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
