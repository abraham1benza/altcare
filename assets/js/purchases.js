/* ============================================
   purchases.js — Lógica de Compras
   OC → Recepción → Factura → Retenciones
   ============================================ */

const purchases = {

  PO_STATUS: {
    DRAFT:     { label: 'Borrador',         color: 'badge-plain'   },
    SENT:      { label: 'Enviada',          color: 'badge-accent'  },
    PARTIAL:   { label: 'Recepción parcial',color: 'badge-warning' },
    RECEIVED:  { label: 'Recibida',         color: 'badge-success' },
    INVOICED:  { label: 'Facturada',        color: 'badge-success' },
    CANCELLED: { label: 'Cancelada',        color: 'badge-danger'  }
  },

  INV_STATUS: {
    PENDING:  { label: 'Pendiente de pago', color: 'badge-warning' },
    PARTIAL:  { label: 'Pago parcial',      color: 'badge-warning' },
    PAID:     { label: 'Pagada',            color: 'badge-success' },
    OVERDUE:  { label: 'Vencida',           color: 'badge-danger'  },
    CANCELLED:{ label: 'Anulada',           color: 'badge-danger'  }
  },

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
    if (po.status !== 'DRAFT' && po.status !== 'SENT') throw new Error('Solo se pueden editar OCs en borrador o enviadas');
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
  createSupplierInvoice({ poId, supplierInvoiceNumber, supplierInvoiceControl, issueDate, dueDate, items, exempt, applyIVAWithholding, islrRate, notes }) {
    const po = poId ? db.getById(db.COLLECTIONS.purchaseOrders, poId) : null;
    const supplier = po ? db.getById(db.COLLECTIONS.suppliers, po.supplierId) : null;
    if (!supplier) throw new Error('Proveedor no encontrado');

    const code = db.nextCode(db.COLLECTIONS.supplierInvoices, 'FP');
    const subtotal = items.reduce((s, it) => s + (parseFloat(it.quantity) * parseFloat(it.unitPrice)), 0);
    const calc = tax.computeInvoiceWithWithholdings({
      subtotal,
      exempt: !!exempt,
      applyIVAWithholding: applyIVAWithholding !== false,
      islrRate: parseFloat(islrRate) || 0
    });

    const invoice = {
      code,
      poId: poId || null,
      poCode: po?.code || null,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierRif: supplier.rif,
      supplierInvoiceNumber: supplierInvoiceNumber || '',
      supplierInvoiceControl: supplierInvoiceControl || '',
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
      exempt: !!exempt,
      // Cálculos fiscales
      subtotal: calc.subtotal,
      ivaRate: calc.ivaRate,
      ivaAmount: calc.ivaAmount,
      total: calc.total,
      // Retenciones
      applyIVAWithholding: applyIVAWithholding !== false,
      ivaWithholdingRate: calc.ivaWithholdingRate,
      ivaWithheld: calc.ivaWithheld,
      islrRate: calc.islrRate,
      islrWithheld: calc.islrWithheld,
      totalToPay: calc.totalToPay,
      // Pago
      paidAmount: 0,
      paidPercent: 0,
      payments: [],     // ids de payments aplicados
      status: 'PENDING',
      voucherId: null,  // comprobante de retención
      notes: notes || ''
    };

    const saved = db.save(db.COLLECTIONS.supplierInvoices, invoice);

    // Si la factura está vinculada a una OC, marcar OC como facturada
    if (po) {
      po.status = 'INVOICED';
      po.invoiceId = saved.id;
      db.save(db.COLLECTIONS.purchaseOrders, po);
    }

    // Generar comprobante de retención si hay retenciones
    if ((calc.ivaWithheld + calc.islrWithheld) > 0) {
      const v = this.createWithholdingVoucher(saved.id);
      saved.voucherId = v.id;
      db.save(db.COLLECTIONS.supplierInvoices, saved);
    }

    return saved;
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
  applyPaymentToInvoice(invoiceId, paymentId, amountInInvoiceCurrency) {
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
    } else if (inv.paidAmount > 0) {
      inv.status = 'PARTIAL';
    }
    return db.save(db.COLLECTIONS.supplierInvoices, inv);
  }
};
