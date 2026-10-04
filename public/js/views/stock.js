import { $, h, icono, filaVacia, mostrar } from "../lib/dom.js";
import { calcularPrecioVenta, formatearMoneda } from "../lib/dinero.js";
import { formatearFechaHora } from "../lib/fechas.js";
import { calcularAjusteStock, construirProducto, MODOS_AJUSTE_STOCK, UMBRAL_STOCK_BAJO } from "../core/productos.js";
import {
  ajustarStock,
  crearProducto,
  eliminarProducto,
  guardarProducto,
  obtenerMovimientosStock,
} from "../data/productos.js";
import { sesion, alCambiarSesion, esAdmin } from "../estado.js";
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

  const btnMovimientos = $("btn-actualizar-movimientos");
  btnMovimientos.addEventListener("click", () => conBoton(btnMovimientos, cargarMovimientosStock));

  tbody.addEventListener("click", (e) => {
    const boton = e.target.closest("button[data-accion]");
    if (!boton) return;
    const producto = sesion.productos.find((p) => p.id === boton.dataset.id);
    if (!producto) return;
    if (boton.dataset.accion === "ajustar") conBoton(boton, () => ajustar(producto));
    if (boton.dataset.accion === "editar") conBoton(boton, () => editar(producto));
    if (boton.dataset.accion === "borrar") conBoton(boton, () => borrar(producto));
  });

  // El catálogo llega en tiempo real: la tabla se actualiza sola tras cada venta o edición.
  alCambiarSesion((_, cambios) => {
    if ("productos" in cambios && !$("sec-stock").classList.contains("hidden")) renderStock();
  });
}

/**
 * El admin ve todo (alta, edición, borrado y costo). El empleado ve el catálogo sin el costo
 * y solo puede ajustar el stock (las reglas de Firestore también se lo limitan a ese campo).
 */
export function renderStock() {
  const admin = esAdmin();
  mostrar($("card-nuevo-producto"), admin);
  mostrar($("card-movimientos-stock"), admin);
  mostrar($("th-costo"), admin);
  const columnas = admin ? 7 : 6;

  const termino = filtro.value.trim().toLowerCase();
  const productos = termino
    ? sesion.productos.filter((p) =>
        [p.nombre, p.codigo, p.categoria].some((campo) => campo.toLowerCase().includes(termino)),
      )
    : sesion.productos;

  if (productos.length === 0) {
    return filaVacia(tbody, columnas, termino ? "Ningún producto coincide con el filtro." : "Todavía no hay productos cargados.");
  }

  tbody.replaceChildren(
    ...productos.map((p) =>
      h(
        "tr",
        {},
        h("td", {}, p.codigo || "-"),
        h("td", {}, h("span", { class: "badge" }, p.categoria || "Sin categoría")),
        h("td", {}, p.nombre),
        admin ? h("td", { class: "num text-muted" }, formatearMoneda(p.precioCompra)) : null,
        h("td", { class: "num" }, h("strong", {}, formatearMoneda(p.precio))),
        h("td", { class: `num ${p.stock <= UMBRAL_STOCK_BAJO ? "stock-low" : ""}` }, p.stock),
        h(
          "td",
          { class: "acciones" },
          h(
            "button",
            { type: "button", class: "btn btn-primary btn-sm", title: "Ajustar stock", "aria-label": `Ajustar stock de ${p.nombre}`, dataset: { accion: "ajustar", id: p.id } },
            icono("boxes-stacked"),
            " Stock",
          ),
          admin
            ? h(
                "button",
                { type: "button", class: "btn btn-warning btn-sm", title: "Editar", "aria-label": `Editar ${p.nombre}`, dataset: { accion: "editar", id: p.id } },
                icono("pen"),
              )
            : null,
          admin
            ? h(
                "button",
                { type: "button", class: "btn btn-danger btn-sm", title: "Borrar", "aria-label": `Borrar ${p.nombre}`, dataset: { accion: "borrar", id: p.id } },
                icono("trash"),
              )
            : null,
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
    <p class="text-muted">El stock se cambia con el botón "Stock", que deja registrado el movimiento.</p>
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
        stock: producto.stock, // no se edita acá (ver guardarProducto)
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

// ---------- Ajuste de stock (admin y empleado) ----------

const FORMULARIO_AJUSTE = `
  <div class="swal-form">
    <p id="ajuste-producto" class="text-muted"></p>
    <label>Tipo de ajuste<select id="ajuste-modo" class="swal2-select"></select></label>
    <label><span id="ajuste-etiqueta">Cantidad</span><input id="ajuste-cantidad" type="number" min="0" step="1" class="swal2-input" inputmode="numeric"></label>
    <label>Motivo <small>(opcional)</small><input id="ajuste-motivo" class="swal2-input" maxlength="200" placeholder="Ej: llegó el proveedor, se rompió, vencido"></label>
    <p id="ajuste-resultado" class="ajuste-resultado" aria-live="polite"></p>
  </div>`;

async function ajustar(producto) {
  const campo = (popup, id) => popup.querySelector(`#ajuste-${id}`);
  const leerAjuste = (popup) =>
    calcularAjusteStock(producto.stock, campo(popup, "modo").value, campo(popup, "cantidad").value);

  const ajuste = await formularioModal({
    titulo: "Ajustar stock",
    boton: "Guardar ajuste",
    contenido: FORMULARIO_AJUSTE,
    alAbrir: (popup) => {
      campo(popup, "producto").textContent = `${producto.nombre} · stock actual: ${producto.stock}`;
      campo(popup, "modo").replaceChildren(
        ...Object.entries(MODOS_AJUSTE_STOCK).map(([valor, texto]) => h("option", { value: valor }, texto)),
      );
      const actualizar = () => {
        const modo = campo(popup, "modo").value;
        campo(popup, "etiqueta").textContent = modo === "conteo" ? "Unidades contadas" : "Cantidad";
        const { stock, error } = leerAjuste(popup);
        campo(popup, "resultado").textContent =
          campo(popup, "cantidad").value === "" ? "" : error ?? `Stock resultante: ${stock}`;
      };
      campo(popup, "modo").addEventListener("change", actualizar);
      campo(popup, "cantidad").addEventListener("input", actualizar);
      // Swal enfoca el botón al abrir; se pasa al campo de cantidad para escribir directo.
      setTimeout(() => campo(popup, "cantidad").focus());
    },
    leer: (popup) => {
      const resultado = leerAjuste(popup);
      return resultado.error ?? { ...resultado, modo: campo(popup, "modo").value, motivo: campo(popup, "motivo").value.trim() };
    },
  });
  if (!ajuste) return;

  try {
    await ajustarStock(producto, ajuste, sesion.usuario);
  } catch (error) {
    // Si se vendió mientras el modal estaba abierto, una baja puede dejar el stock negativo.
    if (error.code === "permission-denied") {
      return avisar("No se pudo ajustar", "El stock cambió mientras ajustabas (quizás hubo una venta). Revisalo y volvé a intentar.");
    }
    throw error;
  }
  notificarExito(`${producto.nombre}: ${ajuste.cambio > 0 ? "+" : ""}${ajuste.cambio} unidades`);
  if (esAdmin()) cargarMovimientosStock().catch((error) => console.error(error));
}

// ---------- Historial de movimientos de stock (admin) ----------

const TIPOS_MOVIMIENTO = { ingreso: "Ingreso", baja: "Baja", conteo: "Conteo" };

export async function cargarMovimientosStock() {
  if (!esAdmin()) return;
  const tbodyMov = $("tabla-movimientos-stock");
  let movimientos;
  try {
    movimientos = await obtenerMovimientosStock();
  } catch (error) {
    return mostrarError(error, "No se pudieron cargar los movimientos de stock.");
  }
  if (movimientos.length === 0) return filaVacia(tbodyMov, 6, "Todavía no hay movimientos registrados.");

  tbodyMov.replaceChildren(
    ...movimientos.map((m) =>
      h(
        "tr",
        {},
        h("td", {}, formatearFechaHora(m.fecha)),
        h("td", {}, m.productoNombre),
        h("td", {}, TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo, m.tipo === "conteo" ? h("small", { class: "text-muted d-block" }, `contado: ${m.stockContado}`) : null),
        h("td", { class: `num ${m.cambio < 0 ? "text-danger" : "text-success"}` }, `${m.cambio > 0 ? "+" : ""}${m.cambio}`),
        h("td", {}, m.motivo || "-"),
        h("td", {}, m.empleadoNombre),
      ),
    ),
  );
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
