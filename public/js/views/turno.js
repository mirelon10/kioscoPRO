import { $, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto } from "../lib/dinero.js";
import { formatearFechaHora, horasDesde } from "../lib/fechas.js";
import { abrirTurno, cerrarTurno } from "../data/turnos.js";
import { sesion, alCambiarSesion } from "../estado.js";
import { avisar, confirmar, conBoton, notificarExito } from "../ui.js";

const formAbrir = $("vista-abrir-turno");
const formCerrar = $("vista-cerrar-turno");

export function iniciarTurno() {
  formAbrir.addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? formAbrir.querySelector("button"), alAbrir);
  });
  formCerrar.addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? formCerrar.querySelector("button"), alCerrar);
  });

  alCambiarSesion((_, cambios) => {
    if ("turno" in cambios) render();
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

  if (turno) {
    $("txt-fecha-apertura").textContent =
      `Abierto el ${formatearFechaHora(turno.fechaApertura)} con ${formatearMoneda(turno.cajaInicial)}`;
    mostrar($("aviso-turno-largo"), horasDesde(turno.fechaApertura) >= 24);
  }
}

async function alAbrir() {
  const input = $("cajaInicial");
  const cajaInicial = parsearMonto(input.value);
  if (!(cajaInicial >= 0)) return avisar("Monto inválido", "Ingresá cuánto dinero hay en la caja (puede ser 0).");

  await abrirTurno(sesion.usuario, cajaInicial);
  input.value = "";
  notificarExito("Turno abierto");
}

async function alCerrar() {
  const input = $("cajaFinal");
  const cajaFinal = parsearMonto(input.value);
  if (!(cajaFinal >= 0)) return avisar("Monto inválido", "Ingresá el dinero contado en la caja.");

  const ok = await confirmar({
    titulo: "¿Cerrar turno?",
    texto: `Vas a declarar ${formatearMoneda(cajaFinal)} en caja. No se puede modificar después.`,
    boton: "Cerrar turno",
  });
  if (!ok) return;

  await cerrarTurno(sesion.usuario.uid, sesion.turno.id, cajaFinal);
  input.value = "";
  notificarExito("Turno cerrado");
}
