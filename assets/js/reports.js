/* ============================================
   reports.js — Generación de reportes y exportación
   ============================================ */

const reports = {

  // ====== UTILIDADES DE PERÍODO ======

  /** Convierte un período predefinido a rango de fechas */
  periodToDates(period, customFrom, customTo) {
    const today = new Date();
    today.setHours(0,0,0,0);
    const fmt = d => d.toISOString().slice(0,10);
    let from, to;

    switch (period) {
      case 'today':
        from = to = fmt(today);
        break;
      case 'yesterday': {
        const y = new Date(today); y.setDate(y.getDate()-1);
        from = to = fmt(y);
        break;
      }
      case 'this_week': {
        const day = today.getDay();
        const diff = day === 0 ? -6 : 1 - day; // lunes
        const monday = new Date(today); monday.setDate(today.getDate() + diff);
        from = fmt(monday); to = fmt(today);
        break;
      }
      case 'last_week': {
        const day = today.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const thisMonday = new Date(today); thisMonday.setDate(today.getDate() + diff);
        const lastMonday = new Date(thisMonday); lastMonday.setDate(lastMonday.getDate()-7);
        const lastSunday = new Date(thisMonday); lastSunday.setDate(lastSunday.getDate()-1);
        from = fmt(lastMonday); to = fmt(lastSunday);
        break;
      }
      case 'this_month': {
        from = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
        to = fmt(today);
        break;
      }
      case 'last_month': {
        const first = new Date(today.getFullYear(), today.getMonth()-1, 1);
        const last = new Date(today.getFullYear(), today.getMonth(), 0);
        from = fmt(first); to = fmt(last);
        break;
      }
      case 'this_year': {
        from = fmt(new Date(today.getFullYear(), 0, 1));
        to = fmt(today);
        break;
      }
      case 'last_year': {
        from = fmt(new Date(today.getFullYear()-1, 0, 1));
        to = fmt(new Date(today.getFullYear()-1, 11, 31));
        break;
      }
      case 'custom':
        from = customFrom; to = customTo;
        break;
      case 'all':
      default:
        from = '0000-01-01'; to = '9999-12-31';
        break;
    }
    return { from, to };
  },

  periodLabel(period, from, to) {
    const labels = {
      today: 'Hoy', yesterday: 'Ayer',
      this_week: 'Esta semana', last_week: 'Semana pasada',
      this_month: 'Este mes', last_month: 'Mes pasado',
      this_year: 'Este año', last_year: 'Año pasado',
      all: 'Todo el histórico',
      custom: `Del ${from} al ${to}`
    };
    return labels[period] || `${from} a ${to}`;
  },

  inRange(dateIso, from, to) {
    if (!dateIso) return false;
    const d = String(dateIso).slice(0,10);
    return d >= from && d <= to;
  },

  // ====== LIBRO DE COMPRAS (SENIAT) ======

  /**
   * Devuelve filas del libro de compras según artículos 75-77 del Reglamento de IVA.
   * Solo facturas no anuladas dentro del período.
   */
  libroCompras(from, to) {
    const invoices = db.getAll(db.COLLECTIONS.supplierInvoices)
      .filter(i => i.status !== 'CANCELLED' && this.inRange(i.issueDate, from, to))
      .sort((a,b) => (a.issueDate||'').localeCompare(b.issueDate||''));

    const rows = invoices.map((i, idx) => {
      // Convertir a Bs si la factura está en otra moneda
      let baseVES = i.subtotal;
      let ivaVES = i.ivaAmount;
      let totalVES = i.total;
      let retIVAVES = i.ivaWithheld || 0;
      let retISLRVES = i.islrWithheld || 0;
      if (i.currency !== 'VES') {
        const rate = parseFloat(i.rateValue) || 0;
        baseVES *= rate;
        ivaVES *= rate;
        totalVES *= rate;
        retIVAVES *= rate;
        retISLRVES *= rate;
      }
      return {
        n: idx + 1,
        fecha: i.issueDate,
        rifProveedor: i.supplierRif || '',
        nombreProveedor: i.supplierName,
        nFactura: i.supplierInvoiceNumber || '',
        nControl: i.supplierInvoiceControl || '',
        baseImponible: baseVES,
        ivaRate: i.ivaRate,
        iva: ivaVES,
        exento: i.exempt ? totalVES : 0,
        total: totalVES,
        retencionIVA: retIVAVES,
        retencionISLR: retISLRVES,
        currency: i.currency,
        invoiceId: i.id
      };
    });

    const totals = rows.reduce((t, r) => ({
      baseImponible: t.baseImponible + r.baseImponible,
      iva: t.iva + r.iva,
      exento: t.exento + r.exento,
      total: t.total + r.total,
      retencionIVA: t.retencionIVA + r.retencionIVA,
      retencionISLR: t.retencionISLR + r.retencionISLR
    }), { baseImponible: 0, iva: 0, exento: 0, total: 0, retencionIVA: 0, retencionISLR: 0 });

    return { rows, totals };
  },

  // ====== LIBRO DE VENTAS (SENIAT) ======

  libroVentas(from, to) {
    const docs = db.getAll(db.COLLECTIONS.salesOrders)
      .filter(d => d.type === 'FACTURA' && this.inRange(d.issueDate, from, to))
      .sort((a,b) => (a.issueDate||'').localeCompare(b.issueDate||''));

    const rows = docs.map((d, idx) => {
      // Para libro de ventas, los anulados siguen apareciendo pero con monto 0 (o marcados)
      const isCancelled = d.cancelled;
      let baseVES = d.taxableBase;
      let ivaVES = d.ivaAmount;
      let totalVES = d.total;
      let exemptVES = d.exemptBase;
      if (d.currency !== 'VES') {
        const rate = parseFloat(d.rateValue) || 0;
        baseVES *= rate;
        ivaVES *= rate;
        totalVES *= rate;
        exemptVES *= rate;
      }
      return {
        n: idx + 1,
        fecha: d.issueDate,
        rifCliente: d.customerRif || '',
        nombreCliente: d.customerName,
        nFactura: d.invoiceNumber || d.code,
        nControl: d.controlNumber || '',
        baseImponible: isCancelled ? 0 : baseVES,
        ivaRate: d.ivaRate,
        iva: isCancelled ? 0 : ivaVES,
        exento: isCancelled ? 0 : exemptVES,
        total: isCancelled ? 0 : totalVES,
        cancelled: isCancelled,
        currency: d.currency,
        docId: d.id
      };
    });

    const totals = rows.reduce((t, r) => ({
      baseImponible: t.baseImponible + r.baseImponible,
      iva: t.iva + r.iva,
      exento: t.exento + r.exento,
      total: t.total + r.total
    }), { baseImponible: 0, iva: 0, exento: 0, total: 0 });

    return { rows, totals };
  },

  // ====== ESTADO DE CUENTA CLIENTE ======

  estadoCuentaCliente(customerId, from, to) {
    const customer = db.getById(db.COLLECTIONS.customers, customerId);
    const docs = db.getAll(db.COLLECTIONS.salesOrders)
      .filter(d => d.customerId === customerId && (d.type === 'FACTURA' || d.type === 'NOTA_ENTREGA') && !d.cancelled && this.inRange(d.issueDate, from, to))
      .sort((a,b) => (a.issueDate||'').localeCompare(b.issueDate||''));
    const allPayments = db.query(db.COLLECTIONS.payments, p => p.direction === 'IN' && p.counterpartyId === customerId && this.inRange(p.date, from, to));

    // Movimientos: cargo (factura/NE) y abono (pago)
    const movements = [];
    docs.forEach(d => {
      const isNE = d.type === 'NOTA_ENTREGA';
      movements.push({
        date: d.issueDate,
        type: isNE ? 'NOTA_ENTREGA' : 'INVOICE',
        ref: d.invoiceNumber || d.code,
        description: isNE ? 'Nota de Entrega emitida' : 'Factura emitida',
        debit: d.total,
        credit: 0,
        currency: d.currency,
        docId: d.id
      });
    });
    allPayments.forEach(p => {
      movements.push({
        date: p.date,
        type: 'PAYMENT',
        ref: p.code,
        description: `Cobro · ${p.paymentMethodName||''}${p.reference?' · '+p.reference:''}`,
        debit: 0,
        credit: p.amountInDocCurrency,
        currency: p.docCurrency,
        paymentId: p.id
      });
    });
    movements.sort((a,b) => (a.date||'').localeCompare(b.date||''));

    // Saldo corriente por moneda
    const balanceByCcy = {};
    movements.forEach(m => {
      if (!balanceByCcy[m.currency]) balanceByCcy[m.currency] = 0;
      balanceByCcy[m.currency] += m.debit - m.credit;
      m.balance = balanceByCcy[m.currency];
    });

    return { customer, movements, balanceByCcy };
  },

  estadoCuentaProveedor(supplierId, from, to) {
    const supplier = db.getById(db.COLLECTIONS.suppliers, supplierId);
    const invoices = db.getAll(db.COLLECTIONS.supplierInvoices)
      .filter(i => i.supplierId === supplierId && i.status !== 'CANCELLED' && this.inRange(i.issueDate, from, to))
      .sort((a,b) => (a.issueDate||'').localeCompare(b.issueDate||''));
    const allPayments = db.query(db.COLLECTIONS.payments, p => p.direction === 'OUT' && p.counterpartyId === supplierId && this.inRange(p.date, from, to));

    const movements = [];
    invoices.forEach(i => {
      movements.push({
        date: i.issueDate,
        type: 'INVOICE',
        ref: `${i.code}${i.supplierInvoiceNumber?' / '+i.supplierInvoiceNumber:''}`,
        description: 'Factura recibida',
        debit: 0,
        credit: i.totalToPay,
        currency: i.currency,
        invoiceId: i.id
      });
    });
    allPayments.forEach(p => {
      movements.push({
        date: p.date,
        type: 'PAYMENT',
        ref: p.code,
        description: `Pago · ${p.paymentMethodName||''}${p.reference?' · '+p.reference:''}`,
        debit: p.amountInDocCurrency,
        credit: 0,
        currency: p.docCurrency,
        paymentId: p.id
      });
    });
    movements.sort((a,b) => (a.date||'').localeCompare(b.date||''));

    const balanceByCcy = {};
    movements.forEach(m => {
      if (!balanceByCcy[m.currency]) balanceByCcy[m.currency] = 0;
      balanceByCcy[m.currency] += m.credit - m.debit;
      m.balance = balanceByCcy[m.currency];
    });

    return { supplier, movements, balanceByCcy };
  },

  // ====== INVENTARIO VALORIZADO ======

  inventarioValorizado() {
    const rms = db.getAll(db.COLLECTIONS.rawMaterials);
    const rmRows = rms.map(rm => {
      const lots = db.query(db.COLLECTIONS.rmLots, l => l.rawMaterialId === rm.id && (l.balance||0) > 0);
      const totalQty = lots.reduce((s,l) => s + (l.balance||0), 0);
      let totalValueUSD = 0;
      lots.forEach(l => {
        let usd = (l.balance||0) * (l.unitCost||0);
        if (l.costCurrency === 'VES') {
          const r = currency.getActiveRate();
          usd = r && r.value ? usd / r.value : 0;
        }
        totalValueUSD += usd;
      });
      return {
        kind: 'MP',
        code: rm.code,
        name: rm.name,
        unit: rm.unit,
        quantity: totalQty,
        avgCost: totalQty > 0 ? totalValueUSD / totalQty : 0,
        valueUSD: totalValueUSD,
        lotCount: lots.length
      };
    }).filter(r => r.quantity > 0);

    const fgs = db.getAll(db.COLLECTIONS.finishedGoods).filter(l => (l.balance||0) > 0);
    // Agrupar por fórmula
    const fgByFormula = {};
    fgs.forEach(l => {
      const key = l.formulaId || l.code;
      if (!fgByFormula[key]) fgByFormula[key] = { code: l.code, name: l.formulaName, unit: l.unit, lots: [] };
      fgByFormula[key].lots.push(l);
    });
    const fgRows = Object.values(fgByFormula).map(g => {
      const totalQty = g.lots.reduce((s,l) => s + (l.balance||0), 0);
      const totalValueUSD = g.lots.reduce((s,l) => s + ((l.balance||0) * (l.unitCost||0)), 0);
      return {
        kind: 'PT',
        code: g.lots[0].formulaCode || '—',
        name: g.name,
        unit: g.unit,
        quantity: totalQty,
        avgCost: totalQty > 0 ? totalValueUSD / totalQty : 0,
        valueUSD: totalValueUSD,
        lotCount: g.lots.length
      };
    });

    const all = [...rmRows, ...fgRows];
    const totals = {
      rmValue: rmRows.reduce((s,r) => s + r.valueUSD, 0),
      fgValue: fgRows.reduce((s,r) => s + r.valueUSD, 0),
      total: all.reduce((s,r) => s + r.valueUSD, 0)
    };
    return { rows: all, totals, rmRows, fgRows };
  },

  // ====== PRODUCCIÓN POR PERÍODO ======

  produccion(from, to) {
    const ofs = db.getAll(db.COLLECTIONS.productionOrders)
      .filter(o => this.inRange(o.completedAt || o.scheduledDate, from, to))
      .sort((a,b) => (b.completedAt||b.scheduledDate||'').localeCompare(a.completedAt||a.scheduledDate||''));

    const rows = ofs.map(o => {
      const fg = o.fgLotId ? db.getById(db.COLLECTIONS.finishedGoods, o.fgLotId) : null;
      const yieldPct = o.batchSize > 0 && o.actualQuantity ? (o.actualQuantity / o.batchSize) * 100 : 0;
      // Costo total: suma de MP consumida (en USD)
      let materialCostUSD = 0;
      (o.items||[]).forEach(it => {
        const lot = db.getById(db.COLLECTIONS.rmLots, it.lotId);
        if (lot) {
          let usd = (it.required||0) * (lot.unitCost||0);
          if (lot.costCurrency === 'VES') {
            const r = currency.getActiveRate();
            usd = r && r.value ? usd / r.value : 0;
          }
          materialCostUSD += usd;
        }
      });
      const unitCost = o.actualQuantity > 0 ? materialCostUSD / o.actualQuantity : 0;
      return {
        code: o.code,
        formulaName: o.formulaName,
        formulaVersion: o.formulaVersion,
        scheduledDate: o.scheduledDate,
        completedAt: o.completedAt,
        status: o.status,
        plannedBatch: o.batchSize,
        actualQty: o.actualQuantity || 0,
        unit: o.batchUnit,
        yieldPct,
        materialCostUSD,
        unitCostUSD: unitCost,
        lotCode: fg?.code || '—',
        ofId: o.id
      };
    });

    const completed = rows.filter(r => r.status === 'COMPLETED');
    const totals = {
      countTotal: rows.length,
      countCompleted: completed.length,
      totalProduced: completed.reduce((s,r) => s + r.actualQty, 0),
      totalCostUSD: completed.reduce((s,r) => s + r.materialCostUSD, 0),
      avgYield: completed.length ? completed.reduce((s,r) => s + r.yieldPct, 0) / completed.length : 0
    };
    return { rows, totals };
  },

  // ====== MÁRGENES DE VENTA ======

  margenes(from, to) {
    const docs = db.getAll(db.COLLECTIONS.salesOrders)
      .filter(d => d.type === 'FACTURA' && !d.cancelled && this.inRange(d.issueDate, from, to));

    // Por producto
    const byProduct = {};
    docs.forEach(d => {
      d.items.forEach(it => {
        if (!it.formulaId) return;
        if (!byProduct[it.formulaId]) {
          byProduct[it.formulaId] = {
            formulaId: it.formulaId,
            formulaName: it.formulaName || it.description,
            quantity: 0,
            revenueUSD: 0,
            costUSD: 0
          };
        }
        const itemSubtotal = it.subtotal || (it.quantity * it.unitPrice);
        let revenueUSD = itemSubtotal;
        if (d.currency === 'VES') {
          const r = currency.getActiveRate();
          revenueUSD = r && r.value ? itemSubtotal / r.value : 0;
        } else if (d.currency === 'EUR') {
          revenueUSD = itemSubtotal * 1.05; // aprox
        }
        byProduct[it.formulaId].quantity += it.quantity;
        byProduct[it.formulaId].revenueUSD += revenueUSD;
        // Costo: tomar de los lotes asignados
        (it.allocations || []).forEach(al => {
          const lot = db.getById(db.COLLECTIONS.finishedGoods, al.lotId);
          if (lot) {
            byProduct[it.formulaId].costUSD += al.quantity * (lot.unitCost || 0);
          }
        });
      });
    });
    const productRows = Object.values(byProduct).map(p => ({
      ...p,
      profitUSD: p.revenueUSD - p.costUSD,
      marginPct: p.revenueUSD > 0 ? ((p.revenueUSD - p.costUSD) / p.revenueUSD) * 100 : 0
    })).sort((a,b) => b.revenueUSD - a.revenueUSD);

    // Por cliente
    const byCustomer = {};
    docs.forEach(d => {
      if (!byCustomer[d.customerId]) {
        byCustomer[d.customerId] = {
          customerId: d.customerId,
          customerName: d.customerName,
          docCount: 0,
          revenueUSD: 0,
          costUSD: 0
        };
      }
      let revenueUSD = d.subtotal;
      if (d.currency === 'VES') {
        const r = currency.getActiveRate();
        revenueUSD = r && r.value ? d.subtotal / r.value : 0;
      } else if (d.currency === 'EUR') {
        revenueUSD = d.subtotal * 1.05;
      }
      byCustomer[d.customerId].docCount += 1;
      byCustomer[d.customerId].revenueUSD += revenueUSD;
      d.items.forEach(it => {
        (it.allocations || []).forEach(al => {
          const lot = db.getById(db.COLLECTIONS.finishedGoods, al.lotId);
          if (lot) byCustomer[d.customerId].costUSD += al.quantity * (lot.unitCost || 0);
        });
      });
    });
    const customerRows = Object.values(byCustomer).map(c => ({
      ...c,
      profitUSD: c.revenueUSD - c.costUSD,
      marginPct: c.revenueUSD > 0 ? ((c.revenueUSD - c.costUSD) / c.revenueUSD) * 100 : 0
    })).sort((a,b) => b.revenueUSD - a.revenueUSD);

    const totals = {
      revenueUSD: productRows.reduce((s,r) => s + r.revenueUSD, 0),
      costUSD: productRows.reduce((s,r) => s + r.costUSD, 0)
    };
    totals.profitUSD = totals.revenueUSD - totals.costUSD;
    totals.marginPct = totals.revenueUSD > 0 ? (totals.profitUSD / totals.revenueUSD) * 100 : 0;

    return { productRows, customerRows, totals };
  },

  // ====== FLUJO DE CAJA ======

  flujoCaja(from, to) {
    const moves = db.getAll(db.COLLECTIONS.bankMoves)
      .filter(m => this.inRange(m.date, from, to))
      .sort((a,b) => (a.date||'').localeCompare(b.date||'') || (a.timestamp||'').localeCompare(b.timestamp||''));

    // Agrupar por cuenta
    const accounts = db.getAll(db.COLLECTIONS.bankAccounts);
    const byAccount = {};
    accounts.forEach(a => {
      byAccount[a.id] = {
        account: a,
        moves: [],
        opening: 0, closing: 0, totalIn: 0, totalOut: 0
      };
    });
    moves.forEach(m => {
      if (!byAccount[m.accountId]) return;
      byAccount[m.accountId].moves.push(m);
      if (m.direction === 'IN') byAccount[m.accountId].totalIn += m.amount;
      else byAccount[m.accountId].totalOut += m.amount;
    });
    // Closing balance del último movimiento o saldo actual si no hubo movimientos
    Object.values(byAccount).forEach(g => {
      if (g.moves.length) {
        g.closing = g.moves[g.moves.length-1].runningBalance || 0;
        // Saldo apertura: el saldo antes del primer movimiento del período
        const firstMove = g.moves[0];
        const firstAmount = firstMove.signedAmount || (firstMove.direction === 'IN' ? firstMove.amount : -firstMove.amount);
        g.opening = (firstMove.runningBalance || 0) - firstAmount;
      } else {
        g.closing = g.account.balance;
        g.opening = g.account.balance;
      }
    });

    return { byAccount: Object.values(byAccount).filter(g => g.moves.length || g.account.active) };
  },

  // ====== RETENCIONES ======

  retenciones(from, to) {
    const vouchers = db.getAll(db.COLLECTIONS.withholdingVouchers)
      .filter(v => this.inRange(v.issueDate, from, to))
      .sort((a,b) => (a.issueDate||'').localeCompare(b.issueDate||''));

    const rows = vouchers.map(v => {
      const inv = db.getById(db.COLLECTIONS.supplierInvoices, v.invoiceId);
      let baseVES = v.taxableBase;
      let ivaWithheldVES = v.ivaWithheld;
      let islrWithheldVES = v.islrWithheld;
      let totalVES = v.totalWithheld;
      if (v.currency !== 'VES' && inv) {
        const rate = parseFloat(inv.rateValue) || 0;
        baseVES *= rate;
        ivaWithheldVES *= rate;
        islrWithheldVES *= rate;
        totalVES *= rate;
      }
      return {
        n: vouchers.indexOf(v) + 1,
        fecha: v.issueDate,
        comprobante: v.code,
        rifProveedor: v.supplierRif,
        nombreProveedor: v.supplierName,
        nFactura: v.supplierInvoiceNumber,
        nControl: v.supplierInvoiceControl,
        baseImponible: baseVES,
        ivaWithheld: ivaWithheldVES,
        islrWithheld: islrWithheldVES,
        totalWithheld: totalVES,
        currency: v.currency,
        voucherId: v.id
      };
    });

    const totals = rows.reduce((t,r) => ({
      baseImponible: t.baseImponible + r.baseImponible,
      ivaWithheld: t.ivaWithheld + r.ivaWithheld,
      islrWithheld: t.islrWithheld + r.islrWithheld,
      totalWithheld: t.totalWithheld + r.totalWithheld
    }), { baseImponible: 0, ivaWithheld: 0, islrWithheld: 0, totalWithheld: 0 });

    return { rows, totals };
  },

  // ====== EXPORTACIÓN CSV ======

  /**
   * Convierte filas a CSV con headers. Detecta automáticamente las columnas.
   */
  toCSV(rows, columns) {
    // columns: [{key, label, format?}]
    const header = columns.map(c => `"${c.label.replace(/"/g,'""')}"`).join(',');
    const body = rows.map(r => columns.map(c => {
      let v = r[c.key];
      if (c.format) v = c.format(v, r);
      if (v === null || v === undefined) v = '';
      v = String(v).replace(/"/g, '""');
      return `"${v}"`;
    }).join(',')).join('\n');
    return header + '\n' + body;
  },

  downloadCSV(filename, csvContent) {
    // BOM para que Excel reconozca UTF-8
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  },

  // ====== EXPORTACIÓN PDF (vista imprimible HTML) ======

  /**
   * Abre vista imprimible con header del reporte. El cuerpo se pasa como HTML.
   */
  openPrintable({ title, subtitle, periodLabel, bodyHtml }) {
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter+Tight:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter Tight', sans-serif; font-size: 9.5pt; color: #1a1a18; padding: 30px 40px; line-height: 1.5; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 2px solid #1a1a18; margin-bottom: 24px; }
  .brand { font-family: 'Fraunces', serif; font-size: 22pt; font-style: italic; letter-spacing: -1px; line-height: 1; }
  .brand span { color: #5b7a5a; }
  .company-info { text-align: right; font-size: 9pt; color: #4a4a45; line-height: 1.6; }
  .doc-title { font-family: 'Fraunces', serif; font-size: 22pt; font-style: italic; margin-bottom: 4px; margin-top: 20px; }
  .doc-sub { font-size: 9pt; letter-spacing: 0.16em; text-transform: uppercase; color: #8a8a82; font-weight: 600; }
  .period-banner { background: #f4f3ef; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 10pt; }
  .period-banner strong { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 8.5pt; }
  th { text-align: left; font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: #8a8a82; font-weight: 600; padding: 8px 6px; border-bottom: 2px solid #1a1a18; }
  td { padding: 7px 6px; border-bottom: 1px solid #e7e5df; }
  .num { text-align: right; font-family: monospace; }
  .total-row { background: #1a1a18; color: white; font-weight: 600; font-size: 9.5pt; }
  .total-row td { border: none; padding: 12px 6px; }
  .toolbar { background: #1a1a18; color: white; padding: 12px 20px; margin: -30px -40px 24px -40px; display: flex; justify-content: space-between; align-items: center; }
  .btn-print { background: #5b7a5a; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 11pt; font-weight: 500; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e7e5df; font-size: 8pt; color: #8a8a82; text-align: center; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0; }
  .summary-box { padding: 14px; background: #f4f3ef; border-radius: 6px; }
  .summary-box .label { font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #8a8a82; font-weight: 600; }
  .summary-box .value { font-family: 'Fraunces', serif; font-size: 16pt; font-style: italic; margin-top: 4px; color: #5b7a5a; }
  .section-title { font-family: 'Fraunces', serif; font-size: 14pt; font-style: italic; margin: 24px 0 8px 0; }
  @media print { body { padding: 15mm; } .no-print { display: none; } @page { margin: 0; size: A4 landscape; } }
</style></head><body>

<div class="toolbar no-print">
  <span>${escapeHtml(title)} · Vista previa</span>
  <button class="btn-print" onclick="window.print()">Imprimir / Guardar como PDF</button>
</div>

<div class="header">
  <div>
    <div class="brand"><span>alt</span>care</div>
    <div style="font-size: 8pt; letter-spacing: 0.16em; text-transform: uppercase; color: #8a8a82; font-weight: 600; margin-top: 4px;">${escapeHtml(cfg.companyName||'')}</div>
  </div>
  <div class="company-info">
    ${cfg.companyName ? `<div style="font-weight:600;color:#1a1a18;">${escapeHtml(cfg.companyName)}</div>` : ''}
    ${cfg.rif ? `<div>RIF: ${escapeHtml(cfg.rif)}</div>` : ''}
    ${cfg.address ? `<div>${escapeHtml(cfg.address)}</div>` : ''}
  </div>
</div>

<div class="doc-sub">Reporte</div>
<h1 class="doc-title">${escapeHtml(title)}</h1>
${subtitle ? `<div style="font-size:10pt;color:#4a4a45;margin-top:4px;">${escapeHtml(subtitle)}</div>` : ''}

<div class="period-banner">
  <strong>Período:</strong> ${escapeHtml(periodLabel)} · Generado: ${formatDateTime(new Date().toISOString())}
</div>

${bodyHtml}

<div class="footer">
  Reporte generado por altcare Manufacturing OS · ${formatDateTime(new Date().toISOString())} · ${escapeHtml(cfg.companyName||'')}
</div>

</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { ui.toast('Permite ventanas emergentes', 'error'); return; }
    w.document.write(html);
    w.document.close();

    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    function formatDateTime(iso) { return iso ? new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  }
};

// helper compartido
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function fmtVES(n) { return (parseFloat(n)||0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtUSD(n) { return '$' + (parseFloat(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }

/**
 * Formatea un valor en USD a la moneda del modo activo.
 * Los reportes operativos calculan internamente en USD; esta función
 * convierte a la moneda del usuario al mostrar.
 * - Modo Gerencial → mantiene en USD
 * - Modo Contable → convierte a VES con tasa BCV
 */
function fmtMode(usdAmount) {
  if (typeof currency === 'undefined' || !currency.getModeCurrency) return fmtUSD(usdAmount);
  const modeCcy = currency.getModeCurrency();
  if (modeCcy === 'USD') return fmtUSD(usdAmount);
  // Convertir USD → VES con la tasa del modo (BCV)
  const rate = currency.getRate('BCV_USD');
  if (!rate || !rate.value) return fmtUSD(usdAmount);
  const ves = (parseFloat(usdAmount) || 0) * rate.value;
  return fmtVES(ves) + ' Bs.';
}
