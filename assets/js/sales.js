/* ============================================
   sales.js — Lógica de Ventas
   Pedido / Cotización / Factura → Asignación FEFO de lotes PT
   ============================================ */

const sales = {

  // Estados que puede tener un documento de venta. Empieza como PEDIDO y cambia.
  STATUS: {
    PEDIDO:       { label: 'Pedido',          color: 'badge-order'     },
    COTIZACION:   { label: 'Cotización',      color: 'badge-quote'     },
    NOTA_ENTREGA: { label: 'Nota de Entrega', color: 'badge-note'      },
    FACTURA:      { label: 'Factura',         color: 'badge-invoice'   },
    PARTIAL:      { label: 'Pago parcial',    color: 'badge-partial'   },
    PAID:         { label: 'Pagada',          color: 'badge-paid'      },
    OVERDUE:      { label: 'Vencida',         color: 'badge-overdue'   },
    CANCELLED:    { label: 'Anulada',         color: 'badge-cancelled' }
  },

  // Tipos de documento que descuentan inventario
  INVENTORY_TYPES: ['NOTA_ENTREGA', 'FACTURA'],
  // Tipos de documento que entran en libros fiscales
  FISCAL_TYPES: ['FACTURA'],
  // Tipos que SIEMPRE descuentan stock al crearse o editarse
  // PEDIDO descuenta porque se reserva el producto
  // COTIZACION NO descuenta (es solo un presupuesto)
  STOCK_AFFECTING_TYPES: ['PEDIDO', 'NOTA_ENTREGA', 'FACTURA'],

  // ====== HELPERS DE STOCK (FEFO + RESERVAS) ======

  /**
   * Verifica disponibilidad de stock para una lista de items.
   * Devuelve { ok, warnings: [{itemIdx, missing, available}] }
   * NO descuenta nada, solo informa.
   */
  checkStockAvailability(items) {
    const warnings = [];
    items.forEach((it, idx) => {
      if (!it.formulaId) return; // ítem libre sin fórmula → no controlamos stock
      const lots = db.query(db.COLLECTIONS.finishedGoods, l =>
        l.formulaId === it.formulaId &&
        l.status === 'LIBERADO' &&
        l.balance > 0
      );
      const totalAvailable = lots.reduce((s, l) => s + (l.balance || 0), 0);
      const qty = parseFloat(it.quantity) || 0;
      if (qty > totalAvailable) {
        warnings.push({
          itemIdx: idx,
          formulaId: it.formulaId,
          formulaName: it.formulaName || it.description,
          requested: qty,
          available: totalAvailable,
          missing: qty - totalAvailable
        });
      }
    });
    return { ok: warnings.length === 0, warnings };
  },

  /**
   * Asigna lotes FEFO a los items de un documento y descuenta stock.
   * Si un ítem no tiene suficiente stock, asigna lo que hay y deja el resto como missing.
   * Retorna lista de allocations por item: [{itemIdx, allocations:[{lotId,lotCode,quantity,expiryDate}], missing}]
   */
  allocateLotsAndConsume(docId, reference) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');

    doc.items.forEach((item, idx) => {
      if (!item.formulaId) return;
      // Si ya tiene allocations, no volver a asignar
      if (item.allocations && item.allocations.length > 0) return;

      const lots = db.query(db.COLLECTIONS.finishedGoods, l =>
        l.formulaId === item.formulaId &&
        l.status === 'LIBERADO' &&
        l.balance > 0
      );
      // Ordenar FEFO (los que vencen primero primero)
      lots.sort((a, b) => (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31'));

      const allocations = [];
      let remaining = parseFloat(item.quantity) || 0;

      for (const lot of lots) {
        if (remaining <= 0.0001) break;
        const take = Math.min(remaining, lot.balance);
        if (take <= 0) continue;

        // Descontar del lote
        lot.balance = round(lot.balance - take);
        db.save(db.COLLECTIONS.finishedGoods, lot);

        // Registrar movimiento
        if (typeof inventory !== 'undefined' && inventory.registerMove) {
          inventory.registerMove({
            type: 'SALE_RESERVE',
            itemKind: 'PT',
            itemId: lot.formulaId,
            itemCode: lot.code,
            itemName: lot.formulaName || item.formulaName,
            lotId: lot.id,
            lotCode: lot.code,
            quantity: -take,    // negativo: salida
            unit: lot.unit,
            unitCost: lot.unitCost,
            costCurrency: lot.costCurrency,
            warehouseId: lot.warehouseId,
            reference: reference || `${doc.code}`
          });
        }

        allocations.push({
          lotId: lot.id,
          lotCode: lot.code,
          quantity: take,
          expiryDate: lot.expiryDate
        });
        remaining = round(remaining - take);
      }

      item.allocations = allocations;
      item.missing = remaining > 0.0001 ? round(remaining) : 0;
    });

    doc.lotsAssigned = true;
    return db.save(db.COLLECTIONS.salesOrders, doc);
  },

  /**
   * Reverso: devuelve el stock asignado al inventario.
   * Se llama al cancelar un pedido/factura/NE.
   */
  reverseStockAllocations(docId, reason) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');

    let reversed = 0;
    doc.items.forEach(item => {
      if (!item.allocations || item.allocations.length === 0) return;
      item.allocations.forEach(a => {
        const lot = db.getById(db.COLLECTIONS.finishedGoods, a.lotId);
        if (!lot) return;
        // Sumar de vuelta
        lot.balance = round((lot.balance || 0) + (a.quantity || 0));
        db.save(db.COLLECTIONS.finishedGoods, lot);
        reversed++;

        // Registrar movimiento de reversa
        if (typeof inventory !== 'undefined' && inventory.registerMove) {
          inventory.registerMove({
            type: 'SALE_REVERSE',
            itemKind: 'PT',
            itemId: lot.formulaId,
            itemCode: lot.code,
            itemName: lot.formulaName || item.formulaName,
            lotId: lot.id,
            lotCode: lot.code,
            quantity: a.quantity,    // positivo: entrada
            unit: lot.unit,
            unitCost: lot.unitCost,
            costCurrency: lot.costCurrency,
            warehouseId: lot.warehouseId,
            reference: `Reversa ${doc.code}: ${reason || 'cancelación'}`
          });
        }
      });
      // Limpiar allocations
      item.allocations = [];
      item.missing = 0;
    });

    doc.lotsAssigned = false;
    return { doc: db.save(db.COLLECTIONS.salesOrders, doc), reversed };
  },

  /**
   * Permite cambiar manualmente la asignación de lotes para un item.
   * Hace reversa de las allocations actuales + descuenta de los nuevos lotes.
   * newAllocations: [{lotId, quantity}]
   */
  changeItemLots(docId, itemIdx, newAllocations) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');
    if (doc.cancelled) throw new Error('Documento anulado');
    const item = doc.items[itemIdx];
    if (!item) throw new Error('Item no encontrado');

    // Validar que la suma cubra la cantidad pedida
    const totalNew = newAllocations.reduce((s, a) => s + (parseFloat(a.quantity) || 0), 0);
    if (Math.abs(totalNew - item.quantity) > 0.0001) {
      throw new Error(`La suma asignada (${totalNew}) no coincide con la cantidad pedida (${item.quantity})`);
    }

    // Validar disponibilidad
    for (const a of newAllocations) {
      const lot = db.getById(db.COLLECTIONS.finishedGoods, a.lotId);
      if (!lot) throw new Error(`Lote no encontrado: ${a.lotId}`);
      // Calcular cuánto está reservado actualmente DEL MISMO doc (ese lo podemos liberar)
      const currentlyAllocatedHere = (item.allocations || [])
        .filter(x => x.lotId === a.lotId)
        .reduce((s, x) => s + x.quantity, 0);
      const trueAvailable = lot.balance + currentlyAllocatedHere;
      const requested = parseFloat(a.quantity) || 0;
      if (requested > trueAvailable + 0.0001) {
        throw new Error(`Lote ${lot.code}: solo hay ${trueAvailable} disponibles (pediste ${requested})`);
      }
    }

    // Reversar allocations actuales SOLO de este item
    (item.allocations || []).forEach(a => {
      const lot = db.getById(db.COLLECTIONS.finishedGoods, a.lotId);
      if (!lot) return;
      lot.balance = round((lot.balance || 0) + (a.quantity || 0));
      db.save(db.COLLECTIONS.finishedGoods, lot);
      if (typeof inventory !== 'undefined' && inventory.registerMove) {
        inventory.registerMove({
          type: 'SALE_REVERSE',
          itemKind: 'PT',
          itemId: lot.formulaId,
          itemCode: lot.code,
          itemName: lot.formulaName || item.formulaName,
          lotId: lot.id,
          lotCode: lot.code,
          quantity: a.quantity,
          unit: lot.unit,
          unitCost: lot.unitCost,
          costCurrency: lot.costCurrency,
          warehouseId: lot.warehouseId,
          reference: `Cambio de lotes ${doc.code}`
        });
      }
    });

    // Aplicar nuevas allocations
    item.allocations = newAllocations.map(a => {
      const lot = db.getById(db.COLLECTIONS.finishedGoods, a.lotId);
      const qty = parseFloat(a.quantity) || 0;
      lot.balance = round(lot.balance - qty);
      db.save(db.COLLECTIONS.finishedGoods, lot);
      if (typeof inventory !== 'undefined' && inventory.registerMove) {
        inventory.registerMove({
          type: 'SALE_RESERVE',
          itemKind: 'PT',
          itemId: lot.formulaId,
          itemCode: lot.code,
          itemName: lot.formulaName || item.formulaName,
          lotId: lot.id,
          lotCode: lot.code,
          quantity: -qty,
          unit: lot.unit,
          unitCost: lot.unitCost,
          costCurrency: lot.costCurrency,
          warehouseId: lot.warehouseId,
          reference: `Cambio de lotes ${doc.code}`
        });
      }
      return {
        lotId: lot.id,
        lotCode: lot.code,
        quantity: qty,
        expiryDate: lot.expiryDate
      };
    });
    item.missing = 0;

    return db.save(db.COLLECTIONS.salesOrders, doc);
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

    // Tipo de documento
    const docType = status || 'PEDIDO';
    const isNotaEntrega = docType === 'NOTA_ENTREGA';

    // Cálculo IVA con la alícuota configurada
    // NOTA: Las Notas de Entrega NO cobran IVA (no son documento fiscal)
    const ivaRate = cfg.ivaRate || 16;
    const taxableBase = isNotaEntrega ? 0 : normalizedItems.filter(it => !it.exempt).reduce((s, it) => s + it.subtotal, 0);
    const exemptBase = isNotaEntrega ? subtotal : normalizedItems.filter(it => it.exempt).reduce((s, it) => s + it.subtotal, 0);
    const ivaAmount = isNotaEntrega ? 0 : taxableBase * (ivaRate / 100);
    const total = subtotal + ivaAmount;

    // Numeración: NE para notas de entrega, V (venta genérica) para el resto
    const code = isNotaEntrega
      ? db.nextCode(db.COLLECTIONS.salesOrders, 'NE')
      : db.nextCode(db.COLLECTIONS.salesOrders, 'V');

    const doc = {
      code,
      type: docType,                       // PEDIDO | COTIZACION | NOTA_ENTREGA | FACTURA
      status: docType,
      // Datos cliente (snapshot - no cambia si cliente se edita después)
      customerId,
      customerName: customer.name,
      customerRif: customer.rif,
      customerAddress: customer.address || '',
      customerPhone: customer.phone || '',
      // Numeración fiscal (solo se asigna al convertir a FACTURA, NUNCA a NE)
      invoiceNumber: null,
      controlNumber: null,
      // Si nació como NE y luego se convirtió a Factura, guardamos el código original
      noteEntregaCode: isNotaEntrega ? code : null,
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
      ivaRate: isNotaEntrega ? 0 : ivaRate,
      ivaAmount: round(ivaAmount),
      total: round(total),
      // Equivalente en VES (para libros SENIAT cuando sea factura)
      totalVES: docCurrency === 'VES' ? round(total) : round(total * (currency.getRate(rateType || cfg.defaultRateType || 'BCV_USD')?.value || 0)),
      // Pago
      paidAmount: 0,
      paidPercent: 0,
      payments: [],
      // Asignación de lotes (al convertir a FACTURA o crear como NE)
      lotsAssigned: false,
      // Cancelación
      cancelled: false,
      cancellationReason: null,
      notes: notes || ''
    };

    const saved = db.save(db.COLLECTIONS.salesOrders, doc);

    // Si el tipo afecta stock (PEDIDO/NE/FACTURA), descontar inventario FEFO automáticamente
    // COTIZACION no toca stock (es solo presupuesto)
    if (this.STOCK_AFFECTING_TYPES.includes(docType)) {
      try {
        this.allocateLotsAndConsume(saved.id, `Venta ${saved.code}`);
      } catch (err) {
        console.warn('[sales] Error al asignar lotes:', err.message);
      }
    }

    return db.getById(db.COLLECTIONS.salesOrders, saved.id);
  },

  /**
   * Convierte el documento a otro estado.
   * - PEDIDO/COTIZACION → NOTA_ENTREGA: descuenta inventario, NO factura
   * - PEDIDO/COTIZACION/NOTA_ENTREGA → FACTURA: asigna número fiscal, recalcula IVA
   * - FACTURA → NOTA_ENTREGA: solo si no tiene pagos. Reversa fiscal.
   */
  convertTo(docId, newStatus) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');
    if (doc.cancelled) throw new Error('Documento anulado');
    if (doc.status === newStatus) throw new Error(`Ya es ${newStatus}`);

    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};

    // FACTURA → NOTA_ENTREGA: solo permitido si no tiene pagos
    if (newStatus === 'NOTA_ENTREGA' && doc.status === 'FACTURA') {
      if ((doc.paidAmount || 0) > 0) {
        throw new Error('No se puede revertir a Nota de Entrega: la factura tiene pagos asociados');
      }
      // Quitar IVA, quitar numeración fiscal
      doc.subtotal = doc.subtotal; // queda igual
      doc.taxableBase = 0;
      doc.exemptBase = doc.subtotal;
      doc.ivaAmount = 0;
      doc.ivaRate = 0;
      doc.total = doc.subtotal;
      doc.totalVES = doc.currency === 'VES' ? doc.total : doc.total * (doc.rateValue || 0);
      doc.invoiceNumber = null;
      doc.controlNumber = null;
      doc.invoicedAt = null;
      // Asignar código NE si no tenía
      if (!doc.noteEntregaCode) {
        doc.noteEntregaCode = db.nextCode(db.COLLECTIONS.salesOrders, 'NE');
        doc.code = doc.noteEntregaCode;
      } else {
        doc.code = doc.noteEntregaCode;
      }
    }
    // → FACTURA: recalcular IVA si venía de NE, asignar número fiscal
    else if (newStatus === 'FACTURA') {
      // Recalcular IVA (en caso de venir de NE que tenía IVA en 0)
      const ivaRate = cfg.ivaRate || 16;
      const taxableBase = doc.items.filter(it => !it.exempt).reduce((s, it) => s + it.subtotal, 0);
      const exemptBase = doc.items.filter(it => it.exempt).reduce((s, it) => s + it.subtotal, 0);
      const ivaAmount = taxableBase * (ivaRate / 100);
      doc.taxableBase = round(taxableBase);
      doc.exemptBase = round(exemptBase);
      doc.ivaRate = ivaRate;
      doc.ivaAmount = round(ivaAmount);
      doc.total = round(doc.subtotal + ivaAmount);
      doc.totalVES = doc.currency === 'VES' ? doc.total : round(doc.total * (doc.rateValue || 0));

      // Asignar número de control y número de factura
      const allInvoices = db.getAll(db.COLLECTIONS.salesOrders).filter(d => d.invoiceNumber);
      const nextInvoice = allInvoices.length + 1;
      doc.invoiceNumber = `${cfg.invoiceNumberPrefix||'F'}-${String(nextInvoice).padStart(8,'0')}`;
      doc.controlNumber = `${cfg.invoiceControlNumberPrefix||'00'}-${String(nextInvoice).padStart(8,'0')}`;
      doc.invoicedAt = new Date().toISOString();
    }
    // → NOTA_ENTREGA desde Pedido/Cotización: sin IVA
    else if (newStatus === 'NOTA_ENTREGA') {
      doc.taxableBase = 0;
      doc.exemptBase = doc.subtotal;
      doc.ivaAmount = 0;
      doc.ivaRate = 0;
      doc.total = doc.subtotal;
      doc.totalVES = doc.currency === 'VES' ? doc.total : doc.total * (doc.rateValue || 0);
      // Asignar código NE
      if (!doc.noteEntregaCode) {
        doc.noteEntregaCode = db.nextCode(db.COLLECTIONS.salesOrders, 'NE');
        doc.code = doc.noteEntregaCode;
      }
    }

    // Guardar el tipo previo para saber si pasó a "afecta stock"
    const oldType = doc.type;

    doc.type = newStatus;
    doc.status = newStatus;
    const saved = db.save(db.COLLECTIONS.salesOrders, doc);

    // Si pasamos de COTIZACION (no afecta) a un tipo que afecta stock → descontar ahora
    const wasNotAffecting = !this.STOCK_AFFECTING_TYPES.includes(oldType);
    const isNowAffecting = this.STOCK_AFFECTING_TYPES.includes(newStatus);
    if (wasNotAffecting && isNowAffecting && !saved.lotsAssigned) {
      try {
        this.allocateLotsAndConsume(saved.id, `Conversión a ${newStatus}: ${saved.code}`);
      } catch (err) {
        console.warn('[sales] Error al asignar lotes en conversión:', err.message);
      }
    }

    return db.getById(db.COLLECTIONS.salesOrders, saved.id);
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
    if (doc.cancelled) throw new Error('Documento ya anulado');
    // Si la factura tiene pagos, no permitir
    if ((doc.paidAmount || 0) > 0) throw new Error('No se puede anular un documento con pagos');
    // Si tenía lotes asignados, devolverlos al stock
    if (doc.lotsAssigned) {
      this.reverseStockAllocations(docId, reason || 'cancelación');
    }
    // Recargar después del reverso
    const updated = db.getById(db.COLLECTIONS.salesOrders, docId);
    updated.cancelled = true;
    updated.status = 'CANCELLED';
    updated.cancellationReason = reason || '';
    updated.cancelledAt = new Date().toISOString();
    return db.save(db.COLLECTIONS.salesOrders, updated);
  },

  /**
   * Elimina completamente un documento (no anular, sino borrar).
   * Hace reverso del stock antes.
   */
  deleteDoc(docId) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) throw new Error('Documento no encontrado');
    if ((doc.paidAmount || 0) > 0) throw new Error('No se puede eliminar un documento con pagos');
    if (doc.type === 'FACTURA' && doc.invoiceNumber) {
      throw new Error('No se puede eliminar una factura emitida (con número fiscal). Anúlala en su lugar.');
    }
    // Reverso de stock si tenía
    if (doc.lotsAssigned) {
      this.reverseStockAllocations(docId, 'eliminación');
    }
    db.remove(db.COLLECTIONS.salesOrders, docId);
    return { ok: true };
  },

  /** Aplica un pago a un documento de venta (factura) */
  applyPayment(docId, paymentId, amountInDocCurrency, paymentRate = null, paymentRateType = 'BCV_USD') {
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
      // CONGELAR TASA AL COMPLETAR PAGO
      if (paymentRate && paymentRate > 0 && !doc.rateAtFullPayment) {
        doc.rateAtFullPayment = paymentRate;
        doc.rateTypeAtFullPayment = paymentRateType;
        if (doc.currency === 'USD') {
          doc.totalVES_atFullPayment = Math.round(doc.total * paymentRate * 100) / 100;
          doc.totalUSD_atFullPayment = doc.total;
        } else if (doc.currency === 'VES') {
          doc.totalVES_atFullPayment = doc.total;
          doc.totalUSD_atFullPayment = Math.round((doc.total / paymentRate) * 100) / 100;
        }
        doc.fullPaymentDate = new Date().toISOString();
      }
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
