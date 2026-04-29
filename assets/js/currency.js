/* ============================================
   currency.js — Conversiones multi-moneda
   Cualquier monto se almacena en TRES campos:
     amountVES  → bolívares
     amountUSD  → dólares
     rateUsed   → tasa congelada en el momento
     rateType   → BCV_USD | BCV_EUR | BINANCE | CUSTOM
   ============================================ */

const currency = {

  getRates() {
    return db.getAll(db.COLLECTIONS.rates);
  },

  getRate(type) {
    return db.getAll(db.COLLECTIONS.rates).find(r => r.type === type);
  },

  getActiveRate() {
    return db.getAll(db.COLLECTIONS.rates).find(r => r.active) || this.getRate('BCV_USD');
  },

  setActiveRate(type) {
    db.getAll(db.COLLECTIONS.rates).forEach(r => {
      r.active = (r.type === type);
      db.save(db.COLLECTIONS.rates, r);
    });
  },

  updateRate(type, value) {
    const rate = this.getRate(type);
    if (!rate) return false;
    rate.value = parseFloat(value) || 0;
    rate.updatedDate = new Date().toISOString().slice(0,10);
    db.save(db.COLLECTIONS.rates, rate);
    return true;
  },

  /**
   * Convierte un monto entre VES y la moneda extranjera asociada al rateType.
   * @param {number} amount - cantidad
   * @param {string} fromCurrency - 'VES' o 'USD' o 'EUR'
   * @param {string} rateType - tipo de tasa a usar
   * @returns {{ves:number, foreign:number, rate:number, type:string}}
   */
  convert(amount, fromCurrency, rateType) {
    const rate = this.getRate(rateType);
    if (!rate || !rate.value) {
      return { ves: 0, foreign: 0, rate: 0, type: rateType };
    }
    let ves, foreign;
    if (fromCurrency === 'VES') {
      ves = parseFloat(amount) || 0;
      foreign = ves / rate.value;
    } else {
      foreign = parseFloat(amount) || 0;
      ves = foreign * rate.value;
    }
    return {
      ves: Math.round(ves * 100) / 100,
      foreign: Math.round(foreign * 10000) / 10000,
      rate: rate.value,
      type: rateType
    };
  },

  /** Formatea un número como moneda */
  format(amount, currencyCode = 'VES') {
    const n = parseFloat(amount) || 0;
    if (currencyCode === 'VES') {
      return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Bs.';
    }
    if (currencyCode === 'USD') {
      return '$ ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (currencyCode === 'EUR') {
      return '€ ' + n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return n.toFixed(2);
  },

  formatCompact(amount, currencyCode = 'VES') {
    const n = parseFloat(amount) || 0;
    const sym = currencyCode === 'VES' ? 'Bs' : currencyCode === 'USD' ? '$' : '€';
    if (Math.abs(n) >= 1e6) return sym + ' ' + (n/1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return sym + ' ' + (n/1e3).toFixed(1) + 'K';
    return sym + ' ' + n.toFixed(2);
  }
};
