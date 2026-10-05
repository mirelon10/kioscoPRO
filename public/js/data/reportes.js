import { db, collection, getDocs, getCountFromServer, query, where, orderBy } from "../firebase.js";
import { aDate } from "../lib/fechas.js";
import { consultaVentasTurno } from "./turnos.js";

const entreFechas = (coleccion, campo, desde, hasta) =>
  query(collection(db, coleccion), where(campo, ">=", desde), where(campo, "<=", hasta), orderBy(campo, "desc"));

const datos = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const leer = async (q) => datos(await getDocs(q));

/**
 * Trae los turnos abiertos en el período, con sus egresos y guardados (pocos documentos).
 *
 * Las ventas, que son miles por día, no se leen: los turnos cerrados tienen su resumen guardado.
 * Solo se leen las de los turnos cerrados que todavía no lo tienen (de antes de este cambio),
 * y el admin se lo guarda (`sinResumen`), salvo que algo haya salido de la copia local (sin
 * conexión puede estar incompleta): ahí `sinResumen` queda vacío y se vuelve a intentar otro día. Las de los turnos abiertos se leen a pedido
 * (obtenerVentasTurno), porque en un turno largo pueden ser muchas.
 *
 * Egresos y guardados se piden hasta el cierre del último turno del período, para que un turno
 * que pasó la medianoche salga completo.
 *
 * @returns {Promise<{ turnos, ventas, egresos, guardados, turnosCalculados: Set<string>, sinResumen: object[] }>}
 */
export async function obtenerMovimientos(desde, hasta) {
  const turnos = await leer(entreFechas("turnos", "fechaApertura", desde, hasta));

  const ahora = new Date();
  const finDeTurnos = turnos.map((t) => aDate(t.fechaCierre) ?? ahora);
  const hastaMovimientos = new Date(Math.max(hasta.getTime(), ...finDeTurnos.map((f) => f.getTime())));

  const sinResumen = turnos.filter((t) => t.estado === "cerrado" && !t.resumen);
  const snaps = await Promise.all([
    getDocs(entreFechas("egresos", "fecha", desde, hastaMovimientos)),
    getDocs(entreFechas("guardados", "fecha", desde, hastaMovimientos)),
    ...sinResumen.map((t) => getDocs(consultaVentasTurno(t))),
  ]);
  const [egresos, guardados, ...ventasPorTurno] = snaps.map(datos);
  const delServidor = snaps.every((s) => !s.metadata.fromCache);

  return {
    turnos,
    ventas: ventasPorTurno.flat(),
    egresos,
    guardados,
    turnosCalculados: new Set(sinResumen.map((t) => t.id)),
    sinResumen: delServidor ? sinResumen : [],
  };
}

/** Cuántas ventas hay en el período. Cuesta 1 lectura cada 1000 ventas. */
export async function contarVentas(desde, hasta) {
  return (await getCountFromServer(entreFechas("ventas", "timestamp", desde, hasta))).data().count;
}

/** Todas las ventas del período: 1 lectura por venta. */
export function obtenerVentas(desde, hasta) {
  return leer(entreFechas("ventas", "timestamp", desde, hasta));
}
