/* ============================================
   utils.js — Utilidades compartidas

   POR QUÉ EXISTE ESTE ARCHIVO

   `round()` estaba definido tres veces, con dos firmas distintas:

     formulas.js  →  round(n, dec = 2)
     sales.js     →  round(n)            // siempre 2 decimales
     tax.js       →  round(n)            // siempre 2 decimales

   Los tres son declaraciones globales cargadas en la MISMA página, así que
   no convivían: la última en cargarse pisaba a las anteriores. En ventas.html
   el orden es ... formulas.js → sales.js ..., de modo que las 7 llamadas
   `round(x, 4)` del escalado de fórmulas terminaban ejecutando la versión de
   sales.js, que ignora el segundo argumento y devuelve 2 decimales.

   Además otros 7 archivos (commissions, payments, purchases, reports,
   reconciliation, currency) LLAMAN a round() sin definirlo: dependían por
   completo de cuál hubiera ganado la carrera de carga.

   Una sola definición con `dec = 2` por defecto es compatible con todos los
   llamadores existentes: round(n) sigue dando 2 decimales y round(n, 4) ahora
   sí da 4.

   Este archivo debe cargarse ANTES que cualquier otro que use estas funciones.
   ============================================ */

/**
 * Redondea a `dec` decimales.
 * @param {number|string} n
 * @param {number} dec - decimales (2 por defecto, para montos de dinero)
 */
function round(n, dec = 2) {
  const f = Math.pow(10, dec);
  return Math.round((parseFloat(n) || 0) * f) / f;
}

/**
 * Escapa HTML para interpolar texto de la base de datos sin romper el marcado.
 *
 * El sistema arma sus tablas con innerHTML y plantillas. Un nombre de cliente
 * o proveedor con `<`, `>` o comillas rompe el marcado; con una etiqueta
 * completa, ejecuta. Los usuarios son internos, así que el riesgo es acotado,
 * pero no cuesta nada escapar.
 */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/** Escapa un valor para meterlo dentro de un atributo HTML entre comillas */
function escapeAttr(s) {
  return escapeHtml(s);
}

// Disponibles también como propiedades explícitas del global, para código que
// prefiera no depender del hoisting de declaraciones de función.
window.round = round;
window.escapeHtml = escapeHtml;
window.escapeAttr = escapeAttr;
