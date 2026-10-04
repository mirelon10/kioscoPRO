/** Roles con acceso al sistema. */
export const ROLES = { admin: "Administrador", empleado: "Empleado" };

/** Roles que el admin puede asignar ("ninguno" quita el acceso sin borrar la cuenta). */
export const ROLES_ASIGNABLES = { ...ROLES, ninguno: "Sin acceso" };

export function validarAlta({ email, rol }) {
  const limpio = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) return { error: "Ingresá un email válido." };
  if (!(rol in ROLES)) return { error: "Elegí el rol: empleado o administrador." };
  return { email: limpio, rol };
}

// Sin letras ni números que se confundan al dictarlos (0/O, 1/l/I).
const ALFABETO = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Contraseña temporal aleatoria para entregarle al usuario nuevo. */
export function generarClave(largo = 10) {
  const valores = crypto.getRandomValues(new Uint32Array(largo));
  return Array.from(valores, (v) => ALFABETO[v % ALFABETO.length]).join("");
}
