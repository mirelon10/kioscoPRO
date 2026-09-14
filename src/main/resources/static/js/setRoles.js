const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require("../serviceAccountKey.json");

initializeApp({
  credential: cert(serviceAccount),
});

async function asignarRoles() {
  await getAuth().setCustomUserClaims("6OtHtZuFXPfIqM7duh96o2aGB9v2", { rol: "admin" });
  console.log("Admin asignado");

  await getAuth().setCustomUserClaims("N2MowHKvnCM3kGA4RZU7ddQ2goH2", { rol: "empleado" });
  console.log("Empleado asignado");
}

asignarRoles();