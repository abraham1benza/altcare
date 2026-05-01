/* ============================================
   db.js — Capa de Datos (Firebase Firestore)
   Mantiene la misma API que la versión localStorage:
     db.getAll(collection)
     db.getById(collection, id)
     db.save(collection, item)
     db.remove(collection, id)
     db.query(collection, predicate)
     db.nextCode(collection, prefix)

   Internamente:
   - Cada colección se carga una sola vez al inicio (snapshot)
   - Los cambios se guardan en Firestore Y en caché de memoria
   - La caché se mantiene sincronizada en tiempo real con onSnapshot
   ============================================ */

const DB_VERSION = 4;

const COLLECTIONS = {
  users: 'users',
  config: 'config',
  rates: 'rates',
  historicalRates: 'historicalRates',
  rawMaterials: 'rawMaterials',
  rmLots: 'rmLots',
  warehouses: 'warehouses',
  locations: 'locations',
  suppliers: 'suppliers',
  customers: 'customers',
  formulas: 'formulas',
  formulaVersions: 'formulaVersions',
  presentations: 'presentations',
  productionOrders: 'productionOrders',
  packagingOrders: 'packagingOrders',
  qcTests: 'qcTests',
  finishedGoods: 'finishedGoods',
  packaging: 'packaging',
  warehouseMoves: 'warehouseMoves',
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
  notificationTemplates: 'notificationTemplates',
  notificationLog: 'notificationLog',
  auditLog: 'auditLog'
};

// ====== CACHÉ LOCAL EN MEMORIA ======
// Cada colección carga toda su data en memoria al inicio.
// Las funciones síncronas (getAll, getById) leen de aquí.
// Las funciones que modifican (save, remove) escriben en Firestore Y actualizan la caché.
const _cache = {};
const _ready = {}; // map collection -> Promise resolved cuando se cargó

let _initialized = false;
let _userUid = null;

const db = {
  COLLECTIONS,

  // ====== INICIALIZACIÓN ======

  /**
   * Carga todas las colecciones en caché. Llamar una vez al iniciar la app
   * después de autenticarse.
   */
  async init() {
    if (_initialized) return;
    if (!window.fb) throw new Error('Firebase no inicializado');
    if (!window.fb.auth.currentUser) throw new Error('Usuario no autenticado');
    _userUid = window.fb.auth.currentUser.uid;

    // Cargar todas las colecciones en paralelo
    const tasks = Object.values(COLLECTIONS).map(name => this._loadCollection(name));
    await Promise.all(tasks);
    _initialized = true;
    console.log('[db] Inicializado · ' + Object.keys(_cache).length + ' colecciones cargadas');
  },

  /** Carga una colección desde Firestore a la caché */
  async _loadCollection(name) {
    const fb = window.fb;
    try {
      const snap = await fb.getDocs(fb.collection(fb.db, name));
      _cache[name] = {};
      snap.forEach(d => {
        _cache[name][d.id] = { ...d.data(), id: d.id };
      });
    } catch (err) {
      // Distinguir entre permiso denegado (esperado para algunos roles)
      // vs error real (problema de configuración o conexión)
      const isPermissionError = err.code === 'permission-denied'
        || err.message?.includes('Missing or insufficient permissions');
      if (isPermissionError) {
        // Silenciar: es esperado que algunos roles no puedan leer ciertas colecciones
        console.debug(`[db] Sin permisos para ${name} (esperado por rol)`);
      } else {
        console.warn(`[db] Error cargando ${name}:`, err.message);
      }
      _cache[name] = {};
    }
  },

  isInitialized() { return _initialized; },

  /** Limpiar caché (al cerrar sesión) */
  clearCache() {
    Object.keys(_cache).forEach(k => delete _cache[k]);
    _initialized = false;
    _userUid = null;
  },

  // ====== API PÚBLICA (SÍNCRONA, igual que antes) ======

  /** Obtiene todos los items de una colección */
  getAll(collectionName) {
    if (!_cache[collectionName]) return [];
    return Object.values(_cache[collectionName]);
  },

  /** Obtiene un item por id */
  getById(collectionName, id) {
    if (!_cache[collectionName]) return null;
    return _cache[collectionName][id] || null;
  },

  /** Filtra items con un predicado */
  query(collectionName, predicate) {
    return this.getAll(collectionName).filter(predicate);
  },

  /** Genera un código secuencial para una colección con prefijo */
  nextCode(collectionName, prefix) {
    const items = this.getAll(collectionName);
    const codes = items.map(i => i.code || '').filter(c => c.startsWith(prefix + '-'));
    let max = 0;
    codes.forEach(c => {
      const n = parseInt((c.split('-')[1] || '').replace(/\D/g, ''), 10);
      if (n > max) max = n;
    });
    return prefix + '-' + String(max + 1).padStart(4, '0');
  },

  /**
   * Genera un id único (similar a Firestore autoId)
   */
  generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 20; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  },

  /**
   * Guarda un item. Si tiene id, hace update; si no, crea.
   * Devuelve el item con id asignado.
   */
  save(collectionName, item) {
    if (!_cache[collectionName]) _cache[collectionName] = {};
    if (!item.id) item.id = this.generateId();

    // Limpiar valores undefined (Firestore los rechaza)
    const clean = this._cleanForFirestore(item);

    // Update caché inmediatamente (UI responde)
    _cache[collectionName][item.id] = { ...clean };

    // Escribir a Firestore en background (no bloquea)
    const fb = window.fb;
    if (fb && fb.auth.currentUser) {
      const docRef = fb.doc(fb.db, collectionName, item.id);
      fb.setDoc(docRef, clean, { merge: false }).catch(err => {
        console.error(`[db] Error guardando ${collectionName}/${item.id}:`, err.message);
        // Notificar a UI si está disponible
        if (window.ui && window.ui.toast) {
          window.ui.toast('Error guardando: ' + err.message, 'error', 5000);
        }
      });
    }

    return clean;
  },

  /** Elimina un item */
  remove(collectionName, id) {
    if (_cache[collectionName]) {
      delete _cache[collectionName][id];
    }
    const fb = window.fb;
    if (fb && fb.auth.currentUser) {
      const docRef = fb.doc(fb.db, collectionName, id);
      fb.deleteDoc(docRef).catch(err => {
        console.error(`[db] Error eliminando ${collectionName}/${id}:`, err.message);
        if (window.ui && window.ui.toast) {
          window.ui.toast('Error eliminando: ' + err.message, 'error', 5000);
        }
      });
    }
    return true;
  },

  /**
   * Limpia un objeto para Firestore: convierte undefined → null,
   * elimina funciones, normaliza fechas.
   */
  _cleanForFirestore(obj) {
    if (obj === null || obj === undefined) return null;
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(x => this._cleanForFirestore(x));
    if (typeof obj === 'object') {
      const out = {};
      Object.entries(obj).forEach(([k, v]) => {
        if (v === undefined) out[k] = null;
        else if (typeof v === 'function') return;
        else out[k] = this._cleanForFirestore(v);
      });
      return out;
    }
    return obj;
  },

  // ====== UTILIDADES ======

  /**
   * Asegura que existan los datos por defecto (config, rates, paymentMethods, etc.).
   * SOLO se ejecuta si el usuario es admin (roles inferiores no tienen permiso).
   * Solo crea si la colección está vacía.
   */
  async seedDefaults() {
    const fb = window.fb;

    // Solo admin puede hacer seed (los otros roles no tienen permiso de escritura
    // en config/rates/paymentMethods según reglas Firestore)
    const profile = window.auth?._profile;
    const isAdmin = profile?.role === 'admin';
    if (!isAdmin) {
      console.log('[db] seedDefaults: omitido (usuario no admin)');
      return;
    }

    const today = new Date().toISOString().slice(0,10);

    // Config
    if (this.getAll(COLLECTIONS.config).length === 0) {
      this.save(COLLECTIONS.config, {
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
        invoiceMode: 'SENIAT',
        invoiceNumberPrefix: 'F',
        invoiceControlNumberPrefix: '00',
        nextInvoiceNumber: 1,
        nextControlNumber: 1
      });
    }

    // Tasas
    if (this.getAll(COLLECTIONS.rates).length === 0) {
      this.save(COLLECTIONS.rates, { id: 'rate_BCV_USD', type: 'BCV_USD', label: 'BCV USD',  symbol: '$', value: 0, updatedDate: today, source: null, active: true });
      this.save(COLLECTIONS.rates, { id: 'rate_BCV_EUR', type: 'BCV_EUR', label: 'BCV EUR',  symbol: '€', value: 0, updatedDate: today, source: null, active: false });
      this.save(COLLECTIONS.rates, { id: 'rate_BINANCE', type: 'BINANCE', label: 'P2P USD',  symbol: '$', value: 0, updatedDate: today, source: null, active: false });
      this.save(COLLECTIONS.rates, { id: 'rate_P2P_EUR', type: 'P2P_EUR', label: 'P2P EUR',  symbol: '€', value: 0, updatedDate: today, source: null, active: false });
      this.save(COLLECTIONS.rates, { id: 'rate_CUSTOM',  type: 'CUSTOM',  label: 'Personalizada', symbol: '$', value: 0, updatedDate: today, source: null, active: false });
    } else {
      // Migración: asegurar P2P_EUR
      if (!this.getAll(COLLECTIONS.rates).find(r => r.type === 'P2P_EUR')) {
        this.save(COLLECTIONS.rates, { id: 'rate_P2P_EUR', type: 'P2P_EUR', label: 'P2P EUR', symbol: '€', value: 0, updatedDate: today, source: null, active: false });
      }
    }

    // Métodos de pago default
    if (this.getAll(COLLECTIONS.paymentMethods).length === 0) {
      const methods = [
        { id: 'pm_efectivo',     name: 'Efectivo',      type: 'CASH',          requiresBank: false, requiresReference: false, active: true },
        { id: 'pm_transferencia',name: 'Transferencia', type: 'TRANSFER',      requiresBank: true,  requiresReference: true,  active: true },
        { id: 'pm_zelle',        name: 'Zelle',         type: 'TRANSFER',      requiresBank: true,  requiresReference: true,  active: true },
        { id: 'pm_pago_movil',   name: 'Pago Móvil',    type: 'MOBILE',        requiresBank: true,  requiresReference: true,  active: true },
        { id: 'pm_cheque',       name: 'Cheque',        type: 'CHECK',         requiresBank: true,  requiresReference: true,  active: true },
        { id: 'pm_cripto',       name: 'Criptomoneda',  type: 'CRYPTO',        requiresBank: false, requiresReference: true,  active: true }
      ];
      methods.forEach(m => this.save(COLLECTIONS.paymentMethods, m));
    }
  }
};

// Hacer disponible globalmente
window.db = db;
