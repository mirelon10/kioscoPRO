import { $, h, icono, filaVacia } from "../lib/dom.js";
import { calcularPrecioVenta, formatearMoneda } from "../lib/dinero.js";
import { construirProducto, UMBRAL_STOCK_BAJO } from "../core/productos.js";
import { crearProducto, eliminarProducto, guardarProducto } from "../data/productos.js";
import { sesion, alCambiarSesion } from "../estado.js";
import { avisar, confirmar, conBoton, formularioModal, mostrarError, notificarExito } from "../ui.js";

const form = $("form-nuevo-producto");
const tbody = $("tabla-stock-admin");
const filtro = $("filtro-stock");

export function iniciarStock() {
  const recalcular = () => {
    $("prod-precio").value = formatearMoneda(calcularPrecioVenta($("prod-compra").value, $("prod-margen").value));
  };
  $("prod-compra").addEventListener("input", recalcular);
  $("prod-margen").addEventListener("input", recalcular);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton(e.submitter ?? form.querySelector("button"), alCrear);
  });

  filtro.addEventListener("input", renderStock);

  tbody.addEventListener("click", (e) => {
    const boton = e.target.closest("button[data-accion]");
    if (!boton) return;
    const producto = sesion.productos.find((p) => p.id === boton.dataset.id);
    if (!producto) return;
    if (boton.dataset.accion === "editar") conBoton(boton, () => editar(producto));
    if (boton.dataset.accion === "borrar") conBoton(boton, () => borrar(producto));
  });

  // El catálogo llega en tiempo real: la tabla se actualiza sola tras cada venta o edición.
  alCambiarSesion((_, cambios) => {
    if ("productos" in cambios && !$("admin-stock-view").classList.contains("hidden")) renderStock();
  });
}

export function renderStock() {
  const termino = filtro.value.trim().toLowerCase();
  const productos = termino
    ? sesion.productos.filter((p) =>
        [p.nombre, p.codigo, p.categoria].some((campo) => campo.toLowerCase().includes(termino)),
      )
    : sesion.productos;

  if (productos.length === 0) {
    return filaVacia(tbody, 7, termino ? "Ningún producto coincide con el filtro." : "Todavía no hay productos cargados.");
  }

  tbody.replaceChildren(
    ...productos.map((p) =>
      h(
        "tr",
        {},
        h("td", {}, p.codigo || "-"),
        h("td", {}, h("span", { class: "badge" }, p.categoria || "Sin categoría")),
        h("td", {}, p.nombre),
        h("td", { class: "num text-muted" }, formatearMoneda(p.precioCompra)),
        h("td", { class: "num" }, h("strong", {}, formatearMoneda(p.precio))),
        h("td", { class: `num ${p.stock <= UMBRAL_STOCK_BAJO ? "stock-low" : ""}` }, p.stock),
        h(
          "td",
          { class: "acciones" },
          h(
            "button",
            { type: "button", class: "btn btn-warning btn-sm", "aria-label": `Editar ${p.nombre}`, dataset: { accion: "editar", id: p.id } },
            icono("pen"),
          ),
          h(
            "button",
            { type: "button", class: "btn btn-danger btn-sm", "aria-label": `Borrar ${p.nombre}`, dataset: { accion: "borrar", id: p.id } },
            icono("trash"),
          ),
        ),
      ),
    ),
  );
}

function existeCodigo(codigo, exceptoId = null) {
  return codigo !== "" && sesion.productos.some((p) => p.id !== exceptoId && p.codigo.toLowerCase() === codigo.toLowerCase());
}

async function alCrear() {
  const { producto, error } = construirProducto({
    codigo: $("prod-codigo").value,
    nombre: $("prod-nombre").value,
    categoria: $("prod-categoria").value,
    precioCompra: $("prod-compra").value,
    margen: $("prod-margen").value,
    stock: $("prod-stock").value,
  });
  if (error) return avisar("Datos inválidos", error);
  if (existeCodigo(producto.codigo)) return avisar("Código repetido", `Ya existe un producto con el código ${producto.codigo}.`);

  await crearProducto(producto);
  form.reset();
  $("prod-precio").value = "";
  notificarExito(`${producto.nombre} agregado`);
  $("prod-codigo").focus();
}

// Los valores se cargan con .value en alAbrir (nunca interpolados en el HTML) para evitar XSS.
const FORMULARIO_EDICION = `
  <div class="swal-form">
    <label>Código de barras<input id="swal-codigo" class="swal2-input" maxlength="64"></label>
    <label>Categoría<input id="swal-categoria" class="swal2-input" maxlength="60"></label>
    <label>Nombre<input id="swal-nombre" class="swal2-input" maxlength="120"></label>
    <div class="swal-fila">
      <label>Costo $<input id="swal-compra" type="number" min="0" step="0.01" class="swal2-input"></label>
      <label>Margen %<input id="swal-margen" type="number" min="0" step="0.01" class="swal2-input"></label>
    </div>
    <label>Precio de venta<input id="swal-precio" class="swal2-input input-readonly" readonly tabindex="-1"></label>
    <label>Stock<input id="swal-stock" type="number" min="0" step="1" class="swal2-input"></label>
  </div>`;

async function editar(producto) {
  const campo = (popup, id) => popup.querySelector(`#swal-${id}`);

  const datos = await formularioModal({
    titulo: "Editar producto",
    contenido: FORMULARIO_EDICION,
    alAbrir: (popup) => {
      campo(popup, "codigo").value = producto.codigo;
      campo(popup, "categoria").value = producto.categoria;
      campo(popup, "nombre").value = producto.nombre;
      campo(popup, "compra").value = producto.precioCompra;
      campo(popup, "margen").value = producto.margen;
      campo(popup, "stock").value = producto.stock;
      const recalcular = () => {
        campo(popup, "precio").value = formatearMoneda(
          calcularPrecioVenta(campo(popup, "compra").value, campo(popup, "margen").value),
        );
      };
      campo(popup, "compra").addEventListener("input", recalcular);
      campo(popup, "margen").addEventListener("input", recalcular);
      recalcular();
    },
    leer: (popup) => {
      const { producto: editado, error } = construirProducto({
        codigo: campo(popup, "codigo").value,
        categoria: campo(popup, "categoria").value,
        nombre: campo(popup, "nombre").value,
        precioCompra: campo(popup, "compra").value,
        margen: campo(popup, "margen").value,
        stock: campo(popup, "stock").value,
      });
      if (error) return error;
      if (existeCodigo(editado.codigo, producto.id)) return `Ya existe otro producto con el código ${editado.codigo}.`;
      return editado;
    },
  });
  if (!datos) return;

  await guardarProducto(producto.id, datos);
  notificarExito("Cambios guardados");
}

async function borrar(producto) {
  const ok = await confirmar({
    titulo: `¿Eliminar "${producto.nombre}"?`,
    texto: "Las ventas anteriores conservan el nombre y el precio. Esta acción no se puede deshacer.",
    boton: "Sí, eliminar",
    peligro: true,
  });
  if (!ok) return;

  try {
    await eliminarProducto(producto.id);
    notificarExito("Producto eliminado");
  } catch (error) {
    mostrarError(error, "No se pudo eliminar el producto.");
  }
}
