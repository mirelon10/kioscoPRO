// Copia la lógica de negocio pura (public/js/core y lib) a functions/compartido/,
// así el navegador y las Cloud Functions usan exactamente el mismo código.
// Corre solo antes de cada deploy de funciones y de los emuladores (ver firebase.json y package.json).
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "functions", "compartido");

rmSync(destino, { recursive: true, force: true });
mkdirSync(join(destino, "lib"), { recursive: true });

cpSync(join(raiz, "public", "js", "core"), join(destino, "core"), { recursive: true });
for (const archivo of ["dinero.js", "fechas.js"]) {
  cpSync(join(raiz, "public", "js", "lib", archivo), join(destino, "lib", archivo));
}

console.log("✔ Lógica compartida copiada a functions/compartido/");
