# Kiosco Pro

Sistema de gestión para kiosco: ventas (POS) con cálculo de vuelto, caja por turnos, egresos, inventario
y panel de administración con exportación a Excel.

- **Frontend:** HTML + JavaScript (módulos ES nativos, sin build), publicado en **Netlify**.
- **Backend:** no hay servidor propio (plan gratuito Spark de Firebase). La app habla directo con
  **Firebase Auth** y **Firestore**, y la seguridad la imponen las reglas de [`firestore.rules`](firestore.rules).

## Estructura

```
public/                  ← lo que publica Netlify
  index.html
  css/style.css
  js/
    main.js              ← autenticación, navegación y ciclo de vida de los listeners
    firebase.js          ← único punto de acceso al SDK (versión + configuración)
    estado.js            ← estado de la sesión (usuario, rol, turno, movimientos del turno, catálogo)
    ui.js                ← diálogos, toasts y manejo de botones ocupados
    lib/                 ← utilidades: dinero, fechas, DOM, Excel
    core/                ← reglas de negocio puras (testeables con Node)
    data/                ← acceso a Firestore
    views/               ← una vista por sección: pos, turno, egresos, admin, stock (+ desglose del cierre)
firestore.rules          ← seguridad (la parte más importante)
firestore.indexes.json   ← índices compuestos
netlify.toml             ← publicación y cabeceras de seguridad (CSP)
scripts/set-rol.js       ← asigna roles a los usuarios
tests/unit/              ← tests de la lógica de negocio
tests/rules/             ← tests de las reglas contra el emulador de Firestore
```

## Puesta en marcha

### 1. Requisitos

Node 20+ y, para los emuladores y los tests de reglas, **Java 21+**.

```bash
npm install
npx firebase login   # en una terminal propia: el login es interactivo
```

### 2. Asignar roles

Los roles viven en el token del usuario (custom claim `rol`), no en el código. Primero creá los usuarios
en Firebase Console → Authentication. Después, con la clave de cuenta de servicio **fuera** del repositorio:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\claves\kiosco-admin.json"
npm run set-rol -- nachomiretti@gmail.com admin
npm run set-rol -- empleado@ejemplo.com empleado
npm run set-rol -- ex-empleado@ejemplo.com ninguno   # quita el acceso
```

Un usuario sin rol no puede entrar.

### 3. Publicar

```bash
npm test               # unitarios + reglas
npm run deploy:rules   # reglas e índices
```

El frontend lo publica Netlify solo al mergear a `main`. Si un cambio agrega campos nuevos a los
documentos, publicá primero las reglas (que aceptan el formato nuevo) y después mergeá.

### 4. Netlify

`netlify.toml` indica que se publica la carpeta `public/` y no hay comando de build.
La API key web está restringida por referente HTTP: si agregás un dominio (por ejemplo, *deploy previews*
`https://*--kioscoproo.netlify.app/*`), sumalo en Google Cloud → Credenciales.

## Desarrollo local

Probá contra los emuladores para no tocar los datos reales:

```bash
npm run emuladores       # Auth + Firestore locales (UI en http://localhost:4000)
npm run dev              # en otra terminal: sirve public/ en http://localhost:3000
```

Abrí `http://localhost:3000/?emulador`. Los usuarios y roles de prueba se crean desde la UI del emulador
(Authentication → *Add user* → *Custom claims*: `{"rol":"admin"}`).

## Tests

```bash
npm run test:unit    # lógica de negocio (rápido, sin emulador)
npm run test:rules   # reglas de seguridad contra el emulador (requiere Java 21+)
npm test             # ambos
```

## Cómo funciona

**Cobro:** el cajero escanea productos (Enter), y con Enter en el buscador vacío salta a *Paga con*. Ahí
escribe con cuánto paga el cliente y ve el vuelto en vivo; con Enter cobra. En efectivo no se puede cobrar si
el pago no alcanza. Al cobrar, una transacción vuelve a leer los precios y el stock reales, recalcula el
total y el vuelto, descuenta el stock y guarda la venta. Si dos cajas venden la última unidad a la vez,
una de las dos falla en lugar de dejar stock negativo.

**Turnos:** se abren con el efectivo inicial. Mientras el turno está abierto, la pantalla de *Caja y turnos*
muestra en vivo el cierre en un solo total:

```
Efectivo + Mercado Pago + Tarjeta (ventas de productos) + Recargas SUBE
− Caja inicial − Egresos − Caja de guardado = TOTAL
```

Las recargas SUBE van en su propia línea (no se suman de nuevo en el método con que se cobraron). Al cerrar
no se cuenta la plata: se confirma con el detalle a la vista y después se muestra el resumen. En `cajaFinal`
se registra el efectivo que debería quedar en el cajón (caja inicial + todo lo cobrado en efectivo − egresos
− guardado). El desglose no se guarda: el panel lo recalcula siempre desde los movimientos del turno.

**Caja de guardado:** durante el turno, el empleado pasa efectivo de la caja a la caja de guardado (debajo del
cierre, en *Caja y turnos*). No puede guardar más efectivo del que hay en el cajón. Cada guardado queda
registrado con su hora, no se puede borrar y se resta del total del turno.

**Inventario:** sección para todos los usuarios. El admin da de alta, edita y borra productos. El empleado ve
el catálogo (sin el costo) y ajusta el stock con *Stock*: ingreso de mercadería (+), baja por rotura o
vencimiento (−) o conteo (fija el número contado). Ingresos y bajas usan `increment()`, así no pisan una venta
que entre mientras el modal está abierto.

**Cierre forzado:** si un empleado se va sin cerrar, el admin lo cierra desde *Administración → Turnos del
período* (botón *Cerrar*). Queda registrado quién lo cerró.

**Egresos:** cada empleado ve los egresos de su turno. La búsqueda por fecha es solo para administradores.

**Exportar a Excel:** desde el resumen de caja, con tres hojas (Resumen, Turnos, Egresos). Los montos y las
fechas son valores reales de Excel, se pueden sumar y filtrar.

## Modelo de datos

| Colección | Documento | Quién escribe |
|---|---|---|
| `productos/{id}` | `codigo, nombre, categoria, precioCompra, margen, precio, stock` | Admin. El empleado solo puede cambiar `stock` (al cobrar y desde Inventario), nunca dejarlo negativo. |
| `turnos/{id}` | `empleadoId, empleadoNombre, cajaInicial, estado, fechaApertura` + al cerrar: `cajaFinal` (contado), `fechaCierre, cerradoPor, cerradoPorNombre` | Abre el empleado; cierra él mismo o un admin. |
| `turnosActivos/{uid}` | `turnoId` | Candado: **un solo turno abierto** por empleado. Se crea y se borra en el mismo batch que abre y cierra el turno. |
| `ventas/{id}` | `tipo ("productos"\|"sube"), turnoId, empleadoId, empleadoNombre, metodoPago, items[], total, montoRecibido, vuelto, timestamp` | Empleado con turno abierto. En efectivo, `montoRecibido ≥ total`; si no, ambos en `null`. **Inmutables.** |
| `egresos/{id}` | `turnoId, empleadoId, empleadoNombre, monto, motivo, fecha` | Empleado con turno abierto. **Inmutables.** |
| `guardados/{id}` | `turnoId, empleadoId, empleadoNombre, monto, fecha` | Caja de guardado. Empleado con turno abierto. **Inmutables.** |

Las fechas siempre las pone el servidor (`serverTimestamp`) y las reglas lo verifican.

**Recarga SUBE:** es una venta `tipo: "sube"` cobrada con el método elegido. Si es en efectivo, suma a la
caja del turno.

## Limitaciones conocidas

- Sin servidor propio, las reglas verifican que el empleado solo toque el campo `stock` y que la venta sea de
  su turno abierto, pero no pueden recorrer los ítems para comprobar que la cantidad descontada coincida
  exactamente con lo vendido, ni que el total sea la suma de los precios. Esa garantía requiere un
  servidor (Cloud Functions, que necesitan el plan Blaze).
- Los ajustes de stock no dejan historial (quién ajustó, cuándo y cuánto).
- Cobrar requiere conexión (las transacciones no funcionan offline). El catálogo sí carga desde la caché local.
- La recarga SUBE no calcula vuelto (solo la venta de productos).
- Datos anteriores a la migración: los productos con `codigoBarra` y las ventas SUBE viejas
  (`metodoPago: "Sube"`) se leen bien y se normalizan al editarlos. Si hubiera egresos muy viejos
  guardados con el campo `timestamp` en lugar de `fecha`, no aparecen en los filtros por fecha.
