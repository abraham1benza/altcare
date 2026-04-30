<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Métodos de Pago · altcare</title>
<link rel="stylesheet" href="../assets/css/styles.css">
</head>
<body>
<script type="module" src="../assets/js/firebase-init.js"></script>
<script src="../assets/js/module-init-v2.js"></script>
<script src="../assets/js/db.js"></script>
<script src="../assets/js/auth.js"></script>
<script src="../assets/js/currency.js"></script>
<script src="../assets/js/tax.js"></script>
<script src="../assets/js/inventory.js"></script>
<script src="../assets/js/formulas.js"></script>
<script src="../assets/js/purchases.js"></script>
<script src="../assets/js/sales.js"></script>
<script src="../assets/js/payments.js"></script>
<script src="../assets/js/ui.js"></script>
<script>
moduleInit('metodos-pago').then(async (ok) => {
if (!ok) return;

function render() {
  const items = db.getAll(db.COLLECTIONS.paymentMethods);

  const tableHtml = items.length ? `<table>
    <thead><tr><th>Nombre</th><th style="text-align:center;">Requiere cuenta bancaria</th><th style="text-align:center;">Requiere referencia</th><th>Estado</th><th style="text-align:right;width:110px;">Acciones</th></tr></thead>
    <tbody>${items.map(m => `<tr>
      <td><div class="td-strong">${ui.escape(m.name)}</div></td>
      <td style="text-align:center;">${m.requiresBank ? '<span class="badge badge-accent">Sí</span>' : '<span class="text-muted">No</span>'}</td>
      <td style="text-align:center;">${m.requiresReference ? '<span class="badge badge-plain">Sí</span>' : '<span class="text-muted">No</span>'}</td>
      <td>${m.active !== false ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>'}</td>
      <td class="td-actions">
        <button class="btn-icon" onclick="editItem('${m.id}')">${ui.icon('edit')}</button>
        <button class="btn-icon" onclick="deleteItem('${m.id}')">${ui.icon('trash')}</button>
      </td>
    </tr>`).join('')}</tbody></table>` : `<div class="empty-state"><div class="empty-state-title">Sin métodos de pago</div></div>`;

  ui.renderLayout({
    activeModule: 'metodos-pago', pageEyebrow: 'Sistema', pageTitle: 'Métodos de Pago',
    contentHtml: `
      <div class="action-bar">
        <div class="action-bar-left">
          <h2 class="action-bar-title">Métodos de pago</h2>
          <span class="action-bar-count">${items.length} configurados</span>
        </div>
        <div class="action-bar-right">
          <button class="btn btn-primary" onclick="newItem()">${ui.icon('plus')} Nuevo método</button>
        </div>
      </div>
      <p class="text-muted mb-24" style="max-width:680px;">
        Configura los métodos de pago que usás. Marcá si requiere asociar a una cuenta bancaria (transferencias, Zelle) o si requiere número de referencia.
      </p>
      <div class="table-wrap">${tableHtml}</div>
    `
  });
}

function newItem() {
  openForm({ requiresBank: false, requiresReference: false, active: true });
}

function editItem(id) {
  const m = db.getById(db.COLLECTIONS.paymentMethods, id);
  if (m) openForm(m);
}

function openForm(item) {
  const isNew = !item.id;
  ui.openModal({
    title: isNew ? 'Nuevo método de pago' : 'Editar método',
    body: `
      <form id="pm-form" onsubmit="saveItem(event, '${item.id || ''}')">
        <div class="form-grid form-grid-2">
          <div class="field" style="grid-column:1/-1;"><label class="field-label">Nombre *</label><input class="input" name="name" required value="${ui.escape(item.name||'')}" placeholder="Ej: Wise, PayPal, Billetera Crypto..."></div>
          <div class="field" style="grid-column:1/-1;">
            <div class="checkbox-row"><input type="checkbox" id="req-bank" name="requiresBank" ${item.requiresBank?'checked':''}><label for="req-bank" style="font-size:13px;">Requiere asociar cuenta bancaria al usar</label></div>
            <div class="field-hint">Activá si los pagos con este método siempre salen/entran de una cuenta específica (ej: Transferencia, Zelle)</div>
          </div>
          <div class="field" style="grid-column:1/-1;">
            <div class="checkbox-row"><input type="checkbox" id="req-ref" name="requiresReference" ${item.requiresReference?'checked':''}><label for="req-ref" style="font-size:13px;">Requiere número de referencia</label></div>
            <div class="field-hint">Activá para forzar registro de N° de operación, comprobante, hash de cripto, etc.</div>
          </div>
          ${!isNew ? `<div class="field" style="grid-column:1/-1;">
            <div class="checkbox-row"><input type="checkbox" id="active-cb" name="active" ${item.active!==false?'checked':''}><label for="active-cb" style="font-size:13px;">Método activo</label></div>
          </div>` : ''}
        </div>
      </form>
    `,
    footer: `<button class="btn btn-secondary" onclick="ui.closeModal()">Cancelar</button><button class="btn btn-primary" onclick="document.getElementById('pm-form').requestSubmit()">${ui.icon('check')} Guardar</button>`
  });
}

function saveItem(e, id) {
  e.preventDefault();
  const data = ui.formData(e.target);
  if (!data.name) { ui.toast('El nombre es obligatorio', 'error'); return; }
  if (id) data.id = id;
  if (data.active === undefined) data.active = true;
  db.save(db.COLLECTIONS.paymentMethods, data);
  ui.closeModal();
  ui.toast(id ? 'Método actualizado' : 'Método creado', 'success');
  render();
}

function deleteItem(id) {
  const m = db.getById(db.COLLECTIONS.paymentMethods, id);
  // Verificar si está en uso
  const inUse = db.query(db.COLLECTIONS.payments, p => p.paymentMethodId === id).length;
  if (inUse > 0) { ui.toast(`Este método está en uso en ${inUse} pago(s). Desactívalo en lugar de eliminarlo.`, 'error', 4000); return; }
  ui.confirm(`¿Eliminar "${m.name}"?`, () => {
    db.remove(db.COLLECTIONS.paymentMethods, id);
    ui.toast('Método eliminado', 'success');
    render();
  }, { danger: true, confirmLabel: 'Eliminar' });
}

render();


// Exponer funciones a window (para que onclick="" del HTML pueda llamarlas)
Object.assign(window, {
  render: typeof render !== 'undefined' ? render : undefined,
  newItem: typeof newItem !== 'undefined' ? newItem : undefined,
  editItem: typeof editItem !== 'undefined' ? editItem : undefined,
  openForm: typeof openForm !== 'undefined' ? openForm : undefined,
  saveItem: typeof saveItem !== 'undefined' ? saveItem : undefined,
  deleteItem: typeof deleteItem !== 'undefined' ? deleteItem : undefined,
});
});
</script>
</body>
</html>
