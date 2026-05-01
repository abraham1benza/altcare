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
      { id: 'envasado',          label: 'Envasado',          href: 'modules/envasado.html' },
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
      { id: 'usuarios',          label: 'Usuarios',          href: 'modules/usuarios.html' },
      { id: 'configuracion',     label: 'Configuración',     href: 'modules/configuracion.html' }
    ]
  }
];

const ui = {

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
            <div class="brand-mark"><span>alt</span>care</div>
            <div class="brand-sub">Manufacturing OS</div>
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
