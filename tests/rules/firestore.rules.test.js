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
  increment,
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


/** Cierre como lo hace la app: actualiza el turno y libera el candado del empleado en un batch. */
function cerrarTurno(fs, cerrador, empleadoId, turnoId = `turno-${empleadoId}`, extra = {}) {
  const batch = writeBatch(fs);
  batch.update(doc(fs, "turnos", turnoId), {
    estado: "cerrado",
    cajaFinal: 1500,
    fechaCierre: serverTimestamp(),
    cerradoPor: cerrador,
    cerradoPorNombre: `${cerrador}@kiosco.test`,
    ...extra,
  });
  batch.delete(doc(fs, "turnosActivos", empleadoId));
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
  montoRecibido: 1000,
  vuelto: 400,
  timestamp: serverTimestamp(),
  ...extra,
});

const guardado = (uid, extra = {}) => ({
  turnoId: `turno-${uid}`,
  empleadoId: uid,
  empleadoNombre: `${uid}@kiosco.test`,
  monto: 5000,
  fecha: serverTimestamp(),
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

  test("el empleado puede subir y bajar el stock, pero nunca dejarlo negativo ni tocar otros campos", async () => {
    await sembrar({ "productos/p1": producto({ stock: 5 }) });
    const fs = comoAna();
    await assertSucceeds(updateDoc(doc(fs, "productos/p1"), { stock: 4 }));
    await assertSucceeds(updateDoc(doc(fs, "productos/p1"), { stock: 50 })); // ingreso de mercadería
    await assertSucceeds(updateDoc(doc(fs, "productos/p1"), { stock: increment(-10) })); // baja
    await assertSucceeds(updateDoc(doc(fs, "productos/p1"), { stock: 0 })); // conteo
    await assertFails(updateDoc(doc(fs, "productos/p1"), { stock: increment(-1) })); // quedaría negativo
    await assertFails(updateDoc(doc(fs, "productos/p1"), { stock: -1 }));
    await assertFails(updateDoc(doc(fs, "productos/p1"), { stock: 2.5 }));
    await assertFails(updateDoc(doc(fs, "productos/p1"), { stock: 3, precio: 1 }));
  });

  test("un usuario sin rol no puede tocar el stock", async () => {
    await sembrar({ "productos/p1": producto({ stock: 5 }) });
    await assertFails(updateDoc(doc(sinRol(), "productos/p1"), { stock: 6 }));
  });

  test("al editar, el admin puede borrar campos viejos como codigoBarra", async () => {
    await sembrar({ "productos/p1": { codigoBarra: "779", nombre: "Agua", precio: 600, stock: 5 } });
    await assertSucceeds(setDoc(doc(comoAdmin(), "productos/p1"), producto()));
  });
});

describe("turnos", () => {
  test("el empleado abre y cierra su turno", async () => {
    await assertSucceeds(abrirTurno(comoAna(), ANA));
    await assertSucceeds(cerrarTurno(comoAna(), ANA, ANA));
  });

  test("no se pueden tener dos turnos abiertos, pero sí abrir otro después de cerrar", async () => {
    const fs = comoAna();
    await assertSucceeds(abrirTurno(fs, ANA, "t1"));
    await assertFails(abrirTurno(fs, ANA, "t2"));
    await cerrarTurno(fs, ANA, ANA, "t1");
    await assertSucceeds(abrirTurno(fs, ANA, "t2"));
  });

  test("no se puede abrir un turno sin candado ni a nombre de otro", async () => {
    const fs = comoAna();
    await assertFails(
      setDoc(doc(fs, "turnos/t1"), { empleadoId: ANA, empleadoNombre: "a", cajaInicial: 0, estado: "abierto", fechaApertura: serverTimestamp() }),
    );
    await assertFails(abrirTurno(fs, BETO));
  });

  test("un empleado no puede cerrar el turno de otro; el admin sí", async () => {
    await abrirTurno(comoAna(), ANA);
    await assertFails(cerrarTurno(comoBeto(), BETO, ANA));
    await assertSucceeds(cerrarTurno(comoAdmin(), ADMIN, ANA));
  });

  test("al cerrar hay que liberar el candado, y no se puede liberar sin cerrar", async () => {
    await abrirTurno(comoAna(), ANA);
    await assertFails(
      updateDoc(doc(comoAna(), `turnos/turno-${ANA}`), {
        estado: "cerrado", cajaFinal: 10, fechaCierre: serverTimestamp(), cerradoPor: ANA, cerradoPorNombre: "a",
      }),
    );
    await assertFails(deleteDoc(doc(comoAna(), `turnosActivos/${ANA}`)));
    await assertFails(deleteDoc(doc(comoAdmin(), `turnosActivos/${ANA}`)));
  });

  test("no se puede falsificar quién cerró, la fecha ni agregar campos", async () => {
    await abrirTurno(comoAna(), ANA);
    const fs = comoAna();
    await assertFails(cerrarTurno(fs, ANA, ANA, undefined, { cerradoPor: ADMIN }));
    await assertFails(cerrarTurno(fs, ANA, ANA, undefined, { fechaCierre: new Date(2020, 0, 1) }));
    await assertFails(cerrarTurno(fs, ANA, ANA, undefined, { cajaFinal: -5 }));
    await assertFails(cerrarTurno(fs, ANA, ANA, undefined, { cajaEsperada: 1500 }));
    await assertFails(cerrarTurno(fs, ANA, ANA, undefined, { cajaInicial: 0 }));
  });

  test("sigue aceptando el cierre en el formato anterior (sin cerradoPor)", async () => {
    await abrirTurno(comoAna(), ANA);
    const fs = comoAna();
    const batch = writeBatch(fs);
    batch.update(doc(fs, `turnos/turno-${ANA}`), { estado: "cerrado", cajaFinal: 1500, fechaCierre: serverTimestamp() });
    batch.delete(doc(fs, `turnosActivos/${ANA}`));
    await assertSucceeds(batch.commit());
  });

  test("un turno cerrado no se reabre ni se modifica", async () => {
    await abrirTurno(comoAna(), ANA);
    await cerrarTurno(comoAna(), ANA, ANA);
    await assertFails(updateDoc(doc(comoAna(), `turnos/turno-${ANA}`), { cajaFinal: 99999 }));
    await assertFails(updateDoc(doc(comoAdmin(), `turnos/turno-${ANA}`), { estado: "abierto" }));
  });

  test("el admin puede cerrar un turno viejo que no tiene candado", async () => {
    await sembrar({ "turnos/viejo": { empleadoId: ANA, empleadoNombre: "a", cajaInicial: 0, estado: "abierto" } });
    const fs = comoAdmin();
    await assertSucceeds(
      updateDoc(doc(fs, "turnos/viejo"), {
        estado: "cerrado", cajaFinal: 0, fechaCierre: serverTimestamp(), cerradoPor: ADMIN, cerradoPorNombre: "admin",
      }),
    );
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

  test("el empleado solo ve sus turnos; el admin ve todos (y sus candados)", async () => {
    await abrirTurno(comoAna(), ANA);
    await assertSucceeds(getDoc(doc(comoAna(), `turnos/turno-${ANA}`)));
    await assertFails(getDoc(doc(comoBeto(), `turnos/turno-${ANA}`)));
    await assertFails(getDocs(collection(comoBeto(), "turnos")));
    await assertSucceeds(getDocs(collection(comoAdmin(), "turnos")));
    await assertSucceeds(getDoc(doc(comoAdmin(), `turnosActivos/${ANA}`)));
    await assertFails(getDoc(doc(comoBeto(), `turnosActivos/${ANA}`)));
  });
});

describe("ventas", () => {
  test("venta en efectivo con monto recibido y vuelto", async () => {
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

  test("venta sin conexión: venta + increment del stock en un batch, como la sube la app al reconectar", async () => {
    await sembrar({ "productos/p1": producto({ stock: 5 }) });
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const batch = writeBatch(fs);
    batch.update(doc(fs, "productos/p1"), { stock: increment(-2) });
    batch.set(doc(fs, "ventas/v-offline"), venta(ANA));
    await assertSucceeds(batch.commit());
  });

  test("venta sin conexión con stock agotado: el batch se rechaza, pero la venta sola entra", async () => {
    await sembrar({ "productos/p1": producto({ stock: 1 }) });
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const batch = writeBatch(fs);
    batch.update(doc(fs, "productos/p1"), { stock: increment(-2) });
    batch.set(doc(fs, "ventas/v-offline"), venta(ANA));
    await assertFails(batch.commit());
    await assertSucceeds(setDoc(doc(fs, "ventas/v-offline"), venta(ANA)));
  });

  test("una venta sin conexión que ya entró por la transacción no se duplica", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await assertSucceeds(setDoc(doc(fs, "ventas/v1"), venta(ANA)));
    await assertFails(setDoc(doc(fs, "ventas/v1"), venta(ANA)));
  });

  test("en efectivo el pago tiene que cubrir el total; en otros medios no hay pago ni vuelto", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const ventas = collection(fs, "ventas");
    await assertFails(addDoc(ventas, venta(ANA, { montoRecibido: 500, vuelto: 0 })));
    await assertFails(addDoc(ventas, venta(ANA, { montoRecibido: null })));
    await assertFails(addDoc(ventas, venta(ANA, { vuelto: -400 })));
    await assertFails(addDoc(ventas, venta(ANA, { metodoPago: "Tarjeta" })));
    await assertSucceeds(addDoc(ventas, venta(ANA, { metodoPago: "Tarjeta", montoRecibido: null, vuelto: null })));
  });

  test("sigue aceptando ventas en el formato anterior (sin monto recibido ni vuelto)", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const { montoRecibido, vuelto, ...formatoAnterior } = venta(ANA);
    await assertSucceeds(addDoc(collection(fs, "ventas"), formatoAnterior));
  });

  test("recarga SUBE con el método de pago elegido, sin vuelto", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const sube = { tipo: "sube", montoRecibido: null, vuelto: null };
    await assertSucceeds(addDoc(collection(fs, "ventas"), venta(ANA, { ...sube, metodoPago: "Efectivo" })));
    await assertSucceeds(addDoc(collection(fs, "ventas"), venta(ANA, { ...sube, metodoPago: "Mercado Pago" })));
  });

  test("sin turno abierto, con turno ajeno o cerrado no se vende", async () => {
    await assertFails(addDoc(collection(comoAna(), "ventas"), venta(ANA)));

    await abrirTurno(comoBeto(), BETO);
    await assertFails(addDoc(collection(comoAna(), "ventas"), venta(ANA, { turnoId: `turno-${BETO}` })));

    await abrirTurno(comoAna(), ANA);
    await cerrarTurno(comoAna(), ANA, ANA);
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

  test("las ventas son inmutables", async () => {
    await sembrar({ "ventas/v1": venta(ANA, { timestamp: new Date() }) });
    await assertFails(updateDoc(doc(comoAna(), "ventas/v1"), { total: 1 }));
    await assertFails(deleteDoc(doc(comoAna(), "ventas/v1")));
    await assertFails(deleteDoc(doc(comoAdmin(), "ventas/v1")));
  });

  test("el empleado solo lee sus ventas; el admin, todas", async () => {
    await sembrar({ "ventas/v1": venta(ANA, { timestamp: new Date() }) });
    await assertSucceeds(getDoc(doc(comoAna(), "ventas/v1")));
    await assertFails(getDoc(doc(comoBeto(), "ventas/v1")));
    await assertSucceeds(getDocs(collection(comoAdmin(), "ventas")));
  });

  test("el empleado consulta las ventas de su turno (para calcular la caja)", async () => {
    await sembrar({ "ventas/v1": venta(ANA, { timestamp: new Date() }) });
    const ventas = collection(comoAna(), "ventas");
    await assertSucceeds(getDocs(query(ventas, where("turnoId", "==", `turno-${ANA}`), where("empleadoId", "==", ANA))));
    // Sin filtrar por su empleadoId la consulta podría devolver ventas ajenas: se rechaza.
    await assertFails(getDocs(query(ventas, where("turnoId", "==", `turno-${ANA}`))));
  });
});

describe("egresos", () => {
  test("se registra un egreso válido con turno abierto", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await assertSucceeds(addDoc(collection(fs, "egresos"), egreso(ANA)));
  });

  test("rechaza egresos inválidos, sin turno o con el turno ya cerrado", async () => {
    await assertFails(addDoc(collection(comoAna(), "egresos"), egreso(ANA)));
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const egresos = collection(fs, "egresos");
    await assertFails(addDoc(egresos, egreso(ANA, { monto: 0 })));
    await assertFails(addDoc(egresos, egreso(ANA, { motivo: "" })));
    await assertFails(addDoc(egresos, egreso(ANA, { empleadoId: BETO })));
    await cerrarTurno(fs, ANA, ANA);
    await assertFails(addDoc(egresos, egreso(ANA)));
  });

  test("el empleado ve los egresos de su turno pero no puede buscar los de todos", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await addDoc(collection(fs, "egresos"), egreso(ANA));
    const egresos = collection(fs, "egresos");
    await assertSucceeds(getDocs(query(egresos, where("turnoId", "==", `turno-${ANA}`), where("empleadoId", "==", ANA))));
    await assertFails(getDocs(egresos));
    await assertSucceeds(getDocs(collection(comoAdmin(), "egresos")));
  });
});

describe("caja de guardado", () => {
  const SALDO = "cajaGuardado/saldo";
  const saldo = (centavos, movColeccion, movId) => ({ saldoCentavos: centavos, movColeccion, movId, actualizado: serverTimestamp() });

  /** Como la app: el movimiento y el saldo en el mismo batch. */
  function conSaldo(fs, ruta, datos, saldoCentavos) {
    const [coleccion, id] = ruta.split("/");
    const batch = writeBatch(fs);
    batch.set(doc(fs, ruta), datos);
    batch.set(doc(fs, SALDO), saldo(saldoCentavos, coleccion, id));
    return batch.commit();
  }
  const egresoGuardado = (uid, extra = {}) => egreso(uid, { tipo: "fijo", origen: "guardado", monto: 2000, motivo: "Alquiler", ...extra });

  test("guardar efectivo suma al saldo en la misma transacción", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await assertSucceeds(conSaldo(fs, "guardados/g1", guardado(ANA), 500000));
    await assertSucceeds(conSaldo(fs, "guardados/g2", guardado(ANA, { monto: 100.1 }), 510010));
    await assertSucceeds(getDoc(doc(comoBeto(), SALDO))); // todo el personal ve el saldo
    await assertFails(getDoc(doc(sinRol(), SALDO)));
  });

  test("un guardado sin mover el saldo, con un monto distinto o repetido se rechaza", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await assertFails(setDoc(doc(fs, "guardados/g1"), guardado(ANA)));
    await assertFails(conSaldo(fs, "guardados/g1", guardado(ANA), 999999));
    await assertSucceeds(conSaldo(fs, "guardados/g1", guardado(ANA), 500000));
    // Volver a usar un guardado que ya existía para inflar el saldo.
    await assertFails(setDoc(doc(fs, SALDO), saldo(1000000, "guardados", "g1")));
    await assertFails(setDoc(doc(fs, SALDO), saldo(0, "egresos", "inventado")));
    await assertFails(deleteDoc(doc(fs, SALDO)));
  });

  test("rechaza guardados inválidos, ajenos, sin turno o con el turno cerrado", async () => {
    await assertFails(conSaldo(comoAna(), "guardados/g0", guardado(ANA), 500000));
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await assertFails(conSaldo(fs, "guardados/g1", guardado(ANA, { monto: 0 }), 0));
    await assertFails(conSaldo(fs, "guardados/g2", guardado(ANA, { empleadoId: BETO }), 500000));
    await assertFails(conSaldo(fs, "guardados/g3", guardado(ANA, { nota: "extra" }), 500000));
    await cerrarTurno(fs, ANA, ANA);
    await assertFails(conSaldo(fs, "guardados/g4", guardado(ANA), 500000));
  });

  test("pagar un egreso con la caja de guardado descuenta el saldo y nunca lo deja negativo", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await conSaldo(fs, "guardados/g1", guardado(ANA), 500000); // $5.000
    await assertSucceeds(conSaldo(fs, "egresos/e1", egresoGuardado(ANA), 300000)); // − $2.000
    await assertFails(conSaldo(fs, "egresos/e2", egresoGuardado(ANA, { monto: 4000 }), -100000)); // no alcanza
    await assertFails(conSaldo(fs, "egresos/e3", egresoGuardado(ANA), 300000)); // no descuenta
    await assertFails(setDoc(doc(fs, "egresos/e4"), egresoGuardado(ANA))); // sin tocar el saldo
    await assertSucceeds(conSaldo(fs, "egresos/e5", egresoGuardado(ANA, { monto: 3000 }), 0)); // vacía la caja
  });

  test("egresos clasificados como costo fijo o variable", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    const egresos = collection(fs, "egresos");
    await assertSucceeds(addDoc(egresos, egreso(ANA, { tipo: "variable", origen: "caja" })));
    await assertSucceeds(addDoc(egresos, egreso(ANA, { tipo: "fijo" })));
    await assertSucceeds(addDoc(egresos, egreso(ANA))); // formato anterior
    await assertFails(addDoc(egresos, egreso(ANA, { tipo: "otro" })));
    await assertFails(addDoc(egresos, egreso(ANA, { origen: "banco" })));
  });

  test("solo el admin ajusta el saldo, y queda registrado con el saldo anterior real", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await conSaldo(fs, "guardados/g1", guardado(ANA), 500000);

    const ajuste = (uid, anterior, nuevo) => ({
      saldoAnteriorCentavos: anterior,
      saldoNuevoCentavos: nuevo,
      motivo: "Retiro del dueño",
      adminId: uid,
      adminNombre: `${uid}@kiosco.test`,
      fecha: serverTimestamp(),
    });
    await assertFails(conSaldo(comoAna(), "ajustesGuardado/a1", ajuste(ANA, 500000, 0), 0));
    await assertFails(conSaldo(comoAdmin(), "ajustesGuardado/a2", ajuste(ADMIN, 123, 0), 0)); // anterior falso
    await assertSucceeds(conSaldo(comoAdmin(), "ajustesGuardado/a3", ajuste(ADMIN, 500000, 100000), 100000));
    await assertSucceeds(getDoc(doc(comoAdmin(), "ajustesGuardado/a3")));
    await assertFails(getDoc(doc(comoAna(), "ajustesGuardado/a3")));
  });

  test("los guardados son inmutables y cada empleado ve solo los suyos", async () => {
    const fs = comoAna();
    await abrirTurno(fs, ANA);
    await conSaldo(fs, "guardados/g1", guardado(ANA), 500000);
    const ref = doc(fs, "guardados/g1");
    await assertFails(updateDoc(ref, { monto: 1 }));
    await assertFails(deleteDoc(ref));
    const guardados = collection(fs, "guardados");
    await assertSucceeds(getDocs(query(guardados, where("turnoId", "==", `turno-${ANA}`), where("empleadoId", "==", ANA))));
    await assertFails(getDocs(guardados));
    await assertFails(getDocs(query(collection(comoBeto(), "guardados"), where("empleadoId", "==", ANA))));
    await assertSucceeds(getDocs(collection(comoAdmin(), "guardados")));
  });
});
