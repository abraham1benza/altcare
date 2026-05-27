/* ============================================
   module-init.js — VERSIÓN DEBUG
   NO redirige al login - solo muestra error en pantalla
   para que podamos ver qué pasa
   ============================================ */

console.log('[moduleInit] script cargado');

window.moduleInit = async function(moduleName) {
  console.log('[moduleInit] === INICIO ===', moduleName);

  // Mostrar pantalla de carga con info de debug
  let loading = document.getElementById('module-loading');
  if (!loading) {
    loading = document.createElement('div');
    loading.id = 'module-loading';
    loading.style.cssText = 'position:fixed;inset:0;background:#fafaf6;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    loading.innerHTML = `
      <div style="font-family:'Fraunces',serif;font-style:italic;font-size:48px;letter-spacing:-0.03em;line-height:1;color:#1a1a18;">
        <span style="color:#5b7a5a;">alt</span>care
      </div>
      <div style="margin-top:24px;width:32px;height:32px;border:3px solid #e7e5df;border-top-color:#5b7a5a;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <div id="module-loading-text" style="margin-top:20px;font-size:13px;color:#8a8a82;letter-spacing:0.04em;text-align:center;max-width:600px;">Iniciando...</div>
      <div id="module-debug-log" style="margin-top:30px;font-family:monospace;font-size:11px;color:#666;text-align:left;max-width:800px;background:#f0f0f0;padding:12px;border-radius:6px;white-space:pre-wrap;"></div>
      <button id="module-back-btn" style="margin-top:20px;padding:8px 16px;background:#5b7a5a;color:white;border:none;border-radius:4px;cursor:pointer;display:none;" onclick="window.location.href='../index.html'">← Volver al dashboard</button>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(loading);
  }

  const setText = (t) => {
    const el = document.getElementById('module-loading-text');
    if (el) el.textContent = t;
    console.log('[moduleInit]', t);
  };

  const debugLog = (msg) => {
    const el = document.getElementById('module-debug-log');
    if (el) el.textContent += msg + '\n';
    console.log('[moduleInit DEBUG]', msg);
  };

  const showError = (msg) => {
    setText('❌ Error: ' + msg);
    loading.style.color = '#a83232';
    const btn = document.getElementById('module-back-btn');
    if (btn) btn.style.display = 'inline-block';
  };

  try {
    debugLog('1. Buscando window.fb...');
    setText('Cargando Firebase...');

    let waited = 0;
    while (!window.fb && waited < 10000) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }

    if (!window.fb) {
      debugLog('❌ window.fb NO existe después de 10s');
      showError('Firebase no se pudo cargar (timeout)');
      return false;
    }
    debugLog('✓ window.fb existe (esperó ' + waited + 'ms)');

    debugLog('2. Verificando sesión con onAuthStateChanged...');
    setText('Verificando sesión...');

    const user = await new Promise((resolve) => {
      const unsub = window.fb.onAuthStateChanged(window.fb.auth, (u) => {
        unsub();
        resolve(u);
      });
      setTimeout(() => resolve(window.fb.auth.currentUser), 5000);
    });

    if (!user) {
      debugLog('❌ NO hay usuario autenticado');
      debugLog('   currentUser directo: ' + (window.fb.auth.currentUser ? window.fb.auth.currentUser.email : 'null'));
      showError('Sin sesión. Hacé login primero.');
      return false;
    }
    debugLog('✓ Usuario: ' + user.email + ' (uid: ' + user.uid + ')');

    debugLog('3. Cargando perfil desde Firestore...');
    setText('Cargando perfil...');

    try {
      await auth.loadProfile();
      debugLog('✓ Perfil cargado: ' + auth._profile?.email + ' · rol: ' + auth._profile?.role);
    } catch (err) {
      debugLog('❌ Error cargando perfil: ' + err.message);
      showError('No se pudo cargar perfil: ' + err.message);
      return false;
    }

    debugLog('4. Verificando acceso al módulo "' + moduleName + '"...');
    if (!auth.canAccess(moduleName)) {
      debugLog('❌ Sin acceso al módulo');
      showError('No tenés permiso para este módulo');
      return false;
    }
    debugLog('✓ Acceso permitido');

    debugLog('5. Cargando datos desde Firestore...');
    setText('Cargando datos...');
    try {
      await db.init();
      await db.seedDefaults();
      debugLog('✓ DB inicializada · ' + Object.keys(db.COLLECTIONS).length + ' colecciones');
    } catch (err) {
      debugLog('❌ Error en db.init: ' + err.message);
      showError('Error cargando datos: ' + err.message);
      return false;
    }

    debugLog('=== TODO OK · módulo listo ===');
    loading.remove();
    return true;
  } catch (err) {
    debugLog('❌ ERROR FATAL: ' + err.message);
    debugLog('   stack: ' + (err.stack || 'sin stack'));
    showError(err.message);
    return false;
  }
};
