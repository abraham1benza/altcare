/* ============================================
   db.js — Capa de Datos
   Abstracción sobre localStorage. Cuando migremos a
   Firebase, solo este archivo cambia. El resto del
   sistema sigue llamando db.getAll(), db.save(), etc.
   ============================================ */

const DB_VERSION = 4;
const DB_PREFIX = 'altcare_';

const COLLECTIONS = {
  users: 'users',
  config: 'config',
  rates: 'rates',
  // Inventario
  rawMaterials: 'rawMaterials',
  rmLots: 'rmLots',
  warehouses: 'warehouses',
  locations: 'locations',
  // Comercial - master data
  suppliers: 'suppliers',
  customers: 'customers',
  // Producción
  formulas: 'formulas',
  formulaVersions: 'formulaVersions',
  presentations: 'presentations',          // 🆕 SKUs envasados (Shampoo X · 250ml)
  productionOrders: 'productionOrders',     // OF de fabricación (granel)
  packagingOrders: 'packagingOrders',       // 🆕 OF de envasado
  qcTests: 'qcTests',
  finishedGoods: 'finishedGoods',           // ahora distingue BULK / PACKAGED
  packaging: 'packaging',
  // Movimientos
  warehouseMoves: 'warehouseMoves',
  // ===== COMERCIAL FASE 3 =====
  purchaseOrders: 'purchaseOrders',
  purchaseReceipts: 'purchaseReceipts',
  supplierInvoices: 'supplierInvoices',
  withholdingVouchers: 'withholdingVouchers',
  salesOrders: 'salesOrders',
  salesInvoices: 'salesInvoices',
  paymentMethods: 'paymentMethods',
  bankAccounts: 'bankAccounts',
  payments: 'payments',
  bankMoves: 'bankMoves',
  // Sistema
  auditLog: 'auditLog'
};

const db = {
  // ====== Bajo nivel ======
  _key(collection) { return `${DB_PREFIX}${collection}`; },

  _read(collection) {
    try {
      const raw = localStorage.getItem(this._key(collection));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('DB read error:', collection, e);
      return [];
    }
  },

  _write(collection, data) {
    try {
      localStorage.setItem(this._key(collection), JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('DB write error:', collection, e);
      return false;
    }
  },

  // ====== CRUD genérico ======

  /** Devuelve todos los registros de una colección */
  getAll(collection) {
    return this._read(collection);
  },

  /** Devuelve uno por id */
  getById(collection, id) {
    return this._read(collection).find(r => r.id === id) || null;
  },

  /** Filtra registros */
  query(collection, predicate) {
    return this._read(collection).filter(predicate);
  },

  /** Crea o actualiza. Si no trae id, lo asigna. */
  save(collection, record) {
    const all = this._read(collection);
    if (!record.id) {
      record.id = this._uid();
      record.createdAt = new Date().toISOString();
      record.createdBy = auth.currentUser()?.username || 'system';
      all.push(record);
    } else {
      const idx = all.findIndex(r => r.id === record.id);
      if (idx === -1) {
        all.push(record);
      } else {
        record.updatedAt = new Date().toISOString();
        record.updatedBy = auth.currentUser()?.username || 'system';
        all[idx] = { ...all[idx], ...record };
      }
    }
    this._write(collection, all);
    this._audit(collection, record.id, 'save');
    return record;
  },

  /** Borra por id */
  remove(collection, id) {
    const all = this._read(collection);
    const filtered = all.filter(r => r.id !== id);
    this._write(collection, filtered);
    this._audit(collection, id, 'delete');
    return filtered.length !== all.length;
  },

  /** Limpia toda una colección */
  clear(collection) {
    this._write(collection, []);
  },

  /** Limpia TODA la base de datos. Úsalo con cuidado. */
  nuke() {
    Object.values(COLLECTIONS).forEach(c => localStorage.removeItem(this._key(c)));
  },

  /** Genera ID único */
  _uid() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  },

  /** Genera código secuencial tipo MP-0001, OF-0001 */
  nextCode(collection, prefix, padding = 4) {
    const all = this._read(collection);
    const codes = all
      .map(r => r.code)
      .filter(c => c && c.startsWith(prefix + '-'))
      .map(c => parseInt(c.split('-')[1], 10))
      .filter(n => !isNaN(n));
    const next = codes.length ? Math.max(...codes) + 1 : 1;
    return `${prefix}-${String(next).padStart(padding, '0')}`;
  },

  /** Auditoría simple */
  _audit(collection, recordId, action) {
    if (collection === COLLECTIONS.auditLog) return; // evita recursión
    const log = this._read(COLLECTIONS.auditLog);
    log.push({
      id: this._uid(),
      timestamp: new Date().toISOString(),
      user: typeof auth !== 'undefined' ? auth.currentUser()?.username : 'system',
      collection,
      recordId,
      action
    });
    if (log.length > 5000) log.splice(0, log.length - 5000); // límite
    this._write(COLLECTIONS.auditLog, log);
  },

  // ====== Export / Import ======

  exportAll() {
    const dump = { version: DB_VERSION, exportedAt: new Date().toISOString(), data: {} };
    Object.values(COLLECTIONS).forEach(c => { dump.data[c] = this._read(c); });
    return dump;
  },

  importAll(dump) {
    if (!dump || !dump.data) return false;
    Object.entries(dump.data).forEach(([c, data]) => {
      this._write(c, data);
    });
    return true;
  }
};

// Exponer constantes
db.COLLECTIONS = COLLECTIONS;

// ====== INICIALIZACIÓN POR DEFECTO ======
// Solo se corre la primera vez que se abre la app
(function initDefaults() {
  // Config inicial
  if (db.getAll(COLLECTIONS.config).length === 0) {
    db.save(COLLECTIONS.config, {
      id: 'main',
      companyName: '',
      rif: '',
      address: '',
      phone: '',
      email: '',
      website: '',
      ivaRate: 16,
      ivaWithholdingRate: 75,
      currency: 'VES',
      defaultRateType: 'BCV_USD',
      logoDataUrl: null,
      expiryAlertDays: 60,
      lotNumberFormat: 'L-{YYYY}-{####}',
      // Fase 3
      invoiceMode: 'SENIAT',                       // SENIAT | SIMPLE
      invoiceControlNumberPrefix: '00',           // ej: 00-00000001
      invoiceNumberPrefix: 'F',                   // ej: F-00000001
      invoicePaymentTermsDefault: 'Contado',
      defaultISLRRate: 0,                          // % ISLR a aplicar por defecto si proveedor no tiene
      receiptNumberPrefix: 'REC',
      withholdingVoucherPrefix: 'CR'
    });
  }
  // Almacén principal por defecto
  if (db.getAll(COLLECTIONS.warehouses).length === 0) {
    db.save(COLLECTIONS.warehouses, {
      id: 'wh_main', code: 'PRINCIPAL', name: 'Almacén Principal',
      address: '', isDefault: true, active: true
    });
  }
  // Métodos de pago por defecto
  if (db.getAll(COLLECTIONS.paymentMethods).length === 0) {
    [
      { id: 'pm_efectivo',     name: 'Efectivo',           requiresBank: false, requiresReference: false },
      { id: 'pm_transferencia',name: 'Transferencia',      requiresBank: true,  requiresReference: true },
      { id: 'pm_zelle',        name: 'Zelle',              requiresBank: true,  requiresReference: true },
      { id: 'pm_pagomovil',    name: 'Pago Móvil',         requiresBank: true,  requiresReference: true },
      { id: 'pm_cheque',       name: 'Cheque',             requiresBank: true,  requiresReference: true },
      { id: 'pm_cripto',       name: 'Criptomoneda',       requiresBank: false, requiresReference: true }
    ].forEach(pm => db.save(COLLECTIONS.paymentMethods, { ...pm, active: true }));
  }
  // Tasas iniciales (vacías, el usuario las llena)
  if (db.getAll(COLLECTIONS.rates).length === 0) {
    const today = new Date().toISOString().slice(0,10);
    db.save(COLLECTIONS.rates, { id: 'rate_BCV_USD', type: 'BCV_USD', label: 'BCV USD',  symbol: '$', value: 0, updatedDate: today, source: null, active: true });
    db.save(COLLECTIONS.rates, { id: 'rate_BCV_EUR', type: 'BCV_EUR', label: 'BCV EUR',  symbol: '€', value: 0, updatedDate: today, source: null, active: false });
    db.save(COLLECTIONS.rates, { id: 'rate_BINANCE', type: 'BINANCE', label: 'P2P USD',  symbol: '$', value: 0, updatedDate: today, source: null, active: false });
    db.save(COLLECTIONS.rates, { id: 'rate_P2P_EUR', type: 'P2P_EUR', label: 'P2P EUR',  symbol: '€', value: 0, updatedDate: today, source: null, active: false });
    db.save(COLLECTIONS.rates, { id: 'rate_CUSTOM',  type: 'CUSTOM',  label: 'Personalizada', symbol: '$', value: 0, updatedDate: today, source: null, active: false });
  } else {
    // Migración: asegurar que P2P_EUR existe y BINANCE tenga el label nuevo
    if (!db.getAll(COLLECTIONS.rates).find(r => r.type === 'P2P_EUR')) {
      db.save(COLLECTIONS.rates, { id: 'rate_P2P_EUR', type: 'P2P_EUR', label: 'P2P EUR', symbol: '€', value: 0, updatedDate: new Date().toISOString().slice(0,10), source: null, active: false });
    }
    const binance = db.getAll(COLLECTIONS.rates).find(r => r.type === 'BINANCE');
    if (binance && binance.label === 'Binance USD') {
      binance.label = 'P2P USD';
      db.save(COLLECTIONS.rates, binance);
    }
  }
  // Usuario admin por defecto
  if (db.getAll(COLLECTIONS.users).length === 0) {
    db.save(COLLECTIONS.users, {
      id: 'user_admin',
      username: 'admin',
      password: 'admin',  // ⚠️ en Firebase usaremos auth real
      fullName: 'Administrador',
      role: 'admin',
      active: true
    });
  }
})();
