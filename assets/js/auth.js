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
      try {
        await this.loadProfile();
      } catch (profileErr) {
        // Auth pasó pero Firestore falló al leer perfil
        const isBlocked = profileErr.message?.includes('ERR_BLOCKED') ||
                         profileErr.code === 'unavailable' ||
                         profileErr.message?.includes('Failed to fetch') ||
                         profileErr.message?.includes('offline');
        if (isBlocked) {
          // Cerrar sesión si no podemos leer perfil
          await window.fb.signOut(window.fb.auth);
          return {
            ok: false,
            error: '🛡️ Conexión a Firestore bloqueada. Desactivá Brave Shields o tu AdBlocker para este sitio (firestore.googleapis.com está bloqueado). Click en el icono escudo Brave al lado de la URL → bajar Shields → recargar.'
          };
        }
        // Otro error (ej: no tiene perfil)
        await window.fb.signOut(window.fb.auth);
        return { ok: false, error: profileErr.message || 'No se pudo cargar tu perfil' };
      }
      return { ok: true };
    } catch (err) {
      let msg = 'Error de login';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        msg = 'Email o contraseña incorrectos';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Demasiados intentos. Esperá unos minutos.';
      } else if (err.code === 'auth/network-request-failed') {
        msg = '🛡️ Sin conexión a Firebase. Puede ser Brave Shields o AdBlocker bloqueando. Desactivalo para este sitio.';
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
   * Crea un usuario nuevo en Firebase Auth Y en Firestore con el mismo UID.
   * IMPORTANTE: createUserWithEmailAndPassword desloguea al admin actual y
   * loguea automáticamente al usuario recién creado. Por eso, después de
   * crearlo, deslogueamos y pedimos al admin que vuelva a loguearse.
   *
   * @param {object} data - { email, password, fullName, username, role, allowedModes, active }
   * @returns {Promise<{ok, error?, uid?}>}
   */
  async createUser(data) {
    if (!window.fb) return { ok: false, error: 'Firebase no inicializado' };
    if (!data.email || !data.password) return { ok: false, error: 'Email y contraseña son obligatorios' };
    if (data.password.length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres' };

    const currentAdminEmail = this._profile?.email || (this._user?.email);
    let createdAuthUser = null; // Para rollback si falla Firestore

    try {
      // 1. Crear usuario en Firebase Auth
      const cred = await window.fb.createUserWithEmailAndPassword(
        window.fb.auth, data.email.trim(), data.password
      );
      createdAuthUser = cred.user;
      const newUid = cred.user.uid;

      // 2. Crear documento en Firestore con el MISMO UID
      const profile = {
        email: data.email.trim(),
        username: data.username,
        fullName: data.fullName,
        role: data.role,
        allowedModes: data.allowedModes,
        active: data.active !== false,
        createdAt: new Date().toISOString(),
        createdBy: currentAdminEmail || 'sistema'
      };

      try {
        await window.fb.setDoc(window.fb.doc(window.fb.db, 'users', newUid), profile);
      } catch (firestoreErr) {
        // ¡Firestore falló! El usuario quedó solo en Auth, hay que rollback
        console.error('[auth.createUser] Firestore falló, rollback de Auth:', firestoreErr);

        // Detectar si es bloqueo de adblocker/Brave Shields
        const isBlocked = firestoreErr.message?.includes('ERR_BLOCKED') ||
                         firestoreErr.code === 'unavailable' ||
                         firestoreErr.name === 'FirebaseError' && firestoreErr.message?.includes('Failed to fetch');

        // Intentar borrar el usuario de Auth para no dejar huérfano
        try {
          if (createdAuthUser && window.fb.deleteUser) {
            await window.fb.deleteUser(createdAuthUser);
            console.log('[auth.createUser] Usuario de Auth borrado (rollback OK)');
          }
        } catch (rollbackErr) {
          console.error('[auth.createUser] No se pudo hacer rollback:', rollbackErr);
        }

        // Mensaje al usuario
        if (isBlocked) {
          return {
            ok: false,
            error: '🛡️ Conexión a Firestore bloqueada por el navegador (Brave Shields o AdBlocker). Desactivá Brave Shields para este sitio: click en el escudo Brave al lado de la URL → bajar el toggle de Shields → recargar la página. También puede ser un AdBlocker bloqueando firestore.googleapis.com'
          };
        }
        return { ok: false, error: 'Error guardando perfil en Firestore: ' + (firestoreErr.message || 'desconocido') };
      }

      // 3. Cerrar sesión del usuario recién creado (Firebase nos logueó como él)
      await window.fb.signOut(window.fb.auth);

      return { ok: true, uid: newUid, needsRelogin: true, adminEmail: currentAdminEmail };

    } catch (err) {
      let msg = err.message || 'Error desconocido';
      if (err.code === 'auth/email-already-in-use') msg = 'Ya existe un usuario con ese email en Firebase Auth. Si necesitás recrearlo, eliminálo primero desde Firebase Console.';
      else if (err.code === 'auth/invalid-email') msg = 'El email no es válido';
      else if (err.code === 'auth/weak-password') msg = 'La contraseña es muy débil (mínimo 6 caracteres)';
      else if (err.code === 'auth/operation-not-allowed') msg = 'Email/password no está habilitado en Firebase. Habilítalo en Firebase Console → Authentication → Sign-in method';
      else if (err.code === 'auth/network-request-failed') msg = '🛡️ Sin conexión a Firebase. Puede ser Brave Shields/AdBlocker bloqueando. Desactivá los shields para este sitio.';
      return { ok: false, error: msg };
    }
  },

  /**
   * Crea solo el documento Firestore del usuario, asumiendo que ya existe en Firebase Auth.
   * Útil para registrar manualmente un usuario que ya fue creado en consola Firebase.
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
