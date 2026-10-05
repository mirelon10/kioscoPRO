// Único punto de acceso al SDK de Firebase: la versión y la configuración se cambian solo acá.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  terminate,
  clearIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

export {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getCountFromServer,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp,
  increment,
  deleteField,
  waitForPendingWrites,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// La configuración web de Firebase es pública por diseño: la seguridad está en firestore.rules.
const firebaseConfig = {
  apiKey: "AIzaSyCwOLhtnlDYOtsbtw3UrrYjrC_OgWG8ETM",
  authDomain: "kioscopro-db07e.firebaseapp.com",
  projectId: "kioscopro-db07e",
  storageBucket: "kioscopro-db07e.firebasestorage.app",
  messagingSenderId: "478533783578",
  appId: "1:478533783578:web:17940ee09e386c319001a3",
};

const app = initializeApp(firebaseConfig);

// Desarrollo local contra los emuladores: http://localhost:3000/?emulador
const enLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const usarEmulador = enLocal && new URLSearchParams(location.search).has("emulador");

// ---------- App Check ----------
// Cada pedido a Firebase lleva un token que prueba que viene de esta app (reCAPTCHA v3) y no de un
// script que copió la configuración de arriba. Se activa antes que Firestore y Auth.
// La clave del sitio es pública (como apiKey); la clave secreta queda cargada en la consola de Firebase.
// Vacía, la app funciona sin App Check (por ejemplo, antes de crear la clave).
const RECAPTCHA_SITE_KEY = "";

function activarAppCheck(instancia) {
  if (!RECAPTCHA_SITE_KEY || usarEmulador) return;
  // En localhost reCAPTCHA no sirve: la consola del navegador muestra un token de depuración que hay
  // que registrar en Firebase → App Check → Apps → Administrar tokens de depuración.
  if (enLocal) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  initializeAppCheck(instancia, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
}
activarAppCheck(app);

// Caché local persistente: el catálogo carga al instante y sobrevive a cortes cortos de internet.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth = getAuth(app);

// ---------- Alta de cuentas por el admin ----------
// Crear una cuenta con el SDK del navegador inicia sesión con ella. Para no cerrar la sesión del admin,
// se usa una segunda instancia de Firebase que no guarda nada (la sesión nueva vive solo en memoria).
let authAltas = null;

/** Crea la cuenta en Firebase Auth y devuelve su uid. No cambia la sesión actual. */
export async function crearCuenta(email, clave) {
  if (!authAltas) {
    const appAltas = initializeApp(firebaseConfig, "altas");
    activarAppCheck(appAltas);
    authAltas = initializeAuth(appAltas, { persistence: inMemoryPersistence });
    if (usarEmulador) connectAuthEmulator(authAltas, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  const { user } = await createUserWithEmailAndPassword(authAltas, email, clave);
  await signOut(authAltas);
  return user.uid;
}

// ---------- Borrar la copia local al cerrar sesión ----------

const CLAVE_BORRADO_PENDIENTE = "kiosco.borrarDatosLocales";

function marcarBorradoPendiente(pendiente) {
  try {
    if (pendiente) localStorage.setItem(CLAVE_BORRADO_PENDIENTE, "1");
    else localStorage.removeItem(CLAVE_BORRADO_PENDIENTE);
  } catch {
    // almacenamiento bloqueado: no se puede reintentar más tarde
  }
}

/** Un borrado anterior no se pudo completar. */
export function hayBorradoPendiente() {
  try {
    return localStorage.getItem(CLAVE_BORRADO_PENDIENTE) === "1";
  } catch {
    return false;
  }
}

// Base IndexedDB donde persistentLocalCache guarda todo. "mutations" es el almacén de las
// escrituras sin subir. Son nombres internos del SDK: al actualizarlo, verificar que sigan iguales.
const BASE_LOCAL = `firestore/[DEFAULT]/${firebaseConfig.projectId}/main`;
const ALMACEN_PENDIENTES = "mutations";

/**
 * Cuenta las escrituras sin subir guardadas en este equipo, de todas las pestañas.
 * (waitForPendingWrites solo ve las de la pestaña actual: una venta hecha sin conexión en otra
 * pestaña se perdería al borrar.) Devuelve null si no se puede verificar.
 */
export async function contarEscriturasSinSubir() {
  try {
    if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === BASE_LOCAL)) return 0;
  } catch {
    // sin indexedDB.databases(): se abre directamente
  }
  return new Promise((resolver) => {
    let req;
    try {
      req = indexedDB.open(BASE_LOCAL);
    } catch {
      return resolver(null);
    }
    // La base no existía: se cancela para no crearla vacía.
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => resolver(req.error?.name === "AbortError" ? 0 : null);
    req.onsuccess = () => {
      const base = req.result;
      if (!base.objectStoreNames.contains(ALMACEN_PENDIENTES)) {
        base.close();
        return resolver(0);
      }
      const conteo = base.transaction(ALMACEN_PENDIENTES, "readonly").objectStore(ALMACEN_PENDIENTES).count();
      conteo.onsuccess = () => {
        base.close();
        resolver(conteo.result);
      };
      conteo.onerror = () => {
        base.close();
        resolver(null);
      };
    };
  });
}

/**
 * Borra la caché local de Firestore (catálogo, ventas, turnos, egresos) para que en una PC
 * compartida no queden en el navegador los datos de quien cerró sesión.
 * Nunca borra escrituras sin subir: si hay (o no se puede verificar), no borra nada y lo deja
 * marcado para reintentar.
 * Deja Firestore inutilizable en esta pestaña, así que termina recargando la página. Si hay otra
 * pestaña de la app abierta, sigue andando con caché en memoria.
 * Si el borrado falla, queda marcado y se reintenta la próxima vez que se abra la app sin sesión.
 */
let borrando = null;

export function borrarDatosLocales() {
  // Al cerrar sesión se puede llamar dos veces (cerrarSesion y el aviso de "sin sesión"): se borra una sola.
  borrando ??= (async () => {
    marcarBorradoPendiente(true);
    const pendientes = await contarEscriturasSinSubir();
    if (pendientes !== 0) {
      console.warn("Hay movimientos sin subir en este equipo (o no se pudo verificar): no se borran los datos guardados");
      return location.reload();
    }
    try {
      await terminate(db);
      await clearIndexedDbPersistence(db);
      marcarBorradoPendiente(false);
    } catch (error) {
      console.warn("No se pudieron borrar los datos guardados en este equipo; se reintenta al volver a abrir la app", error);
    }
    location.reload();
  })();
  return borrando;
}

if (usarEmulador) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  console.info("Usando emuladores de Firebase");
}
