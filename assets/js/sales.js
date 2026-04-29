/* ============================================
   sales.js — Lógica de Ventas
   Pedido / Cotización / Factura → Asignación FEFO de lotes PT
   ============================================ */

const sales = {

  // Estados que puede tener un documento de venta. Empieza como PEDIDO y cambia.
  STATUS: {
    PEDIDO:    { label: 'Pedido',          color: 'badge-plain'   },
    COTIZACION:{ label: 'Cotización',      color: 'badge-accent'  },
    FACTURA:   { label: 'Factura',         color: 'badge-success' },
    PARTIAL:   { label: 'Pago parcial',    color: 'badge-warning' },
    PAID:      { label: 'Pagada',          color: 'badge-success' },
    OVERDUE:   { label: 'Vencida',         color: 'badge-danger'  },
    CANCELLED: { label: 'Anulada',         color: 'badge-danger'  }
  },

  // ====== PEDIDO / COTIZACIÓN / FACTURA ======

  /**
   * Crea un documento de venta en estado inicial (PEDIDO por defecto).
   * Items: [{ formulaId, formulaName, fgLotId (opcional), quantity, unitPrice, unit, notes }]
   */
  create({ customerId, currency: docCurrency, rateType, items, status, notes, paymentTerms, dueDate }) {
    const customer = db.getById(db.COLLECTIONS.customers, customerId);
    if (!customer) throw new Error('Cliente no encontrado');
    if (!items || !items.length) throw new Error('Debe haber al menos un ítem');

    const code = db.nextCode(db.COLLECTIONS.salesOrders, 'V');
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};

    // Normalizar items y calcular totales
    const normalizedItems = items.map(it => ({
      formulaId: it.formulaId || null,
      formulaName: it.formulaName || it.description || '',
      fgLotId: it.fgLotId || null,
      fgLotCode: it.fgLotCode || null,
      description: it.description || it.formulaName || '',
      quantity: parseFloat(it.quantity) || 0,
      unit: it.unit || 'unidad',
      unitPrice: parseFloat(it.unitPrice) || 0,
      discount: parseFloat(it.discount) || 0,
      subtotal: ((parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0)) * (1 - (parseFloat(it.discount) || 0) / 100),
      exempt: !!it.exempt,
      notes: it.notes || ''
    }));
    const subtotal = normalizedItems.reduce((s, it) => s + it.subtotal, 0);

    // Cálculo IVA con la alícuota configurada
    const ivaRate = cfg.ivaRate || 16;
    const taxableBase = normalizedItems.filter(it => !it.exempt).reduce((s, it) => s + it.subtotal, 0);
    const exemptBase = normalizedItems.filter(it => it.exempt).reduce((s, it) => s + it.subtotal, 0);
    const ivaAmount = taxableBase * (ivaRate / 100);
    const total = subtotal + ivaAmount;

    const doc = {
      code,
      type: status || 'PEDIDO',           // PEDIDO | COTIZACION | FACTURA
      status: status || 'PEDIDO',
      // Datos cliente (snapshot - no cambia si cliente se edita después)
      customerId,
      customerName: customer.name,
      customerRif: customer.rif,
      customerAddress: customer.address || '',
      customerPhone: customer.phone || '',
      // Numeración fiscal (solo se asigna al convertir a FACTURA)
      invoiceNumber: null,
      controlNumber: null,
      // Fechas
      issueDate: new Date().toISOString().slice(0,10),
      dueDate: dueDate || null,
      paymentTerms: paymentTerms || cfg.invoicePaymentTermsDefault || 'Contado',
      // Moneda
      currency: docCurrency || customer.preferredCurrency || 'VES',
      rateType: rateType || (cfg.defaultRateType || 'BCV_USD'),
      rateValue: currency.getRate(rateType || cfg.defaultRateType || 'BCV_USD')?.value || 0,
      // Items
      items: normalizedItems,
      // Totales
      subtotal: round(subtotal),
      taxableBase: round(taxableBase),
      exemptBase: round(exemptBase),
      ivaRate,
      ivaAmount: round(ivaAmount),
      total: round(total),
      // Equivalente en VES (para libros SENIAT)
      totalVES: docCurrency === 'VES' ? round(total) : round(total * (currency.getRate(rateType || cfg.defaultRateType || 'BCV_USD')?.value || 0)),
      // Pago
      paidAmount: 0,
      paidPercent: 0,
      payments: [],
      // Asignación de lotes (al convertir a FACTURA)
      lotsAssigned: false,
      // Cancelación
      cancelled: false,
      cancellationReason: null,
      notes: notes || ''
    };

    return db.save(db.COLLECTIONS.salesOrders, doc);
  },

  /** Convierte el documento a otro estado: PEDIDO → COTIZACION o FACTURA */
  convertTo(docId, newStatus) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');
    if (doc.cancelled) throw new Error('Documento anulado');
    if (newStatus === 'FACTURA' && doc.status === 'FACTURA') throw new Error('Ya es factura');

    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};

    if (newStatus === 'FACTURA') {
      // Asignar número de control y número de factura
      const allInvoices = db.getAll(db.COLLECTIONS.salesOrders).filter(d => d.invoiceNumber);
      const nextInvoice = allInvoices.length + 1;
      doc.invoiceNumber = `${cfg.invoiceNumberPrefix||'F'}-${String(nextInvoice).padStart(8,'0')}`;
      doc.controlNumber = `${cfg.invoiceControlNumberPrefix||'00'}-${String(nextInvoice).padStart(8,'0')}`;
      doc.invoicedAt = new Date().toISOString();
    }

    doc.type = newStatus;
    doc.status = newStatus;
    return db.save(db.COLLECTIONS.salesOrders, doc);
  },

  /**
   * Sugiere lotes FEFO para cada item de la factura.
   * No los descuenta — solo devuelve la sugerencia para que el usuario confirme.
   */
  suggestLotsForDoc(doc) {
    return doc.items.map(it => {
      if (!it.formulaId) return { ...it, suggestions: [] };
      // Buscar lotes liberados de esta fórmula con stock disponible, ordenados por vencimiento
      const lots = db.query(db.COLLECTIONS.finishedGoods, l =>
        l.formulaId === it.formulaId &&
        l.status === 'LIBERADO' &&
        (l.balance - (l.reserved||0)) > 0
      );
      lots.sort((a, b) => (a.expiryDate||'9999').localeCompare(b.expiryDate||'9999'));
      // Sugerir reparto en orden FEFO hasta cubrir la cantidad
      const suggestions = [];
      let remaining = it.quantity;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const avail = lot.balance - (lot.reserved||0);
        const take = Math.min(remaining, avail);
        suggestions.push({ lotId: lot.id, lotCode: lot.code, expiryDate: lot.expiryDate, available: avail, take });
        remaining -= take;
      }
      return { ...it, suggestions, missing: Math.max(0, remaining) };
    });
  },

  /**
   * Confirma asignación de lotes y descuenta inventario.
   * lotAssignments: [{ itemIdx, allocations: [{ lotId, quantity }] }]
   */
  confirmLotAssignment(docId, lotAssignments) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');
    if (doc.lotsAssigned) throw new Error('Lotes ya asignados');

    // Validar disponibilidad y descontar
    lotAssignments.forEach(la => {
      const item = doc.items[la.itemIdx];
      if (!item) return;
      item.allocations = la.allocations.map(a => ({
        lotId: a.lotId,
        lotCode: db.getById(db.COLLECTIONS.finishedGoods, a.lotId)?.code,
        quantity: parseFloat(a.quantity) || 0
      }));
      // Descontar de cada lote
      la.allocations.forEach(a => {
        const lot = db.getById(db.COLLECTIONS.finishedGoods, a.lotId);
        if (!lot) return;
        const qty = parseFloat(a.quantity) || 0;
        if (qty > (lot.balance - (lot.reserved||0))) throw new Error(`Lote ${lot.code}: stock insuficiente`);
        lot.balance = Math.max(0, lot.balance - qty);
        db.save(db.COLLECTIONS.finishedGoods, lot);
        // Registrar movimiento
        inventory.registerMove({
          type: 'SALE',
          itemKind: 'PT',
          itemId: lot.formulaId,
          itemCode: lot.code,
          itemName: lot.formulaName,
          lotId: lot.id,
          lotCode: lot.code,
          quantity: qty,
          unit: lot.unit,
          unitCost: lot.unitCost,
          costCurrency: lot.costCurrency,
          warehouseId: lot.warehouseId,
          reference: `Venta ${doc.invoiceNumber || doc.code}`
        });
      });
    });

    doc.lotsAssigned = true;
    doc.lotsAssignedAt = new Date().toISOString();
    return db.save(db.COLLECTIONS.salesOrders, doc);
  },

  /** Anula factura (no se eliminan documentos fiscales, se anulan) */
  cancel(docId, reason) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');
    // Si tenía lotes asignados, devolverlos
    if (doc.lotsAssigned) {
      doc.items.forEach(item => {
        (item.allocations || []).forEach(a => {
          const lot = db.getById(db.COLLECTIONS.finishedGoods, a.lotId);
          if (lot) {
            lot.balance = (lot.balance || 0) + a.quantity;
            db.save(db.COLLECTIONS.finishedGoods, lot);
            inventory.registerMove({
              type: 'ADJUSTMENT_IN',
              itemKind: 'PT',
              itemId: lot.formulaId,
              itemCode: lot.code,
              itemName: lot.formulaName,
              lotId: lot.id,
              lotCode: lot.code,
              quantity: a.quantity,
              unit: lot.unit,
              unitCost: lot.unitCost,
              costCurrency: lot.costCurrency,
              warehouseId: lot.warehouseId,
              reference: `Anulación ${doc.invoiceNumber || doc.code}`
            });
          }
        });
      });
    }
    doc.cancelled = true;
    doc.status = 'CANCELLED';
    doc.cancellationReason = reason || '';
    doc.cancelledAt = new Date().toISOString();
    return db.save(db.COLLECTIONS.salesOrders, doc);
  },

  /** Aplica un pago a un documento de venta (factura) */
  applyPayment(docId, paymentId, amountInDocCurrency) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');
    const amount = parseFloat(amountInDocCurrency) || 0;
    if (amount <= 0) throw new Error('Monto del pago debe ser positivo');
    doc.paidAmount = Math.round(((doc.paidAmount || 0) + amount) * 100) / 100;
    doc.payments = doc.payments || [];
    if (!doc.payments.includes(paymentId)) doc.payments.push(paymentId);
    doc.paidPercent = doc.total > 0 ? (doc.paidAmount / doc.total) * 100 : 0;
    // Estado: PAID solo si pagado >= total con tolerancia mínima
    const remaining = Math.round((doc.total - doc.paidAmount) * 100) / 100;
    if (remaining <= 0.01) {
      doc.status = 'PAID';
    } else if (doc.paidAmount > 0) {
      doc.status = 'PARTIAL';
    }
    return db.save(db.COLLECTIONS.salesOrders, doc);
  },

  /** Recalcula totales de un documento (cuando cambia IVA en config o se editan items) */
  recompute(doc) {
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};
    const ivaRate = cfg.ivaRate || 16;
    doc.items.forEach(it => {
      it.subtotal = (it.quantity * it.unitPrice) * (1 - (it.discount || 0) / 100);
    });
    doc.subtotal = doc.items.reduce((s,i)=>s+i.subtotal, 0);
    doc.taxableBase = doc.items.filter(i=>!i.exempt).reduce((s,i)=>s+i.subtotal, 0);
    doc.exemptBase = doc.items.filter(i=>i.exempt).reduce((s,i)=>s+i.subtotal, 0);
    doc.ivaRate = ivaRate;
    doc.ivaAmount = round(doc.taxableBase * ivaRate / 100);
    doc.total = round(doc.subtotal + doc.ivaAmount);
    return doc;
  }
};

function round(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }
