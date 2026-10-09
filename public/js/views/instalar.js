import { $, h, mostrar } from "../lib/dom.js";
import { mostrarDetalle } from "../ui.js";

// Botón "Instalar app": deja la app como un programa más en la PC o un ícono en el celular
// (se abre en su propia ventana, sin la barra del navegador). Se oculta si ya está instalada.
// - Chrome / Edge (PC y Android): el navegador avisa con `beforeinstallprompt` y el botón abre su cartel.
// - iPhone / iPad: Safari no tiene ese aviso; el botón explica cómo agregarla a la pantalla de inicio.

const btn = $("btn-instalar");
let pedidoInstalacion = null;

const yaInstalada = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

const esIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad con iPadOS 13+

export function iniciarInstalacion() {
  if (yaInstalada()) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // en vez del cartel automático, se usa el botón
    pedidoInstalacion = e;
    mostrar(btn, true);
  });
  window.addEventListener("appinstalled", () => {
    pedidoInstalacion = null;
    mostrar(btn, false);
  });

  if (esIOS()) mostrar(btn, true);
  btn.addEventListener("click", instalar);
}

async function instalar() {
  if (pedidoInstalacion) {
    const pedido = pedidoInstalacion;
    // El navegador permite usarlo una sola vez. Si dice que no, el botón vuelve cuando el
    // navegador lo ofrezca de nuevo (otro beforeinstallprompt).
    pedidoInstalacion = null;
    mostrar(btn, false);
    await pedido.prompt();
    return;
  }
  if (esIOS()) {
    mostrarDetalle({
      titulo: "Instalar en iPhone / iPad",
      icono: "info",
      contenido: h(
        "ol",
        { class: "pasos-instalar" },
        h("li", {}, "Abrí esta página en Safari."),
        h("li", {}, "Tocá el botón Compartir (el cuadrado con la flecha hacia arriba)."),
        h("li", {}, "Elegí \"Agregar a inicio\" y tocá \"Agregar\"."),
      ),
    });
  }
}
