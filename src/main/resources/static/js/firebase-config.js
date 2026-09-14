import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCwOLhtnlDYOtsbtw3UrrYjrC_OgWG8ETM",
  authDomain: "kioscopro-db07e.firebaseapp.com",
  projectId: "kioscopro-db07e",
  storageBucket: "kioscopro-db07e.firebasestorage.app",
  messagingSenderId: "478533783578",
  appId: "1:478533783578:web:17940ee09e386c319001a3"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

enableIndexedDbPersistence(db).catch((err) => {
  console.warn("Persistencia offline no disponible:", err.code);
});