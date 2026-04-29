# Alternative Care · Manufacturing OS

Sistema integral de gestión para fábrica de cosméticos en Venezuela. Cuidado capilar (shampoos, acondicionadores). Multi-moneda con cálculo automático de IVA y retenciones.

---

## ✨ Fase 1 — Lo que ya funciona

- **Login y roles** — 7 roles distintos (admin, gerente, producción, calidad, almacén, ventas, compras) con permisos por módulo
- **Dashboard** — KPIs, alertas de configuración, tasas activas y accesos rápidos
- **Tasas de cambio** — BCV USD, BCV EUR, Binance USD y Tasa Personalizada. Convertidor en vivo. La tasa "activa" se usa por defecto en transacciones
- **Configuración** — Datos fiscales editables (razón social, RIF, dirección), parámetros de IVA y retención, exportar/importar respaldo, reset total
- **Materias primas** — CRUD completo con campos específicos para cuidado capilar: INCI, CAS, pH, % activo, densidad, vida útil, stock con alerta de mínimo
- **Proveedores** — Datos fiscales venezolanos (RIF, tipo de contribuyente), retenciones IVA/ISLR configurables por proveedor
- **Clientes** — Mayoristas, distribuidores, salones, tiendas. Crédito, descuentos, vendedor asignado
- **Usuarios** — Gestión de cuentas con roles y validaciones de seguridad

---

## 🚀 Cómo usarlo

### Localmente

1. Descomprime el ZIP
2. Abre `index.html` en un navegador moderno (Chrome, Firefox, Edge, Safari)
3. Inicia sesión con: `admin` / `admin`
4. **Primera tarea:** ve a `Configuración` y completa los datos fiscales de Alternative Care
5. **Segunda tarea:** ve a `Tasas de Cambio` y actualiza al menos la tasa BCV USD
6. **Tercera tarea:** ve a `Usuarios` y cambia la contraseña de `admin`, luego crea cuentas para tu equipo

### Subir a GitHub Pages

```bash
# Desde la carpeta alternative-care:
git init
git add .
git commit -m "Fase 1 - Núcleo operativo"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/alternative-care.git
git push -u origin main
```

Luego en GitHub: `Settings → Pages → Source: main / root → Save`. En 1-2 minutos estará online en `https://TU-USUARIO.github.io/alternative-care/`

---

## 🗂️ Estructura

```
alternative-care/
├── index.html                    Login + Dashboard
├── modules/
│   ├── tasas-cambio.html         ✅ Multi-moneda
│   ├── configuracion.html        ✅ Datos fiscales
│   ├── materias-primas.html      ✅ CRUD shampoo
│   ├── proveedores.html          ✅ RIF + retenciones
│   ├── clientes.html             ✅ Comercial
│   ├── usuarios.html             ✅ Roles y permisos
│   ├── formulas.html             ⏳ Fase 2
│   ├── produccion.html           ⏳ Fase 2
│   ├── calidad.html              ⏳ Fase 2
│   ├── trazabilidad.html         ⏳ Fase 2
│   ├── producto-terminado.html   ⏳ Fase 2
│   ├── envasado.html             ⏳ Fase 2
│   ├── almacen.html              ⏳ Fase 2
│   ├── compras.html              ⏳ Fase 3
│   ├── ventas.html               ⏳ Fase 3
│   ├── pagos.html                ⏳ Fase 3
│   └── reportes.html             ⏳ Fase 3
└── assets/
    ├── css/styles.css
    └── js/
        ├── db.js          Capa de datos (localStorage hoy, Firestore mañana)
        ├── auth.js        Login + permisos
        ├── currency.js    Conversiones VES/USD/EUR
        ├── tax.js         IVA + retenciones SENIAT
        └── ui.js          Sidebar, modales, toasts, tablas
```

---

## 🔐 Datos y respaldos

Toda la información se guarda en `localStorage` del navegador. Esto significa:

- ✅ Funciona sin internet, sin servidor, sin base de datos
- ✅ Es perfecto para empezar y probar el flujo completo
- ⚠️ Los datos viven solo en el navegador donde los registres
- ⚠️ Si abres el sistema desde otra computadora, no verás los mismos datos

**Por eso es importante hacer respaldos:** ve a `Configuración → Exportar todo` regularmente. Te genera un JSON que puedes guardar en Drive/Dropbox y restaurar después.

Cuando migremos a **Firebase** (etapa final), los datos se sincronizarán entre todos los usuarios en tiempo real — automáticamente. La estructura ya está preparada para eso: solo tendremos que reescribir `db.js` y `auth.js`.

---

## 📐 Decisiones técnicas importantes

### Multi-moneda

Cada transacción que crearemos en Fase 3 (compras, ventas, pagos) se guardará con **tres campos**:
- `amountVES` — el monto en bolívares
- `amountUSD` — el equivalente en USD
- `rateUsed` — la tasa congelada en ese momento
- `rateType` — qué tasa se usó (BCV_USD, BINANCE, etc.)

Esto significa que aunque mañana cambie el BCV, los reportes de meses pasados **no se distorsionan**. Cada transacción mantiene su valor histórico real.

### IVA y retenciones (Venezuela)

- IVA configurable (default 16%)
- Retención IVA configurable (default 75% — agente de retención general)
- ISLR configurable por tipo de servicio/proveedor
- En Fase 3, las facturas de compra calcularán automáticamente:
  - Subtotal + IVA = Total facturado
  - Total facturado − Retención IVA − Retención ISLR = Total a pagar al proveedor

### Roles

- **admin** → todo
- **gerente** → ve y edita casi todo (no usuarios ni reset de sistema)
- **producción** → fórmulas, OF, materias primas (ver), trazabilidad
- **calidad** → pruebas, liberación de lotes, fórmulas (consulta)
- **almacén** → inventarios, movimientos, recepciones
- **ventas** → clientes, pedidos, facturas, cobros
- **compras** → proveedores, OC, pagos a proveedores

---

## 🛣️ Roadmap

**Fase 2 — Producción** (siguiente entrega)
- Fórmulas con fases A/B/C, escalado por batch, costo automático
- Órdenes de fabricación que descuentan inventario
- Control de calidad: pH, viscosidad, microbiológico, aprobación de lote
- Trazabilidad completa: lote → materias primas → clientes
- Producto terminado por lote con cuarentena/liberado/rechazado
- Envasado y almacén

**Fase 3 — Comercial**
- Compras con cálculo automático de retenciones
- Ventas con facturación IVA y asignación FEFO de lotes
- Pagos multi-moneda con conciliación
- Reportes: libro de compras, libro de ventas, kardex valorizado, márgenes

**Fase 4 — Migración Firebase**
- Auth con Firebase Auth (email + contraseñas reales)
- Datos en Firestore, sincronización en tiempo real entre usuarios
- Reglas de seguridad por rol
- Storage para logos y documentos

---

## 🔑 Credenciales por defecto

```
Usuario:     admin
Contraseña:  admin
```

**⚠️ Cambia esta contraseña en cuanto inicies sesión por primera vez** desde el módulo `Usuarios`.

---

## ❓ Preguntas frecuentes

**¿Por qué guarda los datos en el navegador y no en una base de datos?**
Es la opción más rápida para empezar a usar el sistema *hoy mismo* sin pagar hosting ni configurar servidores. Sirve para validar el flujo y entrenar al equipo. Cuando estés conforme, migramos a Firebase y los datos se mueven automáticamente.

**¿Puedo perder los datos?**
Sí, si limpias la caché del navegador. **Haz respaldo cada semana** desde `Configuración → Exportar todo`.

**¿Funciona en celular?**
Sí, el diseño es responsivo. Pero el uso ideal es en computadora de escritorio o laptop.

**¿Cómo agrego más usuarios?**
`Sistema → Usuarios → Nuevo usuario`. Solo el admin puede hacerlo.

**¿Puedo cambiar el porcentaje de IVA si SENIAT lo modifica?**
Sí, en `Configuración → Parámetros fiscales`.

---

Hecho con cuidado para Alternative Care · v1.0 — Fase 1
