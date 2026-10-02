import {
  db,
  collection,
  doc,
  getDoc,
  getDocFromCache,
  setDoc,
  runTransaction,
  writeBatch,
  serverTimestamp,
  increment,
} from "../firebase.js";
import { armarCobro } from "../core/caja.js";
import { ErrorNegocio } from "../core/errores.js";
import { conLimiteDeTiempo, esErrorDeConexion } from "../lib/espera.js";
import { formatearMoneda, redondear } from "../lib/dinero.js";
import { esperarConfirmacion, estaOnline, reportarProblema, seguirPendiente } from "./conexion.js";

const ventasCol = collection(db, "ventas");

/** Si la transacción no termina en este tiempo (wifi sin internet), la venta se guarda sin conexión. */
const ESPERA_TRANSACCION_MS = 8000;

/**
 * Registra una venta y descuenta el stock.
 *
 * Con conexión, en una transacción: lee los precios y el stock vigentes, y si dos cajas venden
 * el último producto a la vez, una de las dos falla en lugar de dejar stock negativo.
 *
 * Sin conexión (o si la transacción no responde), con los precios y el stock guardados en el
 * dispositivo: la venta queda pendiente y Firestore la sube sola al volver internet (ver
 * venderSinConexion). Las dos formas usan el mismo id de venta, así que si la transacción
 * llegó a guardarse igual, la copia sin conexión se rechaza y no queda duplicada.
 *
 * En efectivo, `montoRecibido` es obligatorio y tiene que cubrir el total real.
 *
 * @param {{ turnoId: string, usuario: object, carrito: Array<{productoId: string, cantidad: number}>, metodoPago: string, montoRecibido?: number|null }} venta
 * @returns {Promise<{ id: string, total: number, vuelto: number|null, pendiente: boolean }>}
 */
export async function registrarVenta(venta) {
  const ventaRef = doc(ventasCol);

  if (estaOnline()) {
    const transaccion = venderEnTransaccion(ventaRef, venta);
    transaccion.catch(() => {}); // si se abandona por tiempo, su error ya no le importa a nadie
    try {
      return { ...(await conLimiteDeTiempo(transaccion, ESPERA_TRANSACCION_MS)), pendiente: false };
    } catch (error) {
      if (!esErrorDeConexion(error)) throw error;
    }
  }
  return venderSinConexion(ventaRef, venta);
}

function datosVenta({ turnoId, usuario, metodoPago, montoRecibido = null }, { lineas, total, vuelto }) {
  return {
    tipo: "productos",
    turnoId,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    metodoPago,
    items: lineas,
    total,
    montoRecibido: metodoPago === "Efectivo" ? redondear(montoRecibido) : null,
    vuelto,
    timestamp: serverTimestamp(),
  };
}

const refsProductos = (carrito) => carrito.map((item) => doc(db, "productos", item.productoId));

function venderEnTransaccion(ventaRef, venta) {
  return runTransaction(db, async (tx) => {
    const refs = refsProductos(venta.carrito);
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    // El total se recalcula con los precios de la base: puede diferir del carrito en pantalla.
    const cobro = armarCobro(
      venta.carrito,
      snaps.map((s) => (s.exists() ? s.data() : null)),
      venta.metodoPago,
      venta.montoRecibido,
    );

    refs.forEach((ref, i) => tx.update(ref, { stock: cobro.nuevosStocks[i] }));
    tx.set(ventaRef, datosVenta(venta, cobro));
    return { id: ventaRef.id, total: cobro.total, vuelto: cobro.vuelto };
  });
}

/**
 * Venta sin conexión: precios y stock salen de la copia local del catálogo (que ya incluye lo
 * vendido sin conexión), y el stock se descuenta con increment() para que, al subirse, se reste
 * del stock que haya en ese momento en el servidor y no pise otras ventas.
 */
async function venderSinConexion(ventaRef, venta) {
  const refs = refsProductos(venta.carrito);
  const productos = await Promise.all(
    refs.map((ref) =>
      getDocFromCache(ref)
        .then((s) => (s.exists() ? s.data() : null))
        .catch(() => {
          throw new ErrorNegocio("Sin conexión: este equipo no tiene cargado un producto del carrito. Esperá a que vuelva internet.");
        }),
    ),
  );
  const cobro = armarCobro(venta.carrito, productos, venta.metodoPago, venta.montoRecibido);
  const datos = datosVenta(venta, cobro);

  const batch = writeBatch(db);
  venta.carrito.forEach((item, i) => batch.update(refs[i], { stock: increment(-item.cantidad) }));
  batch.set(ventaRef, datos);

  const descripcion = `Venta de ${formatearMoneda(cobro.total)} (${venta.metodoPago})`;
  seguirPendiente(batch.commit(), descripcion, (error) => alRechazarVentaSinConexion(error, ventaRef, datos, descripcion));

  return { id: ventaRef.id, total: cobro.total, vuelto: cobro.vuelto, pendiente: true };
}

/**
 * La venta y el stock se rechazan juntos. Lo más común es que el stock hubiera quedado
 * negativo (otra caja vendió lo mismo mientras tanto): la venta se hizo igual en el mostrador,
 * así que se guarda sola y se avisa que el stock hay que revisarlo.
 */
async function alRechazarVentaSinConexion(error, ventaRef, datos, descripcion) {
  if (error?.code !== "permission-denied") {
    return reportarProblema("No se pudo subir una venta hecha sin conexión", `${descripcion}.`, error);
  }

  try {
    await setDoc(ventaRef, datos);
    reportarProblema(
      "Revisá el stock",
      `${descripcion}: se subió la venta, pero no se pudo descontar el stock (otra caja vendió los mismos productos mientras no había conexión). Ajustalo desde Inventario.`,
      error,
    );
  } catch (errorVenta) {
    // Si la transacción original sí había llegado al servidor, la venta ya está guardada.
    try {
      if ((await getDoc(ventaRef)).exists()) return;
    } catch {
      // sin poder verificarlo, se avisa
    }
    reportarProblema(
      "No se pudo subir una venta hecha sin conexión",
      `${descripcion}: el servidor la rechazó (por ejemplo, porque el turno ya estaba cerrado). Anotala y avisale al administrador.`,
      errorVenta,
    );
  }
}

export async function registrarRecargaSube({ turnoId, usuario, monto, metodoPago }) {
  const total = redondear(monto);
  const ventaRef = doc(ventasCol);
  const escritura = setDoc(ventaRef, {
    tipo: "sube",
    turnoId,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.email,
    metodoPago,
    items: [{ nombre: "Recarga SUBE", precio: total, cantidad: 1, subtotal: total }],
    total,
    montoRecibido: null,
    vuelto: null,
    timestamp: serverTimestamp(),
  });
  const pendiente = await esperarConfirmacion(escritura, `Recarga SUBE de ${formatearMoneda(total)}`);
  return { id: ventaRef.id, total, pendiente };
}
