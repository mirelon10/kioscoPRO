// Cloud Functions de Kiosco Pro.
//
// Todo lo que mueve plata o stock pasa por acá: el servidor lee los precios y el stock
// reales, calcula el total, el vuelto y la caja del turno, y escribe todo en una sola
// transacción. Las reglas de Firestore no dejan que el navegador escriba ventas ni
// toque el stock o el cierre de turnos directamente.
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { setGlobalOptions, logger } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";

// Lógica compartida con el navegador (copiada por scripts/copiar-compartido.js).
import { armarVenta, METODOS_PAGO } from "./compartido/core/ventas.js";
import { calcularCajaTurno, calcularVuelto } from "./compartido/core/caja.js";
import { ErrorNegocio } from "./compartido/core/errores.js";
import { formatearMoneda, redondear } from "./compartido/lib/dinero.js";

initializeApp();
const db = getFirestore();

// Misma región que Firestore (São Paulo). maxInstances acota el costo ante un abuso.
setGlobalOptions({ region: "southamerica-east1", maxInstances: 5 });

const ROLES = ["admin", "empleado"];
const MONTO_MAXIMO = 100_000_000;
const MAX_ITEMS = 100;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

// ---------- Validación de entrada (nunca confiar en lo que manda el navegador) ----------

function usuarioAutorizado(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Tenés que iniciar sesión.");
  const { uid, token } = request.auth;
  if (!ROLES.includes(token.rol)) throw new HttpsError("permission-denied", "Tu usuario no tiene un rol asignado.");
  return { uid, nombre: token.email ?? uid, esAdmin: token.rol === "admin" };
}

const invalido = (mensaje) => new HttpsError("invalid-argument", mensaje);

function leerId(valor, campo) {
  if (typeof valor !== "string" || !ID_VALIDO.test(valor)) throw invalido(`${campo} inválido.`);
  return valor;
}

function leerMonto(valor, campo, { mayorACero = false } = {}) {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0 || valor > MONTO_MAXIMO) {
    throw invalido(`${campo} inválido.`);
  }
  if (mayorACero && valor <= 0) throw invalido(`${campo} debe ser mayor a 0.`);
  return redondear(valor);
}

function leerMetodoPago(valor) {
  if (!METODOS_PAGO.includes(valor)) throw invalido("Método de pago inválido.");
  return valor;
}

/** Valida los ítems y une los repetidos: [{productoId, cantidad}]. */
function leerCarrito(items) {
  if (!Array.isArray(items) || items.length === 0) throw invalido("El carrito está vacío.");
  if (items.length > MAX_ITEMS) throw invalido(`Máximo ${MAX_ITEMS} productos por venta.`);

  const cantidades = new Map();
  for (const item of items) {
    const productoId = leerId(item?.productoId, "Producto");
    const cantidad = item?.cantidad;
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10_000) throw invalido("Cantidad inválida.");
    cantidades.set(productoId, (cantidades.get(productoId) ?? 0) + cantidad);
  }
  return [...cantidades].map(([productoId, cantidad]) => ({ productoId, cantidad }));
}

// ---------- Helpers de Firestore ----------

/** Los errores de negocio llegan al usuario con su mensaje; el resto se registra y se oculta. */
async function conErroresDeNegocio(accion) {
  try {
    return await accion();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof ErrorNegocio) throw new HttpsError("failed-precondition", error.message);
    logger.error(error);
    throw new HttpsError("internal", "Error interno del servidor. Volvé a intentar.");
  }
}

async function leerTurnoAbiertoPropio(tx, turnoId, usuario) {
  const snap = await tx.get(db.doc(`turnos/${turnoId}`));
  if (!snap.exists) throw new ErrorNegocio("El turno no existe.");
  const turno = snap.data();
  if (turno.empleadoId !== usuario.uid) throw new HttpsError("permission-denied", "Ese turno no es tuyo.");
  if (turno.estado !== "abierto") throw new ErrorNegocio("Tu turno está cerrado. Abrí uno nuevo para vender.");
  return turno;
}

function datosVenta({ tipo, turnoId, usuario, metodoPago, items, total, montoRecibido = null, vuelto = null }) {
  return {
    tipo,
    turnoId,
    empleadoId: usuario.uid,
    empleadoNombre: usuario.nombre,
    metodoPago,
    items,
    total,
    montoRecibido,
    vuelto,
    timestamp: FieldValue.serverTimestamp(),
  };
}

// ---------- Funciones ----------

/**
 * Cobra una venta: valida stock y precios reales, calcula total y vuelto,
 * descuenta el stock exacto de cada producto y guarda la venta. Todo o nada.
 *
 * data: { turnoId, items: [{productoId, cantidad}], metodoPago, montoRecibido? (obligatorio en efectivo) }
 */
export const registrarVenta = onCall(async (request) => {
  const usuario = usuarioAutorizado(request);
  const data = request.data ?? {};
  const turnoId = leerId(data.turnoId, "Turno");
  const metodoPago = leerMetodoPago(data.metodoPago);
  const carrito = leerCarrito(data.items);
  const montoRecibido = metodoPago === "Efectivo" ? leerMonto(data.montoRecibido, "Monto recibido") : null;

  return conErroresDeNegocio(() =>
    db.runTransaction(async (tx) => {
      await leerTurnoAbiertoPropio(tx, turnoId, usuario);

      const refs = carrito.map((item) => db.doc(`productos/${item.productoId}`));
      const snaps = await tx.getAll(...refs);
      const { lineas, total, nuevosStocks } = armarVenta(
        carrito,
        snaps.map((s) => (s.exists ? s.data() : null)),
      );

      let vuelto = null;
      if (montoRecibido !== null) {
        const pago = calcularVuelto(total, montoRecibido);
        if (pago.falta > 0) {
          throw new ErrorNegocio(`El pago no alcanza: el total es ${formatearMoneda(total)} y faltan ${formatearMoneda(pago.falta)}.`);
        }
        vuelto = pago.vuelto;
      }

      refs.forEach((ref, i) => tx.update(ref, { stock: nuevosStocks[i] }));
      const ventaRef = db.collection("ventas").doc();
      tx.set(ventaRef, datosVenta({ tipo: "productos", turnoId, usuario, metodoPago, items: lineas, total, montoRecibido, vuelto }));

      logger.info("Venta registrada", { ventaId: ventaRef.id, turnoId, total, items: lineas.length });
      return { id: ventaRef.id, total, vuelto };
    }),
  );
});

/** data: { turnoId, monto, metodoPago } */
export const registrarRecargaSube = onCall(async (request) => {
  const usuario = usuarioAutorizado(request);
  const data = request.data ?? {};
  const turnoId = leerId(data.turnoId, "Turno");
  const metodoPago = leerMetodoPago(data.metodoPago);
  const monto = leerMonto(data.monto, "Monto", { mayorACero: true });

  return conErroresDeNegocio(() =>
    db.runTransaction(async (tx) => {
      await leerTurnoAbiertoPropio(tx, turnoId, usuario);
      const ventaRef = db.collection("ventas").doc();
      const items = [{ nombre: "Recarga SUBE", precio: monto, cantidad: 1, subtotal: monto }];
      tx.set(ventaRef, datosVenta({ tipo: "sube", turnoId, usuario, metodoPago, items, total: monto }));
      return { id: ventaRef.id, total: monto };
    }),
  );
});

/**
 * Cierra un turno. Calcula en el servidor el efectivo esperado (caja inicial + ventas
 * en efectivo − egresos) y lo guarda junto con lo que el empleado declaró haber contado.
 * El admin puede cerrar el turno de cualquier empleado (por ejemplo, si se fue sin cerrarlo).
 *
 * data: { turnoId, cajaContada }
 */
export const cerrarTurno = onCall(async (request) => {
  const usuario = usuarioAutorizado(request);
  const data = request.data ?? {};
  const turnoId = leerId(data.turnoId, "Turno");
  const cajaContada = leerMonto(data.cajaContada, "Efectivo contado");

  return conErroresDeNegocio(() =>
    db.runTransaction(async (tx) => {
      const turnoRef = db.doc(`turnos/${turnoId}`);
      const snap = await tx.get(turnoRef);
      if (!snap.exists) throw new ErrorNegocio("El turno no existe.");
      const turno = snap.data();

      if (turno.empleadoId !== usuario.uid && !usuario.esAdmin) {
        throw new HttpsError("permission-denied", "Solo podés cerrar tu propio turno.");
      }
      if (turno.estado !== "abierto") throw new ErrorNegocio("El turno ya estaba cerrado.");

      const candadoRef = db.doc(`turnosActivos/${turno.empleadoId}`);
      const [ventas, egresos, candado] = await Promise.all([
        tx.get(db.collection("ventas").where("turnoId", "==", turnoId)),
        tx.get(db.collection("egresos").where("turnoId", "==", turnoId)),
        tx.get(candadoRef),
      ]);

      const caja = calcularCajaTurno({
        cajaInicial: turno.cajaInicial,
        ventas: ventas.docs.map((d) => d.data()),
        egresos: egresos.docs.map((d) => d.data()),
      });
      const diferencia = redondear(cajaContada - caja.esperado);

      tx.update(turnoRef, {
        estado: "cerrado",
        cajaFinal: cajaContada,
        cajaEsperada: caja.esperado,
        fechaCierre: FieldValue.serverTimestamp(),
        cerradoPor: usuario.uid,
        cerradoPorNombre: usuario.nombre,
      });
      if (candado.exists && candado.data().turnoId === turnoId) tx.delete(candadoRef);

      logger.info("Turno cerrado", { turnoId, cerradoPor: usuario.uid, esperado: caja.esperado, diferencia });
      return { esperado: caja.esperado, cajaContada, diferencia };
    }),
  );
});
