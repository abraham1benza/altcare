# Alternative Care · Manufacturing OS

Sistema de gestión de fabricación para cosmética y farma, con trazabilidad de
lote a lote, control de calidad y operación multi-moneda pensada para Venezuela.

Aplicación web sin build: HTML, CSS y JavaScript sobre Firebase (Auth +
Firestore). Se abre `index.html` y funciona.

---

## Módulos

**Núcleo** · Login y roles · Dashboard · Tasas multi-moneda con histórico ·
Configuración fiscal · Proveedores · Clientes · Usuarios · Almacenes

**Producción**
- Materias primas con **lotes de recepción** (vencimiento, costo y proveedor por lote)
- **Fórmulas** con fases personalizables, modo % o cantidad fija, panel QC y **versionado**
- **Escalado** de fórmulas en tiempo real
- **Órdenes de Fabricación** con reserva FEFO de lotes específicos
- Workflow OF: Planificada → En proceso → Terminada (con merma real vs teórica)
- **Control de Calidad** con evaluación automática contra los rangos de la fórmula
- Estados QC: Aprobado / Aprobado con observaciones / Rechazado
- **COA en PDF** descargable
- **Producto Terminado** con estados (Cuarentena → Liberado / Rechazado)
- **Almacén** con kardex valorizado en USD
- **Trazabilidad navegable** (Lote PT → OF → MPs → Lotes proveedores → QC)

**Comercial y administración**
- **Compras** con recepciones, facturas de proveedor y retenciones
- **Ventas** con cotización → nota de entrega → factura, IVA y numeración fiscal
- Notas de crédito y débito
- **Pagos** multi-moneda, cuentas bancarias y conciliación
- **Comisiones** de vendedores y préstamos
- **Reportes**: libro de compras, libro de ventas y analíticos
- **Notificaciones** e **Importación** masiva

**Sistema**
- **Diagnóstico**: verificación de consistencia de datos (solo admin y gerente)

---

## Puesta en marcha

### 1. Servir los archivos

No hay paso de build. Cualquier servidor estático sirve:

```bash
python -m http.server 8080
```

Abrir `http://localhost:8080`. No funciona abriendo el archivo con `file://`
porque `firebase-init.js` es un módulo ES y el navegador lo bloquea.

### 2. Desplegar las reglas de seguridad

**Este paso no es opcional.** La matriz de roles de `assets/js/auth.js` solo
decide qué se dibuja en pantalla: cualquiera con la consola del navegador
abierta puede saltársela. Lo único que protege los datos de verdad son las
reglas de Firestore.

```bash
firebase deploy --only firestore:rules
```

O pegando el contenido de [`firestore.rules`](firestore.rules) en
Firebase Console → Firestore → Reglas.

### 3. Crear el primer usuario

Alta en Firebase Auth (email + contraseña) y un documento en la colección
`users` con el UID como id:

```json
{ "email": "...", "fullName": "...", "role": "admin" }
```

El campo `role` es obligatorio. Un perfil sin rol solo ve el dashboard.

---

## Roles

| Rol | Alcance |
|---|---|
| `admin` | Todo, incluida la gestión de usuarios |
| `gerente` | Todo el negocio salvo usuarios |
| `contador` | Reportes, compras, ventas, pagos, bancos, tasas |
| `ventas` | Clientes, ventas, pagos, notificaciones |
| `compras` | Proveedores, compras, pagos, notificaciones |
| `produccion` | Fórmulas, OF, calidad, producto terminado, almacén |
| `almacen` | Almacén, materias primas, producto terminado, trazabilidad |
| `calidad` | Control de calidad y trazabilidad |

Se pueden sumar módulos sueltos a un usuario con `extraModules`, o quitárselos
con `hiddenModules`.

---

## Notas técnicas

- **Lotes de MP individuales**: el stock total es la suma de los saldos de los lotes.
- **FEFO automático**: sugiere primero los lotes que vencen antes.
- **Reserva vs consumo**: una OF planificada *reserva* (marca el campo `reserved`);
  una OF terminada *consume* (baja el `balance`). Reservar **no** mueve stock, por
  eso los movimientos `RESERVATION` y `UNRESERVATION` no alteran el saldo del kardex.
- **Kardex valorizado en USD**: cada movimiento congela su `unitCostUSD` con la tasa
  BCV de su fecha. Es la única forma de que el histórico sea comparable con una
  moneda local que se devalúa.
- **Versionado de fórmulas**: editar crea una versión nueva, nunca pisa la anterior;
  si no, se rompería la trazabilidad de los lotes ya fabricados.
- **Numeración fiscal atómica**: los números de factura y de control se reservan con
  una transacción de Firestore sobre `config/main`. Cada serie es independiente, no
  se repite aunque dos personas facturen a la vez, y no se reutiliza al borrar.

---

## Diagnóstico

`modules/diagnostico.html` compara lo que el sistema dice que tiene contra lo que
sus propios registros implican. Es de solo lectura: reporta y no corrige, porque
un descuadre casi siempre tiene una causa concreta que conviene entender.

Revisa saldos de lote contra el kardex, saldos negativos, numeración fiscal
duplicada, sobre-reservas, movimientos sin valorizar y lotes vencidos con
existencia.

---

## Limitaciones conocidas

- **Sin sincronización en vivo**: `db.js` carga cada colección una vez al iniciar
  sesión y no usa `onSnapshot`. Dos personas trabajando a la vez no ven los
  cambios de la otra hasta recargar.
- **Escrituras optimistas**: `db.save()` actualiza la caché y escribe a Firestore
  en segundo plano. Si la escritura falla, la interfaz ya mostró el dato.
- **Carga completa al iniciar**: se leen las 38 colecciones enteras en cada login.
  Con historial acumulado esto pesa en tiempo y en costo de Firestore.
- **Sin modo oscuro**: hay 287 colores fijos en estilos inline repartidos en 20
  archivos. Habría que migrarlos a variables CSS antes de poder ofrecerlo.

---

## Estructura

```
index.html              Login y dashboard
firestore.rules         Reglas de seguridad (hay que desplegarlas)
modules/*.html          Una página por módulo
assets/css/styles.css   Sistema de diseño completo
assets/img/logo.png     Logo
assets/js/
  firebase-init.js      Inicialización de Firebase
  utils.js              round(), escapeHtml() — cargar antes que el resto
  db.js                 Capa de datos y caché
  auth.js               Sesión y matriz de roles
  currency.js           Multi-moneda y tasas históricas
  inventory.js          Lotes, kardex y FEFO
  formulas.js           Escalado y costeo
  sales.js  purchases.js  payments.js  commissions.js
  reports.js  notifications.js  reconciliation.js  tax.js
  ui.js                 Layout, tablas, modales, toasts
```
