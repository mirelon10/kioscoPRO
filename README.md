# Kiosco Pro

Sistema de gestión para kiosco: ventas (POS) con cálculo de vuelto, caja por turnos, egresos, inventario
y panel de administración con exportación a Excel.

- **Frontend:** HTML + JavaScript (módulos ES nativos, sin build), publicado en **Netlify**.
- **Backend:** **Firebase Auth**, **Firestore** y **Cloud Functions** (región `southamerica-east1`).
  - Todo lo que mueve plata o stock (cobrar, recargar SUBE, cerrar turnos) pasa por las funciones de
    [`functions/index.js`](functions/index.js): el servidor calcula totales, vuelto y caja esperada.
  - El resto (catálogo, abrir turno, egresos, lecturas) va directo a Firestore, protegido por
    [`firestore.rules`](firestore.rules).

## Estructura

```
public/                  ← lo que publica Netlify
  index.html
  css/style.css
  js/
    main.js              ← autenticación, navegación y ciclo de vida de los listeners
    firebase.js          ← único punto de acceso al SDK (versión, configuración, llamadas a funciones)
    estado.js            ← estado de la sesión (usuario, rol, turno, movimientos del turno, catálogo)
    ui.js                ← diálogos, toasts y manejo de botones ocupados
    lib/                 ← utilidades: dinero, fechas, DOM, Excel
    core/                ← reglas de negocio puras, compartidas con las Cloud Functions
    data/                ← acceso a Firestore y a las funciones
    views/               ← una vista por sección: pos, turno, egresos, admin, stock
functions/
  index.js               ← Cloud Functions: registrarVenta, registrarRecargaSube, cerrarTurno
  compartido/            ← copia generada de public/js/core y lib (no se edita a mano)
firestore.rules          ← seguridad de lo que el navegador puede leer y escribir
netlify.toml             ← publicación y cabeceras de seguridad (CSP)
scripts/set-rol.js       ← asigna roles a los usuarios
scripts/copiar-compartido.js ← copia la lógica compartida a functions/ (corre solo antes de cada deploy)
tests/unit/              ← lógica de negocio
tests/rules/             ← reglas de seguridad contra el emulador de Firestore
tests/functions/         ← Cloud Functions contra los emuladores
```

## Puesta en marcha

### 1. Requisitos

- Node 20+ y, para los emuladores y los tests de reglas/funciones, **Java 21+**.
- El proyecto de Firebase en el **plan Blaze** (las Cloud Functions lo requieren; la cuota gratuita
  alcanza de sobra para un kiosco).

```bash
npm install          # instala también las dependencias de functions/
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

### 3. Publicar (en este orden)

```bash
npm test                    # unitarios + reglas + funciones
npm run deploy:functions    # 1º: las funciones nuevas
# 2º: mergear a main → Netlify publica el frontend que usa las funciones
npm run deploy:rules        # 3º: recién ahí, las reglas que bloquean el camino viejo
```

El orden importa: las reglas nuevas impiden crear ventas desde el navegador, así que si se publican antes
que el frontend nuevo, la versión vieja de la app no puede cobrar.

### 4. Netlify

`netlify.toml` indica que se publica la carpeta `public/` y no hay comando de build.
La API key web está restringida por referente HTTP: si agregás un dominio (por ejemplo, *deploy previews*
`https://*--kioscoproo.netlify.app/*`), sumalo en Google Cloud → Credenciales.

## Desarrollo local

Probá contra los emuladores para no tocar los datos reales:

```bash
npm run emuladores       # Auth + Firestore + Functions locales (UI en http://localhost:4000)
npm run dev              # en otra terminal: sirve public/ en http://localhost:3000
```

Abrí `http://localhost:3000/?emulador`. Los usuarios y roles de prueba se crean desde la UI del emulador
(Authentication → *Add user* → *Custom claims*: `{"rol":"admin"}`).

## Tests

```bash
npm run test:unit        # lógica de negocio (rápido, sin emulador)
npm run test:rules       # reglas de seguridad (requiere Java 21+)
npm run test:functions   # Cloud Functions contra los emuladores (requiere Java 21+)
npm test                 # todo
```

## Cómo funciona

**Cobro:** el cajero escanea productos (Enter), y con Enter en el buscador vacío salta a *Paga con*. Ahí
escribe con cuánto paga el cliente y ve el vuelto en vivo; con Enter cobra. En efectivo no se puede cobrar si
el pago no alcanza. La función `registrarVenta` vuelve a calcular todo con los precios y el stock reales,
descuenta el stock exacto de cada producto y guarda la venta, todo en una transacción.

**Turnos:** se abren con el efectivo inicial. Mientras el turno está abierto, la pantalla de *Caja y turnos*
muestra en vivo `caja inicial + ventas en efectivo − egresos = efectivo esperado`. Al cerrar, el monto
contado viene precargado con el esperado; si el empleado contó otra cosa, lo corrige y queda registrada
la diferencia (faltante/sobrante). La función `cerrarTurno` recalcula el esperado en el servidor.

**Cierre forzado:** si un empleado se va sin cerrar, el admin lo cierra desde *Administración → Turnos del
período* (botón *Cerrar*). Queda registrado quién lo cerró.

**Egresos:** cada empleado ve los egresos de su turno. La búsqueda por fecha es solo para administradores.

**Exportar a Excel:** desde el resumen de caja, con tres hojas (Resumen, Turnos, Egresos). Los montos y las
fechas son valores reales de Excel, se pueden sumar y filtrar.

## Modelo de datos

| Colección | Documento | Quién escribe |
|---|---|---|
| `productos/{id}` | `codigo, nombre, categoria, precioCompra, margen, precio, stock` | Admin. El stock lo descuenta `registrarVenta`. |
| `turnos/{id}` | `empleadoId, empleadoNombre, cajaInicial, estado, fechaApertura` + al cerrar: `cajaFinal` (contado), `cajaEsperada, fechaCierre, cerradoPor, cerradoPorNombre` | Abre el empleado; cierra `cerrarTurno`. |
| `turnosActivos/{uid}` | `turnoId` | Candado: **un solo turno abierto** por empleado. |
| `ventas/{id}` | `tipo ("productos"\|"sube"), turnoId, empleadoId, empleadoNombre, metodoPago, items[], total, montoRecibido, vuelto, timestamp` | Solo las funciones. **Inmutables.** |
| `egresos/{id}` | `turnoId, empleadoId, empleadoNombre, monto, motivo, fecha` | Empleado con turno abierto. **Inmutables.** |

Las fechas siempre las pone el servidor (`serverTimestamp`).

**Recarga SUBE:** es una venta `tipo: "sube"` cobrada con el método elegido. Si es en efectivo, suma a la
caja del turno.

## Limitaciones conocidas

- Cobrar requiere conexión. El catálogo sí carga desde la caché local.
- La primera venta después de un rato sin uso puede tardar 1–3 segundos más (arranque en frío de la función).
  Si molesta, se puede configurar `minInstances: 1` en `functions/index.js`, que tiene un costo mensual fijo.
- La recarga SUBE no calcula vuelto (solo la venta de productos).
- Datos anteriores a la migración: los productos con `codigoBarra` y las ventas SUBE viejas
  (`metodoPago: "Sube"`) se leen bien y se normalizan al editarlos. Si hubiera egresos muy viejos
  guardados con el campo `timestamp` en lugar de `fecha`, no aparecen en los filtros por fecha.
