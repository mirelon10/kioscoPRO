import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const form = document.getElementById("login-form");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const errorMsg = document.getElementById("error-msg");

  try {
    const credenciales = await signInWithEmailAndPassword(auth, email, password);
    const tokenResult = await credenciales.user.getIdTokenResult();
    const rol = tokenResult.claims.rol;

    if (rol === "admin") {
      window.location.href = "admin.html";
    } else if (rol === "empleado") {
      window.location.href = "turno.html";
    } else {
      errorMsg.textContent = "Usuario sin rol asignado. Contactá al administrador.";
    }
  } catch (error) {
    errorMsg.textContent = "Email o contraseña incorrectos.";
  }
});