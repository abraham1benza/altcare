/* ============================================
   module-init.js — Boot de módulos
   Espera Firebase + Auth + DB lista antes de seguir.
   ============================================ */

window.moduleInit = async function(moduleName) {
  // Mostrar pantalla de carga si no existe
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

  try {
    // 1. ESPERAR A QUE FIREBASE ESTÉ DISPONIBLE
    // firebase-init.js es un <script type="module"> que carga async/defer.
    // Esperamos hasta 10 segundos comprobando cada 50ms si window.fb existe.
    setText('Cargando Firebase...');
    let waited = 0;
    while (!window.fb && waited < 10000) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }
    if (!window.fb) throw new Error('Firebase no se pudo cargar (timeout)');

    // 2. ESPERAR A QUE AUTH DETERMINE ESTADO
    // onAuthStateChanged dispara con el estado inicial (puede ser null al principio
    // y luego con el user). Esperamos a que tenga UN estado definitivo.
    setText('Verificando sesión...');
    const profile = await new Promise((resolve) => {
      let resolved = false;
      const unsub = window.fb.onAuthStateChanged(window.fb.auth, async (user) => {
        if (resolved) return;
        if (!user) {
          // Esperar un poquito más por si la sesión está cargándose
          // Firebase Auth a veces dispara primero null y después el usuario
          await new Promise(r => setTimeout(r, 300));
          // Verificar de nuevo
          const currentUser = window.fb.auth.currentUser;
          if (!currentUser) {
            resolved = true;
            unsub();
            return resolve(null);
          }
          // Hay usuario, cargar perfil
          try {
            await auth.loadProfile();
            resolved = true;
            unsub();
            resolve(auth._profile);
          } catch (err) {
            console.error('[moduleInit] Error cargando perfil:', err.message);
            resolved = true;
            unsub();
            resolve(null);
          }
        } else {
          // Hay usuario inmediatamente
          try {
            await auth.loadProfile();
            resolved = true;
            unsub();
            resolve(auth._profile);
          } catch (err) {
            console.error('[moduleInit] Error cargando perfil:', err.message);
            resolved = true;
            unsub();
            resolve(null);
          }
        }
      });
      // Timeout de seguridad: 8 segundos
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          unsub();
          resolve(null);
        }
      }, 8000);
    });

    if (!profile) {
      console.warn('[moduleInit] No hay sesión activa, redirigiendo al login');
      window.location.href = '../index.html';
      return false;
    }

    // 3. VERIFICAR ACCESO AL MÓDULO
    if (!auth.canAccess(moduleName)) {
      alert('No tenés permiso para acceder a este módulo.');
      window.location.href = '../index.html';
      return false;
    }

    // 4. CARGAR DATOS DESDE FIRESTORE
    setText('Cargando datos...');
    await db.init();
    await db.seedDefaults();

    // 5. OCULTAR LOADING
    loading.remove();
    return true;
  } catch (err) {
    console.error('[moduleInit] Error:', err);
    setText('Error: ' + err.message);
    loading.style.color = '#a83232';
    setTimeout(() => {
      window.location.href = '../index.html';
    }, 2500);
    return false;
  }
};
