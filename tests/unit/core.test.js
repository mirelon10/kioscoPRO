import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { redondear, parsearMonto, calcularPrecioVenta, aCentavos } from "../../public/js/lib/dinero.js";
import { fechaLocalISO, inicioDelDia, finDelDia, aDate } from "../../public/js/lib/fechas.js";
import { armarVenta, normalizarVenta, productoIdsDe } from "../../public/js/core/ventas.js";
import { ErrorNegocio, mensajeDeError } from "../../public/js/core/errores.js";
import { construirProducto, normalizarProducto, buscarExacto, buscarCoincidencias, calcularAjusteStock } from "../../public/js/core/productos.js";
import { calcularResumen, empleadosDeTurnos } from "../../public/js/core/resumen.js";
import { armarCobro, cajaDesdeResumen, calcularCajaTurno, calcularVuelto, resumenDeCaja } from "../../public/js/core/caja.js";
import { conLimiteDeTiempo, esErrorDeConexion, TiempoAgotado } from "../../public/js/lib/espera.js";
import { armarExcelResumen } from "../../public/js/core/exportacion.js";
import { normalizarEgreso, totalizarEgresos, etiquetaTipoEgreso } from "../../public/js/core/egresos.js";
import { revisarVentas } from "../../public/js/core/auditoria.js";
import { validarAlta, generarClave, validarClaveNueva } from "../../public/js/core/usuarios.js";

describe("dinero", () => {
  test("redondea a centavos sin errores de punto flotante", () => {
    assert.equal(redondear(0.1 + 0.2), 0.3);
    assert.equal(redondear(1.005), 1.01);
  });

  test("parsea montos con coma o punto y rechaza basura", () => {
    assert.equal(parsearMonto("1500,50"), 1500.5);
    assert.equal(parsearMonto(" 20.333 "), 20.33);
    assert.ok(Number.isNaN(parsearMonto("")));
    assert.ok(Number.isNaN(parsearMonto("abc")));
  });

  test("calcula el precio de venta con margen", () => {
    assert.equal(calcularPrecioVenta(1000, 35), 1350);
    assert.equal(calcularPrecioVenta("", ""), 0);
  });
});

describe("fechas", () => {
  test("usa la fecha local, no UTC (22:30 en Argentina sigue siendo hoy)", () => {
    const nocheLocal = new Date(2026, 9, 1, 22, 30);
    assert.equal(fechaLocalISO(nocheLocal), "2026-10-01");
  });

  test("arma el rango completo del día en hora local", () => {
    assert.deepEqual(inicioDelDia("2026-10-01"), new Date(2026, 9, 1, 0, 0, 0, 0));
    assert.deepEqual(finDelDia("2026-10-01"), new Date(2026, 9, 1, 23, 59, 59, 999));
  });

  test("convierte Timestamps de Firestore, strings y valores inválidos", () => {
    const fecha = new Date(2026, 0, 1);
    assert.deepEqual(aDate({ toDate: () => fecha }), fecha);
    assert.deepEqual(aDate(fecha.toISOString()), fecha);
    assert.equal(aDate("no es fecha"), null);
    assert.equal(aDate(null), null);
  });
});

describe("armarVenta", () => {
  const coca = { nombre: "Coca 500", precio: 1200.5, stock: 3 };
  const alfajor = { nombre: "Alfajor", precio: 800, stock: 10 };

  test("usa los precios de la base, calcula el total y el stock nuevo", () => {
    const r = armarVenta(
      [
        { productoId: "c", cantidad: 2 },
        { productoId: "a", cantidad: 1 },
      ],
      [coca, alfajor],
    );
    assert.equal(r.total, 3201);
    assert.deepEqual(r.nuevosStocks, [1, 9]);
    assert.equal(r.lineas[0].subtotal, 2401);
  });

  test("rechaza vender más que el stock", () => {
    assert.throws(() => armarVenta([{ productoId: "c", cantidad: 4 }], [coca]), ErrorNegocio);
  });

  test("rechaza productos borrados, cantidades inválidas y carrito vacío", () => {
    assert.throws(() => armarVenta([{ productoId: "x", cantidad: 1 }], [null]), /ya no existe/);
    assert.throws(() => armarVenta([{ productoId: "c", cantidad: 0 }], [coca]), /Cantidad inválida/);
    assert.throws(() => armarVenta([{ productoId: "c", cantidad: 1.5 }], [coca]), /Cantidad inválida/);
    assert.throws(() => armarVenta([], []), /vacío/);
  });
});

describe("normalizarVenta", () => {
  test("convierte las recargas SUBE viejas en ventas en efectivo de tipo sube", () => {
    const v = normalizarVenta({ metodoPago: "Sube", total: 500 });
    assert.equal(v.tipo, "sube");
    assert.equal(v.metodoPago, "Efectivo");
  });

  test("unifica el nombre viejo de Mercado Pago", () => {
    assert.equal(normalizarVenta({ metodoPago: "Mercadopago", total: 1 }).metodoPago, "Mercado Pago");
  });
});

describe("productos", () => {
  test("normaliza el campo viejo codigoBarra", () => {
    const p = normalizarProducto("id1", { codigoBarra: "779", nombre: "Agua", precio: 500, stock: 4 });
    assert.equal(p.codigo, "779");
  });

  test("construye un producto válido calculando el precio", () => {
    const { producto, error } = construirProducto({
      codigo: " 779 ",
      nombre: " Agua ",
      categoria: "",
      precioCompra: "400",
      margen: "50",
      stock: "12",
    });
    assert.equal(error, undefined);
    assert.deepEqual(producto, { codigo: "779", nombre: "Agua", categoria: "", precioCompra: 400, margen: 50, precio: 600, stock: 12 });
  });

  test("valida nombre, montos y stock entero", () => {
    const base = { nombre: "X", precioCompra: "1", margen: "1", stock: "1" };
    assert.match(construirProducto({ ...base, nombre: " " }).error, /nombre/);
    assert.match(construirProducto({ ...base, precioCompra: "-1" }).error, /compra/);
    assert.match(construirProducto({ ...base, stock: "1.5" }).error, /stock/);
    assert.match(construirProducto({ ...base, stock: "" }).error, /stock/);
  });

  test("busca por código exacto antes que por nombre", () => {
    const lista = [normalizarProducto("1", { nombre: "123", codigo: "" }), normalizarProducto("2", { nombre: "Agua", codigo: "123" })];
    assert.equal(buscarExacto(lista, "123").id, "2");
    assert.equal(buscarCoincidencias(lista, "agu").length, 1);
  });
});

describe("calcularAjusteStock", () => {
  test("ingreso suma, baja resta y conteo fija el número contado", () => {
    assert.deepEqual(calcularAjusteStock(10, "ingreso", "24"), { cambio: 24, stock: 34 });
    assert.deepEqual(calcularAjusteStock(10, "baja", 3), { cambio: -3, stock: 7 });
    assert.deepEqual(calcularAjusteStock(10, "conteo", "8"), { cambio: -2, stock: 8 });
    assert.deepEqual(calcularAjusteStock(10, "conteo", "0"), { cambio: -10, stock: 0 });
  });

  test("rechaza cantidades inválidas, stock negativo y ajustes que no cambian nada", () => {
    assert.match(calcularAjusteStock(10, "ingreso", "").error, /entero/);
    assert.match(calcularAjusteStock(10, "ingreso", "1.5").error, /entero/);
    assert.match(calcularAjusteStock(10, "ingreso", "-2").error, /entero/);
    assert.match(calcularAjusteStock(10, "ingreso", "0").error, /mayor a 0/);
    assert.match(calcularAjusteStock(3, "baja", "5").error, /hay 3/);
    assert.match(calcularAjusteStock(10, "conteo", "10").error, /nada que ajustar/);
    assert.match(calcularAjusteStock(10, "otro", "1").error, /tipo/);
  });
});

describe("calcularResumen", () => {
  const desde = new Date(2026, 9, 1, 0, 0);
  const hasta = new Date(2026, 9, 1, 23, 59, 59, 999);
  const ts = (h) => ({ toDate: () => new Date(2026, 9, 1, h) });

  const turnos = [
    { id: "t1", empleadoId: "e1", empleadoNombre: "ana@k.com", cajaInicial: 1000, estado: "cerrado", cajaFinal: 2900, fechaApertura: ts(8), fechaCierre: ts(14) },
    { id: "t2", empleadoId: "e2", empleadoNombre: "beto@k.com", cajaInicial: 500, estado: "abierto", fechaApertura: ts(14) },
  ];
  const ventas = [
    { turnoId: "t1", empleadoId: "e1", tipo: "productos", metodoPago: "Efectivo", total: 1500, timestamp: ts(9) },
    { turnoId: "t1", empleadoId: "e1", tipo: "sube", metodoPago: "Efectivo", total: 600, timestamp: ts(10) },
    { turnoId: "t1", empleadoId: "e1", metodoPago: "Sube", total: 100, timestamp: ts(11) }, // formato viejo
    { turnoId: "t2", empleadoId: "e2", tipo: "productos", metodoPago: "Tarjeta", total: 2000, timestamp: ts(15) },
  ];
  const egresos = [{ turnoId: "t1", empleadoId: "e1", monto: 300, motivo: "Proveedor", fecha: ts(12) }];
  const guardados = [{ turnoId: "t1", empleadoId: "e1", monto: 400, fecha: ts(13) }];

  test("totaliza por método sin la SUBE, que va aparte y suma al total sin contarse dos veces", () => {
    const r = calcularResumen({ turnos, ventas, egresos, guardados, desde, hasta });
    assert.equal(r.porMetodo["Efectivo"], 1500);
    assert.equal(r.porMetodo["Tarjeta"], 2000);
    assert.equal(r.sube, 700);
    assert.equal(r.totalVentas, 4200);
    assert.equal(r.totalEgresos, 300);
    assert.equal(r.totalGuardado, 400);
    assert.equal(r.neto, 3900);
  });

  test("cada turno muestra su cierre: ventas + SUBE − caja inicial − egresos − guardado", () => {
    const [t1, t2] = calcularResumen({ turnos, ventas, egresos, guardados, desde, hasta }).turnos;
    // t1: (1500 + 700 SUBE) − 1000 inicial − 300 egresos − 400 guardado = 500
    assert.equal(t1.efectivo, 1500);
    assert.equal(t1.sube, 700);
    assert.equal(t1.totalVentas, 2200);
    assert.equal(t1.guardado, 400);
    assert.equal(t1.total, 500);
    // t2: 2000 tarjeta − 500 inicial = 1500
    assert.equal(t2.tarjeta, 2000);
    assert.equal(t2.mercadoPago, 0);
    assert.equal(t2.total, 1500);
  });

  test("filtra por empleado", () => {
    const r = calcularResumen({ turnos, ventas, egresos, desde, hasta, empleadoId: "e2" });
    assert.equal(r.totalVentas, 2000);
    assert.equal(r.totalEgresos, 0);
    assert.equal(r.turnos.length, 1);
  });

  test("un turno suma completo al período en que se abrió, aunque pase la medianoche", () => {
    const tarde = { turnoId: "t1", empleadoId: "e1", tipo: "productos", metodoPago: "Efectivo", total: 50, timestamp: { toDate: () => new Date(2026, 9, 2, 0, 30) } };
    const r = calcularResumen({ turnos, ventas: [...ventas, tarde], egresos, desde, hasta });
    assert.equal(r.porMetodo["Efectivo"], 1550);
    assert.equal(r.turnos[0].efectivo, 1550);
  });

  test("un turno cerrado con resumen guardado no necesita sus ventas", () => {
    const caja = calcularCajaTurno({ cajaInicial: 1000, ventas: ventas.filter((v) => v.turnoId === "t1"), egresos, guardados });
    const conResumen = [{ ...turnos[0], resumen: resumenDeCaja(caja) }, turnos[1]];
    const r = calcularResumen({ turnos: conResumen, ventas: ventas.filter((v) => v.turnoId === "t2"), egresos, guardados, desde, hasta });
    // La caja de cada fila se compara sin efectivoEnCaja, que no va en el resumen (es cajaFinal).
    const sinCaja = ({ turnos, ...resto }) => ({ ...resto, turnos: turnos.map(({ caja, ...fila }) => fila) });
    assert.deepEqual(sinCaja(r), sinCaja(calcularResumen({ turnos, ventas, egresos, guardados, desde, hasta })));
  });

  test("un turno sin resumen ni ventas cargadas queda pendiente y no suma a los totales", () => {
    const r = calcularResumen({ turnos, ventas: [], egresos, guardados, desde, hasta, turnosCalculados: new Set() });
    assert.equal(r.turnosPendientes, 2);
    assert.equal(r.totalVentas, 0);
    assert.equal(r.totalEgresos, 0); // los egresos del turno pendiente tampoco
    assert.equal(r.turnos[0].pendiente, true);
    assert.equal(r.turnos[0].total, null);

    const t2 = calcularResumen({ turnos, ventas, egresos, guardados, desde, hasta, turnosCalculados: new Set(["t2"]) });
    assert.equal(t2.turnosPendientes, 1);
    assert.equal(t2.totalVentas, 2000);
  });

  test("lista empleados únicos ordenados", () => {
    assert.deepEqual(empleadosDeTurnos([...turnos, turnos[0]]), [
      { id: "e1", nombre: "ana@k.com" },
      { id: "e2", nombre: "beto@k.com" },
    ]);
  });
});

describe("mensajeDeError", () => {
  test("traduce errores de Firebase y deja pasar los de negocio", () => {
    assert.match(mensajeDeError({ code: "permission-denied" }), /permisos/);
    assert.equal(mensajeDeError(new ErrorNegocio("Sin stock")), "Sin stock");
    assert.equal(mensajeDeError(new Error("x"), "Por defecto"), "Por defecto");
  });
});

describe("calcularCajaTurno", () => {
  test("ventas por método + SUBE − caja inicial − egresos − guardado = total", () => {
    const caja = calcularCajaTurno({
      cajaInicial: 1000,
      ventas: [
        { metodoPago: "Efectivo", total: 1500.1 },
        { metodoPago: "Sube", total: 200.2 }, // formato viejo: efectivo
        { metodoPago: "Tarjeta", total: 999 },
        { tipo: "sube", metodoPago: "Mercado Pago", total: 500 },
      ],
      egresos: [{ monto: 300 }, { monto: "50" }],
      guardados: [{ monto: 1000 }],
    });
    assert.deepEqual(caja, {
      porMetodo: { Efectivo: 1500.1, "Mercado Pago": 0, Tarjeta: 999 },
      sube: 700.2,
      totalVentas: 3199.3,
      cajaInicial: 1000,
      egresos: 350,
      guardado: 1000,
      total: 849.3, // 3199,3 − 1000 − 350 − 1000
      efectivoEnCaja: 1350.3, // 1000 + 1500,1 + 200,2 (SUBE en efectivo) − 350 − 1000
      cantidadVentas: 4,
    });
  });

  test("el resumen guardado al cerrar reconstruye la misma caja (salvo el efectivo en el cajón, que va en cajaFinal)", () => {
    const caja = calcularCajaTurno({
      cajaInicial: 1000,
      ventas: [{ metodoPago: "Efectivo", total: 1500.1 }, { tipo: "sube", metodoPago: "Mercado Pago", total: 500 }],
      egresos: [{ monto: 300 }],
      guardados: [{ monto: 100 }],
    });
    const { efectivoEnCaja, ...resto } = caja;
    assert.deepEqual(cajaDesdeResumen(1000, resumenDeCaja(caja)), resto);
    assert.deepEqual(Object.keys(resumenDeCaja(caja)).sort(), [
      "cantidadVentas", "efectivo", "egresos", "guardado", "mercadoPago", "sube", "tarjeta", "total", "totalVentas",
    ]);
  });

  test("turno sin movimientos: el total es menos la caja inicial y en el cajón queda la inicial", () => {
    const caja = calcularCajaTurno({ cajaInicial: 500, ventas: [], egresos: [] });
    assert.equal(caja.total, -500);
    assert.equal(caja.efectivoEnCaja, 500);
    assert.equal(caja.guardado, 0);
    assert.equal(caja.totalVentas, 0);
    assert.deepEqual(caja.porMetodo, { Efectivo: 0, "Mercado Pago": 0, Tarjeta: 0 });
  });
});

describe("calcularVuelto", () => {
  test("calcula el vuelto en centavos exactos", () => {
    assert.deepEqual(calcularVuelto(2600.3, 3000), { vuelto: 399.7, falta: 0 });
    assert.deepEqual(calcularVuelto(100, 100), { vuelto: 0, falta: 0 });
  });

  test("informa cuánto falta si no alcanza, y nada si no hay monto", () => {
    assert.deepEqual(calcularVuelto(2600, 2000), { vuelto: null, falta: 600 });
    assert.deepEqual(calcularVuelto(100, NaN), { vuelto: null, falta: null });
  });
});

describe("armarCobro", () => {
  const alfajor = { nombre: "Alfajor", precio: 800, stock: 10 };
  const carrito = [{ productoId: "a", cantidad: 2 }];

  test("en efectivo calcula el vuelto sobre el total real", () => {
    const r = armarCobro(carrito, [alfajor], "Efectivo", 2000);
    assert.equal(r.total, 1600);
    assert.equal(r.vuelto, 400);
    assert.deepEqual(r.nuevosStocks, [8]);
  });

  test("en efectivo rechaza el pago que no alcanza o falta", () => {
    assert.throws(() => armarCobro(carrito, [alfajor], "Efectivo", 1500), /faltan/);
    assert.throws(() => armarCobro(carrito, [alfajor], "Efectivo", null), /no alcanza/);
  });

  test("con otros medios no hay vuelto", () => {
    assert.equal(armarCobro(carrito, [alfajor], "Tarjeta", null).vuelto, null);
  });
});

describe("espera", () => {
  test("conLimiteDeTiempo devuelve el resultado si llega a tiempo", async () => {
    assert.equal(await conLimiteDeTiempo(Promise.resolve(5), 50), 5);
  });

  test("conLimiteDeTiempo rechaza con TiempoAgotado si tarda demasiado", async () => {
    const lenta = new Promise((resolver) => setTimeout(resolver, 200));
    await assert.rejects(conLimiteDeTiempo(lenta, 10), TiempoAgotado);
  });

  test("conLimiteDeTiempo deja pasar el error original", async () => {
    await assert.rejects(conLimiteDeTiempo(Promise.reject(new ErrorNegocio("x")), 50), ErrorNegocio);
  });

  test("distingue errores de conexión de los de permisos o datos", () => {
    assert.ok(esErrorDeConexion({ code: "unavailable" }));
    assert.ok(esErrorDeConexion(new TiempoAgotado()));
    assert.ok(!esErrorDeConexion({ code: "permission-denied" }));
    assert.ok(!esErrorDeConexion(new ErrorNegocio("Stock insuficiente")));
  });
});

describe("armarExcelResumen", () => {
  const desde = new Date(2026, 9, 1);
  const hasta = new Date(2026, 9, 2, 23, 59);
  const resumen = {
    porMetodo: { Efectivo: 2100, "Mercado Pago": 500, Tarjeta: 0 },
    sube: 500,
    totalVentas: 3100,
    totalEgresos: 301,
    egresosTotales: { total: 301, fijos: 200, variables: 101, sinClasificar: 0, desdeCaja: 301, desdeGuardado: 0 },
    totalGuardado: 200,
    neto: 2799,
    turnos: [
      { empleado: "ana@k.com", abierto: false, apertura: desde, cierre: hasta, cerradoPor: "admin@k.com", cajaInicial: 1000, efectivo: 2100, mercadoPago: 500, tarjeta: 0, sube: 500, totalVentas: 3100, egresos: 301, guardado: 200, total: 1599 },
      { empleado: "beto@k.com", abierto: true, apertura: desde, cierre: null, cerradoPor: null, cajaInicial: 0, efectivo: 0, mercadoPago: 0, tarjeta: 0, sube: 0, totalVentas: 0, egresos: 0, guardado: 0, total: 0 },
    ],
    egresos: [{ fecha: { toDate: () => desde }, empleadoNombre: "ana@k.com", motivo: "Proveedor", monto: 301 }],
  };

  test("nombra el archivo con el período y arma las tres hojas", () => {
    const { nombreArchivo, hojas } = armarExcelResumen(resumen, { desde, hasta });
    assert.equal(nombreArchivo, "resumen-caja_2026-10-01_a_2026-10-02.xlsx");
    assert.deepEqual(hojas.map((h) => h.nombre), ["Resumen", "Turnos", "Egresos"]);
  });

  test("las filas llevan números y fechas reales (no texto) para poder sumar en Excel", () => {
    const [res, turnos, egresos] = armarExcelResumen(resumen, { desde, hasta, empleado: "ana@k.com" }).hojas;
    assert.deepEqual(res.filas.find((f) => f[0] === "Neto (ventas − egresos)"), ["Neto (ventas − egresos)", 2799]);
    assert.deepEqual(res.filas[2], ["Empleado", "ana@k.com"]);
    assert.deepEqual(turnos.filas[1].slice(3), ["Cerrado", 1000, 2100, 500, 0, 500, 3100, 301, 200, 1599, "admin@k.com"]);
    assert.deepEqual(turnos.filas[2].slice(2, 4), ["", "Abierto"]);
    const pendiente = { ...resumen, turnos: [{ ...resumen.turnos[1], pendiente: true }] };
    assert.equal(armarExcelResumen(pendiente, { desde, hasta }).hojas[1].filas[1][3], "Abierto (sin calcular)");
    assert.deepEqual(egresos.filas[1], [desde, "ana@k.com", "Proveedor", "Sin clasificar", "Caja", 301]);
    assert.deepEqual(res.filas.find((f) => f[0] === "  Costos variables"), ["  Costos variables", 101]);
  });
});

describe("egresos: tipo y origen", () => {
  const lista = [
    { monto: 1000, tipo: "fijo", origen: "caja" },
    { monto: "250.5", tipo: "variable", origen: "guardado" },
    { monto: 100 }, // formato anterior: sin clasificar, pagado con la caja
  ];

  test("normaliza egresos viejos: sin clasificar y pagados con la caja", () => {
    const e = normalizarEgreso({ monto: "100", motivo: "x" });
    assert.equal(e.tipo, null);
    assert.equal(e.origen, "caja");
    assert.equal(e.monto, 100);
    assert.equal(etiquetaTipoEgreso(e.tipo), "Sin clasificar");
    assert.equal(etiquetaTipoEgreso("fijo"), "Costo fijo");
  });

  test("totaliza por tipo y por origen", () => {
    assert.deepEqual(totalizarEgresos(lista), {
      total: 1350.5,
      fijos: 1000,
      variables: 250.5,
      sinClasificar: 100,
      desdeCaja: 1100,
      desdeGuardado: 250.5,
    });
  });

  test("lo pagado con la caja de guardado no se resta del cierre del turno", () => {
    const caja = calcularCajaTurno({ cajaInicial: 1000, ventas: [{ metodoPago: "Efectivo", total: 3000 }], egresos: lista });
    assert.equal(caja.egresos, 1100);
    assert.equal(caja.total, 900); // 3000 − 1000 − 1100
    assert.equal(caja.efectivoEnCaja, 2900); // 1000 + 3000 − 1100
  });

  test("el resumen del admin suma todos los egresos de los turnos del período, con su detalle", () => {
    const ts = { toDate: () => new Date(2026, 9, 1, 12) };
    const r = calcularResumen({
      turnos: [{ id: "t1", empleadoId: "e1", cajaInicial: 0, estado: "cerrado", fechaApertura: ts }],
      ventas: [],
      egresos: lista.map((e) => ({ ...e, turnoId: "t1", empleadoId: "e1", fecha: ts })),
      desde: new Date(2026, 9, 1),
      hasta: new Date(2026, 9, 1, 23, 59),
    });
    assert.equal(r.totalEgresos, 1350.5);
    assert.equal(r.egresosTotales.desdeGuardado, 250.5);
    assert.equal(r.egresosTotales.fijos, 1000);
  });

  test("pasa a centavos enteros sin errores de punto flotante", () => {
    assert.equal(aCentavos(0.29), 29);
    assert.equal(aCentavos(1234.56), 123456);
    assert.equal(aCentavos(0.1 + 0.2), 30);
  });
});

describe("productoIdsDe", () => {
  test("lista cada producto del carrito una sola vez", () => {
    assert.deepEqual(productoIdsDe([{ productoId: "a" }, { productoId: "b" }, { productoId: "a" }]), ["a", "b"]);
  });
});

describe("revisarVentas", () => {
  const productos = [{ id: "p1", precioCompra: 400 }, { id: "p2", precioCompra: 0 }];
  const ventaOk = (extra = {}) => ({
    id: "v1",
    items: [
      { productoId: "p1", nombre: "Agua", precio: 600, cantidad: 2, subtotal: 1200 },
      { productoId: "p2", nombre: "Chicle", precio: 150.5, cantidad: 1, subtotal: 150.5 },
    ],
    productoIds: ["p1", "p2"],
    total: 1350.5,
    montoRecibido: 2000,
    vuelto: 649.5,
    ...extra,
  });

  test("una venta hecha por la app no se marca", () => {
    assert.deepEqual(revisarVentas([ventaOk()], productos), []);
    // Formato anterior: sin productoIds ni pago en efectivo.
    assert.deepEqual(revisarVentas([ventaOk({ productoIds: undefined, montoRecibido: null, vuelto: null })], productos), []);
  });

  test("marca un total menor a la suma de los productos", () => {
    const [r] = revisarVentas([ventaOk({ total: 100, vuelto: 1900 })], productos);
    assert.equal(r.venta.id, "v1");
    assert.match(r.problemas.join(" "), /no coincide con la suma/);
  });

  test("marca subtotales, cantidades y vueltos que no dan", () => {
    const items = [{ productoId: "p1", nombre: "Agua", precio: 600, cantidad: 2, subtotal: 600 }];
    assert.match(revisarVentas([ventaOk({ items, productoIds: ["p1"], total: 600, vuelto: 1400 })], productos)[0].problemas.join(" "), /subtotal de Agua/);

    const cero = [{ productoId: "p1", nombre: "Agua", precio: 600, cantidad: 0, subtotal: 0 }];
    assert.match(revisarVentas([ventaOk({ items: cero, productoIds: ["p1"], total: 0, montoRecibido: null, vuelto: null })], productos)[0].problemas.join(" "), /Cantidad inválida/);

    assert.match(revisarVentas([ventaOk({ vuelto: 900 })], productos)[0].problemas.join(" "), /vuelto no da/);
  });

  test("marca precios por debajo del costo", () => {
    const items = [{ productoId: "p1", nombre: "Agua", precio: 1, cantidad: 1, subtotal: 1 }];
    const [r] = revisarVentas([ventaOk({ items, productoIds: ["p1"], total: 1, montoRecibido: null, vuelto: null })], productos);
    assert.match(r.problemas.join(" "), /debajo del costo/);
  });

  test("marca cuando el stock se descontó de otros productos", () => {
    const [r] = revisarVentas([ventaOk({ productoIds: ["p1"] })], productos);
    assert.match(r.problemas.join(" "), /no coinciden/);
  });
});

describe("usuarios", () => {
  test("valida el alta: email y rol con acceso", () => {
    assert.deepEqual(validarAlta({ email: "  Ana@Kiosco.com ", rol: "empleado" }), { email: "ana@kiosco.com", rol: "empleado" });
    assert.ok(validarAlta({ email: "ana", rol: "empleado" }).error);
    assert.ok(validarAlta({ email: "ana@kiosco.com", rol: "ninguno" }).error);
    assert.ok(validarAlta({ email: "ana@kiosco.com", rol: "dueño" }).error);
  });

  test("genera contraseñas temporales distintas, sin caracteres confusos", () => {
    const claves = new Set(Array.from({ length: 50 }, () => generarClave()));
    assert.equal(claves.size, 50);
    for (const clave of claves) assert.match(clave, /^[a-km-zA-HJ-NP-Z2-9]{10}$/);
  });

  test("valida la contraseña que reemplaza a la temporal", () => {
    assert.deepEqual(validarClaveNueva({ actual: "Temp2345ab", nueva: "miclave123", repetida: "miclave123" }), {
      actual: "Temp2345ab",
      nueva: "miclave123",
    });
    assert.ok(validarClaveNueva({ actual: "", nueva: "miclave123", repetida: "miclave123" }).error);
    assert.ok(validarClaveNueva({ actual: "Temp2345ab", nueva: "corta", repetida: "corta" }).error);
    assert.ok(validarClaveNueva({ actual: "Temp2345ab", nueva: "Temp2345ab", repetida: "Temp2345ab" }).error);
    assert.ok(validarClaveNueva({ actual: "Temp2345ab", nueva: "miclave123", repetida: "miclave124" }).error);
  });
});
