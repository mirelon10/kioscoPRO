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
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "../firebase.js";
import { conLimiteDeTiempo } from "../lib/espera.js";

// Rol de cada usuario: usuarios/{uid} (ver firestore.rules). Los usuarios creados antes con
// scripts/set-rol.js tienen el rol en el token hasta que la app les crea el documento.

const usuariosCol = collection(db, "usuarios");

/**
 * Documento del usuario en Firestore ({ rol, claveTemporal, eliminado, ... }).
 * @returns {Promise<object|undefined|null>}  undefined: no tiene documento (usuario de antes);
 *   null: no se pudo saber (sin conexión y sin copia local)
 */
export async function leerUsuarioGuardado(uid, esperaMs) {
  const ref = doc(usuariosCol, uid);
  try {
    const snap = await conLimiteDeTiempo(getDoc(ref), esperaMs);
    return snap.exists() ? snap.data() : undefined;
  } catch {
    try {
      const snap = await getDocFromCache(ref);
      return snap.exists() ? snap.data() : null;
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

/** Usuarios del sistema, sin los eliminados. */
export async function obtenerUsuarios() {
  const snap = await getDocs(query(usuariosCol, orderBy("email")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => !u.eliminado);
}

/**
 * Crea la cuenta en Auth (sin cerrar la sesión del admin) y le asigna el rol. La contraseña es
 * temporal: al entrar por primera vez se le pide que la cambie.
 */
export async function crearUsuario({ email, clave, rol }, admin) {
  const uid = await crearCuenta(email, clave);
  await setDoc(doc(usuariosCol, uid), { email, rol, creadoPor: admin.uid, fecha: serverTimestamp(), claveTemporal: true });
  return uid;
}

export function cambiarRol(uid, rol, admin) {
  return updateDoc(doc(usuariosCol, uid), { rol, actualizadoPor: admin.uid, actualizado: serverTimestamp() });
}

/**
 * Saca al usuario del sistema: pierde el acceso enseguida y deja de aparecer en la lista. El documento
 * queda (ver firestore.rules) y la cuenta de Auth se borra cuando esa persona intenta volver a entrar
 * (ver main.js). Sus ventas, turnos y egresos quedan como estaban.
 */
export function eliminarUsuario(uid, admin) {
  return updateDoc(doc(usuariosCol, uid), {
    rol: "ninguno",
    eliminado: true,
    actualizadoPor: admin.uid,
    actualizado: serverTimestamp(),
  });
}

/**
 * Reemplaza la contraseña temporal por la que elige el usuario. Pide la actual porque Firebase exige
 * un inicio de sesión reciente para cambiarla (la sesión puede haber quedado abierta de otro día).
 */
export async function cambiarClaveTemporal(usuario, actual, nueva) {
  await reauthenticateWithCredential(usuario, EmailAuthProvider.credential(usuario.email, actual));
  await updatePassword(usuario, nueva);
  // La contraseña ya cambió: si falla la marca, la próxima vez se le vuelve a ofrecer cambiarla.
  try {
    await updateDoc(doc(usuariosCol, usuario.uid), { claveTemporal: false });
  } catch (error) {
    console.warn("No se pudo registrar el cambio de contraseña", error);
  }
}
