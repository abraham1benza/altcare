/* ============================================
   payments.js — Lógica de pagos
   Cuentas bancarias, métodos, pagos a/desde,
   conversión de monedas, kardex bancario
   ============================================ */

const payments = {

  DIRECTION: {
    OUT: 'OUT',  // pago a proveedor (sale plata)
    IN:  'IN'    // cobro de cliente (entra plata)
  },

  // ====== CUENTAS BANCARIAS ======

  createBankAccount({ name, bank, accountNumber, currency: ccy, openingBalance, type }) {
    const account = {
      name, bank, accountNumber: accountNumber || '',
      currency: ccy || 'VES',
      type: type || 'Corriente',
      openingBalance: parseFloat(openingBalance) || 0,
      balance: 0,    // ← arranca en 0; el movimiento OPENING se encarga de subirlo
      active: true
    };
    const saved = db.save(db.COLLECTIONS.bankAccounts, account);
    if (saved.openingBalance !== 0) {
      this.registerBankMove({
        accountId: saved.id,
        type: 'OPENING',
        amount: saved.openingBalance,
        currency: saved.currency,
        date: new Date().toISOString().slice(0,10),
        reference: 'Saldo inicial'
      });
    }
    return saved;
  },

  updateBankAccount(id, data) {
    const a = db.getById(db.COLLECTIONS.bankAccounts, id);
    if (!a) throw new Error('Cuenta no encontrada');
    Object.assign(a, data);
    return db.save(db.COLLECTIONS.bankAccounts, a);
  },

  /** Movimiento bancario (kardex de cuenta) */
  registerBankMove({ accountId, type, amount, currency: moveCurrency, date, reference, paymentId, counterpartyName }) {
    const account = db.getById(db.COLLECTIONS.bankAccounts, accountId);
    if (!account) throw new Error('Cuenta bancaria no encontrada');
    const isCredit = ['DEPOSIT','OPENING','TRANSFER_IN','PAYMENT_IN'].includes(type);
    const isDebit = ['WITHDRAWAL','TRANSFER_OUT','PAYMENT_OUT','FEE'].includes(type);
    const sign = isCredit ? 1 : (isDebit ? -1 : 1);

    // Actualizar saldo de la cuenta (en su moneda)
    account.balance = (parseFloat(account.balance) || 0) + (parseFloat(amount) * sign);
    db.save(db.COLLECTIONS.bankAccounts, account);

    const move = {
      accountId,
      accountName: account.name,
      type,
      direction: isCredit ? 'IN' : 'OUT',
      amount: parseFloat(amount) || 0,
      signedAmount: parseFloat(amount) * sign,
      currency: moveCurrency || account.currency,
      runningBalance: account.balance,
      date: date || new Date().toISOString().slice(0,10),
      timestamp: new Date().toISOString(),
      reference: reference || '',
      paymentId: paymentId || null,
      counterpartyName: counterpartyName || '',
      user: auth.currentUser()?.username || 'system'
    };
    return db.save(db.COLLECTIONS.bankMoves, move);
  },

  // ====== PAGOS ======

  /**
   * Crea un pago. direction: OUT (a proveedor) o IN (de cliente)
   * Soporta pagos parciales y conversión de monedas.
   *
   * @param {object} data - {
   *   direction: OUT|IN,
   *   counterpartyId: id de proveedor o cliente,
   *   counterpartyName: name (snapshot),
   *   relatedDocId: id de factura proveedor o doc venta,
   *   relatedDocCode: code,
   *   amount: monto en la moneda del pago,
   *   currency: moneda del pago,
   *   docCurrency: moneda de la factura,
   *   amountInDocCurrency: monto convertido (si difiere)
   *   rateUsed: tasa usada si hay conversión,
   *   paymentMethodId, paymentMethodName,
   *   bankAccountId (opcional),
   *   reference (cheque, número, etc),
   *   date,
   *   notes
   * }
   */
  createPayment(data) {
    const code = db.nextCode(db.COLLECTIONS.payments, data.direction === 'OUT' ? 'PG' : 'CB');
    const today = data.date || new Date().toISOString().slice(0, 10);

    // Tasa congelada del pago (BCV del día del pago)
    const rateAtPayment = parseFloat(data.rateAtPayment) || (() => {
      const r = currency.getRate('BCV_USD');
      return r?.value || 0;
    })();

    // Calcular el equivalente en USD y VES del monto del pago (en la moneda en que entró)
    const amountAsNum = parseFloat(data.amount) || 0;
    let amountUSD = 0, amountVES = 0;
    if (data.currency === 'USD') {
      amountUSD = amountAsNum;
      amountVES = rateAtPayment > 0 ? amountAsNum * rateAtPayment : 0;
    } else if (data.currency === 'VES') {
      amountVES = amountAsNum;
      amountUSD = rateAtPayment > 0 ? amountAsNum / rateAtPayment : 0;
    } else if (data.currency === 'EUR') {
      // EUR → USD vía BCV_EUR
      const eurRate = currency.getRate('BCV_EUR');
      amountVES = eurRate?.value ? amountAsNum * eurRate.value : 0;
      amountUSD = rateAtPayment > 0 && amountVES ? amountVES / rateAtPayment : 0;
    }

    const payment = {
      code,
      direction: data.direction,
      counterpartyId: data.counterpartyId,
      counterpartyName: data.counterpartyName,
      relatedDocId: data.relatedDocId,
      relatedDocCode: data.relatedDocCode,
      amount: amountAsNum,
      currency: data.currency,
      docCurrency: data.docCurrency,
      amountInDocCurrency: parseFloat(data.amountInDocCurrency) || parseFloat(data.amount) || 0,
      rateUsed: parseFloat(data.rateUsed) || null,
      // === Tasa congelada del pago ===
      rateAtPayment: rateAtPayment,
      rateTypeAtPayment: data.rateTypeAtPayment || 'BCV_USD',
      amountUSD: Math.round(amountUSD * 100) / 100,
      amountVES: Math.round(amountVES * 100) / 100,
      // === Conversión cruzada (cuando moneda pago ≠ moneda doc) ===
      conversionRate: parseFloat(data.conversionRate) || null,
      conversionRateType: data.conversionRateType || null,
      conversionRateLabel: data.conversionRateLabel || null,
      // ===
      paymentMethodId: data.paymentMethodId,
      paymentMethodName: data.paymentMethodName,
      bankAccountId: data.bankAccountId || null,
      reference: data.reference || '',
      date: today,
      notes: data.notes || ''
    };
    const saved = db.save(db.COLLECTIONS.payments, payment);

    // Movimiento bancario (si tiene cuenta)
    if (saved.bankAccountId) {
      this.registerBankMove({
        accountId: saved.bankAccountId,
        type: data.direction === 'OUT' ? 'PAYMENT_OUT' : 'PAYMENT_IN',
        amount: saved.amount,
        currency: saved.currency,
        date: saved.date,
        reference: `${saved.direction === 'OUT' ? 'Pago a' : 'Cobro de'} ${saved.counterpartyName} · ${saved.relatedDocCode || ''}`,
        paymentId: saved.id,
        counterpartyName: saved.counterpartyName
      });
    }

    // Aplicar a la factura/documento relacionado, pasando tasa congelada
    if (saved.relatedDocId) {
      if (saved.direction === 'OUT') {
        purchases.applyPaymentToInvoice(saved.relatedDocId, saved.id, saved.amountInDocCurrency, saved.rateAtPayment, saved.rateTypeAtPayment);
      } else {
        sales.applyPayment(saved.relatedDocId, saved.id, saved.amountInDocCurrency, saved.rateAtPayment, saved.rateTypeAtPayment);
      }
    }

    return saved;
  },

  /** Devuelve los pagos hechos a una factura específica */
  getPaymentsForDoc(direction, docId) {
    return db.query(db.COLLECTIONS.payments, p => p.direction === direction && p.relatedDocId === docId);
  },

  /** Saldo total disponible (suma de cuentas, con conversión a USD) */
  totalBalanceUSD() {
    let total = 0;
    db.getAll(db.COLLECTIONS.bankAccounts).filter(a => a.active).forEach(a => {
      let usd = a.balance || 0;
      if (a.currency === 'VES') {
        const r = currency.getActiveRate();
        usd = r && r.value ? usd / r.value : 0;
      }
      total += usd;
    });
    return total;
  },

  /**
   * Repara cuentas bancarias que tengan saldo duplicado por bug viejo.
   * Recalcula el balance real desde los movimientos.
   * Devuelve cuántas cuentas se repararon.
   */
  recalcAllBalances() {
    let fixed = 0;
    db.getAll(db.COLLECTIONS.bankAccounts).forEach(a => {
      const moves = db.query(db.COLLECTIONS.bankMoves, m => m.accountId === a.id);
      let realBalance = 0;
      // Ordenar por fecha+timestamp y recalcular
      moves.sort((x,y) => (x.timestamp||'').localeCompare(y.timestamp||''));
      moves.forEach(m => {
        const isCredit = ['DEPOSIT','OPENING','TRANSFER_IN','PAYMENT_IN'].includes(m.type);
        const isDebit = ['WITHDRAWAL','TRANSFER_OUT','PAYMENT_OUT','FEE'].includes(m.type);
        const sign = isCredit ? 1 : (isDebit ? -1 : 1);
        realBalance += (parseFloat(m.amount) || 0) * sign;
        m.runningBalance = realBalance;
        db.save(db.COLLECTIONS.bankMoves, m);
      });
      if (Math.abs((a.balance||0) - realBalance) > 0.01) {
        a.balance = realBalance;
        db.save(db.COLLECTIONS.bankAccounts, a);
        fixed++;
      }
    });
    return fixed;
  },

  /**
   * Repara facturas (de venta y compra) cuyo estado no coincide con el pagado real.
   * Recalcula paidAmount sumando los pagos y ajusta status.
   * Devuelve {salesFixed, purchasesFixed}.
   */
  recalcAllInvoiceStatuses() {
    let salesFixed = 0, purchasesFixed = 0;

    // Facturas de venta (salesOrders con type=FACTURA)
    db.getAll(db.COLLECTIONS.salesOrders).filter(d => d.type === 'FACTURA').forEach(doc => {
      if (doc.cancelled) return;
      const pays = db.query(db.COLLECTIONS.payments, p => p.direction === 'IN' && p.relatedDocId === doc.id);
      const realPaid = Math.round(pays.reduce((s,p) => s + (parseFloat(p.amountInDocCurrency)||0), 0) * 100) / 100;
      const realRemaining = Math.round((doc.total - realPaid) * 100) / 100;
      let newStatus;
      if (realRemaining <= 0.01) newStatus = 'PAID';
      else if (realPaid > 0) newStatus = 'PARTIAL';
      else newStatus = 'FACTURA';
      if (Math.abs((doc.paidAmount||0) - realPaid) > 0.01 || doc.status !== newStatus) {
        doc.paidAmount = realPaid;
        doc.paidPercent = doc.total > 0 ? (realPaid / doc.total) * 100 : 0;
        doc.status = newStatus;
        db.save(db.COLLECTIONS.salesOrders, doc);
        salesFixed++;
      }
    });

    // Facturas de compra
    db.getAll(db.COLLECTIONS.supplierInvoices).forEach(inv => {
      if (inv.status === 'CANCELLED') return;
      const pays = db.query(db.COLLECTIONS.payments, p => p.direction === 'OUT' && p.relatedDocId === inv.id);
      const realPaid = Math.round(pays.reduce((s,p) => s + (parseFloat(p.amountInDocCurrency)||0), 0) * 100) / 100;
      const realRemaining = Math.round((inv.totalToPay - realPaid) * 100) / 100;
      let newStatus;
      if (realRemaining <= 0.01) newStatus = 'PAID';
      else if (realPaid > 0) newStatus = 'PARTIAL';
      else newStatus = 'PENDING';
      if (Math.abs((inv.paidAmount||0) - realPaid) > 0.01 || inv.status !== newStatus) {
        inv.paidAmount = realPaid;
        inv.paidPercent = inv.totalToPay > 0 ? (realPaid / inv.totalToPay) * 100 : 0;
        inv.status = newStatus;
        db.save(db.COLLECTIONS.supplierInvoices, inv);
        purchasesFixed++;
      }
    });

    return { salesFixed, purchasesFixed };
  }
};
