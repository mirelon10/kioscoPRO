import { db, auth } from "./firebase-config.js";
import { doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

// === UTILIDADES ANTI-CRASHES (NULL SAFETY) ===
const $ = id => document.getElementById(id);
const onClick = (id, fn) => { const el = $(id); if(el) el.addEventListener("click", fn); };
const onSubmit = (id, fn) => { const el = $(id); if(el) el.addEventListener("submit", fn); };
const setText = (id, txt) => { const el = $(id); if(el) el.textContent = txt; };
const setHTML = (id, html) => { const el = $(id); if(el) el.innerHTML = html; };

// === VARIABLES GLOBALES ===
let usuarioActual = null;
let esAdmin = false;
let carrito = [];
let inventarioProductos = [];
const UMBRAL_STOCK_BAJO = 5;
const hoy = new Date().toISOString().split("T")[0];

// Iniciar Fechas
if($("admin-desde")) $("admin-desde").value = hoy;
if($("admin-hasta")) $("admin-hasta").value = hoy;
if($("egresos-desde")) $("egresos-desde").value = hoy;
if($("egresos-hasta")) $("egresos-hasta").value = hoy;

// === AUTENTICACIÓN Y ROLES ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        usuarioActual = user;
        setText("user-display", user.email);
        $("login-screen")?.classList.add("hidden");
        $("app-screen")?.classList.remove("hidden");

        // Reglas estrictas
        if (user.email === "nachomiretti@gmail.com") esAdmin = true;
        else if (user.email === "nachomiretti2@gmail.com") esAdmin = false;
        else esAdmin = false;

        if ($("nav-admin")) {
            if (esAdmin) $("nav-admin").classList.remove("hidden");
            else $("nav-admin").classList.add("hidden");
        }

        cargarVistaTurno();
        cargarInventarioLocal();
        cargarEgresosApp();
    } else {
        usuarioActual = null;
        $("login-screen")?.classList.remove("hidden");
        $("app-screen")?.classList.add("hidden");
    }
});

onSubmit("form-login", async (e) => {
    e.preventDefault();
    try { await signInWithEmailAndPassword(auth, $("login-email").value, $("login-password").value); }
    catch (err) { Swal.fire("Error", "Credenciales incorrectas", "error"); }
});

onClick("btn-logout", async () => {
    if (localStorage.getItem("turnoId")) {
        return Swal.fire("Turno Abierto", "Debés cerrar tu turno en la sección 'Caja y Turnos' antes de salir del sistema.", "warning");
    }
    await signOut(auth); localStorage.clear();
});

// === NAVEGACIÓN SPA ===
document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-target");
        if (target === "sec-admin" && !esAdmin) return Swal.fire("Denegado", "Solo administradores", "error");

        document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        document.querySelectorAll(".view-section").forEach(sec => sec.classList.toggle("hidden", sec.id !== target));

        if (target === "sec-turnos") cargarVistaTurno();
        if (target === "sec-egresos") cargarEgresosApp();
        if (target === "sec-admin") cargarDatosAdmin();
    });
});

// === CAJA Y TURNOS ===
async function cargarVistaTurno() {
    if (!usuarioActual) return;
    try {
        const res = await fetch(`/api/turnos/activo/${usuarioActual.uid}`);
        const data = await res.json();
        if (data.activo) {
            localStorage.setItem("turnoId", data.turnoId);
            $("vista-abrir-turno")?.classList.add("hidden");
            $("vista-cerrar-turno")?.classList.remove("hidden");
            setText("txt-fecha-apertura", "Abierto el: " + new Date(data.fechaApertura).toLocaleString("es-AR"));
        } else {
            localStorage.removeItem("turnoId");
            $("vista-abrir-turno")?.classList.remove("hidden");
            $("vista-cerrar-turno")?.classList.add("hidden");
        }
    } catch (e) { console.error("Error al cargar turno", e); }
}

onClick("btn-abrir-turno-app", async () => {
    const cajaInicial = parseFloat($("cajaInicialApp").value);
    if (isNaN(cajaInicial) || cajaInicial < 0) return Swal.fire("Error", "Monto inválido", "warning");

    const res = await fetch("/api/turnos/abrir", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoId: usuarioActual.uid, empleadoNombre: usuarioActual.email, cajaInicial })
    });
    if (res.ok) { Swal.fire("Éxito", "Turno abierto", "success"); cargarVistaTurno(); }
});

onClick("btn-cerrar-turno-app", async () => {
    const cajaFinal = parseFloat($("cajaFinalApp").value);
    const turnoId = localStorage.getItem("turnoId");
    if (isNaN(cajaFinal) || cajaFinal < 0 || !turnoId) return Swal.fire("Error", "Monto inválido", "warning");

    const res = await fetch("/api/turnos/cerrar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnoId, cajaFinal })
    });
    if (res.ok) { Swal.fire("Éxito", "Turno cerrado", "success"); cargarVistaTurno(); }
});

// === POS / CARRITO ===
async function cargarInventarioLocal() {
    try {
        const snap = await getDocs(collection(db, "productos"));
        inventarioProductos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        revisarAlertasStockGlobal();
    } catch (e) { console.error("Error inventario", e); }
}

const buscadorPos = $("buscador-pos");
const sugerenciasPos = $("sugerencias-pos");

if(buscadorPos && sugerenciasPos) {
    buscadorPos.addEventListener("input", (e) => {
        const term = e.target.value.toLowerCase().trim();
        sugerenciasPos.innerHTML = "";
        if (term.length === 0) { sugerenciasPos.classList.add("hidden"); return; }

        const filtrados = inventarioProductos.filter(p => p.nombre.toLowerCase().includes(term) || (p.codigo && p.codigo.toLowerCase().includes(term)));

        if (filtrados.length > 0) {
            sugerenciasPos.classList.remove("hidden");
            filtrados.forEach(p => {
                const div = document.createElement("div");
                div.className = "autocomplete-item";
                div.innerHTML = `<span><strong>${p.nombre}</strong> <small class="text-muted">(${p.categoria || 'S/C'})</small></span> <span>$${p.precio} <small>(Stock: ${p.stock})</small></span>`;
                div.addEventListener("click", () => {
                    agregarAlCarrito(p);
                    buscadorPos.value = ""; sugerenciasPos.classList.add("hidden"); buscadorPos.focus();
                });
                sugerenciasPos.appendChild(div);
            });
        } else { sugerenciasPos.classList.add("hidden"); }
    });

    buscadorPos.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const term = buscadorPos.value.toLowerCase().trim();
            let match = inventarioProductos.find(p => (p.codigo && p.codigo.toLowerCase() === term));
            if (!match) match = inventarioProductos.find(p => p.nombre.toLowerCase() === term);

            if (match) { agregarAlCarrito(match); buscadorPos.value = ""; sugerenciasPos.classList.add("hidden"); }
            else { Swal.fire("No encontrado", "El producto no existe.", "info"); }
        }
    });
}

function agregarAlCarrito(producto) {
    if (producto.stock <= 0) return Swal.fire("Agotado", `No hay stock de ${producto.nombre}`, "error");
    const itemExistente = carrito.find(i => i.productoId === producto.id);
    if (itemExistente) {
        if (itemExistente.cantidad + 1 > producto.stock) return Swal.fire("Límite", "Stock máximo alcanzado", "warning");
        itemExistente.cantidad++;
    } else {
        carrito.push({ productoId: producto.id, nombre: producto.nombre, precio: producto.precio, cantidad: 1 });
    }
    actualizarCarritoUI();
}

function actualizarCarritoUI() {
    const container = $("carrito-items");
    if(!container) return;

    container.innerHTML = "";
    let total = 0;

    if(carrito.length === 0) {
        container.innerHTML = '<p class="empty-cart-msg">El carrito está vacío</p>';
        setText("cart-total", "$0.00");
        return;
    }

    carrito.forEach((item) => {
        const prodDb = inventarioProductos.find(p => p.id === item.productoId) || item;
        const subtotal = item.precio * item.cantidad;
        total += subtotal;
        container.innerHTML += `
            <div class="cart-item">
                <div class="cart-item-info"><strong>${item.nombre}</strong><small class="text-muted">Precio U: $${item.precio.toFixed(2)}</small></div>
                <div class="cart-item-actions">
                    <input type="number" class="input-qty" value="${item.cantidad}" min="1" max="${prodDb.stock || 100}" data-id="${item.productoId}">
                    <div style="width: 80px; text-align: right; font-weight: bold;">$${subtotal.toFixed(2)}</div>
                    <button class="btn-remove" data-id="${item.productoId}"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
    });
    setText("cart-total", `$${total.toFixed(2)}`);

    document.querySelectorAll(".input-qty").forEach(input => {
        input.addEventListener("change", (e) => {
            const id = e.target.getAttribute("data-id");
            let nuevaCant = parseInt(e.target.value);
            const producto = inventarioProductos.find(p => p.id === id);

            if(producto && nuevaCant > producto.stock) { Swal.fire("Stock", `Quedan ${producto.stock}`, "warning"); nuevaCant = producto.stock; }
            else if (nuevaCant < 1) nuevaCant = 1;

            const item = carrito.find(i => i.productoId === id);
            if(item) item.cantidad = nuevaCant;
            actualizarCarritoUI();
        });
    });

    document.querySelectorAll(".btn-remove").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const id = e.currentTarget.getAttribute("data-id");
            carrito = carrito.filter(i => i.productoId !== id);
            actualizarCarritoUI();
        });
    });
}

onClick("btn-confirmar-venta", async () => {
    const turnoId = localStorage.getItem("turnoId");
    if (!turnoId) return Swal.fire("Aviso", "Abrí turno primero", "warning");
    if (carrito.length === 0) return Swal.fire("Vacío", "El carrito está vacío", "warning");

    const selectPago = $("select-metodo-pago");
    const metodoPago = selectPago ? selectPago.value : "Efectivo";
    const total = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);

    try {
        const res = await fetch("/api/ventas/procesar", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ turnoId, empleadoId: usuarioActual.uid, empleadoNombre: usuarioActual.email, items: carrito, metodoPago, total })
        });
        if (res.ok) {
            Swal.fire("Venta", "Cobro realizado con éxito", "success");
            carrito = []; actualizarCarritoUI(); cargarInventarioLocal();
        }
    } catch (e) { Swal.fire("Error", "Fallo al procesar", "error"); }
});

// === EGRESOS ===
onClick("btn-buscar-egresos", cargarEgresosApp);

async function cargarEgresosApp() {
    const dInp = $("egresos-desde"); const hInp = $("egresos-hasta");
    let desde = dInp && dInp.value ? new Date(dInp.value + "T00:00:00") : new Date(hoy + "T00:00:00");
    let hasta = hInp && hInp.value ? new Date(hInp.value + "T23:59:59") : new Date(hoy + "T23:59:59");

    try {
        const snap = await getDocs(collection(db, "egresos"));
        const tbody = $("tabla-egresos-body");
        if (!tbody) return;
        tbody.innerHTML = "";

        let filtrados = snap.docs.map(d => d.data()).filter(e => {
            const f = e.fecha?.toDate ? e.fecha.toDate() : (e.timestamp?.toDate ? e.timestamp.toDate() : null);
            return f && f >= desde && f <= hasta;
        });

        // El empleado ve solo los suyos, el admin ve todos.
        if(!esAdmin && usuarioActual) {
            filtrados = filtrados.filter(e => e.empleadoId === usuarioActual.uid);
        }

        filtrados.forEach(e => {
            const f = e.fecha?.toDate ? e.fecha.toDate().toLocaleString("es-AR") : '-';
            const emp = e.empleadoNombre || e.empleadoId || 'Desconocido';
            tbody.innerHTML += `<tr><td>${f}</td><td>${emp}</td><td>${e.motivo}</td><td>$${e.monto.toFixed(2)}</td></tr>`;
        });
    } catch (e) { console.error("Error al cargar egresos", e); }
}

onSubmit("form-egreso-app", async (e) => {
    e.preventDefault();
    const turnoId = localStorage.getItem("turnoId");
    if (!turnoId) return Swal.fire("Aviso", "Abrí turno primero", "warning");

    const monto = parseFloat($("egreso-monto").value);
    const motivo = $("egreso-motivo").value;

    const res = await fetch("/api/egresos/registrar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnoId, empleadoId: usuarioActual.uid, empleadoNombre: usuarioActual.email, monto, motivo })
    });
    if (res.ok) { Swal.fire("Éxito", "Egreso registrado", "success"); e.target.reset(); cargarEgresosApp(); }
});

// === ADMIN ===
onClick("btn-ver-ventas", function() {
    $("btn-ver-ventas").classList.replace("btn-secondary", "btn-primary");
    $("btn-ver-stock")?.classList.replace("btn-primary", "btn-secondary");
    $("admin-resumen-view")?.classList.remove("hidden");
    $("admin-stock-view")?.classList.add("hidden");
    cargarDatosAdmin();
});

onClick("btn-ver-stock", function() {
    $("btn-ver-stock").classList.replace("btn-secondary", "btn-primary");
    $("btn-ver-ventas")?.classList.replace("btn-primary", "btn-secondary");
    $("admin-stock-view")?.classList.remove("hidden");
    $("admin-resumen-view")?.classList.add("hidden");
    cargarStockAdmin();
});

function revisarAlertasStockGlobal() {
    const alertaBox = $("alerta-stock-admin");
    const lista = $("lista-alertas-stock");
    if(!alertaBox || !lista) return;
    lista.innerHTML = "";

    const bajos = inventarioProductos.filter(p => p.stock <= UMBRAL_STOCK_BAJO);
    if(bajos.length > 0 && esAdmin) {
        alertaBox.classList.remove("hidden");
        bajos.forEach(p => { lista.innerHTML += `<li>${p.nombre} (Quedan: <strong>${p.stock}</strong>)</li>`; });
    } else { alertaBox.classList.add("hidden"); }
}

onClick("btn-admin-filtrar", cargarDatosAdmin);

async function cargarDatosAdmin() {
    try {
        const dInp = $("admin-desde"); const hInp = $("admin-hasta");
        if(!dInp || !hInp) return;

        const desde = new Date(dInp.value + "T00:00:00");
        const hasta = new Date(hInp.value + "T23:59:59");
        const empSelect = $("admin-empleado");
        const filtroEmp = empSelect ? empSelect.value : "";

        const snapTurnos = await getDocs(collection(db, "turnos"));
        const snapVentas = await getDocs(collection(db, "ventas"));
        const snapEgresos = await getDocs(collection(db, "egresos"));

        if(empSelect && empSelect.options.length <= 1) {
            const empUnicos = [...new Set(snapTurnos.docs.map(d => d.data().empleadoNombre || d.data().empleadoId))];
            empUnicos.forEach(emp => { if(emp) empSelect.innerHTML += `<option value="${emp}">${emp}</option>`; });
        }

        let turnos = snapTurnos.docs.map(d => ({id: d.id, ...d.data()})).filter(t => {
            const fAper = t.fechaApertura?.toDate ? t.fechaApertura.toDate() : new Date(t.fechaApertura);
            return fAper >= desde && fAper <= hasta;
        });

        // Filtrado flexible de fecha para ventas (soporta String ISO o Timestamp)
        let ventas = snapVentas.docs.map(d => d.data()).filter(v => {
            const fVenta = v.timestamp ? new Date(v.timestamp) : null;
            return fVenta && fVenta >= desde && fVenta <= hasta;
        });

        let egresos = snapEgresos.docs.map(d => d.data()).filter(e => {
            const f = e.fecha?.toDate ? e.fecha.toDate() : (e.timestamp?.toDate ? e.timestamp.toDate() : new Date(e.timestamp));
            return f && f >= desde && f <= hasta;
        });

        if(filtroEmp) {
            turnos = turnos.filter(t => t.empleadoNombre === filtroEmp || t.empleadoId === filtroEmp);
            const tIds = new Set(turnos.map(t=>t.id));
            ventas = ventas.filter(v => tIds.has(v.turnoId));
            egresos = egresos.filter(e => e.empleadoNombre === filtroEmp || e.empleadoId === filtroEmp);
        }

        let efe = 0, mp = 0, tarj = 0, sube = 0;
        ventas.forEach(v => {
            const monto = v.total || 0;
            if(v.metodoPago === "Efectivo") efe += monto;
            else if(v.metodoPago === "Mercado Pago" || v.metodoPago === "Mercadopago") mp += monto;
            else if(v.metodoPago === "Tarjeta") tarj += monto;
            else if(v.metodoPago === "Sube") sube += monto; // Detecta recargas SUBE registradas como venta
        });

        let totEgr = egresos.reduce((acc, e) => acc + (e.monto || 0), 0);
        let totGen = (efe + mp + tarj + sube) - totEgr;

        setText("metric-efectivo", `$${efe.toFixed(2)}`);
        setText("metric-mp", `$${mp.toFixed(2)}`);
        setText("metric-tarjeta", `$${tarj.toFixed(2)}`);
        setText("metric-sube", `$${sube.toFixed(2)}`);
        setText("metric-egresos", `$${totEgr.toFixed(2)}`);
        setText("metric-general", `$${totGen.toFixed(2)}`);

        const tbodyTurnos = $("tabla-turnos");
        if(tbodyTurnos) {
            tbodyTurnos.innerHTML = "";
            turnos.forEach(t => {
                const vEfe = ventas.filter(v => v.turnoId === t.id && v.metodoPago === "Efectivo").reduce((s, v) => s + v.total, 0);
                const egr = egresos.filter(e => e.turnoId === t.id).reduce((s, e) => s + e.monto, 0);
                const cajaFin = t.cajaFinal != null ? t.cajaFinal : 0;
                const dif = cajaFin - (t.cajaInicial + vEfe - egr);

                const fechaAper = t.fechaApertura?.toDate ? t.fechaApertura.toDate().toLocaleString("es-AR") : new Date(t.fechaApertura).toLocaleString("es-AR");
                const fechaCier = t.fechaCierre ? (t.fechaCierre?.toDate ? t.fechaCierre.toDate().toLocaleString("es-AR") : new Date(t.fechaCierre).toLocaleString("es-AR")) : "Abierto";

                tbodyTurnos.innerHTML += `<tr><td>${t.empleadoNombre || t.empleadoId}</td><td>${fechaAper}</td>
                <td>${fechaCier}</td>
                <td>$${t.cajaInicial.toFixed(2)}</td><td>${t.cajaFinal != null ? "$" + t.cajaFinal.toFixed(2) : "-"}</td>
                <td>$${vEfe.toFixed(2)}</td><td class="${dif>=0?'text-success':'text-danger'}"><strong>$${dif.toFixed(2)}</strong></td></tr>`;
            });
        }
    } catch (err) { console.error("Error al cargar Admin", err); }
}
// === GESTION STOCK Y PRECIOS ===
const inpCompra = $("prod-compra");
const inpMargen = $("prod-margen");
const inpVenta = $("prod-precio");

function calcularPrecioFinal() {
    if(!inpCompra || !inpMargen || !inpVenta) return;
    const costo = parseFloat(inpCompra.value) || 0;
    const margen = parseFloat(inpMargen.value) || 0;
    inpVenta.value = (costo * (1 + (margen / 100))).toFixed(2);
}
if(inpCompra) inpCompra.addEventListener("input", calcularPrecioFinal);
if(inpMargen) inpMargen.addEventListener("input", calcularPrecioFinal);

async function cargarStockAdmin() {
    await cargarInventarioLocal();
    const tbody = $("tabla-stock-admin");
    if(!tbody) return;
    tbody.innerHTML = "";
    inventarioProductos.forEach(p => {
        const estado = p.stock <= UMBRAL_STOCK_BAJO ? "<span class='text-danger'><b>BAJO</b></span>" : "<span class='text-success'>Óptimo</span>";
        tbody.innerHTML += `
            <tr>
                <td>${p.codigo || '-'}</td>
                <td><span style="background:#e2e8f0; padding:3px 8px; border-radius:12px; font-size:0.8rem;">${p.categoria || 'S/C'}</span></td>
                <td>${p.nombre}</td>
                <td class="text-muted">$${(p.precioCompra || 0).toFixed(2)}</td>
                <td><strong>$${p.precio.toFixed(2)}</strong></td>
                <td>${p.stock}</td>
                <td>
                    <button class="btn btn-warning btn-sm" onclick="window.editarProd('${p.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="window.borrarProd('${p.id}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

onSubmit("form-nuevo-producto", async (e) => {
    e.preventDefault();
    const cod = $("prod-codigo").value.trim();
    const cat = $("prod-categoria").value.trim();
    const nombre = $("prod-nombre").value.trim();
    const precioCompra = parseFloat(inpCompra.value);
    const margen = parseFloat(inpMargen.value);
    const precio = parseFloat(inpVenta.value);
    const stock = parseInt($("prod-stock").value);

    try {
        await addDoc(collection(db, "productos"), { codigo: cod, categoria: cat, nombre, precioCompra, margen, precio, stock });
        Swal.fire("Agregado", "Producto guardado", "success");
        e.target.reset();
        cargarStockAdmin();
    } catch(err) { Swal.fire("Error", "No se pudo guardar", "error"); }
});

window.borrarProd = async (id) => {
    const res = await Swal.fire({ title: '¿Eliminar producto?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, borrar' });
    if(res.isConfirmed) {
        await deleteDoc(doc(db, "productos", id));
        cargarStockAdmin(); Swal.fire("Borrado", "Producto eliminado", "success");
    }
};

window.editarProd = async (id) => {
    const p = inventarioProductos.find(x => x.id === id);
    const pc = p.precioCompra || 0;
    const mg = p.margen || 0;

    const { value: formValues } = await Swal.fire({
        title: 'Editar Producto',
        html: `
            <input id="swal-cat" class="swal2-input" value="${p.categoria || ''}" placeholder="Categoría">
            <input id="swal-nom" class="swal2-input" value="${p.nombre}" placeholder="Nombre">
            <div style="display:flex; gap:10px;">
                <input id="swal-compra" type="number" step="0.01" class="swal2-input" value="${pc}" placeholder="Costo $" style="width:45%">
                <input id="swal-margen" type="number" step="0.01" class="swal2-input" value="${mg}" placeholder="Margen %" style="width:45%">
            </div>
            <input id="swal-pre" type="number" class="swal2-input" value="${p.precio}" placeholder="Precio Final" readonly style="background:#eee;">
            <input id="swal-stk" type="number" class="swal2-input" value="${p.stock}" placeholder="Stock">
        `,
        didOpen: () => {
            const c = $("swal-compra"); const m = $("swal-margen"); const v = $("swal-pre");
            const recalcular = () => { v.value = ((parseFloat(c.value)||0) * (1 + ((parseFloat(m.value)||0)/100))).toFixed(2); };
            c.addEventListener('input', recalcular); m.addEventListener('input', recalcular);
        },
        preConfirm: () => ({
            categoria: $("swal-cat").value, nombre: $("swal-nom").value,
            precioCompra: parseFloat($("swal-compra").value), margen: parseFloat($("swal-margen").value),
            precio: parseFloat($("swal-pre").value), stock: parseInt($("swal-stk").value)
        })
    });

    if (formValues) {
        await updateDoc(doc(db, "productos", id), formValues);
        cargarStockAdmin(); Swal.fire("Actualizado", "Cambios guardados", "success");
    }
    // === RECARGA SUBE DESDE EL POS ===
    onClick("btn-cobrar-sube", async () => {
        const turnoId = localStorage.getItem("turnoId");
        if (!turnoId) return Swal.fire("Aviso", "Debés abrir un turno primero para registrar dinero en caja", "warning");

        const inputMonto = $("input-monto-sube");
        const monto = parseFloat(inputMonto.value);

        if (isNaN(monto) || monto <= 0) {
            return Swal.fire("Monto inválido", "Ingresá un valor superior a 0 para la recarga SUBE", "warning");
        }

        const ventaSubeData = {
            turnoId,
            empleadoId: usuarioActual.uid,
            empleadoNombre: usuarioActual.email,
            items: [{ nombre: "Recarga Tarjeta SUBE", precio: monto, cantidad: 1 }],
            metodoPago: "Sube",
            total: monto,
            timestamp: new Date().toISOString()
        };

        try {
            const respuestaServidor = await fetch("/api/ventas/procesar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(ventaSubeData)
            });

            if (respuestaServidor.ok) {
                Swal.fire("SUBE Recargada", `Se registró la recarga de $${monto.toFixed(2)} correctamente`, "success");
                inputMonto.value = "";
            } else {
                Swal.fire("Error", "No se pudo registrar la recarga en el sistema", "error");
            }
        } catch (e) {
            Swal.fire("Error de conexión", "Fallo al procesar la recarga SUBE", "error");
        }
    });
};