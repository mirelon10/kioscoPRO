import { db, auth } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const form = document.getElementById("form-producto");
const tabla = document.getElementById("tabla-productos");
const mensajeEl = document.getElementById("mensaje");

const precioCompraInput = document.getElementById("precioCompra");
const margenInput = document.getElementById("margen");
const precioVentaInput = document.getElementById("precioVenta");

function calcularPrecioVenta() {
  const compra = parseFloat(precioCompraInput.value) || 0;
  const margen = parseFloat(margenInput.value) || 0;
  const venta = compra * (1 + margen / 100);
  precioVentaInput.value = venta > 0 ? venta.toFixed(2) : "";
}

precioCompraInput.addEventListener("input", calcularPrecioVenta);
margenInput.addEventListener("input", calcularPrecioVenta);

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const precioCompra = parseFloat(precioCompraInput.value);
  const margen = parseFloat(margenInput.value);
  const precioVenta = precioCompra * (1 + margen / 100);

  const producto = {
  codigoBarra: document.getElementById("codigoBarra").value.trim(),
  nombre: document.getElementById("nombre").value.trim(),
  nombreLower: document.getElementById("nombre").value.trim().toLowerCase(),
  precioCompra,
  margen,
  precio: parseFloat(precioVenta.toFixed(2)),
  stock: parseInt(document.getElementById("stock").value),
  categoria: document.getElementById("categoria").value.trim() || "Sin categoría"
  };

  try {
    await addDoc(collection(db, "productos"), producto);
    mostrarMensaje("Producto agregado con éxito", "ok");
    form.reset();
    precioVentaInput.value = "";
    document.getElementById("codigoBarra").focus();
    cargarProductos();
  } catch (error) {
    mostrarMensaje("Error al guardar: " + error.message, "error");
  }
});

import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

async function cargarProductos() {
  const q = query(collection(db, "productos"), orderBy("nombre"));
  const snap = await getDocs(q);

  tabla.innerHTML = "";
  snap.forEach(docSnap => {
    const p = docSnap.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.codigoBarra}</td>
      <td>${p.nombre}</td>
      <td>$${p.precio.toFixed(2)}</td>
      <td>
        <input type="number" class="input-stock-editable" data-id="${docSnap.id}" value="${p.stock}" min="0" style="width:70px; padding:4px;">
      </td>
      <td>${p.categoria}</td>
      <td><button class="btn-guardar-stock" data-id="${docSnap.id}">Guardar</button></td>
    `;
    tabla.appendChild(tr);
  });

  document.querySelectorAll(".btn-guardar-stock").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const input = document.querySelector(`.input-stock-editable[data-id="${id}"]`);
      const nuevoStock = parseInt(input.value);
      if (isNaN(nuevoStock) || nuevoStock < 0) return;

      try {
        await updateDoc(doc(db, "productos", id), { stock: nuevoStock });
        mostrarMensaje("Stock actualizado", "ok");
      } catch (error) {
        mostrarMensaje("Error: " + error.message, "error");
      }
    });
  });
}

function mostrarMensaje(texto, tipo) {
  mensajeEl.textContent = texto;
  mensajeEl.className = tipo;
  setTimeout(() => mensajeEl.classList.add("oculto"), 3000);
}

document.getElementById("salir").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

cargarProductos();