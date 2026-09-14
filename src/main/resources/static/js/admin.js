import { db, auth } from "./firebase-config.js";
import {
  collection, query, where, getDocs, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const fechaDesde = document.getElementById("fechaDesde");
const fechaHasta = document.getElementById("fechaHasta");
const filtroEmpleado = document.getElementById("filtroEmpleado");
const tablaTurnos = document.getElementById("tabla-turnos");

const hoy = new Date().toISOString().split("T")[0];
fechaDesde.value = hoy;
fechaHasta.value = hoy;

document.getElementById("btn-filtrar").addEventListener("click", cargarDatos);
filtroEmpleado.addEventListener("change", cargarDatos);

async function cargarDatos() {
  const inicio = new Date(fechaDesde.value + "T00:00:00");
  const fin = new Date(fechaHasta.value + "T23:59:59");

  const qTurnos = query(
      collection(db, "turnos"),
      where("fechaApertura", ">=", inicio),
      where("fechaApertura", "<=", fin),
      orderBy("fechaApertura", "desc")
  );
  const snapTurnos = await getDocs(qTurnos);
  let turnos = snapTurnos.docs.map(d => ({ id: d.id, ...d.data() }));

  const qVentas = query(
      collection(db, "ventas"),
      where("timestamp", ">=", inicio),
      where("timestamp", "<=", fin)
  );
  const snapVentas = await getDocs(qVentas);
  let ventas = snapVentas.docs.map(d => d.data());

  // Egresos: filtrado en cliente, compatible con campo "fecha" (Java) o "timestamp" (frontend viejo)
  const snapEgresos = await getDocs(collection(db, "egresos"));
  let egresos = snapEgresos.docs.map(d => d.data()).filter(e => {
    const f = e.fecha?.toDate ? e.fecha.toDate() : (e.timestamp?.toDate ? e.timestamp.toDate() : null);
    return f && f >= inicio && f <= fin;
  });
  egresos.sort((a, b) => {
    const fa = a.fecha?.toDate ? a.fecha.toDate() : (a.timestamp?.toDate ? a.timestamp.toDate() : 0);
    const fb = b.fecha?.toDate ? b.fecha.toDate() : (b.timestamp?.toDate ? b.timestamp.toDate() : 0);
    return fb - fa;
  });

  const empleadosUnicos = [...new Map(turnos.map(t => [t.empleadoId, t.empleadoNombre])).entries()];
  const seleccionActual = filtroEmpleado.value;
  filtroEmpleado.innerHTML = `<option value="">Todos</option>`;
  empleadosUnicos.forEach(([id, nombre]) => {
    filtroEmpleado.innerHTML += `<option value="${id}">${nombre || id}</option>`;
  });
  filtroEmpleado.value = seleccionActual;

  const empleadoFiltrado = filtroEmpleado.value;
  if (empleadoFiltrado) {
    turnos = turnos.filter(t => t.empleadoId === empleadoFiltrado);
    const turnoIdsFiltrados = new Set(turnos.map(t => t.id));
    ventas = ventas.filter(v => turnoIdsFiltrados.has(v.turnoId));
    egresos = egresos.filter(e => e.empleadoId === empleadoFiltrado);
  }

  renderTotales(ventas);
  renderTurnos(turnos, ventas, egresos);
  renderEgresos(egresos, turnos);
}

function renderTotales(ventas) {
  let efectivo = 0, mp = 0, tarjeta = 0, sube = 0;
  ventas.forEach(v => {
    if (v.metodoPago === "Efectivo") efectivo += (v.total || 0);
    else if (v.metodoPago === "Mercado Pago") mp += (v.total || 0);
    else if (v.metodoPago === "Tarjeta") tarjeta += (v.total || 0);
    else if (v.metodoPago === "Sube") sube += (v.total || 0);
  });

  document.getElementById("total-efectivo").textContent = `$${efectivo.toFixed(2)}`;
  document.getElementById("total-mp").textContent = `$${mp.toFixed(2)}`;
  document.getElementById("total-tarjeta").textContent = `$${tarjeta.toFixed(2)}`;
  document.getElementById("total-sube").textContent = `$${sube.toFixed(2)}`;
  document.getElementById("total-general").textContent = `$${(efectivo + mp + tarjeta + sube).toFixed(2)}`;
}

function renderTurnos(turnos, ventas, egresos) {
  tablaTurnos.innerHTML = "";

  turnos.forEach(t => {
    const ventasDelTurno = ventas.filter(v => v.turnoId === t.id && v.metodoPago === "Efectivo");
    const vendidoEfectivo = ventasDelTurno.reduce((acc, v) => acc + (v.total || 0), 0);

    const egresosDelTurno = egresos.filter(e => e.turnoId === t.id);
    const totalEgresosTurno = egresosDelTurno.reduce((acc, e) => acc + (e.monto || 0), 0);

    const apertura = t.fechaApertura?.toDate ? t.fechaApertura.toDate().toLocaleString("es-AR") : "-";
    const cierre = t.fechaCierre?.toDate ? t.fechaCierre.toDate().toLocaleString("es-AR") : "Turno abierto";

    let diferenciaTexto = "-";
    let claseDiferencia = "";

    if (t.estado === "cerrado" && t.cajaFinal != null) {
      const esperado = t.cajaInicial + vendidoEfectivo - totalEgresosTurno;
      const diferencia = t.cajaFinal - esperado;
      claseDiferencia = diferencia >= 0 ? "diferencia-pos" : "diferencia-neg";
      diferenciaTexto = `${diferencia >= 0 ? "+" : ""}$${diferencia.toFixed(2)}`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.empleadoNombre || t.empleadoId}</td>
      <td>${apertura}</td>
      <td>${cierre}</td>
      <td>$${(t.cajaInicial || 0).toFixed(2)}</td>
      <td>${t.cajaFinal != null ? "$" + t.cajaFinal.toFixed(2) : "-"}</td>
      <td>$${vendidoEfectivo.toFixed(2)}</td>
      <td class="${claseDiferencia}">${diferenciaTexto}</td>
    `;
    tablaTurnos.appendChild(tr);
  });
}

function renderEgresos(egresos, turnos) {
  const tabla = document.getElementById("tabla-egresos-admin");
  if (!tabla) return;

  const mapaEmpleados = new Map(turnos.map(t => [t.empleadoId, t.empleadoNombre]));

  tabla.innerHTML = "";
  let total = 0;

  egresos.forEach(e => {
    total += (e.monto || 0);
    const fechaObj = e.fecha?.toDate ? e.fecha.toDate() : (e.timestamp?.toDate ? e.timestamp.toDate() : null);
    const fecha = fechaObj ? fechaObj.toLocaleString("es-AR") : "-";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fecha}</td>
      <td>${mapaEmpleados.get(e.empleadoId) || e.empleadoId}</td>
      <td>${e.motivo}</td>
      <td>$${(e.monto || 0).toFixed(2)}</td>
    `;
    tabla.appendChild(tr);
  });

  const totalEl = document.getElementById("total-egresos");
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
}

const btnSalir = document.getElementById("salir");
if (btnSalir) {
  btnSalir.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.clear();
    window.location.href = "index.html";
  });
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  cargarDatos();
});