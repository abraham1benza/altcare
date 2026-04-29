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
      type: type || 'Corriente',     // Corriente, Ahorro, USD, Custodia, etc.
      openingBalance: parseFloat(openingBalance) || 0,
      balance: parseFloat(openingBalance) || 0,
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
    const payment = {
      code,
      direction: data.direction,
      counterpartyId: data.counterpartyId,
      counterpartyName: data.counterpartyName,
      relatedDocId: data.relatedDocId,
      relatedDocCode: data.relatedDocCode,
      amount: parseFloat(data.amount) || 0,
      currency: data.currency,
      docCurrency: data.docCurrency,
      amountInDocCurrency: parseFloat(data.amountInDocCurrency) || parseFloat(data.amount) || 0,
      rateUsed: parseFloat(data.rateUsed) || null,
      paymentMethodId: data.paymentMethodId,
      paymentMethodName: data.paymentMethodName,
      bankAccountId: data.bankAccountId || null,
      reference: data.reference || '',
      date: data.date || new Date().toISOString().slice(0,10),
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

    // Aplicar a la factura/documento relacionado
    if (saved.relatedDocId) {
      if (saved.direction === 'OUT') {
        // Pago a proveedor → factura proveedor
        purchases.applyPaymentToInvoice(saved.relatedDocId, saved.id, saved.amountInDocCurrency);
      } else {
        // Cobro de cliente → doc venta
        sales.applyPayment(saved.relatedDocId, saved.id, saved.amountInDocCurrency);
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
  }
};
