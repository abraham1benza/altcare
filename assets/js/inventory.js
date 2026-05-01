/* ============================================
   inventory.js — Lógica de inventario
   Centraliza: lotes MP, lotes PT, movimientos (kardex)
   ============================================ */

const inventory = {

  // ====== Tipos de movimiento ======
  // Cualquier cambio de stock pasa por aquí. Esto es lo que después
  // arma el kardex y la trazabilidad.
  MOVE_TYPES: {
    RECEIPT_MP:    { code: 'RECEIPT_MP',    label: 'Recepción de MP',          direction: 'in'  },
    CONSUMPTION:   { code: 'CONSUMPTION',   label: 'Consumo en producción',     direction: 'out' },
    PRODUCTION:    { code: 'PRODUCTION',    label: 'Producción de PT',          direction: 'in'  },
    SALE:          { code: 'SALE',          label: 'Venta',                     direction: 'out' },
    ADJUSTMENT_IN: { code: 'ADJUSTMENT_IN', label: 'Ajuste positivo',           direction: 'in'  },
    ADJUSTMENT_OUT:{ code: 'ADJUSTMENT_OUT',label: 'Ajuste negativo',           direction: 'out' },
    TRANSFER_OUT:  { code: 'TRANSFER_OUT',  label: 'Traspaso (salida)',         direction: 'out' },
    TRANSFER_IN:   { code: 'TRANSFER_IN',   label: 'Traspaso (entrada)',        direction: 'in'  },
    RESERVATION:   { code: 'RESERVATION',   label: 'Reserva por OF',            direction: 'out' },
    UNRESERVATION: { code: 'UNRESERVATION', label: 'Liberación de reserva',     direction: 'in'  },
    SCRAP:         { code: 'SCRAP',         label: 'Merma / descarte',          direction: 'out' }
  },

  // ====== STOCK DE MATERIAS PRIMAS POR LOTE ======

  /** Devuelve todos los lotes activos de una MP */
  getLotsForRM(rmId) {
    return db.query(db.COLLECTIONS.rmLots, l => l.rawMaterialId === rmId && l.active !== false);
  },

  /** Stock total de una MP = suma de saldos de sus lotes activos */
  getStockForRM(rmId) {
    const lots = this.getLotsForRM(rmId);
    return lots.reduce((sum, l) => sum + (parseFloat(l.balance) || 0), 0);
  },

  /** Stock disponible = balance - reservado (para validar contra reservas pendientes) */
  getAvailableStockForRM(rmId) {
    const lots = this.getLotsForRM(rmId);
    return lots.reduce((sum, l) => sum + ((parseFloat(l.balance) || 0) - (parseFloat(l.reserved) || 0)), 0);
  },

  /** Devuelve lotes de una MP ordenados FEFO (vence primero → primero) */
  getLotsFEFO(rmId, onlyAvailable = true) {
    let lots = this.getLotsForRM(rmId);
    if (onlyAvailable) lots = lots.filter(l => (l.balance - (l.reserved||0)) > 0);
    return lots.sort((a, b) => {
      const ea = a.expiryDate || '9999-12-31';
      const eb = b.expiryDate || '9999-12-31';
      return ea.localeCompare(eb);
    });
  },

  /**
   * Crea un lote de recepción de MP. Esto se usa cuando llega material del proveedor.
   * En Fase 2 se puede crear manualmente; en Fase 3 lo creará la recepción de OC.
   */
  createRMLot({ rawMaterialId, supplierId, quantity, unitCost, costCurrency, receiptDate, expiryDate, supplierLotNumber, warehouseId, locationId, notes }) {
    const rm = db.getById(db.COLLECTIONS.rawMaterials, rawMaterialId);
    if (!rm) throw new Error('Materia prima no encontrada');
    const code = db.nextCode(db.COLLECTIONS.rmLots, 'LMP');

    // Congelar tasa BCV del día de compra y costo USD equivalente
    const today = receiptDate || new Date().toISOString().slice(0, 10);
    const bcvRate = currency.getRateOnDate(today, 'BCV_USD');
    const rateAtPurchase = bcvRate.value || 0;
    const unitCostNum = parseFloat(unitCost) || 0;
    const ccy = costCurrency || 'USD';
    let unitCostUSD_atPurchase = 0;
    if (ccy === 'USD') {
      unitCostUSD_atPurchase = unitCostNum;
    } else if (ccy === 'VES' && rateAtPurchase > 0) {
      unitCostUSD_atPurchase = unitCostNum / rateAtPurchase;
    } else if (ccy === 'EUR') {
      const eurRate = currency.getRate('BCV_EUR');
      const inVES = eurRate?.value ? unitCostNum * eurRate.value : 0;
      unitCostUSD_atPurchase = rateAtPurchase > 0 ? inVES / rateAtPurchase : 0;
    }

    const lot = {
      code,
      rawMaterialId,
      rawMaterialCode: rm.code,
      rawMaterialName: rm.name,
      supplierId: supplierId || null,
      supplierLotNumber: supplierLotNumber || '',
      quantity: parseFloat(quantity) || 0,    // cantidad recibida original
      balance: parseFloat(quantity) || 0,     // cantidad restante
      reserved: 0,
      unit: rm.unit,
      unitCost: unitCostNum,
      costCurrency: ccy,
      // === Tasa congelada al comprar ===
      rateAtPurchase: rateAtPurchase,
      rateTypeAtPurchase: 'BCV_USD',
      unitCostUSD_atPurchase: Math.round(unitCostUSD_atPurchase * 10000) / 10000,
      // ===
      receiptDate: today,
      expiryDate: expiryDate || null,
      warehouseId: warehouseId || this.defaultWarehouse()?.id,
      locationId: locationId || null,
      active: true,
      notes: notes || ''
    };
    const saved = db.save(db.COLLECTIONS.rmLots, lot);
    // Registrar movimiento
    this.registerMove({
      type: 'RECEIPT_MP',
      itemKind: 'MP',
      itemId: rawMaterialId,
      itemCode: rm.code,
      itemName: rm.name,
      lotId: saved.id,
      lotCode: saved.code,
      quantity: saved.quantity,
      unit: rm.unit,
      unitCost: saved.unitCost,
      costCurrency: saved.costCurrency,
      warehouseId: saved.warehouseId,
      reference: 'Recepción manual',
      notes: notes || ''
    });
    return saved;
  },

  /**
   * Reserva una cantidad de un lote específico (para OF planificada).
   */
  reserveFromLot(lotId, quantity, reference) {
    const lot = db.getById(db.COLLECTIONS.rmLots, lotId);
    if (!lot) throw new Error('Lote no encontrado');
    const available = (lot.balance || 0) - (lot.reserved || 0);
    if (quantity > available) throw new Error(`Stock insuficiente. Disponible: ${available} ${lot.unit}`);
    lot.reserved = (lot.reserved || 0) + parseFloat(quantity);
    db.save(db.COLLECTIONS.rmLots, lot);
    this.registerMove({
      type: 'RESERVATION',
      itemKind: 'MP',
      itemId: lot.rawMaterialId,
      itemCode: lot.rawMaterialCode,
      itemName: lot.rawMaterialName,
      lotId: lot.id,
      lotCode: lot.code,
      quantity: parseFloat(quantity),
      unit: lot.unit,
      unitCost: lot.unitCost,
      costCurrency: lot.costCurrency,
      warehouseId: lot.warehouseId,
      reference: reference || 'Reserva'
    });
    return lot;
  },

  /** Libera una reserva (cuando se cancela una OF) */
  unreserveFromLot(lotId, quantity, reference) {
    const lot = db.getById(db.COLLECTIONS.rmLots, lotId);
    if (!lot) throw new Error('Lote no encontrado');
    lot.reserved = Math.max(0, (lot.reserved || 0) - parseFloat(quantity));
    db.save(db.COLLECTIONS.rmLots, lot);
    this.registerMove({
      type: 'UNRESERVATION',
      itemKind: 'MP',
      itemId: lot.rawMaterialId,
      itemCode: lot.rawMaterialCode,
      itemName: lot.rawMaterialName,
      lotId: lot.id,
      lotCode: lot.code,
      quantity: parseFloat(quantity),
      unit: lot.unit,
      unitCost: lot.unitCost,
      costCurrency: lot.costCurrency,
      warehouseId: lot.warehouseId,
      reference: reference || 'Liberación'
    });
    return lot;
  },

  /** Consume material reservado (cuando la OF pasa a "terminada") */
  consumeFromLot(lotId, quantity, reference) {
    const lot = db.getById(db.COLLECTIONS.rmLots, lotId);
    if (!lot) throw new Error('Lote no encontrado');
    lot.balance = Math.max(0, (lot.balance || 0) - parseFloat(quantity));
    lot.reserved = Math.max(0, (lot.reserved || 0) - parseFloat(quantity));
    db.save(db.COLLECTIONS.rmLots, lot);
    this.registerMove({
      type: 'CONSUMPTION',
      itemKind: 'MP',
      itemId: lot.rawMaterialId,
      itemCode: lot.rawMaterialCode,
      itemName: lot.rawMaterialName,
      lotId: lot.id,
      lotCode: lot.code,
      quantity: parseFloat(quantity),
      unit: lot.unit,
      unitCost: lot.unitCost,
      costCurrency: lot.costCurrency,
      warehouseId: lot.warehouseId,
      reference: reference || 'Consumo'
    });
    return lot;
  },

  // ====== STOCK DE PRODUCTO TERMINADO ======

  /** Crea un lote de producto terminado tras una OF */
  createFGLot({ formulaId, formulaName, productionOrderId, productionOrderCode, lotNumber, quantity, unit, manufactureDate, expiryDate, warehouseId, locationId, status, unitCost, costCurrency, notes }) {
    const lot = {
      code: lotNumber,
      formulaId,
      formulaName,
      productionOrderId,
      productionOrderCode,
      quantity: parseFloat(quantity) || 0,
      balance: parseFloat(quantity) || 0,
      reserved: 0,
      unit: unit || 'kg',
      manufactureDate: manufactureDate || new Date().toISOString().slice(0,10),
      expiryDate: expiryDate || null,
      warehouseId: warehouseId || this.defaultWarehouse()?.id,
      locationId: locationId || null,
      status: status || 'CUARENTENA',     // CUARENTENA | LIBERADO | RECHAZADO | OBSERVACIONES
      qcTestId: null,
      unitCost: parseFloat(unitCost) || 0,
      costCurrency: costCurrency || 'USD',
      active: true,
      notes: notes || ''
    };
    const saved = db.save(db.COLLECTIONS.finishedGoods, lot);
    this.registerMove({
      type: 'PRODUCTION',
      itemKind: 'PT',
      itemId: formulaId,
      itemCode: lotNumber,
      itemName: formulaName,
      lotId: saved.id,
      lotCode: saved.code,
      quantity: saved.quantity,
      unit: saved.unit,
      unitCost: saved.unitCost,
      costCurrency: saved.costCurrency,
      warehouseId: saved.warehouseId,
      reference: 'OF ' + productionOrderCode
    });
    return saved;
  },

  // ====== KARDEX (movimientos) ======

  /** Registra un movimiento en el kardex */
  registerMove(move) {
    const m = {
      ...move,
      timestamp: new Date().toISOString(),
      user: auth.currentUser()?.username || 'system'
    };
    return db.save(db.COLLECTIONS.warehouseMoves, m);
  },

  /** Devuelve los movimientos de un item específico ordenados cronológicamente */
  getKardex(itemKind, itemId) {
    return db.query(db.COLLECTIONS.warehouseMoves, m => m.itemKind === itemKind && m.itemId === itemId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  },

  /** Calcula saldos corridos para el kardex valorizado */
  getValuedKardex(itemKind, itemId) {
    const moves = this.getKardex(itemKind, itemId);
    let runningQty = 0;
    let runningValue = 0;
    return moves.map(m => {
      const dir = this.MOVE_TYPES[m.type]?.direction || 'in';
      const sign = dir === 'in' ? 1 : -1;
      const qty = (parseFloat(m.quantity) || 0) * sign;
      const value = qty * (parseFloat(m.unitCost) || 0);
      runningQty += qty;
      runningValue += value;
      return { ...m, signedQty: qty, signedValue: value, runningQty, runningValue };
    });
  },

  // ====== HELPERS ======

  defaultWarehouse() {
    const all = db.getAll(db.COLLECTIONS.warehouses);
    return all.find(w => w.isDefault) || all[0];
  },

  getLocationsForWarehouse(warehouseId) {
    return db.query(db.COLLECTIONS.locations, l => l.warehouseId === warehouseId);
  },

  /** Lotes de MP que vencen pronto (configurable en config) */
  getExpiringLots(daysAhead) {
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};
    const days = daysAhead ?? cfg.expiryAlertDays ?? 60;
    const limit = new Date();
    limit.setDate(limit.getDate() + days);
    const limitStr = limit.toISOString().slice(0,10);
    const today = new Date().toISOString().slice(0,10);
    const mpLots = db.query(db.COLLECTIONS.rmLots, l => l.active && l.expiryDate && l.balance > 0 && l.expiryDate <= limitStr);
    const fgLots = db.query(db.COLLECTIONS.finishedGoods, l => l.active && l.expiryDate && l.balance > 0 && l.expiryDate <= limitStr);
    return {
      mp: mpLots.map(l => ({ ...l, kind: 'MP', daysToExpiry: daysBetween(today, l.expiryDate) })),
      fg: fgLots.map(l => ({ ...l, kind: 'PT', daysToExpiry: daysBetween(today, l.expiryDate) }))
    };
  },

  /** Genera número de lote PT auto */
  nextLotNumber(formulaCode) {
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};
    const format = cfg.lotNumberFormat || 'L-{YYYY}-{####}';
    const year = new Date().getFullYear();
    // Buscar lotes existentes de este año para incrementar contador
    const existing = db.getAll(db.COLLECTIONS.finishedGoods)
      .filter(l => l.code && l.code.includes(String(year)))
      .map(l => {
        const m = l.code.match(/(\d{3,})\s*$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter(n => n > 0);
    const next = existing.length ? Math.max(...existing) + 1 : 1;
    return format
      .replace('{YYYY}', year)
      .replace('{YY}', String(year).slice(-2))
      .replace('{MM}', String(new Date().getMonth() + 1).padStart(2,'0'))
      .replace('{####}', String(next).padStart(4,'0'))
      .replace('{###}', String(next).padStart(3,'0'))
      .replace('{CODE}', formulaCode || '');
  },

  /**
   * Calcula los requerimientos de una Orden de Fabricación y verifica stock.
   * Recibe: formulaId, batchSize (en la unidad de la fórmula), opcionalmente presentationId y units.
   *
   * Retorna:
   * {
   *   ok: bool,                 // true si hay stock para todo
   *   ingredients: [             // ingredientes del granel
   *     { rawMaterialId, code, name, required, available, unit, ok }
   *   ],
   *   packaging: [               // insumos de envasado (si hay presentación)
   *     { rawMaterialId, code, name, kindLabel, required, available, unit, ok }
   *   ],
   *   missingItems: number,      // cantidad de items con stock insuficiente
   *   theoreticalUnits: number   // unidades teóricas que produciría el batch (si hay presentación)
   * }
   */
  checkOFRequirements(formulaId, batchSize, presentationId, units) {
    const result = {
      ok: true,
      ingredients: [],
      packaging: [],
      missingItems: 0,
      theoreticalUnits: 0
    };

    const formula = db.getById(db.COLLECTIONS.formulas, formulaId);
    if (!formula) return result;

    // 1. Ingredientes del granel
    const version = db.query(db.COLLECTIONS.formulaVersions,
      v => v.formulaId === formulaId && v.version === formula.currentVersion
    )[0];
    if (version) {
      const scaled = formulas.scaleVersion(version, batchSize);
      scaled.phases.forEach(phase => {
        (phase.items || []).forEach(item => {
          const rm = db.getById(db.COLLECTIONS.rawMaterials, item.rawMaterialId);
          if (!rm) return;
          const required = item.scaledAmount;
          const available = this.getAvailableStockForRM(rm.id);
          const itemOk = available >= required;
          result.ingredients.push({
            rawMaterialId: rm.id,
            code: rm.code,
            name: rm.name,
            kindLabel: 'Ingrediente',
            required: required,
            available: available,
            unit: rm.unit || 'unidad',
            ok: itemOk
          });
          if (!itemOk) {
            result.ok = false;
            result.missingItems++;
          }
        });
      });
    }

    // 2. Insumos de envasado (si hay presentación)
    if (presentationId && units > 0) {
      const presentation = db.getById(db.COLLECTIONS.presentations, presentationId);
      if (presentation && presentation.components) {
        const KIND_LABELS = { PACKAGING: 'Envase', CAP: 'Tapa', LABEL: 'Etiqueta', BOX: 'Caja', OTHER: 'Otro' };
        presentation.components.forEach(comp => {
          const rm = db.getById(db.COLLECTIONS.rawMaterials, comp.rawMaterialId);
          if (!rm) return;
          const required = (comp.quantity || 1) * units;
          const available = this.getAvailableStockForRM(rm.id);
          const itemOk = available >= required;
          result.packaging.push({
            rawMaterialId: rm.id,
            code: rm.code,
            name: rm.name,
            kindLabel: KIND_LABELS[rm.kind] || 'Otro',
            required: required,
            available: available,
            unit: rm.unit || 'unidad',
            ok: itemOk
          });
          if (!itemOk) {
            result.ok = false;
            result.missingItems++;
          }
        });

        // Calcular unidades teóricas según presentación y batch size
        // (ej: 1000g de granel ÷ 30g por presentación = 33 unidades teóricas)
        // Asumimos que la unidad de batch coincide con la de la presentación (kg/g, L/mL)
        const presSize = parseFloat(presentation.size) || 0;
        if (presSize > 0) {
          // Convertir batchSize y presSize a la misma unidad (mL o g)
          const formulaBatchInBaseUnit = (formula.batchUnit === 'kg' || formula.batchUnit === 'L')
            ? batchSize * 1000
            : batchSize;
          const presInBaseUnit = (presentation.sizeUnit === 'kg' || presentation.sizeUnit === 'L')
            ? presSize * 1000
            : presSize;
          if (presInBaseUnit > 0) {
            result.theoreticalUnits = Math.floor(formulaBatchInBaseUnit / presInBaseUnit);
          }
        }
      }
    }

    return result;
  }
};

function daysBetween(d1, d2) {
  const a = new Date(d1), b = new Date(d2);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}
