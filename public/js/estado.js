// Estado compartido de la sesión. Las vistas se suscriben y se re-renderizan cuando cambia.

export const sesion = {
  usuario: null, // Firebase User
  rol: null, // "admin" | "empleado"
  turno: null, // turno abierto del usuario o null
  movimientosTurno: null, // { ventas, egresos } del turno abierto, en tiempo real
  productos: [], // catálogo en tiempo real
  saldoGuardado: null, // saldo de la caja de guardado en pesos, en tiempo real (null mientras carga)
};

const suscriptores = new Set();

export function actualizarSesion(cambios) {
  Object.assign(sesion, cambios);
  for (const fn of suscriptores) fn(sesion, cambios);
}

/** @returns {() => void} función para desuscribirse */
export function alCambiarSesion(fn) {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

export const esAdmin = () => sesion.rol === "admin";
