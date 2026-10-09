import { h } from "../lib/dom.js";
import { mostrarDetalle } from "../ui.js";

// Botones "Instalar app" (en el login y en el menú): dejan la app como un programa más en la PC o
// un ícono en el celular (se abre en su propia ventana, sin la barra del navegador).
// - Si el navegador ofrece instalar (`beforeinstallprompt`: Chrome / Edge en PC y Android), el botón
//   abre su cartel.
// - Si no (iPhone, Safari, Firefox, o Chrome todavía no lo ofreció), el botón explica cómo hacerlo
//   desde el menú de ese navegador.
// Se ocultan si la app ya está abierta como instalada.

const botones = () => document.querySelectorAll(".js-instalar");
let pedidoInstalacion = null;

const yaInstalada = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

const mostrarBotones = (visible) => botones().forEach((b) => b.classList.toggle("hidden", !visible));

export function iniciarInstalacion() {
  if (yaInstalada()) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // en vez del cartel automático, se usan los botones
    pedidoInstalacion = e;
  });
  window.addEventListener("appinstalled", () => {
    pedidoInstalacion = null;
    mostrarBotones(false);
  });

  botones().forEach((b) => b.addEventListener("click", instalar));
  mostrarBotones(true);
}

/** El navegador avisa que se puede instalar unos segundos después de abrir la página. */
async function esperarPedido(ms) {
  for (let t = 0; !pedidoInstalacion && t < ms; t += 200) await new Promise((r) => setTimeout(r, 200));
  return pedidoInstalacion;
}

/** Chrome y Edge dicen si la app ya está instalada en este equipo (ver related_applications del manifest). */
async function estaInstaladaEnEsteEquipo() {
  try {
    return (await navigator.getInstalledRelatedApps?.())?.length > 0;
  } catch {
    return false;
  }
}

async function instalar() {
  const pedido = pedidoInstalacion ?? (await esperarPedido(3000));
  if (pedido) {
    pedidoInstalacion = null; // el navegador permite usarlo una sola vez
    await pedido.prompt();
    const { outcome } = await pedido.userChoice;
    if (outcome === "dismissed") {
      mostrarDetalle({
        titulo: "No se instaló",
        icono: "info",
        contenido: h("p", {}, "Para intentar de nuevo, recargá la página y tocá \"Instalar app\"."),
      });
    }
    return;
  }
  if (await estaInstaladaEnEsteEquipo()) {
    mostrarDetalle({
      titulo: "Ya está instalada",
      icono: "success",
      contenido: h(
        "p",
        {},
        "Kiosco Pro ya está instalada en este equipo. Abrila desde su ícono: en la PC, en el escritorio o el menú Inicio; en el celular, en la pantalla de inicio.",
      ),
    });
    return;
  }
  const { titulo, nota, pasos } = instrucciones();
  mostrarDetalle({
    titulo,
    icono: "info",
    contenido: h(
      "div",
      {},
      nota ? h("p", { class: "nota-instalar" }, nota) : "",
      h("ol", { class: "pasos-instalar" }, ...pasos.map((p) => h("li", {}, p))),
    ),
  });
}

/** Pasos para instalar a mano según el dispositivo y el navegador. */
function instrucciones() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const edge = /edg\//i.test(ua);
  const samsung = /samsungbrowser/i.test(ua);
  const firefox = /firefox|fxios/i.test(ua);
  const chrome = /chrome|crios/i.test(ua) && !edge && !samsung;
  const safariMac = !ios && /safari/i.test(ua) && !chrome && !edge && !firefox && /macintosh/i.test(ua);

  if (ios) {
    return {
      titulo: "Instalar en iPhone / iPad",
      nota: "Apple no deja que una página se instale sola con un botón: hay que hacerlo desde el navegador, una sola vez.",
      pasos: [
        "Tocá el botón Compartir (el cuadrado con la flecha hacia arriba). En Chrome está arriba a la derecha.",
        "Bajá y elegí \"Agregar a inicio\" (o \"Agregar a pantalla de inicio\").",
        "Tocá \"Agregar\". La app queda con su ícono en la pantalla de inicio.",
      ],
    };
  }
  if (android) {
    return {
      titulo: "Instalar en el celular",
      pasos: samsung
        ? ["Tocá el menú (☰ abajo a la derecha).", "Elegí \"Agregar página a\" → \"Pantalla de inicio\"."]
        : firefox
          ? ["Tocá el menú (⋮).", "Elegí \"Instalar\" o \"Agregar a pantalla de inicio\"."]
          : [
              "Tocá el menú (⋮ arriba a la derecha).",
              "Elegí \"Instalar app\" o \"Agregar a pantalla principal\".",
              "Confirmá con \"Instalar\". La app queda con su ícono junto a las demás.",
            ],
    };
  }
  if (safariMac) {
    return { titulo: "Instalar en la Mac", pasos: ["En el menú Archivo, elegí \"Agregar al Dock\"."] };
  }
  if (firefox) {
    return {
      titulo: "Firefox no instala apps",
      pasos: ["Abrí esta misma página en Google Chrome o Microsoft Edge.", "Tocá \"Instalar app\" de nuevo."],
    };
  }
  return {
    titulo: "Instalar en la PC",
    pasos: edge
      ? [
          "Hacé clic en el menú (··· arriba a la derecha).",
          "Elegí \"Aplicaciones\" → \"Instalar Kiosco Pro\".",
          "Queda en el escritorio y en el menú Inicio.",
        ]
      : [
          "Hacé clic en el ícono de instalar que aparece a la derecha de la barra de direcciones (una pantallita con una flecha).",
          "Si no está: menú (⋮ arriba a la derecha) → \"Transmitir, guardar y compartir\" → \"Instalar página como app\".",
          "Queda en el escritorio y en el menú Inicio.",
        ],
  };
}
