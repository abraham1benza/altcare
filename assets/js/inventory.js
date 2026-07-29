/* ============================================
   inventory.js — Lógica de inventario
   Centraliza: lotes MP, lotes PT, movimientos (kardex)
   ============================================ */

const inventory = {

  // ====== Tipos de movimiento ======
  // Cualquier cambio de stock pasa por aquí. Esto es lo que después
  // arma el kardex y la trazabilidad.
  //
  // `affectsStock: false` marca los movimientos que NO mueven el saldo físico.
  // Reservar y liberar solo tocan el campo `reserved` del lote: el material
  // sigue en el almacén. Si el kardex los sumara como entradas/salidas, toda
  // MP que pasó por una OF quedaría descuadrada en exactamente lo reservado.
  MOVE_TYPES: {
    RECEIPT_MP:    { code: 'RECEIPT_MP',    label: 'Recepción de MP',          direction: 'in'  },
    INITIAL_LOAD:  { code: 'INITIAL_LOAD',  label: 'Carga inicial',             direction: 'in'  },
    CONSUMPTION:   { code: 'CONSUMPTION',   label: 'Consumo en producción',     direction: 'out' },
    PRODUCTION:    { code: 'PRODUCTION',    label: 'Producción de PT',          direction: 'in'  },
    SALE:          { code: 'SALE',          label: 'Venta',                     direction: 'out' },
    ADJUSTMENT_IN: { code: 'ADJUSTMENT_IN', label: 'Ajuste positivo',           direction: 'in'  },
    ADJUSTMENT_OUT:{ code: 'ADJUSTMENT_OUT',label: 'Ajuste negativo',           direction: 'out' },
    TRANSFER_OUT:  { code: 'TRANSFER_OUT',  label: 'Traspaso (salida)',         direction: 'out' },
    TRANSFER_IN:   { code: 'TRANSFER_IN',   label: 'Traspaso (entrada)',        direction: 'in'  },
    RESERVATION:   { code: 'RESERVATION',   label: 'Reserva por OF',            direction: 'out', affectsStock: false },
    UNRESERVATION: { code: 'UNRESERVATION', label: 'Liberación de reserva',     direction: 'in',  affectsStock: false },
    SCRAP:         { code: 'SCRAP',         label: 'Merma / descarte',          direction: 'out' }
  },

  /** true si el tipo de movimiento mueve el saldo físico del almacén */
  affectsStock(type) {
    return this.MOVE_TYPES[type]?.affectsStock !== false;
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
    // costToUSD usa la tasa histórica de la fecha para TODAS las monedas.
    // Antes el caso EUR tomaba la tasa de hoy aunque la recepción fuera
    // retroactiva, mientras que el de VES sí usaba la histórica.
    const unitCostUSD_atPurchase = costToUSD(unitCostNum, ccy, today);

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
      unitCostUSD_atPurchase,   // costToUSD ya redondea a 4 decimales
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
    const qty = parseFloat(quantity);
    if (!isFinite(qty) || qty <= 0) {
      throw new Error('La cantidad a reservar debe ser un número mayor a cero');
    }
    const available = (parseFloat(lot.balance) || 0) - (parseFloat(lot.reserved) || 0);
    if (qty > available + 1e-6) {
      throw new Error(`Stock insuficiente. Disponible: ${round4(available)} ${lot.unit}`);
    }
    lot.reserved = round4((parseFloat(lot.reserved) || 0) + qty);
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
    lot.reserved = round4(Math.max(0, (parseFloat(lot.reserved) || 0) - (parseFloat(quantity) || 0)));
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

  /**
   * Consume material reservado (cuando la OF pasa a "terminada").
   * Valida contra el saldo del lote: antes se hacía `Math.max(0, ...)`, así que
   * consumir de más dejaba el balance en 0 sin avisar y el material sobrante
   * desaparecía del sistema en silencio.
   */
  consumeFromLot(lotId, quantity, reference) {
    const lot = db.getById(db.COLLECTIONS.rmLots, lotId);
    if (!lot) throw new Error('Lote no encontrado');

    const qty = parseFloat(quantity);
    if (!isFinite(qty) || qty <= 0) {
      throw new Error('La cantidad a consumir debe ser un número mayor a cero');
    }

    const balance = parseFloat(lot.balance) || 0;
    // Tolerancia mínima por redondeo de punto flotante (ej: 0.1 + 0.2)
    if (qty > balance + 1e-6) {
      throw new Error(
        `No se puede consumir ${qty} ${lot.unit} del lote ${lot.code}: ` +
        `el saldo es ${round4(balance)} ${lot.unit}`
      );
    }

    lot.balance = round4(balance - qty);
    lot.reserved = round4(Math.max(0, (parseFloat(lot.reserved) || 0) - qty));
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

  /**
   * Crea un lote de PT inicial (carga de inventario, sin OF asociada).
   * Permite que productName sea libre (sin fórmula vinculada todavía).
   * El lote después puede vincularse a una fórmula con `linkLotToFormula`.
   *
   * @param {object} args
   * @param {string} args.productName - Nombre del producto (libre si no hay fórmula)
   * @param {string} [args.formulaId] - Opcional: ID de fórmula si ya existe
   * @param {number} args.quantity
   * @param {string} args.unit
   * @param {number} args.unitCost - en USD
   * @param {number} [args.priceDistributor] - precio venta distribuidor
   * @param {number} [args.pricePharmacy]    - precio venta peluquerías
   * @param {string} [args.expiryDate]
   * @param {string} [args.warehouseId]
   * @param {string} [args.notes]
   */
  createInitialFGLot(args) {
    const lot = {
      code: db.nextCode(db.COLLECTIONS.finishedGoods, 'PT'),
      formulaId: args.formulaId || null,
      formulaName: args.productName || '',         // se mantiene como referencia
      productName: args.productName || '',         // nombre libre cuando no hay fórmula
      productionOrderId: null,
      productionOrderCode: null,
      isInitialLoad: true,                         // marca que es carga inicial
      quantity: parseFloat(args.quantity) || 0,
      balance: parseFloat(args.quantity) || 0,
      reserved: 0,
      unit: args.unit || 'unidad',
      manufactureDate: args.manufactureDate || new Date().toISOString().slice(0,10),
      expiryDate: args.expiryDate || null,
      warehouseId: args.warehouseId || this.defaultWarehouse()?.id,
      locationId: null,
      status: args.status || 'LIBERADO',           // por defecto vendible
      qcTestId: null,
      unitCost: parseFloat(args.unitCost) || 0,
      costCurrency: args.costCurrency || 'USD',
      // Precios de venta del producto
      priceDistributor: parseFloat(args.priceDistributor) || 0,
      pricePharmacy: parseFloat(args.pricePharmacy) || 0,
      // Stock mínimo: nivel de alerta cuando el balance baja de este número
      minStock: args.minStock != null ? parseFloat(args.minStock) : 25,
      active: true,
      notes: args.notes || 'Carga inicial de inventario'
    };
    const saved = db.save(db.COLLECTIONS.finishedGoods, lot);
    // Movimiento de entrada inicial al kardex
    this.registerMove({
      type: 'INITIAL_LOAD',
      itemKind: 'PT',
      itemId: saved.formulaId || saved.id,
      itemCode: saved.code,
      itemName: saved.productName,
      lotId: saved.id,
      lotCode: saved.code,
      quantity: saved.quantity,
      unit: saved.unit,
      unitCost: saved.unitCost,
      costCurrency: saved.costCurrency,
      warehouseId: saved.warehouseId,
      reference: 'Carga inicial de inventario'
    });
    return saved;
  },

  /**
   * Vincula un lote PT existente (sin fórmula) a una fórmula creada después.
   * Si la fórmula tiene un costUSD distinto al del lote, se actualiza el costo del lote
   * con el de la fórmula (más preciso).
   */
  linkLotToFormula(lotId, formulaId) {
    const lot = db.getById(db.COLLECTIONS.finishedGoods, lotId);
    if (!lot) throw new Error('Lote no encontrado');
    const formula = db.getById(db.COLLECTIONS.formulas, formulaId);
    if (!formula) throw new Error('Fórmula no encontrada');
    lot.formulaId = formula.id;
    lot.formulaName = formula.name;
    // Si la fórmula tiene costo calculado, actualizar el costo del lote
    if (formula.costUSD && formula.costUSD > 0) {
      lot.unitCost = formula.costUSD;
      lot.costCurrency = 'USD';
    }
    return db.save(db.COLLECTIONS.finishedGoods, lot);
  },

  /**
   * Registra un movimiento en el kardex.
   *
   * Congela `unitCostUSD` en el momento del movimiento. Sin esto el kardex
   * sumaba `unitCost` crudo sin mirar `costCurrency`, mezclando bolívares con
   * dólares en un mismo total — un número sin significado.
   */
  registerMove(move) {
    const timestamp = new Date().toISOString();
    const m = {
      ...move,
      timestamp,
      unitCostUSD: costToUSD(move.unitCost, move.costCurrency, timestamp.slice(0, 10)),
      user: auth.currentUser()?.username || 'system'
    };
    return db.save(db.COLLECTIONS.warehouseMoves, m);
  },

  /** Devuelve los movimientos de un item específico ordenados cronológicamente */
  getKardex(itemKind, itemId) {
    return db.query(db.COLLECTIONS.warehouseMoves, m => m.itemKind === itemKind && m.itemId === itemId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  },

  /**
   * Calcula saldos corridos para el kardex valorizado.
   *
   * Los movimientos con `affectsStock: false` (reservas y liberaciones) se
   * devuelven en la lista para que se vean en la trazabilidad, pero NO alteran
   * el saldo corrido: reservar no saca material del almacén.
   */
  getValuedKardex(itemKind, itemId) {
    const moves = this.getKardex(itemKind, itemId);
    let runningQty = 0;
    let runningValue = 0;
    return moves.map(m => {
      const def = this.MOVE_TYPES[m.type];
      const sign = (def?.direction || 'in') === 'in' ? 1 : -1;
      const movesStock = def?.affectsStock !== false;
      const qty = (parseFloat(m.quantity) || 0) * sign;
      // Siempre en USD. Los movimientos viejos no tienen unitCostUSD grabado,
      // así que se convierte al vuelo con la tasa de su fecha.
      const costUSD = m.unitCostUSD != null
        ? (parseFloat(m.unitCostUSD) || 0)
        : costToUSD(m.unitCost, m.costCurrency, (m.timestamp || '').slice(0, 10));
      const value = qty * costUSD;
      if (movesStock) {
        runningQty += qty;
        runningValue += value;
      }
      return {
        ...m,
        affectsStock: movesStock,
        unitCostUSD: costUSD,
        valueCurrency: 'USD',
        signedQty: movesStock ? qty : 0,
        signedValue: movesStock ? value : 0,
        // Cantidad informativa del movimiento aunque no mueva stock
        displayQty: qty,
        runningQty: round4(runningQty),
        runningValue: round4(runningValue)
      };
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

/**
 * Redondea a 4 decimales para evitar que el error de punto flotante se acumule
 * en los saldos (0.1 + 0.2 === 0.30000000000000004). 4 decimales es suficiente
 * para gramos y mililitros sin perder precisión real.
 */
function round4(n) {
  return Math.round((parseFloat(n) || 0) * 10000) / 10000;
}

/**
 * Convierte un costo a USD usando la tasa BCV vigente en `dateStr`.
 *
 * El inventario se valoriza SIEMPRE en dólares: es la única forma de que el
 * kardex sea comparable en el tiempo con una moneda local que se devalúa.
 * Si no hay tasa histórica para esa fecha, `getRateOnDate` cae a la tasa
 * actual (devuelve `found: false`).
 *
 * @param {number} amount
 * @param {string} ccy      - 'USD' | 'VES' | 'EUR'
 * @param {string} dateStr  - fecha YYYY-MM-DD
 * @returns {number} monto en USD, 0 si no hay tasa para convertir
 */
function costToUSD(amount, ccy, dateStr) {
  const n = parseFloat(amount) || 0;
  if (!n) return 0;
  const currencyCode = ccy || 'USD';
  if (currencyCode === 'USD') return round4(n);

  const date = dateStr || new Date().toISOString().slice(0, 10);
  const usdRate = (typeof currency !== 'undefined')
    ? (currency.getRateOnDate(date, 'BCV_USD')?.value || 0)
    : 0;

  if (currencyCode === 'VES') {
    return usdRate > 0 ? round4(n / usdRate) : 0;
  }

  if (currencyCode === 'EUR') {
    // EUR → VES → USD, ambas patas con la tasa de la misma fecha
    const eurRate = (typeof currency !== 'undefined')
      ? (currency.getRateOnDate(date, 'BCV_EUR')?.value || 0)
      : 0;
    if (!eurRate || !usdRate) return 0;
    return round4((n * eurRate) / usdRate);
  }

  // Moneda desconocida: no inventar una conversión
  return 0;
}
