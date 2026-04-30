/* ============================================
   module-init-v2.js — Boot de módulos
   Espera Firebase + Auth + DB lista antes de ejecutar el módulo.
   Si no hay sesión activa, redirige al login.
   ============================================ */

window.moduleInit = async function(moduleName) {
  // Pantalla de carga
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
      <div id="module-loading-text" style="margin-top:20px;font-size:13px;color:#8a8a82;letter-spacing:0.04em;">Cargando...</div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
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
      alert('No tenés permiso para acceder a este módulo.');
      goToLogin();
      return false;
    }

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
