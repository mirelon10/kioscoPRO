import { $, h, icono, mostrar } from "../lib/dom.js";
import { formatearMoneda, parsearMonto, redondear } from "../lib/dinero.js";
import { buscarCoincidencias, buscarExacto } from "../core/productos.js";
import { calcularVuelto } from "../core/caja.js";
import { registrarVenta, registrarRecargaSube } from "../data/ventas.js";
import { sesion, alCambiarSesion } from "../estado.js";
import { avisar, conBoton, notificarRegistro } from "../ui.js";

/** productoId -> cantidad */
const carrito = new Map();

const buscador = $("buscador-pos");
const sugerencias = $("sugerencias-pos");
const contenedorCarrito = $("carrito-items");
const btnCobrar = $("btn-confirmar-venta");
const selectMetodo = $("select-metodo-pago");
const inputPagaCon = $("input-paga-con");

const esEfectivo = () => selectMetodo.value === "Efectivo";
/** Total del carrito tal como se ve en pantalla (el servidor lo recalcula al cobrar). */
let totalCarrito = 0;

const productoPorId = (id) => sesion.productos.find((p) => p.id === id);

export function iniciarPos() {
  buscador.addEventListener("input", () => renderSugerencias(buscarCoincidencias(sesion.productos, buscador.value)));
  buscador.addEventListener("keydown", alPresionarTecla);
  buscador.addEventListener("blur", () => setTimeout(cerrarSugerencias, 150));

  // Delegación de eventos: un solo listener por contenedor, aunque se re-renderice.
  sugerencias.addEventListener("mousedown", (e) => {
    const item = e.target.closest("[data-id]");
    if (!item) return;
    e.preventDefault();
    agregarAlCarrito(productoPorId(item.dataset.id));
  });
  contenedorCarrito.addEventListener("change", (e) => {
    if (e.target.matches(".input-qty")) cambiarCantidad(e.target.dataset.id, e.target.value);
  });
  contenedorCarrito.addEventListener("click", (e) => {
    const boton = e.target.closest(".btn-remove");
    if (!boton) return;
    carrito.delete(boton.dataset.id);
    renderCarrito();
  });

  // conBoton rehabilita el botón al terminar; renderCarrito lo vuelve a deshabilitar si quedó vacío.
  btnCobrar.addEventListener("click", () => conBoton(btnCobrar, cobrar).then(renderCarrito));

  selectMetodo.addEventListener("change", renderPago);
  inputPagaCon.addEventListener("input", renderPago);
  inputPagaCon.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!btnCobrar.disabled) btnCobrar.click();
  });
  $("form-sube").addEventListener("submit", (e) => {
    e.preventDefault();
    conBoton($("btn-cobrar-sube"), cargarSube);
  });

  alCambiarSesion((_, cambios) => {
    if ("productos" in cambios || "turno" in cambios) renderCarrito();
  });
  renderCarrito();
}

export function vaciarPos() {
  carrito.clear();
  buscador.value = "";
  inputPagaCon.value = "";
  cerrarSugerencias();
  renderCarrito();
}

export function enfocarBuscador() {
  buscador.focus();
}

// ---------- Búsqueda ----------

function alPresionarTecla(e) {
  if (e.key === "Escape") return cerrarSugerencias();
  if (e.key !== "Enter") return;
  e.preventDefault();

  const termino = buscador.value;
  // Enter con el buscador vacío: terminó de cargar productos, pasa al cobro.
  if (!termino.trim()) {
    if (carrito.size > 0) (esEfectivo() ? inputPagaCon : btnCobrar).focus();
    return;
  }

  // Lector de código de barras: escribe el código y manda Enter.
  const coincidencias = buscarCoincidencias(sesion.productos, termino);
  const producto = buscarExacto(sesion.productos, termino) ?? (coincidencias.length === 1 ? coincidencias[0] : null);

  if (producto) agregarAlCarrito(producto);
  else if (coincidencias.length === 0) avisar("No encontrado", `No hay productos que coincidan con "${termino}".`);
}

function renderSugerencias(productos) {
  sugerencias.replaceChildren(
    ...productos.map((p) =>
      h(
        "li",
        { class: "autocomplete-item", role: "option", dataset: { id: p.id } },
        h("span", {}, h("strong", {}, p.nombre), " ", h("small", { class: "text-muted" }, `(${p.categoria || "Sin categoría"})`)),
        h("span", {}, formatearMoneda(p.precio), " ", h("small", { class: p.stock <= 0 ? "text-danger" : "" }, `Stock: ${p.stock}`)),
      ),
    ),
  );
  const abierto = productos.length > 0;
  mostrar(sugerencias, abierto);
  buscador.setAttribute("aria-expanded", String(abierto));
}

function cerrarSugerencias() {
  renderSugerencias([]);
}

// ---------- Carrito ----------

function agregarAlCarrito(producto) {
  if (!producto) return;
  const actual = carrito.get(producto.id) ?? 0;

  if (producto.stock <= actual) {
    avisar(producto.stock <= 0 ? "Sin stock" : "Stock máximo", `Quedan ${producto.stock} unidades de ${producto.nombre}.`);
  } else {
    carrito.set(producto.id, actual + 1);
    renderCarrito();
  }

  buscador.value = "";
  cerrarSugerencias();
  buscador.focus();
}

function cambiarCantidad(id, valor) {
  const producto = productoPorId(id);
  let cantidad = Math.floor(Number(valor));
  if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 1;
  if (producto && cantidad > producto.stock) {
    avisar("Stock insuficiente", `Quedan ${producto.stock} unidades de ${producto.nombre}.`);
    cantidad = producto.stock;
  }
  if (cantidad < 1) carrito.delete(id);
  else carrito.set(id, cantidad);
  renderCarrito();
}

function lineasDelCarrito() {
  const lineas = [];
  for (const [id, cantidad] of carrito) {
    const producto = productoPorId(id);
    // Si el admin borró el producto mientras estaba en el carrito, se quita.
    if (!producto) {
      carrito.delete(id);
      continue;
    }
    lineas.push({ producto, cantidad, subtotal: redondear(producto.precio * cantidad) });
  }
  return lineas;
}

function renderCarrito() {
  const lineas = lineasDelCarrito();
  const total = redondear(lineas.reduce((s, l) => s + l.subtotal, 0));

  if (lineas.length === 0) {
    contenedorCarrito.replaceChildren(h("p", { class: "empty-cart-msg" }, "El carrito está vacío"));
  } else {
    contenedorCarrito.replaceChildren(
      ...lineas.map(({ producto, cantidad, subtotal }) =>
        h(
          "div",
          { class: "cart-item" },
          h(
            "div",
            { class: "cart-item-info" },
            h("strong", {}, producto.nombre),
            h("small", { class: "text-muted" }, `Precio unitario: ${formatearMoneda(producto.precio)}`),
          ),
          h(
            "div",
            { class: "cart-item-actions" },
            h("input", {
              type: "number",
              class: "input-qty",
              value: cantidad,
              min: 1,
              max: Math.max(producto.stock, 1),
              "aria-label": `Cantidad de ${producto.nombre}`,
              dataset: { id: producto.id },
            }),
            h("span", { class: "cart-item-subtotal" }, formatearMoneda(subtotal)),
            h(
              "button",
              { type: "button", class: "btn-remove", "aria-label": `Quitar ${producto.nombre}`, dataset: { id: producto.id } },
              icono("trash"),
            ),
          ),
        ),
      ),
    );
  }

  totalCarrito = total;
  $("cart-total").textContent = formatearMoneda(total);
  mostrar($("aviso-sin-turno"), !sesion.turno);
  renderPago();
}

/** Muestra el vuelto (o lo que falta) y habilita el cobro solo si el pago alcanza. */
function renderPago() {
  mostrar($("pago-efectivo"), esEfectivo());

  const fila = $("vuelto-fila");
  const pagaCon = parsearMonto(inputPagaCon.value);
  const { vuelto, falta } = calcularVuelto(totalCarrito, pagaCon);
  const pagoIncompleto = esEfectivo() && (vuelto === null || totalCarrito === 0);

  fila.classList.toggle("falta", falta > 0);
  if (falta > 0) {
    $("vuelto-etiqueta").textContent = "Falta";
    $("vuelto-monto").textContent = formatearMoneda(falta);
  } else {
    $("vuelto-etiqueta").textContent = "Vuelto";
    $("vuelto-monto").textContent = vuelto === null || totalCarrito === 0 ? "—" : formatearMoneda(vuelto);
  }

  btnCobrar.disabled = carrito.size === 0 || !sesion.turno || pagoIncompleto;
}

// ---------- Cobro ----------

async function cobrar() {
  if (!sesion.turno) return avisar("Turno cerrado", "Abrí un turno antes de cobrar.");
  if (carrito.size === 0) return;

  const montoRecibido = esEfectivo() ? parsearMonto(inputPagaCon.value) : null;
  if (esEfectivo() && !(montoRecibido >= totalCarrito)) {
    return avisar("Pago insuficiente", "Ingresá con cuánto paga el cliente.");
  }

  const { total, vuelto, pendiente } = await registrarVenta({
    turnoId: sesion.turno.id,
    usuario: sesion.usuario,
    carrito: [...carrito].map(([productoId, cantidad]) => ({ productoId, cantidad })),
    metodoPago: selectMetodo.value,
    montoRecibido,
  });

  notificarRegistro(
    vuelto != null
      ? `Cobrado ${formatearMoneda(total)} · Vuelto ${formatearMoneda(vuelto)}`
      : `Venta cobrada: ${formatearMoneda(total)}`,
    pendiente,
  );
  carrito.clear();
  inputPagaCon.value = "";
  selectMetodo.value = "Efectivo";
  renderCarrito();
  buscador.focus();
}

async function cargarSube() {
  if (!sesion.turno) return avisar("Turno cerrado", "Abrí un turno antes de registrar una recarga.");

  const input = $("input-monto-sube");
  const monto = parsearMonto(input.value);
  if (!(monto > 0)) return avisar("Monto inválido", "Ingresá un monto mayor a 0.");

  const { pendiente } = await registrarRecargaSube({ turnoId: sesion.turno.id, usuario: sesion.usuario, monto, metodoPago: selectMetodo.value });

  notificarRegistro(`Recarga SUBE registrada: ${formatearMoneda(monto)}`, pendiente);
  input.value = "";
}
