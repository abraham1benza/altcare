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
  },

  // ====== HELPERS DE MODO (Gerencial / Contable) ======

  /**
   * Devuelve la moneda de visualización según el modo activo del usuario.
   * - Gerencial → USD
   * - Contable → VES
   */
  getModeCurrency() {
    if (typeof auth === 'undefined' || !auth.getActiveMode) return 'VES';
    const mode = auth.getActiveMode();
    return mode === 'gerencial' ? 'USD' : 'VES';
  },

  /**
   * Devuelve el tipo de tasa que usa el modo activo.
   * - Gerencial → BINANCE (P2P)
   * - Contable → BCV_USD
   */
  getModeRateType() {
    if (typeof auth === 'undefined' || !auth.getActiveMode) return 'BCV_USD';
    const mode = auth.getActiveMode();
    return mode === 'gerencial' ? 'BINANCE' : 'BCV_USD';
  },

  /**
   * Convierte un monto desde su moneda original a la moneda del modo activo.
   * Usa la tasa del modo activo para la conversión.
   * @param {number} amount - cantidad
   * @param {string} fromCurrency - 'VES', 'USD', 'EUR'
   * @returns {number} - monto en la moneda del modo activo
   */
  toDisplay(amount, fromCurrency = 'VES') {
    const n = parseFloat(amount) || 0;
    const targetCcy = this.getModeCurrency();
    if (fromCurrency === targetCcy) return n;

    const rateType = this.getModeRateType();
    const rate = this.getRate(rateType);
    if (!rate || !rate.value) return 0;

    // Caso: convertir VES → USD usando tasa del modo
    if (fromCurrency === 'VES' && targetCcy === 'USD') {
      return n / rate.value;
    }
    // Caso: convertir USD → VES usando tasa del modo
    if (fromCurrency === 'USD' && targetCcy === 'VES') {
      return n * rate.value;
    }
    // Caso: convertir EUR → moneda destino vía VES
    if (fromCurrency === 'EUR') {
      const eurRate = this.getRate(targetCcy === 'USD' ? 'BCV_EUR' : 'BCV_EUR');
      if (!eurRate || !eurRate.value) return 0;
      const ves = n * eurRate.value;
      if (targetCcy === 'VES') return ves;
      // a USD usando tasa del modo
      return ves / rate.value;
    }
    // Caso: VES → EUR (raro pero por si acaso)
    if (fromCurrency === 'VES' && targetCcy === 'EUR') {
      const eurRate = this.getRate('BCV_EUR');
      return eurRate && eurRate.value ? n / eurRate.value : 0;
    }
    return n;
  },

  /**
   * Formatea un monto en la moneda del modo activo, después de convertirlo.
   */
  formatInMode(amount, fromCurrency = 'VES') {
    const converted = this.toDisplay(amount, fromCurrency);
    return this.format(converted, this.getModeCurrency());
  },

  // ============================================
  // ===   SISTEMA DE TASAS CONGELADAS       ===
  // ============================================

  /**
   * Devuelve la tasa BCV_USD del día indicado (o la más cercana hacia atrás).
   * Busca en historicalRates primero, sino en la tasa actual.
   * @param {string} date - YYYY-MM-DD
   * @param {string} type - 'BCV_USD' por default
   * @returns {{value: number, date: string, found: boolean, type: string}}
   */
  getRateOnDate(date, type = 'BCV_USD') {
    if (!date) {
      const r = this.getRate(type);
      return { value: r?.value || 0, date: r?.updatedDate || '', found: false, type };
    }
    // Buscar en historicalRates si existe la colección
    try {
      if (db.COLLECTIONS.historicalRates) {
        const all = db.getAll(db.COLLECTIONS.historicalRates)
          .filter(h => h.type === type && h.date <= date)
          .sort((a, b) => b.date.localeCompare(a.date));
        if (all.length) {
          return { value: all[0].value, date: all[0].date, found: all[0].date === date, type };
        }
      }
    } catch (e) { /* ignorar */ }
    // Fallback: tasa actual
    const r = this.getRate(type);
    return { value: r?.value || 0, date: r?.updatedDate || '', found: false, type };
  },

  /**
   * Guarda una tasa histórica para una fecha específica.
   * Útil para snapshot diario o ajustes manuales.
   */
  saveHistoricalRate(date, type, value) {
    if (!db.COLLECTIONS.historicalRates) return false;
    const id = `${type}_${date}`;
    const existing = db.getById(db.COLLECTIONS.historicalRates, id);
    const rec = {
      id,
      date,
      type,
      value: parseFloat(value) || 0,
      savedAt: existing?.savedAt || new Date().toISOString()
    };
    db.save(db.COLLECTIONS.historicalRates, rec);
    return true;
  },

  /**
   * Snapshot de la tasa de hoy en historicalRates.
   * Se llama automáticamente cuando cambia el día.
   */
  snapshotTodayRates() {
    const today = new Date().toISOString().slice(0, 10);
    ['BCV_USD', 'BCV_EUR', 'BINANCE', 'P2P_EUR'].forEach(type => {
      const r = this.getRate(type);
      if (r && r.value > 0) {
        this.saveHistoricalRate(today, type, r.value);
      }
    });
  },

  /**
   * Convierte un monto entre dos monedas usando una tasa específica (no la actual).
   * Útil para mostrar montos congelados con su tasa histórica.
   * @param {number} amount - cantidad original
   * @param {string} fromCcy - moneda origen
   * @param {string} toCcy - moneda destino
   * @param {number} rate - tasa específica (ej: 35.5 para BCV_USD)
   * @param {string} rateType - tipo de tasa que se está usando
   */
  convertWithRate(amount, fromCcy, toCcy, rate, rateType = 'BCV_USD') {
    const n = parseFloat(amount) || 0;
    if (fromCcy === toCcy) return n;
    if (!rate || rate <= 0) return 0;

    if (fromCcy === 'VES' && toCcy === 'USD') return n / rate;
    if (fromCcy === 'USD' && toCcy === 'VES') return n * rate;

    // EUR usa BCV_EUR, separado
    if (fromCcy === 'VES' && toCcy === 'EUR') {
      // si rate es BCV_EUR
      if (rateType === 'BCV_EUR' || rateType === 'P2P_EUR') return n / rate;
      // si rate es de USD, no podemos convertir directo a EUR
      return 0;
    }
    if (fromCcy === 'EUR' && toCcy === 'VES') {
      if (rateType === 'BCV_EUR' || rateType === 'P2P_EUR') return n * rate;
      return 0;
    }
    return n;
  },

  /**
   * Calcula el equivalente fiscal de un monto en la moneda objetivo.
   * Si se proporciona tasa congelada (rate), usa esa. Si no, usa la actual del modo.
   *
   * @param {number} amount - monto en moneda original
   * @param {string} fromCcy - moneda original ('USD', 'VES', 'EUR')
   * @param {string} toCcy - moneda destino
   * @param {object} [frozen] - {rate, rateType} si la conversión está congelada
   * @returns {{value: number, rate: number, rateType: string, isFrozen: boolean}}
   */
  toFiscal(amount, fromCcy, toCcy = 'VES', frozen = null) {
    const n = parseFloat(amount) || 0;
    if (fromCcy === toCcy) return { value: n, rate: 1, rateType: '', isFrozen: !!frozen };

    if (frozen && frozen.rate && frozen.rate > 0) {
      const value = this.convertWithRate(n, fromCcy, toCcy, frozen.rate, frozen.rateType || 'BCV_USD');
      return { value, rate: frozen.rate, rateType: frozen.rateType || 'BCV_USD', isFrozen: true };
    }
    // No congelado → tasa actual BCV
    const rateType = (toCcy === 'EUR' || fromCcy === 'EUR') ? 'BCV_EUR' : 'BCV_USD';
    const rate = this.getRate(rateType);
    if (!rate || !rate.value) return { value: 0, rate: 0, rateType, isFrozen: false };
    const value = this.convertWithRate(n, fromCcy, toCcy, rate.value, rateType);
    return { value, rate: rate.value, rateType, isFrozen: false };
  },

  /**
   * Genera un texto formateado "$100,00 · (Bs 3.550,00)" o similar.
   * Solo muestra el monto convertido entre paréntesis (sin la tasa, que es obvia para el usuario).
   * Si está congelado, agrega un candado.
   */
  formatBoth(amount, fromCcy, frozen = null) {
    const original = this.format(amount, fromCcy);
    const isVES = fromCcy === 'VES';
    const targetCcy = isVES ? 'USD' : 'VES';
    const conv = this.toFiscal(amount, fromCcy, targetCcy, frozen);
    if (!conv.value) return original;

    const lockIcon = conv.isFrozen ? ' 🔒' : '';
    return `${original} · (${this.format(conv.value, targetCcy)}${lockIcon})`;
  }
};
