import { db, auth } from "./firebase-config.js";
import {
  collection, query, where, getDocs, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const form = document.getElementById("form-egreso");
const tabla = document.getElementById("tabla-egresos");
const mensajeEl = document.getElementById("mensaje");

const turnoId = localStorage.getItem("turnoId");
if (!turnoId) {
  window.location.href = "turno.html";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const egreso = {
    turnoId,
    empleadoId: auth.currentUser.uid,
    monto: parseFloat(document.getElementById("monto").value),
    motivo: document.getElementById("motivo").value.trim()
  };

  try {
    // Petición al microservicio Java en lugar de addDoc directo
    const respuesta = await fetch('/api/egresos/registrar', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(egreso)
    });

    const resultado = await respuesta.json();

    if (respuesta.ok && resultado.status === "success") {
      mostrarMensaje("Egreso registrado", "ok");
      form.reset();
      cargarEgresos();
    } else {
      mostrarMensaje("Error en el servidor: " + (resultado.message || "No se pudo registrar"), "error");
    }
  } catch (error) {
    mostrarMensaje("Error de conexión: " + error.message, "error");
  }
});

async function cargarEgresos() {
  try {
    const q = query(
      collection(db, "egresos"),
      where("turnoId", "==", turnoId),
      orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);

    tabla.innerHTML = "";
    snap.forEach(docSnap => {
      const e = docSnap.data();
      const hora = e.fecha?.toDate ? e.fecha.toDate().toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' }) : "-";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${hora}</td><td>${e.motivo}</td><td>$${e.monto.toFixed(2)}</td>`;
      tabla.appendChild(tr);
    });
  } catch (error) {
    console.error("Error al cargar la lista de egresos:", error);
  }
}

function mostrarMensaje(texto, tipo) {
  mensajeEl.textContent = texto;
  mensajeEl.className = tipo;
  setTimeout(() => mensajeEl.classList.add("oculto"), 3000);
}

document.getElementById("salir").addEventListener("click", () => {
  const confirmar = confirm(
    "Tenés un turno abierto. Para cerrar sesión primero tenés que cerrar tu turno. ¿Querés ir a cerrarlo ahora?"
  );
  if (confirmar) window.location.href = "turno.html?cerrar=1";
});

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  cargarEgresos();
});