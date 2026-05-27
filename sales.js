/* ============================================
   notifications.js — Sistema de notificaciones por WhatsApp
   - Plantillas con variables ({{nombre}}, {{monto}}, etc.)
   - Genera links wa.me para envío manual
   - Histórico de envíos
   ============================================ */

const notifications = {

  /** Categorías de plantillas */
  CATEGORIES: {
    PROVEEDOR: { label: 'Para proveedores', color: 'badge-warning', icon: '🏭' },
    CLIENTE:   { label: 'Para clientes',    color: 'badge-success', icon: '👥' },
    INTERNO:   { label: 'Interno',          color: 'badge-plain',   icon: '📋' }
  },

  /** Variables disponibles en plantillas */
  VARIABLES: [
    { key: 'nombre',         desc: 'Nombre del contacto' },
    { key: 'empresa',        desc: 'Nombre de tu empresa' },
    { key: 'numero',         desc: 'Número de documento (factura/OC/pedido)' },
    { key: 'monto',          desc: 'Monto formateado con moneda' },
    { key: 'moneda',         desc: 'Solo el código de moneda (USD, Bs, EUR)' },
    { key: 'vencimiento',    desc: 'Fecha de vencimiento (DD/MM/YYYY)' },
    { key: 'fecha_emision',  desc: 'Fecha de emisión' },
    { key: 'material',       desc: 'Nombre del material/producto' },
    { key: 'stock',          desc: 'Stock actual' },
    { key: 'unidad',         desc: 'Unidad de medida' },
    { key: 'dias_vencimiento', desc: 'Días hasta vencimiento (negativo si ya venció)' }
  ],

  /** Plantillas predeterminadas que se siembran al inicio */
  DEFAULT_TEMPLATES: [
    {
      id: 'tpl_RECORDATORIO_PAGO_PROVEEDOR',
      key: 'RECORDATORIO_PAGO_PROVEEDOR',
      name: 'Recordatorio de pago',
      category: 'PROVEEDOR',
      message: 'Hola {{nombre}}, te recordamos que la factura {{numero}} por {{monto}} vence el {{vencimiento}}. Estamos coordinando el pago. Saludos, {{empresa}}.',
      enabled: true
    },
    {
      id: 'tpl_COBRO_PENDIENTE_CLIENTE',
      key: 'COBRO_PENDIENTE_CLIENTE',
      name: 'Cobro pendiente',
      category: 'CLIENTE',
      message: 'Hola {{nombre}}, esperamos te encuentres bien. Te recordamos que la factura {{numero}} por {{monto}} se encuentra pendiente de pago (vencimiento: {{vencimiento}}). Cualquier duda escríbenos. Saludos, {{empresa}}.',
      enabled: true
    },
    {
      id: 'tpl_SOLICITAR_REPOSICION',
      key: 'SOLICITAR_REPOSICION',
      name: 'Solicitar reposición de stock',
      category: 'PROVEEDOR',
      message: 'Hola {{nombre}}, necesitamos reponer {{material}}. Tenemos {{stock}} {{unidad}} en almacén. ¿Tienes disponibilidad y precio actualizado? Saludos, {{empresa}}.',
      enabled: true
    },
    {
      id: 'tpl_CONFIRMAR_PEDIDO',
      key: 'CONFIRMAR_PEDIDO',
      name: 'Confirmación de pedido',
      category: 'CLIENTE',
      message: 'Hola {{nombre}}, confirmamos la recepción de tu pedido {{numero}} por un total de {{monto}}. Te avisaremos cuando esté listo para entrega. Saludos, {{empresa}}.',
      enabled: true
    },
    {
      id: 'tpl_SOLICITAR_COTIZACION',
      key: 'SOLICITAR_COTIZACION',
      name: 'Solicitar cotización',
      category: 'PROVEEDOR',
      message: 'Hola {{nombre}}, ¿podrías enviarnos cotización actualizada de {{material}}? Necesitamos una cantidad estimada y el tiempo de entrega. Saludos, {{empresa}}.',
      enabled: true
    },
    {
      id: 'tpl_AVISO_ENVIO',
      key: 'AVISO_ENVIO',
      name: 'Aviso de envío',
      category: 'CLIENTE',
      message: 'Hola {{nombre}}, te informamos que tu pedido {{numero}} ya fue enviado. Cualquier consulta no dudes en escribirnos. Saludos, {{empresa}}.',
      enabled: true
    }
  ],

  // ====== TELÉFONOS ======

  /**
   * Normaliza un número telefónico al formato wa.me (sin +, sin espacios, sin caracteres especiales).
   * Asume Venezuela (58) si el número empieza con 0 o tiene 10-11 dígitos.
   *
   * Ejemplos:
   *   "0412-1234567"     → "584121234567"
   *   "+58 412 123 4567" → "584121234567"
   *   "(0412)1234567"    → "584121234567"
   *   "584121234567"     → "584121234567"
   *   ""                 → "" (vacío si no es válido)
   */
  formatPhone(raw) {
    if (!raw) return '';
    // Limpiar todo excepto dígitos
    let digits = String(raw).replace(/\D/g, '');
    if (!digits) return '';

    // Si empieza con 0 (formato VE local: 0412...), reemplazar por 58
    if (digits.startsWith('0')) {
      digits = '58' + digits.slice(1);
    }
    // Si tiene 10 dígitos y no empieza por código país, asumir Venezuela
    else if (digits.length === 10) {
      digits = '58' + digits;
    }
    // Si ya empieza con 58, no tocar
    // Si tiene otro código país (ej: 1, 34), no tocar

    // Validar largo razonable
    if (digits.length < 10 || digits.length > 15) return '';

    return digits;
  },

  /** Valida si un número está bien formateado */
  isValidPhone(raw) {
    return !!this.formatPhone(raw);
  },

  /**
   * Devuelve el número de WhatsApp prioritario de un contacto:
   * 1. campo whatsapp si existe y es válido
   * 2. campo phone como fallback
   */
  getContactPhone(contact) {
    if (!contact) return '';
    const wa = this.formatPhone(contact.whatsapp);
    if (wa) return wa;
    const ph = this.formatPhone(contact.phone);
    return ph || '';
  },

  // ====== PLANTILLAS ======

  /** Devuelve todas las plantillas activas */
  getTemplates() {
    return db.getAll(db.COLLECTIONS.notificationTemplates);
  },

  /** Devuelve plantillas filtradas por categoría */
  getTemplatesByCategory(category) {
    return this.getTemplates().filter(t => t.category === category && t.enabled !== false);
  },

  /** Busca una plantilla por su key (constante interna) */
  getTemplateByKey(key) {
    return this.getTemplates().find(t => t.key === key);
  },

  /** Reemplaza variables {{var}} en el texto con los datos provistos */
  applyTemplate(message, data) {
    if (!message) return '';
    let result = String(message);
    // Reemplazar variables
    Object.entries(data || {}).forEach(([key, value]) => {
      const re = new RegExp('\\{\\{\\s*' + key + '\\s*\\}\\}', 'g');
      result = result.replace(re, value != null ? String(value) : '');
    });
    // Limpiar variables que quedaron sin reemplazar
    result = result.replace(/\{\{\s*\w+\s*\}\}/g, '');
    return result;
  },

  /**
   * Genera un mensaje desde una plantilla usando los datos.
   * @param {string} templateKey - key de la plantilla (ej 'COBRO_PENDIENTE_CLIENTE')
   * @param {object} data - variables a reemplazar
   * @returns {string} - mensaje listo para enviar
   */
  renderTemplate(templateKey, data) {
    const tpl = this.getTemplateByKey(templateKey);
    if (!tpl) return '';
    return this.applyTemplate(tpl.message, data);
  },

  /** Guarda una plantilla nueva o existente */
  saveTemplate(template) {
    if (!template.id) template.id = 'tpl_' + Date.now();
    if (!template.key) template.key = 'CUSTOM_' + Date.now();
    return db.save(db.COLLECTIONS.notificationTemplates, template);
  },

  /** Elimina una plantilla */
  deleteTemplate(templateId) {
    return db.remove(db.COLLECTIONS.notificationTemplates, templateId);
  },

  /** Sembrado inicial de plantillas predeterminadas (solo si no existen) */
  seedDefaultTemplates() {
    const existing = this.getTemplates();
    this.DEFAULT_TEMPLATES.forEach(tpl => {
      // Solo crear si no existe ya una plantilla con esa key
      if (!existing.find(e => e.key === tpl.key)) {
        try {
          db.save(db.COLLECTIONS.notificationTemplates, tpl);
        } catch (e) {
          console.warn('[notifications] No se pudo crear plantilla:', tpl.key, e.message);
        }
      }
    });
  },

  // ====== ENVÍO ======

  /**
   * Genera el link wa.me con el mensaje precargado.
   * El usuario debe hacer click en este link para abrir WhatsApp.
   */
  buildWhatsAppLink(phone, message) {
    const cleanPhone = this.formatPhone(phone);
    if (!cleanPhone) return null;
    const encoded = encodeURIComponent(message || '');
    return `https://wa.me/${cleanPhone}?text=${encoded}`;
  },

  /**
   * Abre WhatsApp en una nueva pestaña con el mensaje precargado.
   * Loguea el envío en el historial.
   */
  send({ phone, message, contactType, contactId, contactName, templateKey, relatedDocId, relatedDocCode }) {
    const link = this.buildWhatsAppLink(phone, message);
    if (!link) {
      throw new Error('Número de teléfono inválido. Verifica el formato.');
    }

    // Registrar en historial ANTES de abrir (por si el usuario cierra el tab)
    this.logSent({
      phone: this.formatPhone(phone),
      message,
      contactType,
      contactId,
      contactName,
      templateKey,
      relatedDocId,
      relatedDocCode
    });

    // Abrir WhatsApp en nueva pestaña
    window.open(link, '_blank');

    return { ok: true, link };
  },

  /** Registra un mensaje enviado en el historial */
  logSent(data) {
    const log = {
      id: 'notif_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      sentAt: new Date().toISOString(),
      sentBy: window.auth?._profile?.email || 'sistema',
      phone: data.phone || '',
      message: data.message || '',
      contactType: data.contactType || '',  // 'supplier' | 'customer' | 'other'
      contactId: data.contactId || '',
      contactName: data.contactName || '',
      templateKey: data.templateKey || null,
      relatedDocId: data.relatedDocId || null,
      relatedDocCode: data.relatedDocCode || null
    };
    try {
      db.save(db.COLLECTIONS.notificationLog, log);
    } catch (e) {
      console.warn('[notifications] No se pudo registrar en log:', e.message);
    }
    return log;
  },

  /** Devuelve histórico ordenado por fecha desc */
  getHistory(filters = {}) {
    let logs = db.getAll(db.COLLECTIONS.notificationLog);
    if (filters.contactId) logs = logs.filter(l => l.contactId === filters.contactId);
    if (filters.contactType) logs = logs.filter(l => l.contactType === filters.contactType);
    if (filters.templateKey) logs = logs.filter(l => l.templateKey === filters.templateKey);
    return logs.sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
  },

  // ====== HELPERS PARA CASOS DE USO ======

  /**
   * Prepara los datos comunes para una factura de proveedor (para usar en plantilla).
   */
  prepareDataFromSupplierInvoice(invoiceId) {
    const inv = db.getById(db.COLLECTIONS.supplierInvoices, invoiceId);
    if (!inv) return null;
    const supplier = db.getById(db.COLLECTIONS.suppliers, inv.supplierId);
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};
    const today = new Date();
    const venc = inv.dueDate ? new Date(inv.dueDate) : null;
    const diasVenc = venc ? Math.floor((venc - today) / (1000 * 60 * 60 * 24)) : null;
    return {
      contact: supplier,
      data: {
        nombre: supplier?.name || '',
        empresa: cfg.companyName || 'tu proveedor',
        numero: inv.code,
        monto: currency.format(inv.totalToPay - (inv.paidAmount || 0), inv.currency),
        moneda: inv.currency,
        vencimiento: venc ? venc.toLocaleDateString('es-VE') : 'sin vencimiento',
        fecha_emision: inv.issueDate ? new Date(inv.issueDate).toLocaleDateString('es-VE') : '',
        dias_vencimiento: diasVenc != null ? String(diasVenc) : ''
      }
    };
  },

  /**
   * Prepara los datos comunes para un documento de venta (factura/pedido).
   */
  prepareDataFromSalesDoc(docId) {
    const doc = db.getById(db.COLLECTIONS.salesOrders, docId);
    if (!doc) return null;
    const customer = db.getById(db.COLLECTIONS.customers, doc.customerId);
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};
    const today = new Date();
    const venc = doc.dueDate ? new Date(doc.dueDate) : null;
    const diasVenc = venc ? Math.floor((venc - today) / (1000 * 60 * 60 * 24)) : null;
    return {
      contact: customer,
      data: {
        nombre: customer?.name || '',
        empresa: cfg.companyName || '',
        numero: doc.invoiceNumber || doc.code,
        monto: currency.format(doc.total - (doc.paidAmount || 0), doc.currency),
        moneda: doc.currency,
        vencimiento: venc ? venc.toLocaleDateString('es-VE') : 'sin vencimiento',
        fecha_emision: doc.issueDate ? new Date(doc.issueDate).toLocaleDateString('es-VE') : '',
        dias_vencimiento: diasVenc != null ? String(diasVenc) : ''
      }
    };
  },

  /**
   * Prepara datos para mensaje a proveedor sobre un material con stock bajo.
   * Busca el último proveedor que vendió ese material.
   */
  prepareDataFromLowStockMaterial(rawMaterialId) {
    const rm = db.getById(db.COLLECTIONS.rawMaterials, rawMaterialId);
    if (!rm) return null;
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};

    // Buscar último lote comprado para identificar al proveedor
    const lots = db.getAll(db.COLLECTIONS.rmLots)
      .filter(l => l.rawMaterialId === rawMaterialId && l.supplierId)
      .sort((a, b) => (b.receiptDate || '').localeCompare(a.receiptDate || ''));
    const lastSupplierId = lots[0]?.supplierId;
    const supplier = lastSupplierId ? db.getById(db.COLLECTIONS.suppliers, lastSupplierId) : null;

    // Stock total disponible
    const totalStock = db.getAll(db.COLLECTIONS.rmLots)
      .filter(l => l.rawMaterialId === rawMaterialId)
      .reduce((s, l) => s + (l.balance || 0), 0);

    return {
      contact: supplier,
      data: {
        nombre: supplier?.name || 'proveedor',
        empresa: cfg.companyName || '',
        material: rm.name,
        stock: totalStock.toFixed(2),
        unidad: rm.unit || 'un',
        numero: rm.code || ''
      }
    };
  }
};

window.notifications = notifications;
