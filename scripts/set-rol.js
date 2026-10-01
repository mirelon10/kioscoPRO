// Asigna el rol de un usuario (custom claim `rol`), que es lo que leen las reglas de Firestore.
//
// Uso:
//   GOOGLE_APPLICATION_CREDENTIALS=ruta/a/clave.json npm run set-rol -- <email> <admin|empleado|ninguno>
//
// La clave de cuenta de servicio se descarga desde la consola de Firebase
// (Configuración del proyecto → Cuentas de servicio). Guardala FUERA del repositorio.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const ROLES = ["admin", "empleado", "ninguno"];
const [email, rol] = process.argv.slice(2);

if (!email || !ROLES.includes(rol)) {
  console.error(`Uso: npm run set-rol -- <email> <${ROLES.join("|")}>`);
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Falta la variable GOOGLE_APPLICATION_CREDENTIALS con la ruta a la clave de cuenta de servicio.");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: "kioscopro-db07e" });
const auth = getAuth();

try {
  const usuario = await auth.getUserByEmail(email);
  const claims = { ...usuario.customClaims };
  if (rol === "ninguno") delete claims.rol;
  else claims.rol = rol;

  await auth.setCustomUserClaims(usuario.uid, claims);
  // Invalida las sesiones abiertas: al quitar un rol, el usuario pierde acceso enseguida.
  if (rol === "ninguno") await auth.revokeRefreshTokens(usuario.uid);

  console.log(`✔ ${email} (${usuario.uid}) → rol: ${rol}`);
  console.log("  El cambio se aplica la próxima vez que el usuario inicie sesión.");
} catch (error) {
  console.error(`✖ No se pudo asignar el rol: ${error.message}`);
  process.exit(1);
}
