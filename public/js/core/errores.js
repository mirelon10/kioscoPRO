/** Error de una regla del negocio (stock insuficiente, turno cerrado...). Su mensaje se muestra tal cual al usuario. */
export class ErrorNegocio extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "ErrorNegocio";
  }
}

const MENSAJES_FIREBASE = {
  "permission-denied": "No tenés permisos para realizar esta acción.",
  unavailable: "Sin conexión con el servidor. Revisá internet y volvé a intentar.",
  "deadline-exceeded": "El servidor tardó demasiado en responder. Volvé a intentar.",
  aborted: "Otro usuario modificó los mismos datos. Volvé a intentar.",
  "failed-precondition": "La operación no se puede completar en este momento.",
  "auth/invalid-credential": "Email o contraseña incorrectos.",
  "auth/wrong-password": "Email o contraseña incorrectos.",
  "auth/user-not-found": "Email o contraseña incorrectos.",
  "auth/invalid-email": "El email no tiene un formato válido.",
  "auth/user-disabled": "Este usuario está deshabilitado.",
  "auth/too-many-requests": "Demasiados intentos. Esperá unos minutos.",
  "auth/network-request-failed": "Sin conexión. Revisá internet.",
};

// Errores de Cloud Functions cuyo mensaje lo escribe nuestro servidor para el usuario.
const CODIGOS_FUNCIONES_CON_MENSAJE = [
  "functions/failed-precondition",
  "functions/invalid-argument",
  "functions/permission-denied",
  "functions/unauthenticated",
  "functions/internal",
];

export function mensajeDeError(error, porDefecto = "Ocurrió un error inesperado.") {
  if (error instanceof ErrorNegocio) return error.message;
  const codigo = error?.code ?? "";
  // "internal" a secas es el SDK diciendo que no pudo hablar con la función (sin internet, CORS...).
  if (CODIGOS_FUNCIONES_CON_MENSAJE.includes(codigo) && error.message && error.message !== "internal") {
    return error.message;
  }
  if (codigo === "functions/internal" || codigo === "functions/unavailable" || codigo === "functions/deadline-exceeded") {
    return "No se pudo conectar con el servidor. Revisá internet y volvé a intentar.";
  }
  return MENSAJES_FIREBASE[codigo] ?? porDefecto;
}
