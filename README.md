# Alternative Care · Manufacturing OS — Fase 2 completa

## ✨ Lo que ya funciona (Fase 1 + Fase 2)

**Núcleo:** Login y roles · Dashboard · Tasas multi-moneda · Configuración fiscal · Proveedores · Clientes · Usuarios · Almacenes

**Producción completa:**
- Materias primas con **lotes de recepción** (vencimiento, costo, proveedor por lote)
- **Fórmulas** con fases personalizables, modo % o cantidad fija, panel QC, **versionado**
- **Escalado** de fórmulas en tiempo real
- **Órdenes de Fabricación** con reserva FEFO de lotes específicos
- Workflow OF: Planificada → En proceso → Terminada (con merma real vs teórica)
- **Control de Calidad** según panel de la fórmula con evaluación automática contra rangos
- Estados QC: Aprobado / Aprobado con observaciones / Rechazado
- **COA en PDF** descargable
- **Producto Terminado** con estados (Cuarentena → Liberado / Rechazado)
- **Almacén** con kardex valorizado y todos los movimientos
- **Trazabilidad navegable** (Lote PT → OF → MPs → Lotes proveedores → QC)
- **Dashboard** con alertas: vencimientos, pendientes QC, OFs en proceso, stock bajo

## 🚀 Flujo end-to-end de prueba

1. Almacenes → crear ubicación
2. Materias primas → crear MP
3. Recepción → crear lote MP
4. Fórmulas → crear fórmula con fases + panel QC
5. OF → crear orden, asignar lotes MP, iniciar, terminar
6. Calidad → realizar prueba, aprobar
7. Producto Terminado → ver lote liberado
8. Trazabilidad → buscar el lote y ver toda la cadena

## 🔑 Login: admin / admin

## 📐 Notas técnicas

- **Lotes MP individuales**: stock total = suma de saldos de lotes
- **FEFO automático**: sugiere lotes que vencen primero
- **Reserva vs consumo**: OF planificada reserva, OF terminada consume
- **Kardex**: cada acción registra movimiento valorizado
- **Versionado**: editar fórmula crea nueva versión, no pisa la anterior

## 🛣️ Próximo (Fase 3)

Compras con retenciones · Ventas con facturación IVA · Pagos multi-moneda · Reportes (libro compras/ventas)

---

v2.0 · Fase 2 completa
