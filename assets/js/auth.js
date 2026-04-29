/* ============================================
   auth.js — Autenticación y Permisos
   Sesión guardada en sessionStorage. En Firebase
   esto se reemplaza con firebase.auth().
   ============================================ */

const SESSION_KEY = 'altcare_session';

const ROLES = {
  admin:      { label: 'Administrador', color: '#5b7a5a' },
  gerente:    { label: 'Gerente',       color: '#2d6a4f' },
  produccion: { label: 'Producción',    color: '#b8860b' },
  calidad:    { label: 'Calidad',       color: '#a83232' },
  almacen:    { label: 'Almacén',       color: '#4a4a45' },
  ventas:     { label: 'Ventas',        color: '#3d5a3c' },
  compras:    { label: 'Compras',       color: '#6b5a3c' }
};

// Matriz de permisos: módulo → roles permitidos
const PERMISSIONS = {
  dashboard:        ['admin','gerente','produccion','calidad','almacen','ventas','compras'],
  configuracion:    ['admin'],
  usuarios:         ['admin'],
  'tasas-cambio':   ['admin','gerente','ventas','compras'],
  'materias-primas':['admin','gerente','produccion','calidad','almacen','compras'],
  proveedores:      ['admin','gerente','compras'],
  clientes:         ['admin','gerente','ventas'],
  formulas:         ['admin','gerente','produccion','calidad'],
  produccion:       ['admin','gerente','produccion'],
  calidad:          ['admin','gerente','calidad'],
  'producto-terminado':['admin','gerente','produccion','calidad','almacen','ventas'],
  envasado:         ['admin','gerente','produccion','almacen'],
  almacen:          ['admin','gerente','almacen'],
  compras:          ['admin','gerente','compras'],
  ventas:           ['admin','gerente','ventas'],
  pagos:            ['admin','gerente','ventas','compras'],
  trazabilidad:     ['admin','gerente','produccion','calidad','ventas'],
  reportes:         ['admin','gerente']
};

const auth = {
  ROLES,
  PERMISSIONS,

  login(username, password) {
    const user = db.query(db.COLLECTIONS.users, u =>
      u.username === username && u.password === password && u.active
    )[0];
    if (!user) return { ok: false, error: 'Usuario o contraseña incorrectos' };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      loggedInAt: new Date().toISOString()
    }));
    return { ok: true, user };
  },

  logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = (window.location.pathname.includes('/modules/') ? '../' : './') + 'index.html';
  },

  currentUser() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  isLoggedIn() { return !!this.currentUser(); },

  hasAccess(moduleName) {
    const user = this.currentUser();
    if (!user) return false;
    const allowed = PERMISSIONS[moduleName];
    return allowed ? allowed.includes(user.role) : false;
  },

  /** Llama esto al inicio de cada página de módulo. Si no tiene acceso, redirige. */
  guard(moduleName) {
    const base = window.location.pathname.includes('/modules/') ? '../' : './';
    if (!this.isLoggedIn()) {
      window.location.href = base + 'index.html';
      return false;
    }
    if (moduleName && !this.hasAccess(moduleName)) {
      alert('No tienes permisos para acceder a este módulo.');
      window.location.href = base + 'index.html';
      return false;
    }
    return true;
  }
};
