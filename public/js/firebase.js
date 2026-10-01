// Único punto de acceso al SDK de Firebase: la versión y la configuración se cambian solo acá.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
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
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
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

// Caché local persistente: el catálogo carga al instante y sobrevive a cortes cortos de internet.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth = getAuth(app);

// Desarrollo local contra los emuladores: http://localhost:3000/?emulador
const usarEmulador =
  ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulador");
if (usarEmulador) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  console.info("Usando emuladores de Firebase");
}
