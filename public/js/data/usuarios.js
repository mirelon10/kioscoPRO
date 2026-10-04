import {
  db,
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  crearCuenta,
} from "../firebase.js";
import { conLimiteDeTiempo } from "../lib/espera.js";

// Rol de cada usuario: usuarios/{uid} (ver firestore.rules). Los usuarios creados antes con
// scripts/set-rol.js tienen el rol en el token hasta que la app les crea el documento.

const usuariosCol = collection(db, "usuarios");

/**
 * Rol guardado en Firestore.
 * @returns {Promise<string|undefined|null>}  undefined: no tiene documento (usuario de antes);
 *   null: no se pudo saber (sin conexión y sin copia local)
 */
export async function leerRolGuardado(uid, esperaMs) {
  const ref = doc(usuariosCol, uid);
  try {
    const snap = await conLimiteDeTiempo(getDoc(ref), esperaMs);
    return snap.exists() ? snap.data().rol : undefined;
  } catch {
    try {
      const snap = await getDocFromCache(ref);
      return snap.exists() ? snap.data().rol : null;
    } catch {
      return null;
    }
  }
}

/** Usuario de antes: pasa a Firestore el rol que tiene en el token (las reglas no dejan cambiarlo). */
export function registrarRolPropio(usuario, rol) {
  return setDoc(doc(usuariosCol, usuario.uid), {
    email: usuario.email,
    rol,
    creadoPor: usuario.uid,
    fecha: serverTimestamp(),
  });
}

/** Avisa si el admin le cambia el rol al usuario con la sesión abierta. */
export function escucharRolPropio(uid, alCambiar) {
  return onSnapshot(
    doc(usuariosCol, uid),
    (snap) => snap.exists() && alCambiar(snap.data().rol),
    (error) => console.warn("No se pudo seguir el rol del usuario", error),
  );
}

export async function obtenerUsuarios() {
  const snap = await getDocs(query(usuariosCol, orderBy("email")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Crea la cuenta en Auth (sin cerrar la sesión del admin) y le asigna el rol. */
export async function crearUsuario({ email, clave, rol }, admin) {
  const uid = await crearCuenta(email, clave);
  await setDoc(doc(usuariosCol, uid), { email, rol, creadoPor: admin.uid, fecha: serverTimestamp() });
  return uid;
}

export function cambiarRol(uid, rol, admin) {
  return updateDoc(doc(usuariosCol, uid), { rol, actualizadoPor: admin.uid, actualizado: serverTimestamp() });
}
