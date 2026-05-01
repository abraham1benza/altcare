/* ============================================
   purchases.js — Lógica de Compras
   OC → Recepción → Factura → Retenciones
   ============================================ */

const purchases = {

  PO_STATUS: {
    DRAFT:     { label: 'Borrador',         color: 'badge-plain'     },
    SENT:      { label: 'Enviada',          color: 'badge-order'     },
    PARTIAL:   { label: 'Recepción parcial',color: 'badge-partial'   },
    RECEIVED:  { label: 'Recibida',         color: 'badge-active'    },
    INVOICED:  { label: 'Facturada',        color: 'badge-invoice'   },
    CANCELLED: { label: 'Cancelada',        color: 'badge-cancelled' }
  },

  INV_STATUS: {
    PENDING:  { label: 'Pendiente de pago', color: 'badge-partial'   },
    PARTIAL:  { label: 'Pago parcial',      color: 'badge-partial'   },
    PAID:     { label: 'Pagada',            color: 'badge-paid'      },
    OVERDUE:  { label: 'Vencida',           color: 'badge-overdue'   },
    CANCELLED:{ label: 'Anulada',           color: 'badge-cancelled' }
  },

  // Tipos de documento de proveedor (recepción)
  INVENTORY_TYPES: ['NOTA_ENTREGA', 'FACTURA'],
  // Tipos que entran al libro fiscal SENIAT
  FISCAL_TYPES: ['FACTURA'],

  // ====== ÓRDENES DE COMPRA ======

  /** Crea OC. Cabecera + items con MP, cantidad, precio. */
  createPO({ supplierId, currency: docCurrency, rateType, items, notes, expectedDate }) {
    const supplier = db.getById(db.COLLECTIONS.suppliers, supplierId);
    if (!supplier) throw new Error('Proveedor no encontrado');
    if (!items || !items.length) throw new Error('La OC debe tener al menos un ítem');

    const code = db.nextCode(db.COLLECTIONS.purchaseOrders, 'OC');
    // Calcular totales
    const subtotal = items.reduce((s, it) => s + (it.quantity * it.unitPrice), 0);

    const po = {
      code,
      supplierId,
      supplierName: supplier.name,
      supplierRif: supplier.rif,
      currency: docCurrency || supplier.preferredCurrency || 'USD',
      rateType: rateType || 'BCV_USD',
      rateValue: currency.getRate(rateType || 'BCV_USD')?.value || 0,
      issueDate: new Date().toISOString().slice(0,10),
      expectedDate: expectedDate || null,
      items: items.map(it => ({
        rawMaterialId: it.rawMaterialId,
        rawMaterialCode: it.rawMaterialCode,
        rawMaterialName: it.rawMaterialName,
        quantity: parseFloat(it.quantity) || 0,
        receivedQuantity: 0,
        unit: it.unit,
        unitPrice: parseFloat(it.unitPrice) || 0,
        subtotal: parseFloat(it.quantity) * parseFloat(it.unitPrice),
        notes: it.notes || ''
      })),
      subtotal,
      notes: notes || '',
      status: 'DRAFT',
      receivedAt: null,
      invoiceId: null
    };
    return db.save(db.COLLECTIONS.purchaseOrders, po);
  },

  updatePO(poId, data) {
    const po = db.getById(db.COLLECTIONS.purchaseOrders, poId);
    if (!po) throw new Error('OC no encontrada');
    // Permitir editar mientras no esté facturada (puede tener factura tipo NE pendiente, ahí sí se permite)
    const hasInvoice = po.invoiceId && po.invoiceType === 'FACTURA';
    if (hasInvoice) throw new Error('No se puede editar una OC ya facturada (con factura legal). Si necesita cambios, anúlela y cree una nueva.');
    if (po.status === 'CANCELLED') throw new Error('No se puede editar una OC anulada');
    Object.assign(po, data);
    if (data.items) po.subtotal = data.items.reduce((s, it) => s + (it.quantity * it.unitPrice), 0);
    return db.save(db.COLLECTIONS.purchaseOrders, po);
  },

  changePOStatus(poId, status) {
    const po = db.getById(db.COLLECTIONS.purchaseOrders, poId);
    if (!po) throw new Error('OC no encontrada');
    po.status = status;
    return db.save(db.COLLECTIONS.purchaseOrders, po);
  },

  // ====== RECEPCIÓN ======

  /**
   * Registra una recepción contra OC. Crea lotes MP automáticamente.
   * @param {object} data - { poId, receivedItems: [{poItemIdx, quantity, lotNumber, expiryDate, warehouseId, locationId, notes}] }
   */
  registerReceipt({ poId, receivedItems, receiptDate, notes }) {
    const po = db.getById(db.COLLECTIONS.purchaseOrders, poId);
    if (!po) throw new Error('OC no encontrada');
    if (!receivedItems || !receivedItems.length) throw new Error('Sin items para recibir');

    const code = db.nextCode(db.COLLECTIONS.purchaseReceipts, 'REC');
    const date = receiptDate || new Date().toISOString().slice(0,10);

    // Crear lotes MP
    const lotsCreated = [];
    receivedItems.forEach(ri => {
      const poItem = po.items[ri.poItemIdx];
      if (!poItem) return;
      const qty = parseFloat(ri.quantity) || 0;
      if (qty <= 0) return;

      // Convertir precio a moneda del lote (preservar moneda OC)
      const lot = inventory.createRMLot({
        rawMaterialId: poItem.rawMaterialId,
        supplierId: po.supplierId,
        quantity: qty,
        unitCost: poItem.unitPrice,
        costCurrency: po.currency,
        receiptDate: date,
        expiryDate: ri.expiryDate || null,
        supplierLotNumber: ri.lotNumber || '',
        warehouseId: ri.warehouseId,
        locationId: ri.locationId || null,
        notes: ri.notes || `Recibido por ${code} de OC ${po.code}`
      });
      lotsCreated.push({ poItemIdx: ri.poItemIdx, lotId: lot.id, quantity: qty });

      // Actualizar cantidad recibida en la OC
      poItem.receivedQuantity = (parseFloat(poItem.receivedQuantity) || 0) + qty;

      // Actualizar último costo de MP
      const rm = db.getById(db.COLLECTIONS.rawMaterials, poItem.rawMaterialId);
      if (rm) {
        rm.lastCost = poItem.unitPrice;
        rm.lastCostCurrency = po.currency;
        rm.supplierId = po.supplierId;
        db.save(db.COLLECTIONS.rawMaterials, rm);
      }
    });

    // Actualizar estado OC
    const allReceived = po.items.every(it => (it.receivedQuantity || 0) >= it.quantity);
    const anyReceived = po.items.some(it => (it.receivedQuantity || 0) > 0);
    po.status = allReceived ? 'RECEIVED' : (anyReceived ? 'PARTIAL' : po.status);
    if (allReceived) po.receivedAt = new Date().toISOString();
    db.save(db.COLLECTIONS.purchaseOrders, po);

    // Guardar registro de recepción
    const receipt = {
      code,
      poId,
      poCode: po.code,
      supplierId: po.supplierId,
      supplierName: po.supplierName,
      receiptDate: date,
      items: lotsCreated,
      notes: notes || ''
    };
    return db.save(db.COLLECTIONS.purchaseReceipts, receipt);
  },

  // ====== FACTURA DE PROVEEDOR ======

  /**
   * Crea factura del proveedor. Calcula IVA + retenciones automáticamente.
   */
  createSupplierInvoice({ poId, supplierInvoiceNumber, supplierInvoiceControl, issueDate, dueDate, items, exempt, applyIVAWithholding, islrRate, notes, inventoryType }) {
    const po = poId ? db.getById(db.COLLECTIONS.purchaseOrders, poId) : null;
    const supplier = po ? db.getById(db.COLLECTIONS.suppliers, po.supplierId) : null;
    if (!supplier) throw new Error('Proveedor no encontrado');

    // Tipo: FACTURA (default, fiscal) o NOTA_ENTREGA (no fiscal)
    const docType = inventoryType === 'NOTA_ENTREGA' ? 'NOTA_ENTREGA' : 'FACTURA';
    const isNote = docType === 'NOTA_ENTREGA';

    // Código según tipo: NE-XXXX para notas, FP-XXXX para facturas
    const codePrefix = isNote ? 'NE' : 'FP';
    const code = db.nextCode(db.COLLECTIONS.supplierInvoices, codePrefix);

    const subtotal = items.reduce((s, it) => s + (parseFloat(it.quantity) * parseFloat(it.unitPrice)), 0);
    const calc = tax.computeInvoiceWithWithholdings({
      subtotal,
      exempt: !!exempt,
      // Las NE no aplican retenciones (no son fiscales)
      applyIVAWithholding: isNote ? false : (applyIVAWithholding !== false),
      islrRate: isNote ? 0 : (parseFloat(islrRate) || 0)
    });

    const invoice = {
      code,
      inventoryType: docType,             // 'FACTURA' | 'NOTA_ENTREGA'
      poId: poId || null,
      poCode: po?.code || null,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierRif: supplier.rif,
      supplierInvoiceNumber: isNote ? '' : (supplierInvoiceNumber || ''),  // las NE no tienen número fiscal
      supplierInvoiceControl: isNote ? '' : (supplierInvoiceControl || ''),
      issueDate: issueDate || new Date().toISOString().slice(0,10),
      dueDate: dueDate || null,
      currency: po?.currency || supplier.preferredCurrency || 'USD',
      rateType: po?.rateType || 'BCV_USD',
      rateValue: po?.rateValue || (currency.getActiveRate()?.value || 0),
      items: items.map(it => ({
        rawMaterialId: it.rawMaterialId,
        rawMaterialName: it.rawMaterialName,
        description: it.description || it.rawMaterialName,
        quantity: parseFloat(it.quantity) || 0,
        unit: it.unit,
        unitPrice: parseFloat(it.unitPrice) || 0,
        subtotal: parseFloat(it.quantity) * parseFloat(it.unitPrice)
      })),
      exempt: isNote ? true : !!exempt,   // NE no aplica IVA
      // Cálculos fiscales (NE: solo subtotal, sin IVA, sin retenciones)
      subtotal: calc.subtotal,
      ivaRate: isNote ? 0 : calc.ivaRate,
      ivaAmount: isNote ? 0 : calc.ivaAmount,
      total: calc.total,
      applyIVAWithholding: isNote ? false : (applyIVAWithholding !== false),
      ivaWithholdingRate: isNote ? 0 : calc.ivaWithholdingRate,
      ivaWithheld: isNote ? 0 : calc.ivaWithheld,
      islrRate: isNote ? 0 : calc.islrRate,
      islrWithheld: isNote ? 0 : calc.islrWithheld,
      totalToPay: calc.totalToPay,
      // Pago
      paidAmount: 0,
      paidPercent: 0,
      payments: [],
      status: 'PENDING',
      voucherId: null,
      notes: notes || ''
    };

    const saved = db.save(db.COLLECTIONS.supplierInvoices, invoice);

    // Si está vinculado a OC, marcarla
    if (po) {
      po.status = isNote ? 'RECEIVED' : 'INVOICED';
      po.invoiceId = saved.id;
      po.invoiceType = docType;
      db.save(db.COLLECTIONS.purchaseOrders, po);
    }

    // Solo facturas generan comprobante de retención (las NE no tienen retenciones)
    if (!isNote && (calc.ivaWithheld + calc.islrWithheld) > 0) {
      const v = this.createWithholdingVoucher(saved.id);
      saved.voucherId = v.id;
      db.save(db.COLLECTIONS.supplierInvoices, saved);
    }

    return saved;
  },

  /**
   * Convierte una Nota de Entrega de proveedor en una Factura.
   * Recalcula IVA y retenciones, asigna nuevo código, y entra al libro fiscal.
   */
  convertNoteToInvoice(noteId, invoiceData) {
    const note = db.getById(db.COLLECTIONS.supplierInvoices, noteId);
    if (!note) throw new Error('Documento no encontrado');
    if (note.inventoryType !== 'NOTA_ENTREGA') throw new Error('Solo se pueden convertir Notas de Entrega');
    if (note.status === 'CANCELLED') throw new Error('No se puede convertir una nota anulada');

    // Datos nuevos: número fiscal, control, IVA, retenciones
    const supplierInvoiceNumber = invoiceData?.supplierInvoiceNumber || '';
    const supplierInvoiceControl = invoiceData?.supplierInvoiceControl || '';
    const applyIVAWithholding = invoiceData?.applyIVAWithholding !== false;
    const islrRate = parseFloat(invoiceData?.islrRate) || 0;
    const exempt = !!invoiceData?.exempt;

    if (!supplierInvoiceNumber) throw new Error('El número de factura del proveedor es obligatorio');

    // Recalcular con IVA y retenciones
    const subtotal = note.items.reduce((s, it) => s + (it.quantity * it.unitPrice), 0);
    const calc = tax.computeInvoiceWithWithholdings({
      subtotal,
      exempt,
      applyIVAWithholding,
      islrRate
    });

    // Cambiar código: de NE-XXXX a FP-XXXX
    const newCode = db.nextCode(db.COLLECTIONS.supplierInvoices, 'FP');

    note.code = newCode;
    note.inventoryType = 'FACTURA';
    note.supplierInvoiceNumber = supplierInvoiceNumber;
    note.supplierInvoiceControl = supplierInvoiceControl;
    note.exempt = exempt;
    note.subtotal = calc.subtotal;
    note.ivaRate = calc.ivaRate;
    note.ivaAmount = calc.ivaAmount;
    note.total = calc.total;
    note.applyIVAWithholding = applyIVAWithholding;
    note.ivaWithholdingRate = calc.ivaWithholdingRate;
    note.ivaWithheld = calc.ivaWithheld;
    note.islrRate = calc.islrRate;
    note.islrWithheld = calc.islrWithheld;

    // Recalcular totalToPay considerando lo ya pagado
    const remainingTotal = calc.totalToPay;
    note.totalToPay = remainingTotal;
    // El estado se recalcula
    if (note.paidAmount >= remainingTotal - 0.01) {
      note.status = 'PAID';
    } else if (note.paidAmount > 0) {
      note.status = 'PARTIAL';
    } else {
      note.status = 'PENDING';
    }
    note.paidPercent = remainingTotal > 0 ? (note.paidAmount / remainingTotal) * 100 : 0;

    note.convertedFromNoteAt = new Date().toISOString();
    db.save(db.COLLECTIONS.supplierInvoices, note);

    // Si tiene OC, actualizarla
    if (note.poId) {
      const po = db.getById(db.COLLECTIONS.purchaseOrders, note.poId);
      if (po) {
        po.status = 'INVOICED';
        po.invoiceType = 'FACTURA';
        db.save(db.COLLECTIONS.purchaseOrders, po);
      }
    }

    // Generar comprobante de retención si corresponde
    if ((calc.ivaWithheld + calc.islrWithheld) > 0) {
      const v = this.createWithholdingVoucher(note.id);
      note.voucherId = v.id;
      db.save(db.COLLECTIONS.supplierInvoices, note);
    }

    return note;
  },

  /** Crea comprobante de retención (CR) */
  createWithholdingVoucher(invoiceId) {
    const inv = db.getById(db.COLLECTIONS.supplierInvoices, invoiceId);
    if (!inv) throw new Error('Factura no encontrada');
    const code = db.nextCode(db.COLLECTIONS.withholdingVouchers, 'CR');
    const v = {
      code,
      invoiceId: inv.id,
      invoiceCode: inv.code,
      supplierInvoiceNumber: inv.supplierInvoiceNumber,
      supplierInvoiceControl: inv.supplierInvoiceControl,
      supplierId: inv.supplierId,
      supplierName: inv.supplierName,
      supplierRif: inv.supplierRif,
      issueDate: new Date().toISOString().slice(0,10),
      taxableBase: inv.subtotal,
      ivaAmount: inv.ivaAmount,
      ivaWithholdingRate: inv.ivaWithholdingRate,
      ivaWithheld: inv.ivaWithheld,
      islrRate: inv.islrRate,
      islrWithheld: inv.islrWithheld,
      totalWithheld: inv.ivaWithheld + inv.islrWithheld,
      currency: inv.currency
    };
    return db.save(db.COLLECTIONS.withholdingVouchers, v);
  },

  /** Aplica un pago a una factura de proveedor */
  applyPaymentToInvoice(invoiceId, paymentId, amountInInvoiceCurrency, paymentRate = null, paymentRateType = 'BCV_USD') {
    const inv = db.getById(db.COLLECTIONS.supplierInvoices, invoiceId);
    if (!inv) throw new Error('Factura no encontrada');
    const amount = parseFloat(amountInInvoiceCurrency) || 0;
    if (amount <= 0) throw new Error('Monto del pago debe ser positivo');
    inv.paidAmount = Math.round(((inv.paidAmount || 0) + amount) * 100) / 100;
    inv.payments = inv.payments || [];
    if (!inv.payments.includes(paymentId)) inv.payments.push(paymentId);
    inv.paidPercent = inv.totalToPay > 0 ? (inv.paidAmount / inv.totalToPay) * 100 : 0;
    const remaining = Math.round((inv.totalToPay - inv.paidAmount) * 100) / 100;
    if (remaining <= 0.01) {
      inv.status = 'PAID';
      // CONGELAR TASA AL COMPLETAR PAGO
      if (paymentRate && paymentRate > 0 && !inv.rateAtFullPayment) {
        inv.rateAtFullPayment = paymentRate;
        inv.rateTypeAtFullPayment = paymentRateType;
        // Calcular total congelado
        if (inv.currency === 'USD') {
          inv.totalVES_atFullPayment = Math.round(inv.totalToPay * paymentRate * 100) / 100;
          inv.totalUSD_atFullPayment = inv.totalToPay;
        } else if (inv.currency === 'VES') {
          inv.totalVES_atFullPayment = inv.totalToPay;
          inv.totalUSD_atFullPayment = Math.round((inv.totalToPay / paymentRate) * 100) / 100;
        }
        inv.fullPaymentDate = new Date().toISOString();
      }
    } else if (inv.paidAmount > 0) {
      inv.status = 'PARTIAL';
    }
    return db.save(db.COLLECTIONS.supplierInvoices, inv);
  }
};
