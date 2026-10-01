// Tests de integración de las Cloud Functions contra los emuladores:  npm run test:functions
// (firebase emulators:exec define FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST)
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp as initAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

const PROYECTO = "demo-kiosco";
const CLAVE = "secreto123";

initAdmin({ projectId: PROYECTO });
const adminAuth = getAdminAuth();
const db = getFirestore();

const uids = {};
const apps = [];

/** Cliente autenticado como un usuario (igual que el navegador). */
async function clienteComo(email) {
  const app = initializeApp({ projectId: PROYECTO, apiKey: "clave-falsa" }, `${email}-${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, CLAVE);
  const functions = getFunctions(app, "southamerica-east1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return (nombre, datos) => httpsCallable(functions, nombre)(datos).then((r) => r.data);
}

async function rechazaCon(promesa, codigo, mensaje) {
  await assert.rejects(promesa, (error) => {
    assert.equal(error.code, `functions/${codigo}`, `código: ${error.code} — ${error.message}`);
    if (mensaje) assert.match(error.message, mensaje);
    return true;
  });
}

const stock = async (id) => (await db.doc(`productos/${id}`).get()).data().stock;
const ventas = async () => (await db.collection("ventas").get()).docs.map((d) => d.data());

async function abrirTurno(uid, turnoId, cajaInicial = 1000) {
  await db.doc(`turnos/${turnoId}`).set({
    empleadoId: uid,
    empleadoNombre: `${uid}@kiosco.test`,
    cajaInicial,
    estado: "abierto",
    fechaApertura: Timestamp.now(),
  });
  await db.doc(`turnosActivos/${uid}`).set({ turnoId });
}

let ana, beto, admin, sinRol;

before(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROYECTO}/accounts`, { method: "DELETE" });
  for (const [nombre, rol] of [["ana", "empleado"], ["beto", "empleado"], ["admin", "admin"], ["sinrol", null]]) {
    const usuario = await adminAuth.createUser({ email: `${nombre}@kiosco.test`, password: CLAVE });
    if (rol) await adminAuth.setCustomUserClaims(usuario.uid, { rol });
    uids[nombre] = usuario.uid;
  }
  [ana, beto, admin, sinRol] = await Promise.all(
    ["ana", "beto", "admin", "sinrol"].map((n) => clienteComo(`${n}@kiosco.test`)),
  );
});

beforeEach(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("productos/agua").set({ nombre: "Agua", precio: 600, stock: 3 });
  await db.doc("productos/alfajor").set({ nombre: "Alfajor", precio: 800.5, stock: 10 });
  await abrirTurno(uids.ana, "t-ana");
});

after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

const ventaAgua = (extra = {}) => ({
  turnoId: "t-ana",
  items: [{ productoId: "agua", cantidad: 2 }, { productoId: "alfajor", cantidad: 1 }],
  metodoPago: "Efectivo",
  montoRecibido: 3000,
  ...extra,
});

describe("registrarVenta", () => {
  test("cobra con los precios de la base, calcula el vuelto y descuenta el stock exacto", async () => {
    const r = await ana("registrarVenta", ventaAgua());
    assert.deepEqual({ total: r.total, vuelto: r.vuelto }, { total: 2000.5, vuelto: 999.5 });
    assert.equal(await stock("agua"), 1);
    assert.equal(await stock("alfajor"), 9);

    const [venta] = await ventas();
    assert.equal(venta.empleadoId, uids.ana);
    assert.equal(venta.tipo, "productos");
    assert.equal(venta.montoRecibido, 3000);
    assert.equal(venta.vuelto, 999.5);
    assert.deepEqual(venta.items.map((i) => [i.productoId, i.cantidad, i.subtotal]), [["agua", 2, 1200], ["alfajor", 1, 800.5]]);
    assert.ok(venta.timestamp instanceof Timestamp);
  });

  test("ignora precios o totales que mande el navegador", async () => {
    const r = await ana("registrarVenta", ventaAgua({ total: 1, items: [{ productoId: "agua", cantidad: 1, precio: 1 }] }));
    assert.equal(r.total, 600);
  });

  test("une productos repetidos en el carrito", async () => {
    await ana("registrarVenta", ventaAgua({ items: [{ productoId: "agua", cantidad: 1 }, { productoId: "agua", cantidad: 2 }] }));
    assert.equal(await stock("agua"), 0);
    assert.equal((await ventas())[0].items.length, 1);
  });

  test("en efectivo exige que el pago alcance; con tarjeta no hay vuelto", async () => {
    await rechazaCon(ana("registrarVenta", ventaAgua({ montoRecibido: 2000 })), "failed-precondition", /no alcanza/);
    await rechazaCon(ana("registrarVenta", ventaAgua({ montoRecibido: undefined })), "invalid-argument");
    assert.equal(await stock("agua"), 3);

    const r = await ana("registrarVenta", ventaAgua({ metodoPago: "Tarjeta", montoRecibido: undefined }));
    assert.equal(r.vuelto, null);
  });

  test("sin stock suficiente no vende NADA (todo o nada)", async () => {
    await rechazaCon(
      ana("registrarVenta", ventaAgua({ items: [{ productoId: "alfajor", cantidad: 1 }, { productoId: "agua", cantidad: 4 }] })),
      "failed-precondition",
      /Stock insuficiente de Agua/,
    );
    assert.equal(await stock("alfajor"), 10);
    assert.equal((await ventas()).length, 0);
  });

  test("rechaza datos inválidos", async () => {
    await rechazaCon(ana("registrarVenta", ventaAgua({ items: [] })), "invalid-argument");
    await rechazaCon(ana("registrarVenta", ventaAgua({ items: [{ productoId: "agua", cantidad: 1.5 }] })), "invalid-argument");
    await rechazaCon(ana("registrarVenta", ventaAgua({ items: [{ productoId: "../x", cantidad: 1 }] })), "invalid-argument");
    await rechazaCon(ana("registrarVenta", ventaAgua({ metodoPago: "Bitcoin" })), "invalid-argument");
    await rechazaCon(ana("registrarVenta", ventaAgua({ items: [{ productoId: "noexiste", cantidad: 1 }] })), "failed-precondition", /ya no existe/);
  });

  test("solo se vende en el turno abierto propio", async () => {
    await rechazaCon(beto("registrarVenta", ventaAgua()), "permission-denied");
    await db.doc("turnos/t-ana").update({ estado: "cerrado" });
    await rechazaCon(ana("registrarVenta", ventaAgua()), "failed-precondition", /turno está cerrado/);
  });

  test("usuarios sin rol no pueden cobrar", async () => {
    await rechazaCon(sinRol("registrarVenta", ventaAgua()), "permission-denied");
  });
});

describe("registrarRecargaSube", () => {
  test("registra la recarga con el método elegido", async () => {
    const r = await ana("registrarRecargaSube", { turnoId: "t-ana", monto: 500, metodoPago: "Mercado Pago" });
    assert.equal(r.total, 500);
    const [venta] = await ventas();
    assert.deepEqual([venta.tipo, venta.metodoPago, venta.total], ["sube", "Mercado Pago", 500]);
  });

  test("rechaza montos inválidos", async () => {
    await rechazaCon(ana("registrarRecargaSube", { turnoId: "t-ana", monto: 0, metodoPago: "Efectivo" }), "invalid-argument");
    await rechazaCon(ana("registrarRecargaSube", { turnoId: "t-ana", monto: "500", metodoPago: "Efectivo" }), "invalid-argument");
  });
});

describe("cerrarTurno", () => {
  async function turnoConMovimientos() {
    await ana("registrarVenta", ventaAgua()); // 2000,50 en efectivo
    await ana("registrarVenta", ventaAgua({ items: [{ productoId: "agua", cantidad: 1 }], metodoPago: "Tarjeta", montoRecibido: undefined }));
    await ana("registrarRecargaSube", { turnoId: "t-ana", monto: 300, metodoPago: "Efectivo" });
    await db.collection("egresos").add({ turnoId: "t-ana", empleadoId: uids.ana, monto: 250, motivo: "Hielo", fecha: Timestamp.now() });
    // esperado = 1000 + 2000,50 + 300 − 250 = 3050,50 (la tarjeta no entra a la caja)
  }

  test("calcula el esperado en el servidor y guarda lo contado y la diferencia", async () => {
    await turnoConMovimientos();
    const r = await ana("cerrarTurno", { turnoId: "t-ana", cajaContada: 3040.5 });
    assert.deepEqual(r, { esperado: 3050.5, cajaContada: 3040.5, diferencia: -10 });

    const turno = (await db.doc("turnos/t-ana").get()).data();
    assert.equal(turno.estado, "cerrado");
    assert.equal(turno.cajaFinal, 3040.5);
    assert.equal(turno.cajaEsperada, 3050.5);
    assert.equal(turno.cerradoPor, uids.ana);
    assert.equal((await db.doc(`turnosActivos/${uids.ana}`).get()).exists, false);
  });

  test("un empleado no puede cerrar el turno de otro; el admin sí", async () => {
    await rechazaCon(beto("cerrarTurno", { turnoId: "t-ana", cajaContada: 1000 }), "permission-denied");
    const r = await admin("cerrarTurno", { turnoId: "t-ana", cajaContada: 1000 });
    assert.equal(r.diferencia, 0);
    const turno = (await db.doc("turnos/t-ana").get()).data();
    assert.equal(turno.cerradoPor, uids.admin);
    assert.equal(turno.cerradoPorNombre, "admin@kiosco.test");
    assert.equal((await db.doc(`turnosActivos/${uids.ana}`).get()).exists, false);
  });

  test("no se cierra dos veces y después del cierre no se puede vender", async () => {
    await ana("cerrarTurno", { turnoId: "t-ana", cajaContada: 1000 });
    await rechazaCon(ana("cerrarTurno", { turnoId: "t-ana", cajaContada: 1000 }), "failed-precondition", /ya estaba cerrado/);
    await rechazaCon(ana("registrarVenta", ventaAgua()), "failed-precondition");
  });

  test("rechaza montos inválidos y turnos inexistentes", async () => {
    await rechazaCon(ana("cerrarTurno", { turnoId: "t-ana", cajaContada: -1 }), "invalid-argument");
    await rechazaCon(ana("cerrarTurno", { turnoId: "no-existe", cajaContada: 0 }), "failed-precondition", /no existe/);
  });
});
