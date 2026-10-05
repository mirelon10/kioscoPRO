import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
  increment,
  deleteField,
} from "../firebase.js";
import { normalizarProducto } from "../core/productos.js";

const productosCol = collection(db, "productos");
const movimientosCol = collection(db, "movimientosStock");

/**
 * Escucha el catálogo en tiempo real. Después de la primera carga, Firestore solo
 * cobra lecturas por los productos que cambian (en lugar de releer todo tras cada venta).
 * @returns {() => void} función para dejar de escuchar
 */
export function escucharProductos(alCambiar, alFallar) {
  return onSnapshot(
    query(productosCol, orderBy("nombre")),
    (snap) => alCambiar(snap.docs.map((d) => normalizarProducto(d.id, d.data()))),
    alFallar,
  );
}

export function crearProducto(producto) {
  return addDoc(productosCol, producto);
}

/**
 * Edita los datos del producto (el admin). El stock no se toca: cambia solo con ventas y ajustes,
 * que quedan registrados. Borra campos viejos como `codigoBarra`.
 */
export function guardarProducto(id, { stock, ...datos }) {
  return updateDoc(doc(productosCol, id), { ...datos, codigoBarra: deleteField() });
}

/**
 * Ajusta el stock desde Inventario (admin y empleado) y registra el movimiento en el mismo batch:
 * las reglas no aceptan un cambio de stock sin su movimiento.
 * Ingresos y bajas usan increment(): si se vende algo mientras el modal está abierto, no se pisa
 * esa venta. Si el resultado quedara negativo, las reglas lo rechazan.
 * El conteo fija el número contado (si el stock cambió mientras tanto, las reglas lo rechazan).
 */
export function ajustarStock(producto, { modo, cambio, stock, motivo, causa }, usuario) {
  const movRef = doc(movimientosCol);
  const batch = writeBatch(db);
  batch.set(movRef, {
    productoId: producto.id,
    productoNombre: producto.nombre,
    tipo: modo,
    cambio,
    motivo,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    fecha: serverTimestamp(),
    ...(modo === "conteo" ? { stockContado: stock } : {}),
    ...(modo === "baja" && causa ? { causa } : {}),
  });
  batch.update(doc(productosCol, producto.id), {
    stock: modo === "conteo" ? stock : increment(cambio),
    ultimoAjuste: movRef.id,
  });
  return batch.commit();
}

/** Últimos movimientos de stock (para el admin). */
export async function obtenerMovimientosStock(cantidad = 100) {
  const snap = await getDocs(query(movimientosCol, orderBy("fecha", "desc"), limit(cantidad)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Movimientos de stock de un período (para el panel del admin): pocos, 1 lectura cada uno. */
export async function obtenerMovimientosStockEntre(desde, hasta) {
  const snap = await getDocs(
    query(movimientosCol, where("fecha", ">=", desde), where("fecha", "<=", hasta), orderBy("fecha", "desc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function eliminarProducto(id) {
  return deleteDoc(doc(productosCol, id));
}
