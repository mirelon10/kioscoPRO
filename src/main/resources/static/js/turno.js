import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const cargandoEl = document.getElementById("cargando");
const cardApertura = document.getElementById("card-apertura");
const cardCierre = document.getElementById("card-cierre");

const params = new URLSearchParams(window.location.search);
const quiereForzarCierre = params.get("cerrar") === "1";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    // 1. Consultar estado del turno directamente a nuestro backend Java
    const res = await fetch(`'/api/turnos/activo/' + user.uid`);
    const data = await res.json();

    cargandoEl.style.display = "none";

    if (data.activo) {
      const { turnoId, fechaApertura } = data;
      const horasAbierto = (Date.now() - new Date(fechaApertura).getTime()) / (1000 * 60 * 60);
      const debeForzarCierre = horasAbierto >= 24;

      if (!quiereForzarCierre && !debeForzarCierre) {
        localStorage.setItem("turnoId", turnoId);
        window.location.href = "pos.html";
        return;
      }

      if (debeForzarCierre && !quiereForzarCierre) {
        document.getElementById("mensaje2").textContent = "Tu turno lleva más de 24hs abierto. Cerralo para continuar.";
      }

      cardCierre.style.display = "block";

      // 2. Cerrar turno mediante el Backend Java
      document.getElementById("btn-cerrar").addEventListener("click", async () => {
        const cajaFinal = parseFloat(document.getElementById("cajaFinal").value);
        if (isNaN(cajaFinal) || cajaFinal < 0) {
          document.getElementById("mensaje2").textContent = "Ingresá un monto válido";
          return;
        }

        const resCierre = await fetch('/api/turnos/cerrar', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnoId, cajaFinal })
        });

        if (resCierre.ok) {
          localStorage.removeItem("turnoId");
          window.location.href = "index.html";
        } else {
          document.getElementById("mensaje2").textContent = "Error al cerrar turno en el servidor.";
        }
      });
      return;
    }

    // 3. Si no tiene turno abierto -> Apertura mediante el Backend Java
    cardApertura.style.display = "block";

    document.getElementById("btn-abrir").addEventListener("click", async () => {
      const cajaInicial = parseFloat(document.getElementById("cajaInicial").value);
      if (isNaN(cajaInicial) || cajaInicial < 0) {
        document.getElementById("mensaje").textContent = "Ingresá un monto válido";
        return;
      }

      const resAbrir = await fetch('/api/turnos/abrir', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empleadoId: user.uid,
          empleadoNombre: user.email,
          cajaInicial
        })
      });

      const dataAbrir = await resAbrir.json();

      if (resAbrir.ok && dataAbrir.turnoId) {
        localStorage.setItem("turnoId", dataAbrir.turnoId);
        window.location.href = "pos.html";
      } else {
        document.getElementById("mensaje").textContent = "Error al abrir turno en el servidor.";
      }
    });

  } catch (error) {
    console.error("Error al conectar con el backend:", error);
    cargandoEl.style.display = "none";
    alert("No se pudo conectar con el servidor Java.");
  }
});