# Kiosco Pro

Sistema de gestión para kiosco: ventas (POS), caja por turnos, egresos, inventario y panel de administración.

- **Frontend:** HTML + JavaScript (módulos ES nativos, sin build), publicado en **Netlify**.
- **Backend:** no hay servidor propio. La app habla directo con **Firebase Auth** y **Firestore**,
  y la seguridad la imponen las reglas de [`firestore.rules`](firestore.rules).

## Estructura

```
public/                  ← lo que publica Netlify
  index.html
  css/style.css
  js/
    main.js              ← autenticación, navegación y ciclo de vida de los listeners
    firebase.js          ← único punto de acceso al SDK (versión + configuración)
    estado.js            ← estado de la sesión (usuario, rol, turno, catálogo)
    ui.js                ← diálogos, toasts y manejo de botones ocupados
    lib/                 ← utilidades puras: dinero, fechas, DOM
    core/                ← reglas de negocio puras (testeables con Node)
    data/                ← acceso a Firestore (lo que antes hacían los controllers Java)
    views/               ← una vista por sección: pos, turno, egresos, admin, stock
firestore.rules          ← seguridad (la parte más importante)
firestore.indexes.json   ← índices compuestos
netlify.toml             ← publicación y cabeceras de seguridad (CSP)
scripts/set-rol.js       ← asigna roles a los usuarios
tests/unit/              ← tests de la lógica de negocio
tests/rules/             ← tests de las reglas contra el emulador de Firestore
```

## Puesta en marcha

### 1. Revocar la clave filtrada (urgente)

La clave `serviceAccountKey.json` quedó en el historial de Git (commit `1699a49`). En la
[consola de Google Cloud](https://console.cloud.google.com/iam-admin/serviceaccounts?project=kioscopro-db07e)
→ cuenta de servicio de Firebase → **Claves**, eliminá la clave vieja. Si necesitás una nueva para
`set-rol`, generala y guardala **fuera** del repositorio.

### 2. Instalar herramientas

Requisitos: Node 20+ y, para los tests de reglas y los emuladores, **Java 21+**.

```bash
npm install
npx firebase login
```

### 3. Asignar roles

Los roles viven en el token del usuario (custom claim `rol`), no en el código. Primero creá los usuarios
en Firebase Console → Authentication. Después:

```bash
# PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\claves\kiosco-admin.json"
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/fuera/del/repo/kiosco-admin.json
npm run set-rol -- nachomiretti@gmail.com admin
npm run set-rol -- empleado@ejemplo.com empleado
npm run set-rol -- ex-empleado@ejemplo.com ninguno   # quita el acceso
```

Un usuario sin rol no puede entrar.

### 4. Publicar reglas e índices

```bash
npm test              # primero, verificar que todo pase
npm run deploy:rules
```

> Hasta que publiques las reglas, la base sigue con las reglas que tenga hoy en la consola.

### 5. Publicar en Netlify

Conectá el repositorio en Netlify. No hace falta configurar nada más: `netlify.toml` indica que se
publica la carpeta `public/` y no hay comando de build.

Recomendado: en Google Cloud → APIs y servicios → Credenciales, restringí la API key web a los
dominios de Netlify (referentes HTTP).

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

## Modelo de datos

| Colección | Documento | Quién escribe |
|---|---|---|
| `productos/{id}` | `codigo, nombre, categoria, precioCompra, margen, precio, stock` | Admin. El empleado solo puede **bajar** `stock` al cobrar. |
| `turnos/{id}` | `empleadoId, empleadoNombre, cajaInicial, estado, fechaApertura, cajaFinal?, fechaCierre?` | El propio empleado (abrir/cerrar). |
| `turnosActivos/{uid}` | `turnoId` | Candado: garantiza **un solo turno abierto** por empleado. Se crea y borra en el mismo batch que el turno. |
| `ventas/{id}` | `tipo ("productos"\|"sube"), turnoId, empleadoId, empleadoNombre, metodoPago, items[], total, timestamp` | Empleado con turno abierto. **Inmutables.** |
| `egresos/{id}` | `turnoId, empleadoId, empleadoNombre, monto, motivo, fecha` | Empleado con turno abierto. **Inmutables.** |

Las fechas siempre las pone el servidor (`serverTimestamp`) y las reglas lo verifican.

**Venta:** se hace en una transacción que lee el stock y los precios vigentes, valida, descuenta el stock
y guarda la venta. Si dos cajas venden la última unidad a la vez, una falla en lugar de dejar stock negativo.

**Recarga SUBE:** es una venta `tipo: "sube"` cobrada con el método elegido. Suma a la caja (efectivo,
Mercado Pago o tarjeta) y además se muestra desglosada en el panel.

**Diferencia de caja:** `cajaFinal − (cajaInicial + ventas en efectivo − egresos)`.

## Limitaciones conocidas

- Las reglas no pueden recorrer listas: verifican que el empleado solo **baje** el stock y que la venta
  tenga un turno abierto propio, pero no que la cantidad descontada coincida con los ítems. Si en algún
  momento necesitás esa garantía, el paso siguiente es mover el cobro a una Cloud Function.
- Cobrar requiere conexión (las transacciones no funcionan offline). El catálogo sí carga desde la caché local.
- Datos anteriores a la migración: los productos con `codigoBarra` y las ventas SUBE viejas
  (`metodoPago: "Sube"`) se leen bien y se normalizan al editarlos. Los turnos abiertos con el sistema
  viejo se reconocen automáticamente al iniciar sesión. Si hubiera egresos muy viejos guardados
  con el campo `timestamp` en lugar de `fecha`, no aparecen en los filtros por fecha.
