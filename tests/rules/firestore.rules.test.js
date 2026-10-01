// Tests de seguridad de firestore.rules. Corren contra el emulador:  npm run test:rules
import { after, before, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const ADMIN = "admin1";
const ANA = "empleada1";
const BETO = "empleado2";

let env;

const db = (uid, rol) => env.authenticatedContext(uid, rol ? { rol, email: `${uid}@kiosco.test` } : {}).firestore();
const comoAdmin = () => db(ADMIN, "admin");
const comoAna = () => db(ANA, "empleado");
const comoBeto = () => db(BETO, "empleado");
const sinRol = () => db("intruso");
const anonimo = () => env.unauthenticatedContext().firestore();

/** Escribe datos de prueba salteando las reglas. */
async function sembrar(datos) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    for (const [ruta, valor] of Object.entries(datos)) await setDoc(doc(fs, ruta), valor);
  });
}

const producto = (extra = {}) => ({ codigo: "779", nombre: "Agua", categoria: "Bebidas", precioCompra: 400, margen: 50, precio: 600, stock: 10, ...extra });

function abrirTurno(fs, uid, turnoId = `turno-${uid}`) {
  const batch = writeBatch(fs);
  batch.set(doc(fs, "turnos", turnoId), {
    empleadoId: uid,
    empleadoNombre: `${uid}@kiosco.test`,
    cajaInicial: 1000,
    estado: "abierto",
    fechaApertura: serverTimestamp(),
  });
  batch.set(doc(fs, "turnosActivos", uid), { turnoId });
  return batch.commit();
}

function cerrarTurno(fs, uid, turnoId = `turno-${uid}`) {
  const batch = writeBatch(fs);
  batch.update(doc(fs, "turnos", turnoId), { estado: "cerrado", cajaFinal: 1500, fechaCierre: serverTimestamp() });
  batch.delete(doc(fs, "turnosActivos", uid));
  return batch.commit();
}

const venta = (uid, extra = {}) => ({
  tipo: "productos",
  turnoId: `turno-${uid}`,
  empleadoId: uid,
  empleadoNombre: `${uid}@kiosco.test`,
  metodoPago: "Efectivo",
  items: [{ productoId: "p1", nombre: "Agua", precio: 600, cantidad: 1, subtotal: 600 }],
  total: 600,
  timestamp: serverTimestamp(),
  ...extra,
});

const egreso = (uid, extra = {}) => ({
  turnoId: `turno-${uid}`,
  empleadoId: uid,
  empleadoNombre: `${uid}@kiosco.test`,
  monto: 300,
  motivo: "Proveedor",
  fecha: serverTimestamp(),
  ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-kiosco",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
beforeEach(() => env.clearFirestore());
after(() => env.cleanup());

describe("acceso general", () => {
  test("usuarios sin sesión o sin rol no leen nada", async () => {
    await sembrar({ "productos/p1": producto() });
    await assertFails(getDoc(doc(anonimo(), "productos/p1")));
    await assertFails(getDoc(doc(sinRol(), "productos/p1")));
  });

  test("colecciones desconocidas están cerradas", async () => {
    await assertFails(setDoc(doc(comoAdmin(), "config/x"), { a: 1 }));
  });
});

describe("productos", () => {
  test("el personal puede leer el catálogo", async () => {
    await sembrar({ "productos/p1": producto() });
    await assertSucceeds(getDoc(doc(comoAna(), "productos/p1")));
  });

  test("solo el admin crea, edita y borra productos", async () => {
    await assertSucceeds(setDoc(doc(comoAdmin(), "productos/p1"), producto()));
    await assertFails(setDoc(doc(comoAna(), "productos/p2"), producto()));
    await assertFails(updateDoc(doc(comoAna(), "productos/p1"), { precio: 1 }));
    await assertFails(deleteDoc(doc(comoAna(), "productos/p1")));
    await assertSucceeds(deleteDoc(doc(comoAdmin(), "productos/p1")));
  });

  test("rechaza productos inválidos aunque los cree el admin", async () => {
    const fs = comoAdmin();
    await assertFails(setDoc(doc(fs, "productos/a"), producto({ stock: -1 })));
    await assertFails(setDoc(doc(fs, "productos/b"), producto({ stock: 1.5 })));
    await assertFails(setDoc(doc(fs, "productos/c"), producto({ precio: "gratis" })));
    await assertFails(setDoc(doc(fs, "productos/d"), producto({ nombre: "" })));
    await assertFails(setDoc(doc(fs, "productos/e"), producto({ campoRaro: true })));
  });

  test("el empleado solo puede bajar el stock, nunca subirlo ni dejarlo negativo", async () => {
    await sembrar({ "productos/p1": producto({ stock: 5 }) });
    const fs = comoAna();
    await assertSucceeds(updateDoc(doc(fs, "productos/p1"), { stock: 4 }));
    await assertFails(updateDoc(doc(fs, "productos/p1"), { stock: 50 }));
    await assertFails(updateDoc(doc(fs, "productos/p1"), { stock: -1 }));
    await assertFails(updateDoc(doc(fs, "productos/p1"), { stock: 3, precio: 1 }));
  });

  test("al editar, el admin puede borrar campos viejos como codigoBarra", async () => {
    await sembrar({ "productos/p1": { codigoBarra: "779", nombre: "Agua", precio: 600, stock: 5 } });
    await assertSucceeds(setDoc(doc(comoAdmin(), "productos/p1"), producto()));
  });
});

describe("turnos", () => {
  test("el empleado abre y cierra su turno", async () => {
    const fs = comoAna();
    await assertSucceeds(abrirTurno(fs, ANA));
    await assertSucceeds(cerrarTurno(fs, ANA));
  });

  test("no se pueden tener dos turnos abiertos", async () => {
    const fs = comoAna();
    await assertSucceeds(abrirTurno(fs, ANA, "t1"));
    await assertFails(abrirTurno(fs, ANA, "t2"));
  });

  test("no se puede abrir un turno sin candado ni a nombre de otro", async () => {
    const fs = comoAna();
    await assertFails(
      setDoc(doc(fs, "turnos/t1"), { empleadoId: ANA, empleadoNombre: "a", cajaInicial: 0, estado: "abierto", fechaApertura: serverTimestamp() }),
    );
    await assertFails(abrirTurno(fs, BETO));
  });

  test("no se puede cerrar un turno ajeno ni dejar el candado colgado", async () => {
    await assertSucceeds(abrirTurno(comoAna(), ANA));
    await assertFails(cerrarTurno(comoBeto(), ANA));
    // Cerrar sin borrar el candado
    await assertFails(
      updateDoc(doc(comoAna(), `turnos/turno-${ANA}`), { estado: "cerrado", cajaFinal: 10, fechaCierre: serverTimestamp() }),
    );
    // Borrar el candado sin cerrar el turno
    await assertFails(deleteDoc(doc(comoAna(), `turnosActivos/${ANA}`)));
  });

  test("un turno cerrado no se reabre ni se modifica", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await cerrarTurno(fs, ANA);
    await assertFails(updateDoc(doc(fs, `turnos/turno-${ANA}`), { cajaFinal: 99999 }));
    await assertFails(updateDoc(doc(fs, `turnos/turno-${ANA}`), { estado: "abierto" }));
  });

  test("se puede adoptar un turno abierto antes de la migración (sin candado)", async () => {
    await sembrar({ [`turnos/viejo`]: { empleadoId: ANA, empleadoNombre: "a", cajaInicial: 0, estado: "abierto" } });
    const fs = comoAna();
    await assertSucceeds(getDocs(query(collection(fs, "turnos"), where("empleadoId", "==", ANA), where("estado", "==", "abierto"))));
    await assertSucceeds(setDoc(doc(fs, `turnosActivos/${ANA}`), { turnoId: "viejo" }));
  });

  test("se puede escuchar un turno que todavía no llegó al servidor (sin exponer datos)", async () => {
    await assertSucceeds(getDoc(doc(comoAna(), "turnos/todavia-no-existe")));
    await assertFails(getDoc(doc(sinRol(), "turnos/todavia-no-existe")));
  });

  test("el empleado solo ve sus turnos; el admin ve todos", async () => {
    await abrirTurno(comoAna(), ANA);
    await assertSucceeds(getDoc(doc(comoAna(), `turnos/turno-${ANA}`)));
    await assertFails(getDoc(doc(comoBeto(), `turnos/turno-${ANA}`)));
    await assertFails(getDocs(collection(comoBeto(), "turnos")));
    await assertSucceeds(getDocs(collection(comoAdmin(), "turnos")));
  });
});

describe("ventas", () => {
  test("se registra una venta con turno abierto propio", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await assertSucceeds(addDoc(collection(fs, "ventas"), venta(ANA)));
  });

  test("venta + descuento de stock en el mismo batch (como la transacción de la app)", async () => {
    await sembrar({ "productos/p1": producto({ stock: 5 }) });
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const batch = writeBatch(fs);
    batch.update(doc(fs, "productos/p1"), { stock: 4 });
    batch.set(doc(collection(fs, "ventas")), venta(ANA));
    await assertSucceeds(batch.commit());
  });

  test("sin turno abierto, con turno ajeno o cerrado no se vende", async () => {
    await assertFails(addDoc(collection(comoAna(), "ventas"), venta(ANA)));

    await abrirTurno(comoBeto(), BETO);
    await assertFails(addDoc(collection(comoAna(), "ventas"), venta(ANA, { turnoId: `turno-${BETO}` })));

    await abrirTurno(comoAna(), ANA);
    await cerrarTurno(comoAna(), ANA);
    await assertFails(addDoc(collection(comoAna(), "ventas"), venta(ANA)));
  });

  test("no se puede firmar una venta a nombre de otro, con fecha falsa o datos inválidos", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const ventas = collection(fs, "ventas");
    await assertFails(addDoc(ventas, venta(ANA, { empleadoId: BETO })));
    await assertFails(addDoc(ventas, venta(ANA, { timestamp: new Date(2020, 0, 1) })));
    await assertFails(addDoc(ventas, venta(ANA, { metodoPago: "Bitcoin" })));
    await assertFails(addDoc(ventas, venta(ANA, { total: -100 })));
    await assertFails(addDoc(ventas, venta(ANA, { items: [] })));
    await assertFails(addDoc(ventas, venta(ANA, { descuento: 50 })));
  });

  test("recarga SUBE con el método de pago elegido", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await assertSucceeds(addDoc(collection(fs, "ventas"), venta(ANA, { tipo: "sube", metodoPago: "Mercado Pago" })));
  });

  test("las ventas son inmutables", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await setDoc(doc(fs, "ventas/v1"), venta(ANA));
    await assertFails(updateDoc(doc(fs, "ventas/v1"), { total: 1 }));
    await assertFails(deleteDoc(doc(fs, "ventas/v1")));
    await assertFails(deleteDoc(doc(comoAdmin(), "ventas/v1")));
  });

  test("el empleado solo lee sus ventas; el admin, todas", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await setDoc(doc(fs, "ventas/v1"), venta(ANA));
    await assertSucceeds(getDoc(doc(fs, "ventas/v1")));
    await assertFails(getDoc(doc(comoBeto(), "ventas/v1")));
    await assertSucceeds(getDocs(collection(comoAdmin(), "ventas")));
  });
});

describe("egresos", () => {
  test("se registra un egreso válido con turno abierto", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await assertSucceeds(addDoc(collection(fs, "egresos"), egreso(ANA)));
  });

  test("rechaza egresos inválidos o sin turno", async () => {
    await assertFails(addDoc(collection(comoAna(), "egresos"), egreso(ANA)));
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const egresos = collection(fs, "egresos");
    await assertFails(addDoc(egresos, egreso(ANA, { monto: 0 })));
    await assertFails(addDoc(egresos, egreso(ANA, { motivo: "" })));
    await assertFails(addDoc(egresos, egreso(ANA, { empleadoId: BETO })));
  });

  test("el empleado lista solo sus egresos filtrando por empleadoId", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await addDoc(collection(fs, "egresos"), egreso(ANA));
    await assertSucceeds(getDocs(query(collection(fs, "egresos"), where("empleadoId", "==", ANA))));
    await assertFails(getDocs(collection(fs, "egresos")));
  });
});
