/* ============================================
   module-init-v2.js — Boot de módulos
   Espera Firebase + Auth + DB lista antes de ejecutar el módulo.
   Si no hay sesión activa, redirige al login.
   ============================================ */

/* Base de rutas: los mismos JS se cargan desde la raiz (index.html) y desde
   /modules/*.html, asi que las rutas relativas a assets cambian. Idempotente:
   varios archivos pueden ejecutarlo sin pisarse. */
window.ASSET_BASE = window.ASSET_BASE ||
  (window.location.pathname.includes('/modules/') ? '../' : './');

window.moduleInit = async function(moduleName) {
  // Pantalla de carga
  let loading = document.getElementById('module-loading');
  if (!loading) {
    loading = document.createElement('div');
    loading.id = 'module-loading';
    loading.style.cssText = 'position:fixed;inset:0;background:#0a0a08;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;';
    loading.innerHTML = `
      <img src="${window.ASSET_BASE}assets/img/logo.png" alt="Alternative Care" style="width:200px;height:auto;animation:fadeInUp 0.4s ease;" />
      <div style="margin-top:32px;width:28px;height:28px;border:2px solid rgba(212,160,23,0.18);border-top-color:#e4b520;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <div id="module-loading-text" style="margin-top:18px;font-size:12px;color:rgba(255,250,230,0.5);letter-spacing:0.06em;">Cargando...</div>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      </style>
    `;
    document.body.appendChild(loading);
  }

  const setText = (t) => {
    const el = document.getElementById('module-loading-text');
    if (el) el.textContent = t;
  };

  const goToLogin = () => {
    const path = window.location.pathname;
    const goTo = path.includes('/altcare/') ? '/altcare/' : '../index.html';
    window.location.href = goTo;
  };

  try {
    // 1. Esperar a Firebase
    setText('Cargando...');
    let waited = 0;
    while (!window.fb && waited < 10000) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }
    if (!window.fb) throw new Error('Firebase no se pudo cargar');

    // 2. Verificar sesión
    setText('Verificando sesión...');
    const user = await new Promise((resolve) => {
      const unsub = window.fb.onAuthStateChanged(window.fb.auth, (u) => {
        unsub();
        resolve(u);
      });
      setTimeout(() => resolve(window.fb.auth.currentUser), 5000);
    });

    if (!user) {
      console.warn('[moduleInit] Sin sesión activa');
      goToLogin();
      return false;
    }

    // 3. Cargar perfil
    try {
      await auth.loadProfile();
    } catch (err) {
      console.error('[moduleInit] Error cargando perfil:', err.message);
      alert('Error: ' + err.message);
      goToLogin();
      return false;
    }

    // 4. Verificar acceso al módulo
    if (!auth.canAccess(moduleName)) {
      alert('No tienes permiso para acceder a este módulo.');
      window.location.href = '/altcare/';
      return false;
    }

    // 4b. Aplicar clases CSS de permisos (controla visibilidad de botones de
    //     editar/eliminar según los permisos del usuario en este módulo)
    if (auth.applyPermissionClasses) auth.applyPermissionClasses();

    // 5. Cargar datos
    setText('Cargando datos...');
    await db.init();
    await db.seedDefaults();

    // 6. Ocultar loading
    loading.remove();
    return true;
  } catch (err) {
    console.error('[moduleInit] Error:', err);
    setText('Error: ' + err.message);
    loading.style.color = '#a83232';
    setTimeout(goToLogin, 2500);
    return false;
  }
};
