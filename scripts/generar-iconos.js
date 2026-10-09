// Genera los íconos de la app instalable (public/icons/*.png) sin dependencias: dibuja un local
// (toldo + frente + puerta + vidriera) en blanco sobre el azul de la app.
//   node scripts/generar-iconos.js
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const AZUL = [37, 99, 235]; // --primary
const CELESTE = [147, 197, 253];
const BLANCO = [255, 255, 255];

/** Color del punto (x, y) en una grilla de 512, o null si es transparente. */
function pintar(x, y, { redondeado, escala }) {
  if (redondeado && fueraDeEsquina(x, y, 96)) return null;

  // escala: tamaño del dibujo respecto del diseño original (los "maskable" necesitan margen alrededor).
  const u = 256 + (x - 256) / escala;
  const v = 256 + (y - 256) / escala;

  // Toldo: 4 franjas con festones abajo.
  const ancho = 63;
  if (u >= 130 && u < 382) {
    const franja = Math.floor((u - 130) / ancho);
    const color = franja % 2 === 0 ? BLANCO : CELESTE;
    if (v >= 140 && v < 210) return color;
    const cx = 130 + franja * ancho + ancho / 2;
    if (v >= 210 && (u - cx) ** 2 + (v - 210) ** 2 < (ancho / 2) ** 2) return color;
  }
  // Frente del local, con la puerta y la vidriera recortadas.
  if (u >= 150 && u < 362 && v >= 210 && v < 372) {
    if (u >= 176 && u < 240 && v >= 272) return AZUL;
    if (u >= 266 && u < 338 && v >= 272 && v < 326) return AZUL;
    return BLANCO;
  }
  return AZUL;
}

function fueraDeEsquina(x, y, r) {
  const cx = x < r ? r : x > 512 - r ? 512 - r : x;
  const cy = y < r ? r : y > 512 - r ? 512 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 > r * r;
}

/** RGBA de tamaño×tamaño, con 4×4 muestras por píxel para que los bordes queden suaves. */
function dibujar(tamaño, opciones) {
  const px = Buffer.alloc(tamaño * tamaño * 4);
  const M = 4;
  for (let j = 0; j < tamaño; j++) {
    for (let i = 0; i < tamaño; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < M; sj++) {
        for (let si = 0; si < M; si++) {
          const c = pintar(((i + (si + 0.5) / M) * 512) / tamaño, ((j + (sj + 0.5) / M) * 512) / tamaño, opciones);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = (j * tamaño + i) * 4;
      if (a) [px[o], px[o + 1], px[o + 2]] = [r / a, g / a, b / a];
      px[o + 3] = Math.round((a / (M * M)) * 255);
    }
  }
  return px;
}

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}
function png(tamaño, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamaño, 0);
  ihdr.writeUInt32BE(tamaño, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  const filas = Buffer.alloc(tamaño * (tamaño * 4 + 1));
  for (let j = 0; j < tamaño; j++) rgba.copy(filas, j * (tamaño * 4 + 1) + 1, j * tamaño * 4, (j + 1) * tamaño * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", ihdr),
    bloque("IDAT", deflateSync(filas, { level: 9 })),
    bloque("IEND", Buffer.alloc(0)),
  ]);
}

const ICONOS = [
  // Escritorio y Android: esquinas redondeadas.
  { archivo: "icon-192.png", tamaño: 192, redondeado: true, escala: 1.15 },
  { archivo: "icon-512.png", tamaño: 512, redondeado: true, escala: 1.15 },
  // Android recorta este con la forma del sistema (círculo, gota...): fondo entero y dibujo más chico.
  { archivo: "icon-maskable-512.png", tamaño: 512, redondeado: false, escala: 1 },
  // iPhone / iPad: iOS redondea las esquinas solo.
  { archivo: "apple-touch-icon.png", tamaño: 180, redondeado: false, escala: 1.05 },
];

mkdirSync("public/icons", { recursive: true });
for (const { archivo, tamaño, ...opciones } of ICONOS) {
  writeFileSync(`public/icons/${archivo}`, png(tamaño, dibujar(tamaño, opciones)));
  console.log(`public/icons/${archivo}`);
}
