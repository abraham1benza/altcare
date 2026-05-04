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
    `;
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
    const d = new Date(iso);
    return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatDateTime(iso) {
    if (!iso) return '—';
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
  }
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
