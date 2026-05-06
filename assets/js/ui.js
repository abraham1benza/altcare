/* ============================================
   ui.js — Componentes UI reutilizables
   Sidebar, topbar, modales, toasts, tablas, etc.
   ============================================ */

const NAV_STRUCTURE = [
  {
    title: 'Operaciones',
    items: [
      { id: 'dashboard',         label: 'Dashboard',         href: 'index.html' },
      { id: 'tasas-cambio',      label: 'Tasas de Cambio',   href: 'modules/tasas-cambio.html' },
    ]
  },
  {
    title: 'Inventario',
    items: [
      { id: 'materias-primas',   label: 'Materias Primas',   href: 'modules/materias-primas.html' },
      { id: 'producto-terminado',label: 'Producto Terminado',href: 'modules/producto-terminado.html' },
      { id: 'almacen',           label: 'Almacén',           href: 'modules/almacen.html' }
    ]
  },
  {
    title: 'Producción',
    items: [
      { id: 'formulas',          label: 'Fórmulas',          href: 'modules/formulas.html' },
      { id: 'produccion',        label: 'Órdenes de Fabricación', href: 'modules/produccion.html' },
      { id: 'calidad',           label: 'Control de Calidad',href: 'modules/calidad.html' },
      { id: 'trazabilidad',      label: 'Trazabilidad',      href: 'modules/trazabilidad.html' }
    ]
  },
  {
    title: 'Comercial',
    items: [
      { id: 'proveedores',       label: 'Proveedores',       href: 'modules/proveedores.html' },
      { id: 'clientes',          label: 'Clientes',          href: 'modules/clientes.html' },
      { id: 'compras',           label: 'Compras',           href: 'modules/compras.html' },
      { id: 'ventas',            label: 'Ventas',            href: 'modules/ventas.html' },
      { id: 'pagos',             label: 'Pagos',             href: 'modules/pagos.html' },
      { id: 'comisiones',        label: 'Comisiones',        href: 'modules/comisiones.html' },
      { id: 'transportistas',    label: 'Transportistas',    href: 'modules/transportistas.html' },
      { id: 'notificaciones',    label: 'Notificaciones',    href: 'modules/notificaciones.html' }
    ]
  },
  {
    title: 'Sistema',
    items: [
      { id: 'reportes',          label: 'Reportes',          href: 'modules/reportes.html' },
      { id: 'almacenes',         label: 'Almacenes',         href: 'modules/almacenes.html' },
      { id: 'cuentas-bancarias', label: 'Cuentas bancarias', href: 'modules/cuentas-bancarias.html' },
      { id: 'metodos-pago',      label: 'Métodos de pago',   href: 'modules/metodos-pago.html' },
      { id: 'importar',          label: 'Importar',          href: 'modules/importar.html' },
      { id: 'usuarios',          label: 'Usuarios',          href: 'modules/usuarios.html' },
      { id: 'configuracion',     label: 'Configuración',     href: 'modules/configuracion.html' }
    ]
  }
];

/**
 * Paleta de 10 colores distintos para badges de vendedor.
 * Se asigna determinísticamente por hash del userId — el mismo vendedor
 * siempre obtiene el mismo color en cualquier sesión y módulo.
 * Cada entrada tiene { bg, fg, dot } para fondo, texto y punto.
 */
const VENDOR_BADGE_PALETTE = [
  { bg: '#dbeafe', fg: '#1e3a8a', dot: '#2563eb' }, // azul
  { bg: '#dcfce7', fg: '#14532d', dot: '#16a34a' }, // verde
  { bg: '#fce7f3', fg: '#831843', dot: '#db2777' }, // rosa
  { bg: '#fef3c7', fg: '#78350f', dot: '#d4a017' }, // dorado
  { bg: '#ede9fe', fg: '#4c1d95', dot: '#7c3aed' }, // violeta
  { bg: '#cffafe', fg: '#164e63', dot: '#0891b2' }, // cyan
  { bg: '#ffedd5', fg: '#7c2d12', dot: '#ea580c' }, // naranja
  { bg: '#e0e7ff', fg: '#3730a3', dot: '#4f46e5' }, // indigo
  { bg: '#f3e8ff', fg: '#581c87', dot: '#9333ea' }, // púrpura
  { bg: '#fae8ff', fg: '#6b21a8', dot: '#a855f7' }, // magenta
];

/** Hash determinístico de string a entero (djb2 simplificado) */
function _hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h & 0xFFFFFFFF;
  }
  return Math.abs(h);
}

const ui = {

  /**
   * Devuelve el color asignado a un vendedor por su userId.
   * Determinístico: el mismo userId siempre obtiene el mismo color.
   * @param {string} userId
   * @returns {{bg, fg, dot}}
   */
  getVendorColor(userId) {
    if (!userId) return { bg: 'var(--surface-2)', fg: 'var(--ink-3)', dot: 'var(--ink-3)' };
    const idx = _hashString(String(userId)) % VENDOR_BADGE_PALETTE.length;
    return VENDOR_BADGE_PALETTE[idx];
  },

  /**
   * Renderiza un badge de vendedor con color consistente.
   * @param {string} userId - ID del usuario vendedor
   * @param {string} name - Nombre a mostrar
   * @param {object} opts - { size: 'sm'|'md', noDot: bool }
   */
  vendorBadge(userId, name, opts = {}) {
    const c = this.getVendorColor(userId);
    const size = opts.size === 'sm' ? '10px' : '11px';
    const padding = opts.size === 'sm' ? '2px 8px' : '3px 10px';
    const dotHtml = opts.noDot
      ? ''
      : `<span style="width:6px;height:6px;border-radius:50%;background:${c.dot};display:inline-block;flex-shrink:0;"></span>`;
    return `<span class="badge" style="background:${c.bg};color:${c.fg};border-color:${c.dot}33;font-size:${size};padding:${padding};display:inline-flex;align-items:center;gap:5px;">
      ${dotHtml}<span>${this.escape(name||'—')}</span>
    </span>`;
  },

  /**
   * Renderiza un header de tabla clickeable que ordena por una columna.
   * @param {string} label - Texto del header
   * @param {string} key - Clave para identificar este header en el state
   * @param {object} sortState - { key, dir } (estado actual)
   * @param {function} onClick - función que recibe (key) y debe togglear y re-renderizar
   * @param {object} opts - { align: 'left'|'right'|'center' }
   */
  sortableTh(label, key, sortState, onClick, opts = {}) {
    const isActive = sortState && sortState.key === key;
    const dir = isActive ? sortState.dir : null;
    const align = opts.align || 'left';
    const arrow = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕';
    const arrowColor = isActive ? 'var(--gold-deep)' : 'var(--ink-4)';
    const arrowOpacity = isActive ? '1' : '0.4';
    return `<th style="cursor:pointer;user-select:none;text-align:${align};white-space:nowrap;" onclick="${onClick}('${key}')" title="Ordenar por ${label}">
      <span style="display:inline-flex;align-items:center;gap:6px;${isActive?'color:var(--gold-deep);':''}">
        ${this.escape(label)}
        <span style="font-size:10px;color:${arrowColor};opacity:${arrowOpacity};font-weight:700;">${arrow}</span>
      </span>
    </th>`;
  },

  /**
   * Aplica ordenamiento a un array según el state {key, dir} y un getter.
   * El getter recibe el item y devuelve el valor de comparación para esa key.
   *
   * @example
   *   ui.applySort(items, sortState, (item, key) => {
   *     if (key === 'name') return item.name;
   *     if (key === 'date') return item.createdAt;
   *   })
   */
  applySort(items, sortState, getter) {
    if (!sortState || !sortState.key) return items;
    const sorted = [...items];
    const dir = sortState.dir === 'desc' ? -1 : 1;
    sorted.sort((a, b) => {
      const va = getter(a, sortState.key);
      const vb = getter(b, sortState.key);
      // Strings vs números
      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      const sa = String(va == null ? '' : va).toLowerCase();
      const sb = String(vb == null ? '' : vb).toLowerCase();
      if (sa < sb) return -1 * dir;
      if (sa > sb) return 1 * dir;
      return 0;
    });
    return sorted;
  },

  /** Toggle helper para sortState: si es la misma key, alterna asc↔desc; si es nueva, empieza en asc */
  toggleSort(currentSort, key) {
    if (currentSort && currentSort.key === key) {
      return { key, dir: currentSort.dir === 'asc' ? 'desc' : 'asc' };
    }
    return { key, dir: 'asc' };
  },

  /**
   * Renderiza el layout completo (sidebar + topbar + contenedor).
   * @param {object} opts - { activeModule, pageTitle, pageEyebrow, contentHtml }
   */
  renderLayout({ activeModule, pageTitle, pageEyebrow, contentHtml }) {
    const user = auth.currentUser();
    if (!user) return;
    const isModulePage = window.location.pathname.includes('/modules/');
    const base = isModulePage ? '../' : './';

    // Filtrar nav según permisos
    const navHtml = NAV_STRUCTURE.map(group => {
      const items = group.items
        .filter(it => auth.hasAccess(it.id))
        .map(it => {
          const href = it.href === 'index.html' ? base + 'index.html' : base + it.href;
          const active = it.id === activeModule ? 'active' : '';
          return `<a class="nav-item ${active}" href="${href}">
            <span class="nav-dot"></span>${it.label}
          </a>`;
        }).join('');
      if (!items) return '';
      return `<div class="nav-group">
        <div class="nav-group-title">${group.title}</div>
        ${items}
      </div>`;
    }).join('');

    const nameForInitials = user.fullName || user.username || user.email || 'Usuario';
    const initials = String(nameForInitials).split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase() || 'U';
    const roleLabel = auth.ROLES[user.role]?.label || user.role;

    const activeRate = currency.getActiveRate();
    const fxPill = activeRate && activeRate.value > 0
      ? `<div class="fx-pill" title="Tasa activa: ${activeRate.label}">
           <span class="dot"></span>
           <span class="label">${activeRate.label}</span>
           <span class="value">${activeRate.value.toFixed(2)}</span>
         </div>`
      : `<a href="${base}modules/tasas-cambio.html" class="fx-pill" style="cursor:pointer;" title="Configura una tasa">
           <span class="dot" style="background:var(--warning);"></span>
           <span class="label">Sin tasa activa</span>
         </a>`;

    // Selector de modo (Gerencial / Contable)
    const allowedModes = auth.getAllowedModes();
    const activeMode = auth.getActiveMode();
    const canSwitch = auth.canSwitchModes();
    let modeSelectorHtml = '';
    if (canSwitch) {
      // Mostrar las dos opciones para elegir
      modeSelectorHtml = `
        <div class="mode-selector">
          ${allowedModes.map(m => {
            const def = auth.MODES[m];
            const active = m === activeMode ? 'active' : '';
            return `<button class="mode-option ${active}" onclick="window._switchMode('${m}')" title="${def.sub}">
              <span class="mode-icon">${def.icon}</span>
              <span class="mode-label">${def.label}</span>
            </button>`;
          }).join('')}
        </div>
      `;
    } else {
      // Solo tiene un modo, mostrar como info
      const def = auth.MODES[activeMode];
      modeSelectorHtml = `
        <div class="mode-selector single">
          <div class="mode-option active" title="${def.sub}">
            <span class="mode-icon">${def.icon}</span>
            <span class="mode-label">Modo ${def.label}</span>
          </div>
        </div>
      `;
    }

    document.body.innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-logo">
              <img src="data:image/png;base64,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" alt="Alternative Care" />
            </div>
            <div class="brand-text">
              <div class="brand-mark">ALT<span>care</span></div>
              <div class="brand-sub">Manufacturing OS</div>
            </div>
          </div>
          ${modeSelectorHtml}
          <nav>${navHtml}</nav>
          <div class="sidebar-footer">
            <div class="user-chip">
              <div class="avatar">${initials}</div>
              <div>
                <div class="user-name">${user.fullName || user.username}</div>
                <div class="user-role">${roleLabel}</div>
              </div>
            </div>
            <button class="logout-btn" onclick="auth.logout()">Cerrar sesión</button>
          </div>
        </aside>
        <main class="main">
          <header class="topbar">
            <div class="page-title-wrap">
              ${pageEyebrow ? `<span class="page-eyebrow">${pageEyebrow}</span>` : ''}
              <h1 class="page-title">${pageTitle}</h1>
            </div>
            <div class="topbar-actions">
              ${fxPill}
            </div>
          </header>
          <div class="content" id="page-content">
            ${contentHtml || ''}
          </div>
        </main>
      </div>
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="toast-stack" id="toast-stack"></div>
      <div id="page-loading-overlay" style="display:none;position:fixed;inset:0;background:#0a0a08;flex-direction:column;align-items:center;justify-content:center;z-index:99999;">
        <img src="data:image/png;base64,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" alt="Alternative Care" style="width:200px;height:auto;animation:fadeInUp 0.4s ease;" />
        <div style="margin-top:32px;width:28px;height:28px;border:2px solid rgba(212,160,23,0.18);border-top-color:#e4b520;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      </div>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      </style>
    `;

    // Después de renderizar, interceptar clicks en nav-item para mostrar el loading
    setTimeout(() => {
      document.querySelectorAll('.sidebar a.nav-item').forEach(a => {
        a.addEventListener('click', (e) => {
          // Solo si es navegación a otra página (no la actual)
          const href = a.getAttribute('href');
          if (!href || href === '#' || href === window.location.href) return;
          e.preventDefault();
          this.showPageLoading();
          // Pequeño delay para que se vea la pantalla
          setTimeout(() => { window.location.href = href; }, 250);
        });
      });
    }, 0);
  },

  /** Muestra la pantalla de carga (logo + spinner) */
  showPageLoading() {
    const el = document.getElementById('page-loading-overlay');
    if (el) el.style.display = 'flex';
  },

  /** Oculta la pantalla de carga */
  hidePageLoading() {
    const el = document.getElementById('page-loading-overlay');
    if (el) el.style.display = 'none';
  },

  // ============== TOAST ==============

  toast(message, type = 'default', duration = 3000) {
    const stack = document.getElementById('toast-stack') || (() => {
      const s = document.createElement('div');
      s.id = 'toast-stack';
      s.className = 'toast-stack';
      document.body.appendChild(s);
      return s;
    })();
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = message;
    stack.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(20px)';
      t.style.transition = 'all 0.2s ease';
      setTimeout(() => t.remove(), 200);
    }, duration);
  },

  // ============== MODAL ==============

  openModal({ title, subtitle, body, footer, size = '' }) {
    const backdrop = document.getElementById('modal-backdrop');
    if (!backdrop) return;
    backdrop.innerHTML = `
      <div class="modal ${size === 'lg' ? 'modal-lg' : ''}">
        <div class="modal-header">
          <div>
            <div class="modal-title">${title || ''}</div>
            ${subtitle ? `<div class="modal-subtitle">${subtitle}</div>` : ''}
          </div>
          <button class="modal-close" onclick="ui.closeModal()" aria-label="Cerrar">
            ${ui.icon('x')}
          </button>
        </div>
        <div class="modal-body">${body || ''}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    `;
    backdrop.classList.add('open');
    backdrop.onclick = (e) => { if (e.target === backdrop) ui.closeModal(); };
  },

  closeModal() {
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.innerHTML = '';
    }
  },

  /** Confirmación rápida */
  confirm(message, onConfirm, opts = {}) {
    this.openModal({
      title: opts.title || 'Confirmar',
      body: `<p style="color:var(--ink-2);font-size:14px;line-height:1.6;">${message}</p>`,
      footer: `
        <button class="btn btn-secondary" onclick="ui.closeModal()">Cancelar</button>
        <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" id="btn-confirm-action">
          ${opts.confirmLabel || 'Confirmar'}
        </button>
      `
    });
    document.getElementById('btn-confirm-action').onclick = () => {
      ui.closeModal();
      onConfirm && onConfirm();
    };
  },

  // ============== TABLE BUILDER ==============

  /**
   * Construye HTML de una tabla.
   * @param {array} columns - [{key, label, render?, align?}]
   * @param {array} rows
   * @param {object} opts - { onEdit, onDelete, emptyTitle, emptyText }
   */
  table(columns, rows, opts = {}) {
    if (!rows.length) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon">${ui.icon('inbox')}</div>
          <div class="empty-state-title">${opts.emptyTitle || 'Sin registros'}</div>
          <div class="empty-state-text">${opts.emptyText || 'Aún no hay datos. Crea el primero usando el botón superior.'}</div>
        </div>`;
    }
    const head = columns.map(c => `<th style="${c.align ? 'text-align:'+c.align : ''}">${c.label}</th>`).join('') +
      (opts.actions !== false ? '<th style="text-align:right;width:120px;">Acciones</th>' : '');
    const body = rows.map(r => {
      const cells = columns.map(c => {
        const val = c.render ? c.render(r) : (r[c.key] ?? '');
        return `<td style="${c.align ? 'text-align:'+c.align : ''}">${val ?? ''}</td>`;
      }).join('');
      const actions = opts.actions !== false ? `
        <td class="td-actions">
          ${opts.onEdit ? `<button class="btn-icon" onclick="(${opts.onEdit.toString()})('${r.id}')" title="Editar">${ui.icon('edit')}</button>` : ''}
          ${opts.onDelete ? `<button class="btn-icon" onclick="(${opts.onDelete.toString()})('${r.id}')" title="Eliminar">${ui.icon('trash')}</button>` : ''}
        </td>` : '';
      return `<tr>${cells}${actions}</tr>`;
    }).join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  },

  // ============== ICONS (inline SVG, lightweight) ==============

  icon(name) {
    const ico = {
      plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      inbox: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
      currency: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      box: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
      flask: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 2h6v6l5 9a2 2 0 0 1-2 3H6a2 2 0 0 1-2-3l5-9V2z"/><line x1="9" y1="2" x2="15" y2="2"/></svg>',
      users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
      activity: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      upload: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
      refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
      settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
    };
    return ico[name] || '';
  },

  // ============== HELPERS ==============

  formatDate(iso) {
    if (!iso) return '—';
    // BUG FIX TIMEZONE: si recibimos un string "YYYY-MM-DD" (sin tiempo),
    // new Date(iso) lo interpreta como UTC medianoche, y al convertir a hora
    // local en zonas negativas (ej. Venezuela UTC-4) muestra el día anterior.
    // Solución: parsear los componentes manualmente como fecha local.
    if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, day] = iso.split('-').map(n => parseInt(n, 10));
      const d = new Date(y, m - 1, day);
      return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    const d = new Date(iso);
    return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatDateTime(iso) {
    if (!iso) return '—';
    // Para datetime ISO completo (con T y zona), respetamos la conversión normal.
    // Solo aplicamos el fix si es solo fecha sin hora.
    if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, day] = iso.split('-').map(n => parseInt(n, 10));
      const d = new Date(y, m - 1, day);
      return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    const d = new Date(iso);
    return d.toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  /** Lee valores de un form serializándolo a objeto */
  formData(formEl) {
    const data = {};
    formEl.querySelectorAll('[name]').forEach(el => {
      if (el.type === 'checkbox') data[el.name] = el.checked;
      else if (el.type === 'number') data[el.name] = el.value === '' ? null : parseFloat(el.value);
      else data[el.name] = el.value;
    });
    return data;
  },

  /**
   * Crea una versión "debounced" de una función. Espera `delay` ms desde la
   * última invocación antes de ejecutarla. Útil para inputs de búsqueda donde
   * no querés re-renderizar todo después de cada tecla (rompe el foco).
   *
   * @param {Function} fn - función original
   * @param {number} delay - ms de espera (default 300)
   */
  debounce(fn, delay = 300) {
    let timeoutId = null;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Wrapper que preserva el foco y la posición del cursor a través de un render.
   * Usar así:
   *
   *   ui.preserveFocus(() => render());
   *
   * Captura el input/textarea con foco, su valor, y la posición del caret antes
   * del render. Después del render, busca un elemento equivalente (por id, name,
   * o estructura) y restaura el foco + caret. Esto soluciona el problema clásico
   * de "perder el foco al escribir" cuando el render redibuja todo el HTML.
   */
  preserveFocus(renderFn) {
    const active = document.activeElement;
    let snapshot = null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
      snapshot = {
        id: active.id || null,
        name: active.name || null,
        tagName: active.tagName,
        type: active.type || null,
        value: active.value,
        selectionStart: active.selectionStart,
        selectionEnd: active.selectionEnd
      };
    }
    renderFn();
    if (!snapshot) return;
    // Después del render, intentar reubicar el mismo input
    let target = null;
    if (snapshot.id) target = document.getElementById(snapshot.id);
    if (!target && snapshot.name) {
      target = document.querySelector(`${snapshot.tagName.toLowerCase()}[name="${snapshot.name}"]`);
    }
    if (target) {
      target.focus();
      try {
        if (snapshot.selectionStart != null && target.setSelectionRange) {
          target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        }
      } catch(e) { /* algunos types no soportan setSelectionRange */ }
    }
  },

  /** Llena un form con datos */
  fillForm(formEl, data) {
    Object.entries(data || {}).forEach(([k, v]) => {
      const el = formEl.querySelector(`[name="${k}"]`);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    });
  },

  /** Sanitiza HTML básico para evitar XSS al insertar texto del usuario */
  escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  },
  // ============================================================================
  // ====== TABLA ORDENABLE POR COLUMNA ======
  // ============================================================================
  /**
   * Ordena un array según una clave y dirección. Maneja números, strings,
   * fechas (ISO YYYY-MM-DD), booleanos, null/undefined.
   *
   * Uso típico:
   *   const sorted = ui.sortRows(rows, sortState, {
   *     code: r => r.code,
   *     fecha: r => r.issueDate,
   *     total: r => r.total,
   *   });
   *
   * sortState es un objeto { key, dir }. Si key es null, devuelve el array sin tocar.
   */
  sortRows(rows, sortState, accessors) {
    if (!sortState || !sortState.key || !accessors[sortState.key]) return rows;
    const acc = accessors[sortState.key];
    const dir = sortState.dir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      // null/undefined al final
      const aNull = va == null || va === '';
      const bNull = vb == null || vb === '';
      if (aNull && bNull) return 0;
      if (aNull) return 1;  // siempre al final, sin importar dir
      if (bNull) return -1;
      // Números
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      // Booleanos
      if (typeof va === 'boolean' && typeof vb === 'boolean') return ((va === vb) ? 0 : (va ? 1 : -1)) * dir;
      // Strings (incluye fechas YYYY-MM-DD que se ordenan correctamente como string)
      return String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' }) * dir;
    });
  },

  /**
   * Renderiza el contenido de un <th> ordenable. Llamar dentro del HTML del thead.
   * Devuelve un span con label + flecha de orden si está activo.
   *
   * Ejemplo:
   *   <th onclick="onSort('cliente')" style="cursor:pointer;user-select:none;">
   *     ${ui.sortHeader('Cliente', 'cliente', sortState)}
   *   </th>
   */
  sortHeader(label, key, sortState) {
    const isActive = sortState && sortState.key === key;
    const arrow = !isActive ? '<span style="opacity:0.25;font-size:9px;margin-left:3px;">▲▼</span>'
                : sortState.dir === 'desc' ? '<span style="font-size:10px;margin-left:3px;color:var(--accent-ink);">▼</span>'
                : '<span style="font-size:10px;margin-left:3px;color:var(--accent-ink);">▲</span>';
    return `${label}${arrow}`;
  },

  /**
   * Helper que actualiza el sortState alternando ASC → DESC → null al hacer click
   * sobre la misma columna. Si se cambia de columna, arranca en ASC.
   * Devuelve el nuevo state.
   */
  toggleSort(sortState, key) {
    if (!sortState || sortState.key !== key) return { key, dir: 'asc' };
    if (sortState.dir === 'asc') return { key, dir: 'desc' };
    return { key: null, dir: null };
  },

};

// ============== HANDLER GLOBAL DE CAMBIO DE MODO ==============

window._switchMode = function(mode) {
  if (auth.setActiveMode(mode)) {
    // Re-renderizar la página actual
    if (typeof render === 'function') {
      render();
    } else if (typeof renderDashboard === 'function') {
      renderDashboard();
    } else {
      // Como fallback, recargar la página
      window.location.reload();
    }
    ui.toast(`Modo ${auth.MODES[mode].label} activado`, 'success', 2000);
  }
};

// Listener de cambios de modo (para módulos que quieran reaccionar)
window.addEventListener('mode-changed', () => {
  // Re-render automático si hay función render disponible
  if (typeof render === 'function') {
    setTimeout(render, 50);
  }
});
