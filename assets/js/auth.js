/* ============================================
   auth.js — Autenticación con Firebase Auth
   Login con email + password.
   El perfil del usuario (rol, nombre, etc.) está en
   Firestore en la colección "users", indexado por su UID.
   ============================================ */

const ROLES = {
  admin:       { label: 'Administrador',     modules: '*' },
  gerente:     { label: 'Gerente',           modules: ['dashboard','tasas-cambio','configuracion','proveedores','clientes','almacenes','materias-primas','formulas','produccion','calidad','producto-terminado','almacen','trazabilidad','envasado','compras','cuentas-bancarias','metodos-pago','pagos','ventas','reportes'] },
  contador:    { label: 'Contador',          modules: ['dashboard','reportes','compras','ventas','pagos','cuentas-bancarias','tasas-cambio'] },
  ventas:      { label: 'Ventas',            modules: ['dashboard','clientes','ventas','pagos'] },
  compras:     { label: 'Compras',           modules: ['dashboard','proveedores','compras','pagos'] },
  produccion:  { label: 'Producción',        modules: ['dashboard','formulas','produccion','calidad','producto-terminado','almacen','envasado'] },
  almacen:     { label: 'Almacén',           modules: ['dashboard','almacen','almacenes','materias-primas','producto-terminado','trazabilidad'] },
  calidad:     { label: 'Control Calidad',   modules: ['dashboard','calidad','trazabilidad'] }
};

// PERMISSIONS: estructura inversa { moduleName: [roles que tienen acceso] }
// Compatibilidad con código que la usa así
const PERMISSIONS = (() => {
  const ALL_MODULES = ['dashboard','tasas-cambio','configuracion','proveedores','clientes','usuarios','almacenes','materias-primas','formulas','produccion','calidad','producto-terminado','almacen','trazabilidad','envasado','compras','cuentas-bancarias','metodos-pago','pagos','ventas','reportes'];
  const out = {};
  ALL_MODULES.forEach(m => {
    out[m] = [];
    Object.entries(ROLES).forEach(([roleKey, roleDef]) => {
      if (roleDef.modules === '*' || roleDef.modules.includes(m)) {
        out[m].push(roleKey);
      }
    });
  });
  return out;
})();

const auth = {

  ROLES,
  PERMISSIONS,

  // Cache del perfil completo del usuario (de Firestore)
  _profile: null,

  // ====== ESTADO DE LOGIN ======

  /** Devuelve true si hay un usuario autenticado en Firebase Auth */
  isLoggedIn() {
    return !!(window.fb && window.fb.auth && window.fb.auth.currentUser);
  },

  /** Devuelve el perfil completo del usuario actual desde caché */
  getCurrentUser() {
    return this._profile;
  },

  /**
   * Alias de getCurrentUser() (compatibilidad con código viejo).
   * Los módulos viejos llamaban `auth.currentUser()` esperando un objeto con
   * username, fullName, id. Devolvemos el perfil con esos campos mapeados.
   */
  currentUser() {
    if (!this._profile) return null;
    return {
      ...this._profile,
      // Compatibilidad: nombres de campos viejos
      username: this._profile.email,
      fullName: this._profile.name || this._profile.email
    };
  },

  /** Devuelve el UID de Firebase del usuario actual */
  getUid() {
    return window.fb?.auth?.currentUser?.uid || null;
  },

  // ====== MODOS DE VISTA ======

  /** Modos disponibles del sistema */
  MODES: {
    gerencial: { label: 'Gerencial', sub: 'USD · Tasa Binance', icon: '📊', currency: 'USD', rateType: 'BINANCE' },
    contable:  { label: 'Contable',  sub: 'VES · Tasa BCV',     icon: '📋', currency: 'VES', rateType: 'BCV_USD' }
  },

  /**
   * Devuelve los modos permitidos al usuario actual.
   * Si no tiene allowedModes definido, por defecto le damos solo 'contable'.
   * Admin siempre puede ambos.
   */
  getAllowedModes() {
    if (!this._profile) return ['contable'];
    if (this._profile.role === 'admin') return ['gerencial', 'contable'];
    const allowed = this._profile.allowedModes;
    if (!allowed || !Array.isArray(allowed) || allowed.length === 0) {
      return ['contable']; // default
    }
    return allowed.filter(m => m === 'gerencial' || m === 'contable');
  },

  /** ¿El usuario actual puede usar ambos modos? */
  canSwitchModes() {
    return this.getAllowedModes().length > 1;
  },

  /** Devuelve el modo activo del usuario actual */
  getActiveMode() {
    const allowed = this.getAllowedModes();
    // Si solo tiene uno, ese es el activo
    if (allowed.length === 1) return allowed[0];
    // Si tiene ambos, leer de localStorage o default 'contable'
    const stored = localStorage.getItem('altcare_active_mode_' + this.getUid());
    if (stored && allowed.includes(stored)) return stored;
    return 'contable';
  },

  /** Cambia el modo activo (solo si está permitido) */
  setActiveMode(mode) {
    const allowed = this.getAllowedModes();
    if (!allowed.includes(mode)) return false;
    localStorage.setItem('altcare_active_mode_' + this.getUid(), mode);
    // Disparar evento para que módulos puedan re-renderizar
    window.dispatchEvent(new CustomEvent('mode-changed', { detail: { mode } }));
    return true;
  },

  // ====== LOGIN / LOGOUT ======

  /**
   * Login con email y password.
   * Después del login carga el perfil de Firestore.
   * @returns {Promise<{ok, error}>}
   */
  async login(email, password) {
    if (!window.fb) return { ok: false, error: 'Firebase no inicializado' };
    try {
      await window.fb.signInWithEmailAndPassword(window.fb.auth, email.trim(), password);
      await this.loadProfile();
      return { ok: true };
    } catch (err) {
      let msg = 'Error de login';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        msg = 'Email o contraseña incorrectos';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Demasiados intentos. Esperá unos minutos.';
      } else if (err.code === 'auth/network-request-failed') {
        msg = 'Sin conexión a internet';
      }
      return { ok: false, error: msg };
    }
  },

  async logout() {
    if (!window.fb) return;
    this._profile = null;
    if (window.db) window.db.clearCache();
    await window.fb.signOut(window.fb.auth);
    window.location.href = '/altcare/';
  },

  /**
   * Carga el perfil del usuario desde Firestore.
   * Si no existe el perfil pero el usuario está autenticado, retorna error.
   */
  async loadProfile() {
    const uid = this.getUid();
    if (!uid) return null;
    const fb = window.fb;
    const docRef = fb.doc(fb.db, 'users', uid);
    const snap = await fb.getDoc(docRef);
    if (!snap.exists()) {
      this._profile = null;
      throw new Error('Tu usuario no tiene perfil. Contactá al administrador.');
    }
    this._profile = { ...snap.data(), id: uid };
    return this._profile;
  },

  /**
   * Espera a que Firebase Auth determine el estado inicial.
   * Devuelve el perfil si hay sesión activa, null si no.
   */
  async waitReady() {
    // Esperar a que window.fb exista (firebase-init.js es módulo ES6 async)
    let waited = 0;
    while (!window.fb && waited < 10000) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }
    if (!window.fb) {
      console.error('[auth] Firebase no se cargó después de 10s');
      return null;
    }

    return new Promise((resolve) => {
      const unsub = window.fb.onAuthStateChanged(window.fb.auth, async (user) => {
        unsub();
        if (!user) return resolve(null);
        try {
          await this.loadProfile();
          resolve(this._profile);
        } catch (err) {
          console.error('[auth] No se pudo cargar perfil:', err.message);
          resolve(null);
        }
      });
      // Timeout de seguridad
      setTimeout(() => resolve(window.fb?.auth?.currentUser ? null : null), 8000);
    });
  },

  // ====== AUTORIZACIÓN ======

  /**
   * Verifica si el usuario actual tiene acceso a un módulo.
   * Si no tiene acceso, redirige al dashboard y devuelve false.
   */
  guard(moduleName) {
    if (!this.isLoggedIn()) {
      window.location.href = '/altcare/';
      return false;
    }
    if (!this._profile) {
      // Perfil aún no cargado (el guard se llamó antes que se inicialice)
      // No bloqueamos, dejamos que el bootstrap de la página se encargue
      return true;
    }
    const role = this._profile.role || 'admin';
    const allowed = ROLES[role]?.modules || [];
    if (allowed === '*') return true;
    if (allowed.includes(moduleName)) return true;
    if (window.ui && window.ui.toast) window.ui.toast('Sin permiso para este módulo', 'error');
    setTimeout(() => { window.location.href = '/altcare/'; }, 800);
    return false;
  },

  /** Verifica si el rol actual puede acceder a un módulo (sin redireccionar) */
  canAccess(moduleName, role = null) {
    const r = role || this._profile?.role || 'admin';
    const allowed = ROLES[r]?.modules || [];
    return allowed === '*' || allowed.includes(moduleName);
  },

  /** Alias de canAccess (compatibilidad) */
  hasAccess(moduleName) {
    return this.canAccess(moduleName);
  },

  // ====== GESTIÓN DE USUARIOS (admin) ======

  /**
   * Crea un usuario nuevo. Solo admin puede hacerlo.
   * IMPORTANTE: createUserWithEmailAndPassword desloguea al admin actual,
   * por lo que después de crear hay que volver a loguear al admin.
   * Por eso preferimos crear desde la consola Firebase manualmente,
   * y solo guardar el perfil en Firestore.
   */
  async createUserProfile(uid, profile) {
    const fb = window.fb;
    const docRef = fb.doc(fb.db, 'users', uid);
    await fb.setDoc(docRef, {
      ...profile,
      createdAt: new Date().toISOString(),
      createdBy: this.getUid()
    });
  },

  async updateUserProfile(uid, updates) {
    const fb = window.fb;
    const docRef = fb.doc(fb.db, 'users', uid);
    await fb.updateDoc(docRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: this.getUid()
    });
  },

  /** Envía email de reset de password al usuario */
  async sendPasswordReset(email) {
    if (!window.fb) return { ok: false, error: 'Firebase no inicializado' };
    try {
      await window.fb.sendPasswordResetEmail(window.fb.auth, email.trim());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};

window.auth = auth;
