import { db, auth } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  runTransaction,
  doc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const turnoId = localStorage.getItem("turnoId");
if (!turnoId) {
  window.location.href = "turno.html";
}
const buscador = document.getElementById("buscador");
const carritoBody = document.getElementById("carrito-body");
const totalEl = document.getElementById("total");
const confirmarBtn = document.getElementById("confirmar");
const mensajeEl = document.getElementById("mensaje");
const metodoBtns = document.querySelectorAll(".metodo-btn");
const resultadosEl = document.getElementById("resultados-busqueda");

let carrito = [];
let metodoPago = null;

buscador.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const texto = buscador.value.trim();
  if (!texto) return;

  // 1. Intentar match exacto por código de barras
  const qCodigo = query(
    collection(db, "productos"),
    where("codigoBarra", "==", texto),
  );
  const snapCodigo = await getDocs(qCodigo);

  if (!snapCodigo.empty) {
    const docSnap = snapCodigo.docs[0];
    agregarAlCarrito({ id: docSnap.id, ...docSnap.data() });
    buscador.value = "";
    resultadosEl.innerHTML = "";
    return;
  }

  // 2. Si no matcheó código, buscar por nombre (prefijo, case-sensitive por límite de Firestore)
  const qNombre = query(
    collection(db, "productos"),
    orderBy("nombreLower"),
    where("nombreLower", ">=", texto.toLowerCase()),
    where("nombreLower", "<=", texto.toLowerCase() + "\uf8ff"),
    limit(8),
  );
  const snapNombre = await getDocs(qNombre);

  if (snapNombre.empty) {
    mostrarMensaje(`Producto no encontrado: ${texto}`, "error");
    resultadosEl.innerHTML = "";
    return;
  }

  mostrarResultados(snapNombre.docs.map((d) => ({ id: d.id, ...d.data() })));
});

function mostrarResultados(productos) {
  resultadosEl.innerHTML = "";
  productos.forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-item";
    div.textContent = `${p.nombre} — $${p.precio.toFixed(2)}`;
    div.addEventListener("click", () => {
      agregarAlCarrito(p);
      buscador.value = "";
      resultadosEl.innerHTML = "";
      buscador.focus();
    });
    resultadosEl.appendChild(div);
  });
}

function agregarAlCarrito(producto) {
  const existente = carrito.find((item) => item.productoId === producto.id);
  if (existente) {
    existente.cantidad++;
  } else {
    carrito.push({
      productoId: producto.id,
      nombre: producto.nombre,
      precioUnit: producto.precio,
      cantidad: 1,
      stockDisponible: producto.stock,
    });
  }
  renderCarrito();
}

function renderCarrito() {
  carritoBody.innerHTML = "";
  let total = 0;

  carrito.forEach((item, idx) => {
    const subtotal = item.precioUnit * item.cantidad;
    total += subtotal;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.nombre}</td>
      <td><input type="number" class="input-cantidad" data-idx="${idx}" value="${item.cantidad}" min="1" max="${item.stockDisponible}"></td>
      <td>$${item.precioUnit.toFixed(2)}</td>
      <td>$${subtotal.toFixed(2)}</td>
      <td><button class="btn-quitar" data-idx="${idx}">✕</button></td>
    `;
    carritoBody.appendChild(tr);
  });

  totalEl.textContent = `$${total.toFixed(2)}`;
  actualizarBotonConfirmar();

  document.querySelectorAll(".btn-quitar").forEach((btn) => {
    btn.addEventListener("click", () => {
      carrito.splice(parseInt(btn.dataset.idx), 1);
      renderCarrito();
    });
  });

  document.querySelectorAll(".input-cantidad").forEach((input) => {
    input.addEventListener("change", () => {
      const idx = parseInt(input.dataset.idx);
      let nuevaCantidad = parseInt(input.value);

      if (isNaN(nuevaCantidad) || nuevaCantidad < 1) nuevaCantidad = 1;
      if (nuevaCantidad > carrito[idx].stockDisponible) {
        mostrarMensaje(
          `Stock disponible: ${carrito[idx].stockDisponible}`,
          "error",
        );
        nuevaCantidad = carrito[idx].stockDisponible;
      }

      carrito[idx].cantidad = nuevaCantidad;
      renderCarrito();
    });
  });
}

metodoBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    metodoBtns.forEach((b) => b.classList.remove("activo"));
    btn.classList.add("activo");
    metodoPago = btn.dataset.metodo;
    actualizarBotonConfirmar();
  });
});

function actualizarBotonConfirmar() {
  confirmarBtn.disabled = carrito.length === 0 || !metodoPago;
}

confirmarBtn.addEventListener("click", async () => {
  confirmarBtn.disabled = true;
  try {
    // 1. Armamos el objeto con la estructura que espera Java
    const totalVenta = carrito.reduce(
      (acc, i) => acc + i.precioUnit * i.cantidad,
      0,
    );

    const estructuraVenta = {
      turnoId: turnoId,
      empleadoId: auth.currentUser ? auth.currentUser.uid : "anonimo",
      metodoPago: metodoPago,
      total: totalVenta,
      items: carrito.map((i) => ({
        productoId: i.productoId,
        nombre: i.nombre,
        precioUnit: i.precioUnit,
        cantidad: i.cantidad,
      })),
      timestamp: new Date().toISOString(),
    };

    // 2. Le enviamos la venta a nuestro microservicio en Java (puerto 8080)
    const respuesta = await fetch('/api/ventas/procesar', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(estructuraVenta),
    });

    if (!respuesta.ok) {
      throw new Error("Error al procesar la venta en el servidor Java");
    }

    // 3. Si Java respondió éxito, limpiamos la interfaz
    mostrarMensaje("Venta registrada con éxito", "ok");
    carrito = [];
    metodoPago = null;
    metodoBtns.forEach((b) => b.classList.remove("activo"));
    renderCarrito();
  } catch (error) {
    mostrarMensaje(error.message, "error");
  } finally {
    actualizarBotonConfirmar();
    buscador.focus();
  }
});

function mostrarMensaje(texto, tipo) {
  mensajeEl.textContent = texto;
  mensajeEl.className = tipo;
  setTimeout(() => mensajeEl.classList.add("oculto"), 3000);
}

document.getElementById("salir").addEventListener("click", () => {
  const confirmar = confirm(
    "Tenés un turno abierto. Para cerrar sesión primero tenés que cerrar tu turno. ¿Querés ir a cerrarlo ahora?",
  );
  if (confirmar) {
    window.location.href = "turno.html?cerrar=1";
  }
});
document.getElementById("cerrar-turno").addEventListener("click", () => {
  window.location.href = "turno.html?cerrar=1";
});
// ==========================================
// FUNCIÓN DE CONEXIÓN CON EL BACKEND (JAVA)
// ==========================================
async function cobrarVenta(metodoPago, itemsCarrito, totalVenta) {
  // Validamos que haya productos antes de enviar
  if (!itemsCarrito || itemsCarrito.length === 0) {
    alert("El carrito está vacío.");
    return;
  }

  const estructuraVenta = {
    metodoPago: metodoPago, // "Efectivo", "Mercado Pago", "Tarjeta"
    total: totalVenta,
    items: itemsCarrito,
    timestamp: new Date().toISOString(),
  };

  try {
    // Envia la petición al servidor Java en puerto 8080
    const respuesta = await fetch('/api/ventas/procesar', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(estructuraVenta),
    });

    if (respuesta.ok) {
      const resultado = await respuesta.json();
      alert("¡Venta completada con éxito!");

      // Aquí llamas a tu función actual para vaciar el carrito visualmente
      if (typeof limpiarCarrito === "function") {
        limpiarCarrito();
      }
    } else {
      alert("Ocurrió un error en el servidor al procesar la venta.");
    }
  } catch (error) {
    console.error("Error de conexión con el backend en Java:", error);
    alert(
      "No se pudo conectar con el servidor Java. Verifica que esté ejecutándose en IntelliJ.",
    );
  }
}
