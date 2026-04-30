/* ============================================
   module-init.js — Boot de módulos
   Espera Firebase + Auth + DB lista antes de seguir.

   Estrategia simple y robusta:
   1. Esperar a que window.fb exista (firebase-init.js cargó)
   2. Esperar al PRIMER evento de onAuthStateChanged (Firebase ya determinó si hay sesión o no)
   3. Si hay sesión → cargar perfil + datos
   4. Si NO hay sesión → redirigir al login
   ============================================ */

window.moduleInit = async function(moduleName) {
  // Mostrar pantalla de carga
  let loading = document.getElementById('module-loading');
  if (!loading) {
    loading = document.createElement('div');
    loading.id = 'module-loading';
    loading.style.cssText = 'position:fixed;inset:0;background:#fafaf6;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;';
    loading.innerHTML = `
      <div style="font-family:'Fraunces',serif;font-style:italic;font-size:48px;letter-spacing:-0.03em;line-height:1;color:#1a1a18;">
        <span style="color:#5b7a5a;">alt</span>care
      </div>
      <div style="margin-top:24px;width:32px;height:32px;border:3px solid #e7e5df;border-top-color:#5b7a5a;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <div id="module-loading-text" style="margin-top:20px;font-size:13px;color:#8a8a82;letter-spacing:0.04em;">Sincronizando datos...</div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(loading);
  }
  const setText = (t) => {
    const el = document.getElementById('module-loading-text');
    if (el) el.textContent = t;
  };

  console.log(`[moduleInit] Iniciando módulo: ${moduleName}`);

  try {
    // 1. ESPERAR A QUE FIREBASE ESTÉ DISPONIBLE
    setText('Cargando Firebase...');
    let waited = 0;
    while (!window.fb && waited < 10000) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }
    if (!window.fb) {
      console.error('[moduleInit] Firebase no se cargó en 10s');
      throw new Error('Firebase no se pudo cargar');
    }
    console.log('[moduleInit] Firebase listo');

    // 2. ESPERAR AL PRIMER EVENTO DE onAuthStateChanged
    // Esto es CLAVE: el primer evento siempre indica el estado real de la sesión
    // (después de que Firebase haya leído el storage local)
    setText('Verificando sesión...');
    const user = await new Promise((resolve) => {
      const unsub = window.fb.onAuthStateChanged(window.fb.auth, (u) => {
        unsub();
        resolve(u);
      });
      // Timeout de seguridad
      setTimeout(() => resolve(window.fb.auth.currentUser), 5000);
    });

    console.log('[moduleInit] User:', user ? user.email : '(sin sesión)');

    if (!user) {
      console.warn('[moduleInit] No hay sesión, redirigiendo a login');
      // Detectar si estamos en /altcare/ o en raíz
      const path = window.location.pathname;
      const goTo = path.includes('/altcare/') ? '/altcare/' : '../index.html';
      window.location.href = goTo;
      return false;
    }

    // 3. CARGAR PERFIL DESDE FIRESTORE
    setText('Cargando perfil...');
    try {
      await auth.loadProfile();
      console.log('[moduleInit] Perfil:', auth._profile?.email, '· rol:', auth._profile?.role);
    } catch (err) {
      console.error('[moduleInit] Error cargando perfil:', err.message);
      alert('Error: ' + err.message);
      const path = window.location.pathname;
      const goTo = path.includes('/altcare/') ? '/altcare/' : '../index.html';
      window.location.href = goTo;
      return false;
    }

    // 4. VERIFICAR ACCESO AL MÓDULO
    if (!auth.canAccess(moduleName)) {
      alert('No tenés permiso para acceder a este módulo.');
      const path = window.location.pathname;
      const goTo = path.includes('/altcare/') ? '/altcare/' : '../index.html';
      window.location.href = goTo;
      return false;
    }

    // 5. CARGAR DATOS DESDE FIRESTORE
    setText('Cargando datos...');
    await db.init();
    await db.seedDefaults();
    console.log('[moduleInit] DB cargada · módulo listo:', moduleName);

    // 6. OCULTAR LOADING
    loading.remove();
    return true;
  } catch (err) {
    console.error('[moduleInit] Error fatal:', err);
    setText('Error: ' + err.message);
    loading.style.color = '#a83232';
    setTimeout(() => {
      const path = window.location.pathname;
      const goTo = path.includes('/altcare/') ? '/altcare/' : '../index.html';
      window.location.href = goTo;
    }, 2500);
    return false;
  }
};
