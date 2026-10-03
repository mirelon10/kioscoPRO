/** Error de una espera que superó su límite de tiempo. Usa el mismo código que Firestore. */
export class TiempoAgotado extends Error {
  constructor() {
    super("El servidor tardó demasiado en responder.");
    this.name = "TiempoAgotado";
    this.code = "deadline-exceeded";
  }
}

/** Rechaza con TiempoAgotado si `promesa` no termina en `ms`. La promesa original sigue corriendo. */
export function conLimiteDeTiempo(promesa, ms) {
  let timer;
  const limite = new Promise((_, rechazar) => {
    timer = setTimeout(() => rechazar(new TiempoAgotado()), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}

const CODIGOS_SIN_CONEXION = new Set(["unavailable", "deadline-exceeded"]);

/** El error se debe a la falta de conexión (y no a datos inválidos o permisos). */
export const esErrorDeConexion = (error) => CODIGOS_SIN_CONEXION.has(error?.code);
