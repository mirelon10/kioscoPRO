import { db, collection, getDocs, query, where, orderBy } from "../firebase.js";
import { aDate } from "../lib/fechas.js";

async function entreFechas(coleccion, campo, desde, hasta) {
  const snap = await getDocs(
    query(collection(db, coleccion), where(campo, ">=", desde), where(campo, "<=", hasta), orderBy(campo, "desc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Trae turnos, ventas y egresos de un período consultando solo ese rango
 * (antes se descargaban las colecciones completas y se filtraba en el navegador).
 *
 * Ventas y egresos se piden hasta el cierre del último turno del período, para que
 * la diferencia de caja de un turno que pasó la medianoche salga completa.
 */
export async function obtenerMovimientos(desde, hasta) {
  const turnos = await entreFechas("turnos", "fechaApertura", desde, hasta);

  const ahora = new Date();
  const finDeTurnos = turnos.map((t) => aDate(t.fechaCierre) ?? ahora);
  const hastaMovimientos = new Date(Math.max(hasta.getTime(), ...finDeTurnos.map((f) => f.getTime())));

  const [ventas, egresos] = await Promise.all([
    entreFechas("ventas", "timestamp", desde, hastaMovimientos),
    entreFechas("egresos", "fecha", desde, hastaMovimientos),
  ]);

  return { turnos, ventas, egresos };
}
