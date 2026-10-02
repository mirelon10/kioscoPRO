import { ErrorNegocio, mensajeDeError } from "./core/errores.js";
import { h } from "./lib/dom.js";

// SweetAlert2 se carga como <script> clásico en index.html (con integridad SRI).
const Swal = window.Swal;

// Siempre se usa titleText/text (no title/html) para que SweetAlert no interprete datos como HTML.
const escaparHtml = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2500,
  timerProgressBar: true,
});

export const notificarExito = (titulo) => toast.fire({ icon: "success", titleText: titulo });
export const avisar = (titulo, texto) => Swal.fire({ icon: "warning", titleText: titulo, text: texto });

export function mostrarError(error, porDefecto) {
  if (!(error instanceof ErrorNegocio)) console.error(error);
  return Swal.fire({ icon: "error", titleText: "Error", text: mensajeDeError(error, porDefecto) });
}

/** Muestra un elemento del DOM armado con h() (nunca un string HTML). */
export const mostrarDetalle = ({ titulo, contenido, icono = "success" }) =>
  Swal.fire({ icon: icono, titleText: titulo, html: contenido, confirmButtonText: "Listo" });

/** `contenido` (opcional) es un elemento del DOM que se muestra debajo del texto. */
export async function confirmar({ titulo, texto, contenido = null, boton = "Confirmar", peligro = false }) {
  const { isConfirmed } = await Swal.fire({
    icon: peligro ? "warning" : "question",
    titleText: titulo,
    ...(contenido ? { html: h("div", {}, h("p", { class: "mb-3" }, texto), contenido) } : { text: texto }),
    showCancelButton: true,
    confirmButtonText: boton,
    cancelButtonText: "Cancelar",
    confirmButtonColor: peligro ? "#ef4444" : "#2563eb",
    focusCancel: peligro,
  });
  return isConfirmed;
}

/** Abre un formulario modal. `leer` devuelve los valores o un string con el error de validación. */
export async function formularioModal({ titulo, contenido, alAbrir, leer, boton = "Guardar" }) {
  const { value } = await Swal.fire({
    titleText: titulo,
    html: contenido,
    showCancelButton: true,
    confirmButtonText: boton,
    cancelButtonText: "Cancelar",
    focusConfirm: false,
    willOpen: (popup) => alAbrir?.(popup), // antes de mostrarse: el formulario nunca se ve vacío
    preConfirm: () => {
      const resultado = leer(Swal.getPopup());
      if (typeof resultado === "string") {
        Swal.showValidationMessage(escaparHtml(resultado)); // lo inserta como HTML
        return false;
      }
      return resultado;
    },
  });
  return value ?? null;
}

/**
 * Deshabilita el botón mientras corre la acción: evita cobrar dos veces con un doble clic.
 * Los errores se muestran al usuario.
 */
export async function conBoton(boton, accion) {
  if (boton.disabled) return;
  boton.disabled = true;
  boton.setAttribute("aria-busy", "true");
  try {
    await accion();
  } catch (error) {
    mostrarError(error);
  } finally {
    boton.disabled = false;
    boton.removeAttribute("aria-busy");
  }
}
