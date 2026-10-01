import { db, collection, doc, addDoc, setDoc, deleteDoc, onSnapshot, query, orderBy } from "../firebase.js";
import { normalizarProducto } from "../core/productos.js";

const productosCol = collection(db, "productos");

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

/** Reemplaza el documento completo: así se eliminan campos viejos como `codigoBarra`. */
export function guardarProducto(id, producto) {
  return setDoc(doc(productosCol, id), producto);
}

export function eliminarProducto(id) {
  return deleteDoc(doc(productosCol, id));
}
