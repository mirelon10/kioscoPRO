// Verifica que el service worker guarde todo lo que la app necesita para abrir sin internet.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const PUBLIC = "public";
const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
const indexHtml = readFileSync(join(PUBLIC, "index.html"), "utf8");

/** Strings de una lista `const NOMBRE = [ ... ];` de sw.js, con ${FIREBASE} resuelto. */
function lista(nombre) {
  const cuerpo = sw.match(new RegExp(`const ${nombre} = \\[([\\s\\S]*?)\\];`))?.[1];
  assert.ok(cuerpo, `sw.js no tiene la lista ${nombre}`);
  const firebase = sw.match(/const FIREBASE = "([^"]+)"/)[1];
  return [...cuerpo.matchAll(/["`]([^"`]+)["`]/g)].map((m) => m[1].replace("${FIREBASE}", firebase));
}

function archivosDe(carpeta) {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? archivosDe(join(carpeta, e.name)) : [relative(PUBLIC, join(carpeta, e.name)).split(sep).join("/")],
  );
}

describe("service worker", () => {
  test("guarda todos los archivos de la app", () => {
    const guardados = new Set(lista("ARCHIVOS_APP"));
    const faltan = archivosDe(PUBLIC).filter((f) => f !== "sw.js" && f !== "index.html" && !guardados.has(f));
    assert.deepEqual(faltan, [], "Agregá estos archivos a ARCHIVOS_APP en public/sw.js");
    assert.ok(guardados.has("./"), "Falta la página principal");
  });

  test("usa la misma versión de Firebase que firebase.js", () => {
    const firebaseJs = readFileSync(join(PUBLIC, "js", "firebase.js"), "utf8");
    const usadas = new Set(firebaseJs.match(/https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+/g));
    const guardadas = new Set(lista("ARCHIVOS_CDN"));
    for (const url of usadas) assert.ok(guardadas.has(url), `sw.js no guarda ${url}`);
  });

  test("guarda las librerías que carga index.html", () => {
    const guardadas = new Set(lista("ARCHIVOS_CDN"));
    const externas = [...indexHtml.matchAll(/(?:src|href)="(https:\/\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(externas.length > 0);
    for (const url of externas) assert.ok(guardadas.has(url), `sw.js no guarda ${url}`);
  });

  test("puede pedir a todos los CDN que usa la app", () => {
    const origenes = new Set(lista("ORIGENES_CDN"));
    const excel = readFileSync(join(PUBLIC, "js", "lib", "excel.js"), "utf8");
    for (const url of [...lista("ARCHIVOS_CDN"), excel.match(/https:\/\/cdn\.sheetjs\.com[^"]+/)[0]]) {
      assert.ok(origenes.has(new URL(url).origin), `Falta ${new URL(url).origin} en ORIGENES_CDN`);
    }
  });
});
