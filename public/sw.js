// Service worker: permite abrir la app sin internet (los datos los guarda Firestore en su propia caché).
//
// - Archivos propios (HTML, CSS, JS): primero la red, así siempre corre la última versión publicada.
//   Sin conexión, o si la red tarda más de ESPERA_RED_MS, se usa la copia guardada.
// - Librerías de CDN (Firebase, SweetAlert, Font Awesome, SheetJS): sus URLs llevan la versión y no
//   cambian nunca, así que se sirven desde la copia guardada.
// - Firestore y Auth (googleapis.com) no pasan por acá: los maneja el SDK.
//
// Al agregar un archivo a public/ o cambiar una versión del CDN, actualizá las listas de abajo
// (tests/unit/sw.test.js lo verifica).

const VERSION = "v2";
const CACHE_APP = `kiosco-app-${VERSION}`;
const CACHE_CDN = `kiosco-cdn-${VERSION}`;
const ESPERA_RED_MS = 4000;

// La misma versión que public/js/firebase.js.
const FIREBASE = "https://www.gstatic.com/firebasejs/12.19.0";

const ARCHIVOS_APP = [
  "./",
  "css/style.css",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "js/core/auditoria.js",
  "js/core/caja.js",
  "js/core/egresos.js",
  "js/core/errores.js",
  "js/core/exportacion.js",
  "js/core/productos.js",
  "js/core/resumen.js",
  "js/core/usuarios.js",
  "js/core/ventas.js",
  "js/data/cajaGuardado.js",
  "js/data/conexion.js",
  "js/data/egresos.js",
  "js/data/productos.js",
  "js/data/reportes.js",
  "js/data/turnos.js",
  "js/data/usuarios.js",
  "js/data/ventas.js",
  "js/estado.js",
  "js/firebase.js",
  "js/lib/dinero.js",
  "js/lib/dom.js",
  "js/lib/espera.js",
  "js/lib/excel.js",
  "js/lib/fechas.js",
  "js/main.js",
  "js/ui.js",
  "js/views/admin.js",
  "js/views/desglose.js",
  "js/views/egresos.js",
  "js/views/instalar.js",
  "js/views/pos.js",
  "js/views/stock.js",
  "js/views/turno.js",
  "js/views/usuarios.js",
  "manifest.webmanifest",
];

// SheetJS (exportar a Excel) no se descarga de antemano: pesa casi 1 MB y se guarda la primera vez que se usa.
// reCAPTCHA (www.google.com) no se guarda: sin internet no hay tokens de App Check igual.
const ARCHIVOS_CDN = [
  `${FIREBASE}/firebase-app.js`,
  `${FIREBASE}/firebase-firestore.js`,
  `${FIREBASE}/firebase-auth.js`,
  `${FIREBASE}/firebase-app-check.js`,
  "https://cdn.jsdelivr.net/npm/sweetalert2@11.26.25/dist/sweetalert2.all.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-solid-900.woff2",
];

const ORIGENES_CDN = [
  "https://www.gstatic.com",
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com",
  "https://cdn.sheetjs.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const app = await caches.open(CACHE_APP);
      // cache: "reload" evita guardar una copia vieja de la caché HTTP del navegador.
      await app.addAll(ARCHIVOS_APP.map((url) => new Request(url, { cache: "reload" })));
      const cdn = await caches.open(CACHE_CDN);
      await cdn.addAll(ARCHIVOS_CDN);
      // Los archivos propios se piden primero a la red, así que la versión nueva puede tomar el control ya.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const vigentes = [CACHE_APP, CACHE_CDN];
      for (const nombre of await caches.keys()) {
        if (!vigentes.includes(nombre)) await caches.delete(nombre);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const origen = new URL(request.url).origin;
  if (origen === self.location.origin) event.respondWith(primeroLaRed(request));
  else if (ORIGENES_CDN.includes(origen)) event.respondWith(primeroLaCache(request));
});

async function primeroLaRed(request) {
  const cache = await caches.open(CACHE_APP);
  // La descarga sigue aunque se use la copia guardada: así queda actualizada para la próxima.
  const red = fetch(request).then((respuesta) => {
    if (respuesta.ok && !respuesta.redirected) cache.put(request, respuesta.clone());
    return respuesta;
  });
  red.catch(() => {});

  try {
    return await conLimiteDeTiempo(red, ESPERA_RED_MS);
  } catch {
    const guardada =
      (await cache.match(request, { ignoreSearch: true })) ??
      (request.mode === "navigate" ? await cache.match("./") : undefined);
    // Sin copia guardada, se espera a la red aunque tarde.
    return guardada ?? red;
  }
}

async function primeroLaCache(request) {
  const cache = await caches.open(CACHE_CDN);
  // Se busca por URL: la misma librería puede pedirse con o sin crossorigin.
  const guardada = await cache.match(request.url);
  if (guardada) return guardada;

  const respuesta = await fetch(request);
  // "opaque": scripts pedidos sin crossorigin (SheetJS). No se puede ver su estado, pero la URL es fija.
  if (respuesta.ok || respuesta.type === "opaque") cache.put(request.url, respuesta.clone());
  return respuesta;
}

function conLimiteDeTiempo(promesa, ms) {
  let timer;
  const limite = new Promise((_, rechazar) => {
    timer = setTimeout(() => rechazar(new Error("tiempo agotado")), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}
