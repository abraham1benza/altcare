/* ============================================
   tax.js — Cálculo de IVA y Retenciones (Venezuela)
   ============================================ */

const tax = {

  config() {
    return db.getById(db.COLLECTIONS.config, 'main') || { ivaRate: 16, ivaWithholdingRate: 75 };
  },

  /**
   * Calcula IVA de un subtotal.
   * @param {number} subtotal - base imponible (sin IVA)
   * @param {boolean} exempt - si es exento
   */
  calcIVA(subtotal, exempt = false) {
    const cfg = this.config();
    const base = parseFloat(subtotal) || 0;
    if (exempt) return { base, iva: 0, total: base, rate: 0 };
    const rate = cfg.ivaRate || 16;
    const iva = base * (rate / 100);
    return {
      base: round(base),
      iva: round(iva),
      total: round(base + iva),
      rate
    };
  },

  /**
   * Calcula retención de IVA (75% para agentes de retención).
   * Se aplica sobre el IVA, no sobre el total.
   */
  calcIVAWithholding(ivaAmount) {
    const cfg = this.config();
    const rate = cfg.ivaWithholdingRate || 75;
    return {
      withheld: round((ivaAmount || 0) * (rate / 100)),
      rate
    };
  },

  /**
   * Calcula retención de ISLR según porcentaje (depende del tipo de servicio).
   * Tabla simplificada — el usuario elige el % al hacer la retención.
   */
  calcISLR(base, rate) {
    return {
      withheld: round((parseFloat(base) || 0) * ((parseFloat(rate) || 0) / 100)),
      rate
    };
  },

  /**
   * Cálculo completo para una factura de COMPRA donde somos agentes de retención.
   */
  computeInvoiceWithWithholdings({ subtotal, exempt = false, applyIVAWithholding = true, islrRate = 0 }) {
    const iva = this.calcIVA(subtotal, exempt);
    const ivaW = applyIVAWithholding ? this.calcIVAWithholding(iva.iva) : { withheld: 0, rate: 0 };
    const islrW = islrRate > 0 ? this.calcISLR(iva.base, islrRate) : { withheld: 0, rate: 0 };
    const totalToPay = iva.total - ivaW.withheld - islrW.withheld;
    return {
      subtotal: iva.base,
      ivaRate: iva.rate,
      ivaAmount: iva.iva,
      total: iva.total,
      ivaWithholdingRate: ivaW.rate,
      ivaWithheld: ivaW.withheld,
      islrRate: islrW.rate,
      islrWithheld: islrW.withheld,
      totalToPay: round(totalToPay)
    };
  }
};

function round(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }
