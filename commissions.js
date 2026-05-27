/* ============================================
   formulas.js — Lógica de fórmulas
   Versionado, escalado, cálculo de costo
   ============================================ */

const formulas = {

  /** Crea una nueva fórmula con su primera versión */
  create({ code, name, description, category, mode, batchSize, batchUnit, phases }) {
    // Cabecera
    const formula = {
      code,
      name,
      description: description || '',
      category: category || '',
      mode: mode || 'PERCENT',           // PERCENT | FIXED
      batchSize: parseFloat(batchSize) || 100,
      batchUnit: batchUnit || 'kg',
      currentVersion: 1,
      active: true,
      createdAt: new Date().toISOString()
    };
    const savedF = db.save(db.COLLECTIONS.formulas, formula);
    // Primera versión
    const version = {
      formulaId: savedF.id,
      version: 1,
      mode: formula.mode,
      batchSize: formula.batchSize,
      batchUnit: formula.batchUnit,
      phases: phases || [],
      qcParams: [],                       // panel de QC se configura aparte
      changeNote: 'Versión inicial',
      createdAt: new Date().toISOString(),
      createdBy: auth.currentUser()?.username
    };
    db.save(db.COLLECTIONS.formulaVersions, version);
    return savedF;
  },

  /** Crea nueva versión de fórmula existente. La anterior queda en historial. */
  createVersion(formulaId, { mode, batchSize, batchUnit, phases, qcParams, changeNote }) {
    const formula = db.getById(db.COLLECTIONS.formulas, formulaId);
    if (!formula) throw new Error('Fórmula no encontrada');
    const newV = (formula.currentVersion || 1) + 1;
    const v = {
      formulaId,
      version: newV,
      mode: mode || formula.mode,
      batchSize: parseFloat(batchSize) || formula.batchSize,
      batchUnit: batchUnit || formula.batchUnit,
      phases: phases || [],
      qcParams: qcParams || [],
      changeNote: changeNote || '',
      createdAt: new Date().toISOString(),
      createdBy: auth.currentUser()?.username
    };
    db.save(db.COLLECTIONS.formulaVersions, v);
    formula.currentVersion = newV;
    formula.mode = v.mode;
    formula.batchSize = v.batchSize;
    formula.batchUnit = v.batchUnit;
    db.save(db.COLLECTIONS.formulas, formula);
    return v;
  },

  /** Lee la versión actual o una específica */
  getVersion(formulaId, versionNum) {
    const formula = db.getById(db.COLLECTIONS.formulas, formulaId);
    if (!formula) return null;
    const target = versionNum || formula.currentVersion || 1;
    return db.query(db.COLLECTIONS.formulaVersions, v => v.formulaId === formulaId && v.version === target)[0];
  },

  /** Todas las versiones de una fórmula (más reciente primero) */
  getAllVersions(formulaId) {
    return db.query(db.COLLECTIONS.formulaVersions, v => v.formulaId === formulaId)
      .sort((a, b) => b.version - a.version);
  },

  /**
   * Escala una fórmula a un tamaño objetivo de batch.
   * Si modo % → multiplica % por target / 100
   * Si modo FIXED → multiplica cada cantidad por target / batchSize
   */
  scaleVersion(version, targetBatchSize) {
    const target = parseFloat(targetBatchSize) || version.batchSize;
    const scaled = JSON.parse(JSON.stringify(version));
    const factor = version.mode === 'PERCENT'
      ? target / 100
      : target / version.batchSize;

    let totalScaled = 0;
    scaled.phases.forEach(phase => {
      phase.items.forEach(item => {
        const original = parseFloat(item.amount) || 0;
        item.scaledAmount = round(original * factor, 4);
        totalScaled += item.scaledAmount;
      });
    });
    scaled.targetBatchSize = target;
    scaled.totalScaled = round(totalScaled, 4);
    return scaled;
  },

  /**
   * Calcula costo total de la fórmula al tamaño objetivo.
   * Toma el último costo conocido de cada MP.
   */
  computeCost(version, targetBatchSize) {
    const scaled = this.scaleVersion(version, targetBatchSize);
    let totalUSD = 0, totalVES = 0;
    const breakdown = [];
    scaled.phases.forEach(phase => {
      phase.items.forEach(item => {
        const rm = db.getById(db.COLLECTIONS.rawMaterials, item.rawMaterialId);
        if (!rm) return;
        const lastCost = parseFloat(rm.lastCost) || 0;
        const ccy = rm.lastCostCurrency || 'USD';
        const lineCost = item.scaledAmount * lastCost;
        let usdCost = 0;
        if (ccy === 'USD') usdCost = lineCost;
        else if (ccy === 'VES') {
          const r = currency.getActiveRate();
          usdCost = r && r.value ? lineCost / r.value : 0;
        }
        totalUSD += usdCost;
        breakdown.push({
          phase: phase.name,
          rmId: rm.id,
          rmCode: rm.code,
          rmName: rm.name,
          quantity: item.scaledAmount,
          unit: rm.unit,
          unitCost: lastCost,
          currency: ccy,
          lineCost: round(lineCost, 4),
          lineCostUSD: round(usdCost, 4)
        });
      });
    });
    const r = currency.getActiveRate();
    totalVES = r && r.value ? totalUSD * r.value : 0;
    return {
      breakdown,
      totalUSD: round(totalUSD, 4),
      totalVES: round(totalVES, 2),
      perKgUSD: scaled.targetBatchSize > 0 ? round(totalUSD / scaled.targetBatchSize, 4) : 0,
      targetBatchSize: scaled.targetBatchSize,
      batchUnit: version.batchUnit
    };
  }
};

function round(n, dec = 2) {
  const f = Math.pow(10, dec);
  return Math.round((parseFloat(n) || 0) * f) / f;
}
