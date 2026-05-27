/* ============================================================================
   reconciliation.js — Conciliación de pagos desde estado de cuenta bancario
   ----------------------------------------------------------------------------
   Toma un estado de cuenta (CSV/Excel) y:
     1. Separa COBROS (créditos, importe +) de GASTOS/EGRESOS (débitos, importe −).
     2. Extrae la cédula/RIF de cada cobro desde la descripción del banco.
     3. Matchea la cédula contra los clientes que tienen cuentas por cobrar.
     4. Ancla el dólar al DÍA DEL PAGO via currency.getRateOnDate(fecha).
     5. Expone helpers para aplicar cobros a facturas y registrar gastos.

   El bolívar cambia todos los días: por eso el monto del banco (en Bs) se
   convierte a USD con la tasa BCV de la FECHA del movimiento, NO la de hoy.
   ============================================================================ */

const reconciliation = {

  // --------------------------------------------------------------------------
  // PARSEO DE MONTOS Y FECHAS (formato venezolano del banco)
  // --------------------------------------------------------------------------

  /**
   * Parsea montos del estado de cuenta. El banco usa formato VE: "74.954,00"
   * (punto = miles, coma = decimal). Puede venir negativo: "-9.018,47".
   * @returns {number|null}
   */
  parseMonto(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return isNaN(raw) ? null : raw;
    let s = String(raw).trim().replace(/[$\s"]/g, '');
    if (!s) return null;
    const neg = s.startsWith('-');
    if (neg) s = s.slice(1);
    // Formato VE: "1.234,56" → punto miles, coma decimal
    if (/,\d{1,2}$/.test(s) && s.indexOf('.') < s.lastIndexOf(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return neg ? -n : n;
  },

  /**
   * Parsea fechas del banco: "26-05-2026" (DD-MM-YYYY) o Date object de XLSX.
   * Devuelve YYYY-MM-DD o null.
   */
  parseFecha(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date) {
      const y = raw.getFullYear(), m = raw.getMonth() + 1, d = raw.getDate();
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const s = String(raw).trim().replace(/"/g, '');
    // Número serie Excel
    if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 25000 && Number(s) < 80000) {
      const days = Number(s);
      const ms = (days - 25569) * 86400000;
      const dt = new Date(ms);
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // DD-MM-YYYY o DD/MM/YYYY (formato del banco venezolano)
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let day = parseInt(m[1], 10), month = parseInt(m[2], 10);
      let yy = m[3]; if (yy.length === 2) yy = '20' + yy;
      // Banco venezolano = DD-MM-YYYY. Si día > 12 sin duda; si mes > 12 invertir.
      if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
      if (day < 1 || day > 31 || month < 1 || month > 12) return null;
      return `${yy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  },

  // --------------------------------------------------------------------------
  // EXTRACCIÓN DE CÉDULA / RIF DESDE LA DESCRIPCIÓN DEL BANCO
  // --------------------------------------------------------------------------

  /**
   * Las descripciones de crédito traen el documento del pagador en formatos como:
   *   "CR.I/REC 0102 V018476322"  → V018476322  (cédula natural, banco 0102)
   *   "CR.I/REC 0191 J504503169"  → J504503169  (RIF jurídico)
   * El número viene con ceros de relleno. Esta función extrae el documento
   * normalizado (letra + dígitos, sin ceros a la izquierda del cuerpo).
   *
   * @returns {{ docType: string, docNumber: string, raw: string }|null}
   */
  extractDoc(descripcion) {
    if (!descripcion) return null;
    const s = String(descripcion).toUpperCase();
    // Buscar patrón [V|J|E|G|P] seguido de 6 a 12 dígitos
    const m = s.match(/\b([VJEGP])\s?-?\s?0*(\d{6,12})\b/);
    if (!m) return null;
    const letter = m[1];
    let digits = m[2].replace(/^0+/, ''); // quitar ceros de relleno del banco
    if (!digits) return null;
    return { docType: letter, docNumber: digits, raw: `${letter}${digits}` };
  },

  /**
   * Normaliza un RIF/cédula de cliente del sistema para comparar contra el
   * documento extraído del banco. Quita prefijo de letra, guiones, espacios,
   * puntos y dígito verificador final si el cliente lo tiene (J-12345678-9).
   *
   * Devuelve { letter, core } donde core es solo el cuerpo numérico SIN el
   * dígito verificador y SIN ceros a la izquierda — para comparar con el banco.
   */
  normalizeCustomerDoc(rif) {
    if (!rif) return null;
    let s = String(rif).toUpperCase().replace(/[\s\.]/g, '');
    const letterMatch = s.match(/^([VJEGP])/);
    const letter = letterMatch ? letterMatch[1] : '';
    // Quitar la letra y todo lo no-numérico, dejando solo dígitos y guiones
    s = s.replace(/^[VJEGP]/, '');
    const parts = s.split('-').filter(Boolean);
    let core;
    if (parts.length >= 2) {
      // Formato J-12345678-9 → cuerpo = "12345678", verificador = "9"
      core = parts[0].replace(/\D/g, '');
    } else {
      // Sin guiones: V12345678 → todo es el cuerpo
      core = (parts[0] || '').replace(/\D/g, '');
    }
    core = core.replace(/^0+/, '');
    if (!core) return null;
    return { letter, core };
  },

  /**
   * Compara el documento extraído del banco con el RIF de un cliente.
   * El banco a veces incluye el dígito verificador pegado y a veces no, así que
   * matcheamos por contención del cuerpo numérico (el más específico gana).
   *
   * @returns {boolean}
   */
  docsMatch(bankDoc, customerRif) {
    if (!bankDoc || !customerRif) return false;
    const cust = this.normalizeCustomerDoc(customerRif);
    if (!cust) return false;
    const bankCore = bankDoc.docNumber.replace(/^0+/, '');
    // Match exacto del cuerpo
    if (bankCore === cust.core) return true;
    // El banco puede traer el verificador pegado: bankCore = core + verificador
    if (bankCore.length === cust.core.length + 1 && bankCore.startsWith(cust.core)) return true;
    // O el cliente guardó el verificador y el banco no
    if (cust.core.length === bankCore.length + 1 && cust.core.startsWith(bankCore)) return true;
    return false;
  },

  // --------------------------------------------------------------------------
  // CLASIFICACIÓN DE MOVIMIENTOS
  // --------------------------------------------------------------------------

  /**
   * Clasifica un movimiento del banco en una categoría de gasto según su
   * descripción. Solo se usa para débitos (egresos).
   */
  classifyExpense(descripcion) {
    const s = String(descripcion || '').toUpperCase();
    if (/COMIS|COM\s/.test(s) && /TRF|TERCERO|CR\.I|EDO\.CTA|EM\./.test(s)) return 'COMISION_BANCARIA';
    if (/COMIS/.test(s)) return 'COMISION_BANCARIA';
    if (/TPBW|TRF/.test(s)) return 'TRANSFERENCIA_ENVIADA';
    if (/CR\.I\/OB/.test(s)) return 'DEBITO_VARIO';
    if (/IGTF|IMPUESTO|RETEN/.test(s)) return 'IMPUESTO';
    return 'OTRO';
  },

  EXPENSE_LABELS: {
    COMISION_BANCARIA: 'Comisión bancaria',
    TRANSFERENCIA_ENVIADA: 'Transferencia enviada',
    DEBITO_VARIO: 'Débito vario',
    IMPUESTO: 'Impuesto / retención',
    OTRO: 'Otro egreso'
  },

  // --------------------------------------------------------------------------
  // CONSTRUCCIÓN DE FILAS CONCILIABLES
  // --------------------------------------------------------------------------

  /**
   * Devuelve todas las facturas/documentos de venta de un cliente que aún
   * tienen saldo pendiente, ordenadas FIFO (más vieja primero).
   */
  getOpenInvoicesForCustomer(customerId) {
    if (!customerId) return [];
    return db.getAll(db.COLLECTIONS.salesOrders)
      .filter(d => d.customerId === customerId
        && d.status !== 'CANCELLED' && d.status !== 'ANULADO'
        && (d.total - (d.paidAmount || 0)) > 0.01)
      .sort((a, b) => String(a.issueDate || '').localeCompare(String(b.issueDate || '')));
  },

  /**
   * Encuentra el cliente cuyo RIF matchea el documento extraído del banco.
   * Prioriza clientes que tengan facturas abiertas.
   */
  findCustomerByDoc(bankDoc, allCustomers) {
    if (!bankDoc) return null;
    const matches = allCustomers.filter(c => this.docsMatch(bankDoc, c.rif));
    if (!matches.length) return null;
    // Preferir el que tenga saldo pendiente
    const withDebt = matches.find(c => this.getOpenInvoicesForCustomer(c.id).length > 0);
    return withDebt || matches[0];
  },

  /**
   * Convierte el monto en Bs del movimiento a USD usando la tasa BCV del DÍA
   * del pago. Devuelve también si la tasa fue exacta de ese día o aproximada.
   *
   * @returns {{ usd:number, rate:number, rateDate:string, exact:boolean }}
   */
  anchorUsd(montoVes, fecha) {
    const r = currency.getRateOnDate(fecha, 'BCV_USD');
    const rate = r.value || 0;
    return {
      usd: rate > 0 ? Math.round((montoVes / rate) * 100) / 100 : 0,
      rate,
      rateDate: r.date || '',
      exact: !!r.found
    };
  },

  /**
   * Parsea el estado de cuenta completo. Recibe filas crudas [fecha, ref, desc,
   * importe, saldo] y devuelve { cobros, gastos, skipped }.
   *
   * Cada cobro: { fecha, referencia, descripcion, montoVes, usd, rate, rateDate,
   *               rateExact, bankDoc, matchedCustomerId, matchedCustomerName,
   *               suggestedInvoiceId, assignedInvoiceId, status }
   * Cada gasto: { fecha, referencia, descripcion, montoVes, category, customDesc }
   */
  parseStatement(rows, colMap) {
    const cobros = [], gastos = [], errors = [];
    const allCustomers = db.getAll(db.COLLECTIONS.customers).filter(c => c.active !== false);

    for (const row of rows) {
      const fecha = this.parseFecha(this.getCell(row, colMap.fecha));
      const descripcion = String(this.getCell(row, colMap.descripcion) || '').trim();
      const referencia = String(this.getCell(row, colMap.referencia) || '').trim();
      const montoRaw = this.parseMonto(this.getCell(row, colMap.importe));

      if (montoRaw == null || montoRaw === 0) continue; // fila vacía o sin importe
      if (!fecha) { errors.push(`Fecha inválida en mov. ${referencia || descripcion}`); continue; }

      if (montoRaw > 0) {
        // === COBRO (crédito, entra plata) ===
        const bankDoc = this.extractDoc(descripcion);
        const matched = bankDoc ? this.findCustomerByDoc(bankDoc, allCustomers) : null;
        const anchor = this.anchorUsd(montoRaw, fecha);
        const openInv = matched ? this.getOpenInvoicesForCustomer(matched.id) : [];

        cobros.push({
          id: `cb_${referencia || Math.random().toString(36).slice(2)}`,
          fecha, referencia, descripcion,
          montoVes: montoRaw,
          usd: anchor.usd,
          rate: anchor.rate,
          rateDate: anchor.rateDate,
          rateExact: anchor.exact,
          bankDoc: bankDoc ? bankDoc.raw : '',
          matchedCustomerId: matched ? matched.id : '',
          matchedCustomerName: matched ? matched.name : '',
          openInvoices: openInv.map(i => ({ id: i.id, code: i.code, remaining: i.total - (i.paidAmount || 0), currency: i.currency, issueDate: i.issueDate })),
          suggestedInvoiceId: openInv.length ? openInv[0].id : '',
          assignedInvoiceId: openInv.length ? openInv[0].id : '',
          status: matched ? (openInv.length ? 'MATCHED' : 'NO_DEBT') : 'UNMATCHED'
        });
      } else {
        // === GASTO (débito, sale plata) ===
        const cat = this.classifyExpense(descripcion);
        gastos.push({
          id: `gs_${referencia || Math.random().toString(36).slice(2)}`,
          fecha, referencia, descripcion,
          montoVes: Math.abs(montoRaw),
          category: cat,
          customDesc: '',
          include: true
        });
      }
    }
    return { cobros, gastos, errors };
  },

  getCell(row, idx) {
    if (idx === undefined || idx === null) return '';
    return row[idx];
  },

  // --------------------------------------------------------------------------
  // MAPEO DE ENCABEZADOS DEL ESTADO DE CUENTA
  // --------------------------------------------------------------------------

  mapHeaders(headers) {
    const map = {};
    headers.forEach((h, idx) => {
      const lower = String(h || '').toLowerCase().trim();
      if (/fecha/.test(lower) && map.fecha === undefined) map.fecha = idx;
      else if (/referen|ref\b|numero|n[uú]mero|nro/.test(lower) && map.referencia === undefined) map.referencia = idx;
      else if (/descrip|concepto|detalle/.test(lower) && map.descripcion === undefined) map.descripcion = idx;
      else if (/importe|monto|d[eé]bito|cr[eé]dito|valor/.test(lower) && map.importe === undefined) map.importe = idx;
      else if (/saldo|balance/.test(lower) && map.saldo === undefined) map.saldo = idx;
    });
    return map;
  },

  // --------------------------------------------------------------------------
  // APLICACIÓN: crear los pagos y registrar gastos
  // --------------------------------------------------------------------------

  /**
   * Aplica un cobro conciliado a su factura, creando un payment IN con el dólar
   * anclado al día del pago. Usa la infraestructura existente de payments/sales.
   *
   * @param {object} cobro - fila de cobro ya conciliada
   * @param {string} bankAccountId - cuenta bancaria (VES) donde entró
   * @returns {object} payment guardado
   */
  applyCobro(cobro, bankAccountId) {
    const inv = cobro.assignedInvoiceId ? db.getById(db.COLLECTIONS.salesOrders, cobro.assignedInvoiceId) : null;
    if (!inv) throw new Error(`Cobro ${cobro.referencia}: sin factura asignada`);

    const customer = db.getById(db.COLLECTIONS.customers, inv.customerId);
    const docCurrency = inv.currency || 'USD';

    // El monto entró en Bs. Lo expresamos en la moneda del documento usando la
    // tasa anclada al día del pago. Si la factura está en USD, usamos cobro.usd.
    let amountInDocCurrency;
    if (docCurrency === 'USD') amountInDocCurrency = cobro.usd;
    else if (docCurrency === 'VES') amountInDocCurrency = cobro.montoVes;
    else amountInDocCurrency = cobro.usd; // EUR u otros: aproximación vía USD

    // No exceder el saldo pendiente del documento
    const remaining = Math.round((inv.total - (inv.paidAmount || 0)) * 100) / 100;
    if (amountInDocCurrency > remaining) amountInDocCurrency = remaining;

    return payments.createPayment({
      direction: 'IN',
      counterpartyId: inv.customerId,
      counterpartyName: customer ? customer.name : (inv.customerName || ''),
      relatedDocId: inv.id,
      relatedDocCode: inv.code,
      amount: cobro.montoVes,          // lo que realmente entró al banco (Bs)
      currency: 'VES',
      docCurrency,
      amountInDocCurrency,             // cuánto descuenta de la deuda (moneda doc)
      rateAtPayment: cobro.rate,       // ★ tasa BCV del DÍA DEL PAGO (anclada)
      rateTypeAtPayment: 'BCV_USD',
      paymentMethodName: 'Transferencia (conciliación bancaria)',
      bankAccountId,
      reference: cobro.referencia,
      date: cobro.fecha,
      notes: `Conciliación automática · ${cobro.descripcion}${cobro.rateExact ? '' : ' · tasa aprox.'}`
    });
  },

  /**
   * Registra un gasto como egreso de la cuenta bancaria (movimiento FEE).
   * Mantiene la descripción editable que escribió el usuario.
   */
  applyGasto(gasto, bankAccountId) {
    const desc = gasto.customDesc && gasto.customDesc.trim()
      ? gasto.customDesc.trim()
      : (this.EXPENSE_LABELS[gasto.category] || 'Egreso');
    return payments.registerBankMove({
      accountId: bankAccountId,
      type: gasto.category === 'COMISION_BANCARIA' || gasto.category === 'IMPUESTO' ? 'FEE' : 'WITHDRAWAL',
      amount: gasto.montoVes,
      currency: 'VES',
      date: gasto.fecha,
      reference: `${desc}${gasto.referencia ? ' · Ref ' + gasto.referencia : ''}`,
      counterpartyName: this.EXPENSE_LABELS[gasto.category] || 'Egreso'
    });
  }
};

if (typeof window !== 'undefined') window.reconciliation = reconciliation;
