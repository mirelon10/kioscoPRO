import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { redondear, parsearMonto, calcularPrecioVenta } from "../../public/js/lib/dinero.js";
import { fechaLocalISO, inicioDelDia, finDelDia, aDate } from "../../public/js/lib/fechas.js";
import { armarVenta, normalizarVenta } from "../../public/js/core/ventas.js";
import { ErrorNegocio, mensajeDeError } from "../../public/js/core/errores.js";
import { construirProducto, normalizarProducto, buscarExacto, buscarCoincidencias } from "../../public/js/core/productos.js";
import { calcularResumen, empleadosDeTurnos } from "../../public/js/core/resumen.js";
import { calcularCajaTurno, calcularVuelto } from "../../public/js/core/caja.js";
import { armarExcelResumen } from "../../public/js/core/exportacion.js";

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

  test("totaliza por método e incluye la SUBE en el efectivo sin contarla dos veces", () => {
    const r = calcularResumen({ turnos, ventas, egresos, desde, hasta });
    assert.equal(r.porMetodo["Efectivo"], 2200);
    assert.equal(r.porMetodo["Tarjeta"], 2000);
    assert.equal(r.sube, 700);
    assert.equal(r.totalVentas, 4200);
    assert.equal(r.totalEgresos, 300);
    assert.equal(r.neto, 3900);
  });

  test("calcula la diferencia de caja solo en turnos cerrados", () => {
    const [t1, t2] = calcularResumen({ turnos, ventas, egresos, desde, hasta }).turnos;
    // esperado = 1000 inicial + 2200 efectivo - 300 egresos = 2900
    assert.equal(t1.esperado, 2900);
    assert.equal(t1.diferencia, 0);
    assert.equal(t2.diferencia, null);
    assert.equal(t2.cajaFinal, null);
  });

  test("filtra por empleado", () => {
    const r = calcularResumen({ turnos, ventas, egresos, desde, hasta, empleadoId: "e2" });
    assert.equal(r.totalVentas, 2000);
    assert.equal(r.totalEgresos, 0);
    assert.equal(r.turnos.length, 1);
  });

  test("las ventas fuera del rango no suman a los totales pero sí a la caja de su turno", () => {
    const tarde = { turnoId: "t1", empleadoId: "e1", tipo: "productos", metodoPago: "Efectivo", total: 50, timestamp: { toDate: () => new Date(2026, 9, 2, 0, 30) } };
    const r = calcularResumen({ turnos, ventas: [...ventas, tarde], egresos, desde, hasta });
    assert.equal(r.porMetodo["Efectivo"], 2200);
    assert.equal(r.turnos[0].efectivo, 2250);
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
  test("caja inicial + efectivo (incluida SUBE vieja) − egresos; MP y tarjeta van aparte", () => {
    const caja = calcularCajaTurno({
      cajaInicial: 1000,
      ventas: [
        { metodoPago: "Efectivo", total: 1500.1 },
        { metodoPago: "Sube", total: 200.2 }, // formato viejo: efectivo
        { metodoPago: "Tarjeta", total: 999 },
        { tipo: "sube", metodoPago: "Mercado Pago", total: 500 },
      ],
      egresos: [{ monto: 300 }, { monto: "50" }],
    });
    assert.deepEqual(caja, { cajaInicial: 1000, efectivo: 1700.3, otrosMedios: 1499, egresos: 350, esperado: 2350.3, cantidadVentas: 4 });
  });

  test("turno sin movimientos: lo esperado es la caja inicial", () => {
    assert.equal(calcularCajaTurno({ cajaInicial: 500, ventas: [], egresos: [] }).esperado, 500);
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

describe("armarExcelResumen", () => {
  const desde = new Date(2026, 9, 1);
  const hasta = new Date(2026, 9, 2, 23, 59);
  const resumen = {
    porMetodo: { Efectivo: 2600, "Mercado Pago": 500, Tarjeta: 0 },
    sube: 500,
    totalVentas: 3100,
    totalEgresos: 301,
    neto: 2799,
    turnos: [
      { empleado: "ana@k.com", abierto: false, apertura: desde, cierre: hasta, cerradoPor: "admin@k.com", cajaInicial: 1000, efectivo: 2600, egresos: 301, esperado: 3299, cajaFinal: 3290, diferencia: -9 },
      { empleado: "beto@k.com", abierto: true, apertura: desde, cierre: null, cerradoPor: null, cajaInicial: 0, efectivo: 0, egresos: 0, esperado: 0, cajaFinal: null, diferencia: null },
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
    assert.deepEqual(turnos.filas[1].slice(3), ["Cerrado", 1000, 2600, 301, 3299, 3290, -9, "admin@k.com"]);
    assert.deepEqual(turnos.filas[2].slice(2, 4), ["", "Abierto"]);
    assert.deepEqual(egresos.filas[1], [desde, "ana@k.com", "Proveedor", 301]);
  });
});

describe("mensajeDeError con Cloud Functions", () => {
  test("muestra el mensaje del servidor y oculta los errores de conexión", () => {
    assert.equal(mensajeDeError({ code: "functions/failed-precondition", message: "Stock insuficiente de Agua (quedan 0)." }), "Stock insuficiente de Agua (quedan 0).");
    assert.match(mensajeDeError({ code: "functions/internal", message: "internal" }), /conectar/);
    assert.match(mensajeDeError({ code: "functions/unavailable", message: "x" }), /conectar/);
  });
});
