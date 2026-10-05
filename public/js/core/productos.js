import { calcularPrecioVenta, parsearMonto } from "../lib/dinero.js";

export const UMBRAL_STOCK_BAJO = 5;

/** Unifica documentos viejos (campo `codigoBarra`) con el formato actual (`codigo`). */
export function normalizarProducto(id, datos) {
  return {
    id,
    codigo: String(datos.codigo ?? datos.codigoBarra ?? "").trim(),
    nombre: String(datos.nombre ?? "").trim(),
    categoria: String(datos.categoria ?? "").trim(),
    precioCompra: Number(datos.precioCompra) || 0,
    margen: Number(datos.margen) || 0,
    precio: Number(datos.precio) || 0,
    stock: Number.isFinite(Number(datos.stock)) ? Number(datos.stock) : 0,
  };
}

/**
 * Valida los datos de un formulario de producto.
 * Devuelve { producto } listo para guardar o { error } con un mensaje para el usuario.
 */
export function construirProducto({ codigo, nombre, categoria, precioCompra, margen, stock }) {
  const costo = parsearMonto(precioCompra);
  const margenNum = parsearMonto(margen);
  const stockTexto = String(stock ?? "").trim();
  const stockNum = stockTexto === "" ? NaN : Number(stockTexto); // Number("") sería 0

  if (!String(nombre ?? "").trim()) return { error: "El nombre es obligatorio." };
  if (!(costo >= 0)) return { error: "El precio de compra debe ser un número mayor o igual a 0." };
  if (!(margenNum >= 0)) return { error: "El margen debe ser un número mayor o igual a 0." };
  if (!Number.isInteger(stockNum) || stockNum < 0) return { error: "El stock debe ser un número entero mayor o igual a 0." };

  return {
    producto: {
      codigo: String(codigo ?? "").trim(),
      nombre: String(nombre).trim(),
      categoria: String(categoria ?? "").trim(),
      precioCompra: costo,
      margen: margenNum,
      precio: calcularPrecioVenta(costo, margenNum),
      stock: stockNum,
    },
  };
}

/** Busca por código exacto primero (lector de código de barras) y si no, por nombre exacto. */
export function buscarExacto(productos, termino) {
  const t = termino.trim().toLowerCase();
  if (!t) return null;
  return (
    productos.find((p) => p.codigo && p.codigo.toLowerCase() === t) ??
    productos.find((p) => p.nombre.toLowerCase() === t) ??
    null
  );
}

export function buscarCoincidencias(productos, termino, limite = 8) {
  const t = termino.trim().toLowerCase();
  if (!t) return [];
  return productos
    .filter((p) => p.nombre.toLowerCase().includes(t) || p.codigo.toLowerCase().includes(t))
    .slice(0, limite);
}

export function productosConStockBajo(productos, umbral = UMBRAL_STOCK_BAJO) {
  return productos.filter((p) => p.stock <= umbral).sort((a, b) => a.stock - b.stock);
}

/** Formas de ajustar el stock desde Inventario (las usan el admin y el empleado). */
export const MODOS_AJUSTE_STOCK = {
  ingreso: "Ingreso de mercadería (+)",
  baja: "Baja: consumo, faltante, rotura, vencido (−)",
  conteo: "Conteo: el stock real es",
};

/** Por qué se da de baja stock (sin ser una venta). Lo ve el admin en Administración. */
export const CAUSAS_BAJA = {
  consumo: "Consumo propio",
  faltante: "Faltante / pérdida",
  rotura: "Rotura",
  vencido: "Vencido",
};

/** Qué pasó en un movimiento de stock, para mostrarlo en las tablas. */
export function describirMovimiento(m) {
  if (m.tipo === "baja") return CAUSAS_BAJA[m.causa] ?? "Baja";
  if (m.tipo === "conteo") return m.cambio < 0 ? "Faltante en conteo" : m.cambio > 0 ? "Sobrante en conteo" : "Conteo";
  if (m.tipo === "ingreso") return "Ingreso";
  return m.tipo;
}

/**
 * Stock que bajó sin ser una venta (bajas y conteos que dieron de menos), del más nuevo al más viejo,
 * con su valor al costo actual del producto. `empleadoId` vacío: todos.
 * @returns {{ filas: object[], unidades: number, valor: number, porEmpleado: { nombre, unidades, valor }[] }}
 */
export function resumirBajasDeStock(movimientos, productos, empleadoId = "") {
  const costo = new Map(productos.map((p) => [p.id, p.precioCompra]));
  const filas = movimientos
    .filter((m) => m.cambio < 0 && (!empleadoId || m.empleadoId === empleadoId))
    .map((m) => {
      const unidades = -m.cambio;
      const precio = costo.get(m.productoId);
      return { ...m, unidades, que: describirMovimiento(m), valor: precio == null ? null : precio * unidades };
    });

  const porEmpleado = new Map();
  for (const f of filas) {
    const e = porEmpleado.get(f.empleadoId) ?? { nombre: f.empleadoNombre, unidades: 0, valor: 0 };
    e.unidades += f.unidades;
    e.valor += f.valor ?? 0;
    porEmpleado.set(f.empleadoId, e);
  }

  return {
    filas,
    unidades: filas.reduce((s, f) => s + f.unidades, 0),
    valor: filas.reduce((s, f) => s + (f.valor ?? 0), 0),
    porEmpleado: [...porEmpleado.values()].sort((a, b) => b.valor - a.valor),
  };
}

/**
 * Valida un ajuste de stock.
 * Devuelve { cambio, stock } (`cambio` es lo que suma o resta; `stock` es el resultado esperado)
 * o { error } con un mensaje para el usuario.
 */
export function calcularAjusteStock(stockActual, modo, cantidad) {
  const texto = String(cantidad ?? "").trim();
  const n = texto === "" ? NaN : Number(texto);
  if (!(modo in MODOS_AJUSTE_STOCK)) return { error: "Elegí el tipo de ajuste." };
  if (!Number.isInteger(n) || n < 0) return { error: "La cantidad debe ser un número entero mayor o igual a 0." };
  if (modo !== "conteo" && n === 0) return { error: "La cantidad debe ser mayor a 0." };

  const cambio = modo === "ingreso" ? n : modo === "baja" ? -n : n - stockActual;
  const stock = stockActual + cambio;
  if (stock < 0) return { error: `No se pueden dar de baja ${n}: hay ${stockActual} en stock.` };
  if (cambio === 0) return { error: "El stock ya es ese, no hay nada que ajustar." };
  return { cambio, stock };
}
