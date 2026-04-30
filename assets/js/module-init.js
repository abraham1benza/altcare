/* ============================================
   module-init.js — Boot de módulos
   Cada módulo HTML usa:
     await moduleInit('nombre-del-modulo');
   Esto:
   1. Espera a que Firebase esté inicializado
   2. Verifica que haya sesión activa
   3. Carga el perfil del usuario
   4. Verifica que tenga acceso al módulo
   5. Inicializa db (carga colecciones desde Firestore)
   6. Asegura datos por defecto
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
    // 1. Esperar a Firebase
    if (!window.fb) {
      setText('Cargando Firebase...');
      await new Promise(resolve => {
        if (window.fb) return resolve();
        window.addEventListener('firebase-ready', resolve, { once: true });
        setTimeout(resolve, 5000);
      });
    }
    if (!window.fb) throw new Error('Firebase no se pudo cargar');

    // 2. Verificar sesión
    setText('Verificando sesión...');
    const profile = await auth.waitReady();
    if (!profile) {
      window.location.href = '../index.html';
      return false;
    }

    // 3. Verificar acceso al módulo
    if (!auth.canAccess(moduleName)) {
      alert('No tenés permiso para acceder a este módulo.');
      window.location.href = '../index.html';
      return false;
    }

    // 4. Cargar datos
    setText('Cargando datos...');
    await db.init();
    await db.seedDefaults();

    // 5. Ocultar loading
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
