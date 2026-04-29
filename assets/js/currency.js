/* ============================================
   currency.js — Conversiones multi-moneda
   Cualquier monto se almacena en TRES campos:
     amountVES  → bolívares
     amountUSD  → dólares
     rateUsed   → tasa congelada en el momento
     rateType   → BCV_USD | BCV_EUR | BINANCE | P2P_EUR | CUSTOM

   Auto-actualización desde https://ve.dolarapi.com/v1/dolares
   y https://ve.dolarapi.com/v1/euros
   ============================================ */

const currency = {

  // Endpoints públicos (CORS habilitado, no requiere API key)
  API_DOLARES: 'https://ve.dolarapi.com/v1/dolares',
  API_EUROS:   'https://ve.dolarapi.com/v1/euros',
  // Refrescar automáticamente si la última actualización tiene más de N horas
  AUTO_REFRESH_HOURS: 6,

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

  updateRate(type, value, source = 'manual') {
    const rate = this.getRate(type);
    if (!rate) return false;
    rate.value = parseFloat(value) || 0;
    rate.updatedDate = new Date().toISOString().slice(0,10);
    rate.updatedAt = new Date().toISOString();
    rate.source = source;
    db.save(db.COLLECTIONS.rates, rate);
    return true;
  },

  /**
   * Trae las tasas en vivo desde dolarapi.com y actualiza BCV_USD, BINANCE (P2P USD),
   * BCV_EUR y P2P_EUR. La función es resiliente: si una API falla, las demás se actualizan igual.
   * @returns {Promise<{ok, updated, errors}>}
   */
  async fetchLiveRates() {
    const updated = [];
    const errors = [];

    // === Dólares ===
    try {
      const resp = await fetch(this.API_DOLARES, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      // dolarapi devuelve un array de items. Buscar oficial (BCV) y paralelo (P2P)
      const oficial = data.find(d => (d.fuente || '').toLowerCase().includes('oficial'));
      const paralelo = data.find(d => (d.fuente || '').toLowerCase().includes('paralelo'));
      if (oficial && oficial.promedio) {
        this.updateRate('BCV_USD', oficial.promedio, 'auto');
        updated.push({ type: 'BCV_USD', value: oficial.promedio });
      }
      if (paralelo && paralelo.promedio) {
        this.updateRate('BINANCE', paralelo.promedio, 'auto');
        updated.push({ type: 'BINANCE', value: paralelo.promedio });
      }
    } catch (e) {
      errors.push({ source: 'dolares', error: e.message });
    }

    // === Euros ===
    try {
      const resp = await fetch(this.API_EUROS, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const oficial = data.find(d => (d.fuente || '').toLowerCase().includes('oficial'));
      const paralelo = data.find(d => (d.fuente || '').toLowerCase().includes('paralelo'));
      if (oficial && oficial.promedio) {
        this.updateRate('BCV_EUR', oficial.promedio, 'auto');
        updated.push({ type: 'BCV_EUR', value: oficial.promedio });
      }
      if (paralelo && paralelo.promedio) {
        // P2P_EUR puede no existir aún, lo creamos en demand
        let p2pEur = this.getRate('P2P_EUR');
        if (!p2pEur) {
          db.save(db.COLLECTIONS.rates, {
            id: 'rate_P2P_EUR', type: 'P2P_EUR', label: 'P2P EUR', symbol: '€',
            value: parseFloat(paralelo.promedio), updatedDate: new Date().toISOString().slice(0,10),
            updatedAt: new Date().toISOString(), source: 'auto', active: false
          });
        } else {
          this.updateRate('P2P_EUR', paralelo.promedio, 'auto');
        }
        updated.push({ type: 'P2P_EUR', value: paralelo.promedio });
      }
    } catch (e) {
      errors.push({ source: 'euros', error: e.message });
    }

    return {
      ok: updated.length > 0,
      updated,
      errors,
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Determina si las tasas están vencidas y necesitan refrescarse.
   * Devuelve true si la última actualización fue hace más de AUTO_REFRESH_HOURS o nunca.
   */
  needsRefresh() {
    const rate = this.getRate('BCV_USD');
    if (!rate || !rate.value || !rate.updatedAt) return true;
    const last = new Date(rate.updatedAt);
    const now = new Date();
    const hours = (now - last) / (1000 * 60 * 60);
    return hours > this.AUTO_REFRESH_HOURS;
  },

  /**
   * Refresca tasas en background si están vencidas. No bloquea el flujo.
   * Llamar desde el inicio de cada página.
   */
  async autoRefreshIfNeeded() {
    if (!this.needsRefresh()) return { skipped: true };
    // Background: no espera
    try {
      const result = await this.fetchLiveRates();
      if (result.ok) {
        console.log('[currency] Tasas actualizadas:', result.updated);
      }
      return result;
    } catch (e) {
      console.warn('[currency] No se pudieron actualizar las tasas:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * Convierte un monto entre VES y la moneda extranjera asociada al rateType.
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

  /** Convierte un monto en una moneda a otra usando la tasa activa. */
  convertBetween(amount, fromCcy, toCcy) {
    const n = parseFloat(amount) || 0;
    if (fromCcy === toCcy) return n;
    const rate = this.getActiveRate();
    if (!rate || !rate.value) return 0;
    if (fromCcy === 'VES' && toCcy === 'USD') return n / rate.value;
    if (fromCcy === 'USD' && toCcy === 'VES') return n * rate.value;
    if (fromCcy === 'VES' && toCcy === 'EUR') {
      const eur = this.getRate('BCV_EUR');
      return eur && eur.value ? n / eur.value : 0;
    }
    if (fromCcy === 'EUR' && toCcy === 'VES') {
      const eur = this.getRate('BCV_EUR');
      return eur && eur.value ? n * eur.value : 0;
    }
    // Cross USD ↔ EUR vía VES
    if (fromCcy === 'USD' && toCcy === 'EUR') {
      const ves = n * rate.value;
      const eur = this.getRate('BCV_EUR');
      return eur && eur.value ? ves / eur.value : 0;
    }
    if (fromCcy === 'EUR' && toCcy === 'USD') {
      const eur = this.getRate('BCV_EUR');
      const ves = eur && eur.value ? n * eur.value : 0;
      return ves / rate.value;
    }
    return n;
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
  },

  /** Devuelve un texto relativo "hace X minutos" para timestamps */
  timeSince(iso) {
    if (!iso) return 'nunca';
    const diff = new Date() - new Date(iso);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'hace unos segundos';
    if (sec < 3600) return `hace ${Math.floor(sec/60)} min`;
    if (sec < 86400) return `hace ${Math.floor(sec/3600)} h`;
    return `hace ${Math.floor(sec/86400)} días`;
  }
};
