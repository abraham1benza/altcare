/**
 * commissions.js - Sistema de comisiones a vendedores
 *
 * MODELO DE DATOS:
 * - users (existente): se le agregan campos de comisión:
 *     commissionEnabled (bool), commissionRateSale (%), commissionRateCollection (%),
 *     commissionBase ('SUBTOTAL'|'TOTAL')  ← solo admins lo cambian
 *
 * - commissionEvents: eventos de devengo (1 evento por factura emitida + 1 por cada cobro)
 *     { id, type: 'SALE'|'COLLECTION', userId, userName, salesOrderId, invoiceCode,
 *       baseAmount (USD), rate, amountUSD, currency, date, reversed, paymentId? }
 *
 * - commissionPayments: pagos hechos al vendedor (egresos)
 *     { id, userId, userName, amount, currency, bankAccountId, date, notes,
 *       loanRepaymentId? (si descontó préstamo) }
 *
 * - loans: préstamos a vendedores
 *     { id, userId, userName, amount, currency, originalAmount, balance, date,
 *       bankAccountId, notes, status: 'OPEN'|'PAID', repayments[] }
 *
 * SALDO DEL VENDEDOR:
 *   saldo = comisionesDevengadas - comisionesPagadas - prestamosActivos
 *   Positivo = se le debe; Negativo = él debe
 *
 * Todos los montos internos se almacenan en USD para coherencia multi-moneda.
 * La conversión se hace al momento del evento usando la tasa correspondiente.
 */

const commissions = {

  /** Devuelve la lista de usuarios con comisión habilitada */
  getEligibleUsers() {
    return db.getAll(db.COLLECTIONS.users)
      .filter(u => u.active !== false && u.commissionEnabled === true);
  },

  /** Configuración global con defaults */
  getDefaultConfig() {
    const cfg = db.getById(db.COLLECTIONS.config, 'main') || {};
    return {
      defaultRateSale: parseFloat(cfg.defaultCommissionRateSale) || 5,
      defaultRateCollection: parseFloat(cfg.defaultCommissionRateCollection) || 2,
      defaultBase: cfg.defaultCommissionBase || 'SUBTOTAL'
    };
  },

  /** Obtiene la config efectiva de un vendedor (con fallback al default global) */
  getUserConfig(userId) {
    const user = db.getById(db.COLLECTIONS.users, userId);
    if (!user) return null;
    const def = this.getDefaultConfig();
    return {
      enabled: !!user.commissionEnabled,
      rateSale: parseFloat(user.commissionRateSale) || def.defaultRateSale,
      rateCollection: parseFloat(user.commissionRateCollection) || def.defaultRateCollection,
      base: user.commissionBase || def.defaultBase  // SUBTOTAL | TOTAL
    };
  },

  /**
   * Convierte un monto a USD según la moneda usando la tasa apropiada.
   * Para coherencia interna, todos los eventos de comisión se guardan en USD.
   */
  _toUSD(amount, ccy) {
    if (!amount) return 0;
    if (ccy === 'USD') return amount;
    if (ccy === 'VES') {
      const r = currency.getRate('BCV_USD');
      return r?.value ? amount / r.value : 0;
    }
    if (ccy === 'EUR') {
      const r = currency.getRate('BCV_EUR');
      const rUsd = currency.getRate('BCV_USD');
      if (!r?.value || !rUsd?.value) return 0;
      const inVes = amount * r.value;
      return inVes / rUsd.value;
    }
    return 0;
  },

  // ==========================================================================
  // EVENTOS DE COMISIÓN
  // ==========================================================================

  /**
   * Genera un evento de comisión POR VENTA cuando se emite una factura.
   * Se llama desde sales.js al crear o convertir a FACTURA.
   *
   * @param {object} salesOrder - documento de venta tipo FACTURA
   */
  registerSaleCommission(salesOrder) {
    if (!salesOrder || salesOrder.type !== 'FACTURA') return null;
    if (!salesOrder.salespersonId) return null; // sin vendedor asignado, sin comisión

    const userCfg = this.getUserConfig(salesOrder.salespersonId);
    if (!userCfg || !userCfg.enabled) return null;

    // Verificar que no exista ya un evento de venta para esta factura (idempotencia)
    const existing = db.query(db.COLLECTIONS.commissionEvents, e =>
      e.salesOrderId === salesOrder.id && e.type === 'SALE' && !e.reversed
    );
    if (existing.length > 0) return existing[0];

    // Base de cálculo según config del vendedor
    const baseAmount = userCfg.base === 'TOTAL' ? salesOrder.total : salesOrder.subtotal;
    const baseUSD = this._toUSD(baseAmount, salesOrder.currency);
    const amountUSD = baseUSD * userCfg.rateSale / 100;

    const event = {
      type: 'SALE',
      userId: salesOrder.salespersonId,
      userName: salesOrder.salespersonName || '',
      salesOrderId: salesOrder.id,
      invoiceCode: salesOrder.code,
      invoiceNumber: salesOrder.invoiceNumber || '',
      customerId: salesOrder.customerId,
      customerName: salesOrder.customerName,
      // Datos del cálculo
      baseLabel: userCfg.base,
      baseAmount: baseAmount,                    // en moneda de la factura
      baseAmountUSD: Math.round(baseUSD * 100) / 100,
      rate: userCfg.rateSale,
      amountUSD: Math.round(amountUSD * 100) / 100,  // comisión en USD
      currency: salesOrder.currency,
      date: salesOrder.issueDate || new Date().toISOString().slice(0,10),
      reversed: false,
      createdAt: new Date().toISOString()
    };

    return db.save(db.COLLECTIONS.commissionEvents, event);
  },

  /**
   * Genera un evento de comisión POR COBRANZA cuando se registra un pago.
   * Se llama desde payments.js al crear un pago tipo IN.
   *
   * @param {object} payment - documento de pago
   * @param {object} salesOrder - factura asociada
   */
  registerCollectionCommission(payment, salesOrder) {
    if (!payment || payment.direction !== 'IN') return null;
    if (!salesOrder || salesOrder.type !== 'FACTURA') return null;
    if (!salesOrder.salespersonId) return null;

    const userCfg = this.getUserConfig(salesOrder.salespersonId);
    if (!userCfg || !userCfg.enabled) return null;

    // El monto del pago se calcula sobre la moneda de la factura
    // Si el pago vino en otra moneda, ya está convertido a la de la factura
    // (campo amountInDocCurrency o appliedToInvoice)
    const paidAmount = parseFloat(payment.amountInDocCurrency || payment.appliedToInvoice || payment.amount) || 0;

    // Base: aplicar el % al monto cobrado, ajustando por la base del vendedor
    // Si el vendedor cobra sobre SUBTOTAL, "extraemos" el subtotal proporcional del pago
    let baseAmount = paidAmount;
    if (userCfg.base === 'SUBTOTAL' && salesOrder.total > 0) {
      // proporción que representa el subtotal sobre el total
      const subtotalRatio = salesOrder.subtotal / salesOrder.total;
      baseAmount = paidAmount * subtotalRatio;
    }

    const baseUSD = this._toUSD(baseAmount, salesOrder.currency);
    const amountUSD = baseUSD * userCfg.rateCollection / 100;

    const event = {
      type: 'COLLECTION',
      userId: salesOrder.salespersonId,
      userName: salesOrder.salespersonName || '',
      salesOrderId: salesOrder.id,
      invoiceCode: salesOrder.code,
      invoiceNumber: salesOrder.invoiceNumber || '',
      customerId: salesOrder.customerId,
      customerName: salesOrder.customerName,
      paymentId: payment.id,
      paymentCode: payment.code,
      // Datos del cálculo
      baseLabel: userCfg.base,
      baseAmount: Math.round(baseAmount * 100) / 100,
      baseAmountUSD: Math.round(baseUSD * 100) / 100,
      rate: userCfg.rateCollection,
      amountUSD: Math.round(amountUSD * 100) / 100,
      currency: salesOrder.currency,
      date: payment.date || new Date().toISOString().slice(0,10),
      reversed: false,
      createdAt: new Date().toISOString()
    };

    return db.save(db.COLLECTIONS.commissionEvents, event);
  },

  /**
   * Reversa todos los eventos de comisión asociados a una factura.
   * Se llama cuando la factura se anula.
   */
  reverseCommissionsForInvoice(salesOrderId, reason) {
    const events = db.query(db.COLLECTIONS.commissionEvents, e =>
      e.salesOrderId === salesOrderId && !e.reversed
    );
    events.forEach(e => {
      e.reversed = true;
      e.reversalReason = reason || 'Factura anulada';
      e.reversedAt = new Date().toISOString();
      db.save(db.COLLECTIONS.commissionEvents, e);
    });
    return events.length;
  },

  /**
   * Reversa SOLO el evento de comisión de un pago específico (cuando se anula un pago).
   */
  reverseCommissionForPayment(paymentId, reason) {
    const events = db.query(db.COLLECTIONS.commissionEvents, e =>
      e.paymentId === paymentId && e.type === 'COLLECTION' && !e.reversed
    );
    events.forEach(e => {
      e.reversed = true;
      e.reversalReason = reason || 'Pago anulado';
      e.reversedAt = new Date().toISOString();
      db.save(db.COLLECTIONS.commissionEvents, e);
    });
    return events.length;
  },

  // ==========================================================================
  // RESUMEN POR VENDEDOR
  // ==========================================================================

  /**
   * Devuelve el resumen completo de un vendedor:
   * ventas (total/semana/mes), comisiones (venta/cobranza/total), pagado, préstamos, saldo.
   * Todos los montos en USD para coherencia.
   */
  getUserSummary(userId) {
    const user = db.getById(db.COLLECTIONS.users, userId);
    if (!user) return null;

    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
    const monthAgo = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);

    // VENTAS realizadas por este vendedor (facturas no anuladas)
    const myInvoices = db.query(db.COLLECTIONS.salesOrders, d =>
      d.salespersonId === userId && d.type === 'FACTURA' && !d.cancelled
    );
    const totalSold = myInvoices.reduce((s, d) => s + this._toUSD(d.total, d.currency), 0);
    const weekSold = myInvoices.filter(d => (d.issueDate||'') >= weekAgo)
      .reduce((s, d) => s + this._toUSD(d.total, d.currency), 0);
    const monthSold = myInvoices.filter(d => (d.issueDate||'') >= monthAgo)
      .reduce((s, d) => s + this._toUSD(d.total, d.currency), 0);

    // Cobrado total
    const totalCollected = myInvoices.reduce((s, d) =>
      s + this._toUSD(d.paidAmount || 0, d.currency), 0);

    // EVENTOS DE COMISIÓN (no reversados)
    const events = db.query(db.COLLECTIONS.commissionEvents, e =>
      e.userId === userId && !e.reversed
    );
    const saleEvents = events.filter(e => e.type === 'SALE');
    const collectionEvents = events.filter(e => e.type === 'COLLECTION');

    const commissionSale = saleEvents.reduce((s, e) => s + (e.amountUSD || 0), 0);
    const commissionCollection = collectionEvents.reduce((s, e) => s + (e.amountUSD || 0), 0);
    const totalCommission = commissionSale + commissionCollection;

    // PAGOS al vendedor (todos en USD para coherencia)
    const myPayments = db.query(db.COLLECTIONS.commissionPayments, p => p.userId === userId);
    const totalPaid = myPayments.reduce((s, p) => s + this._toUSD(p.amount, p.currency), 0);

    // PRÉSTAMOS activos (saldo en USD)
    const myLoans = db.query(db.COLLECTIONS.loans, l => l.userId === userId && l.status === 'OPEN');
    const loansBalance = myLoans.reduce((s, l) => s + this._toUSD(l.balance, l.currency), 0);

    // SALDO NETO
    // Positivo = se le debe al vendedor
    // Negativo = el vendedor debe a la empresa
    const netBalance = totalCommission - totalPaid - loansBalance;

    return {
      userId,
      user,
      // Ventas
      totalSold: Math.round(totalSold * 100) / 100,
      weekSold: Math.round(weekSold * 100) / 100,
      monthSold: Math.round(monthSold * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      invoiceCount: myInvoices.length,
      // Comisiones
      commissionSale: Math.round(commissionSale * 100) / 100,
      commissionCollection: Math.round(commissionCollection * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      saleEventsCount: saleEvents.length,
      collectionEventsCount: collectionEvents.length,
      // Pagos
      totalPaid: Math.round(totalPaid * 100) / 100,
      paymentsCount: myPayments.length,
      // Préstamos
      loansBalance: Math.round(loansBalance * 100) / 100,
      activeLoansCount: myLoans.length,
      // Saldo neto (USD)
      netBalance: Math.round(netBalance * 100) / 100,
      // Config del vendedor
      config: this.getUserConfig(userId)
    };
  },

  /** Resumen de todos los vendedores activos con comisión */
  getAllSummaries() {
    return this.getEligibleUsers().map(u => this.getUserSummary(u.id)).filter(Boolean);
  },

  // ==========================================================================
  // PAGOS A VENDEDORES
  // ==========================================================================

  /**
   * Registra un pago de comisión al vendedor.
   * Sale plata de la cuenta bancaria seleccionada.
   *
   * @param {object} args
   * @param {string} args.userId
   * @param {number} args.amount - monto en la moneda de la cuenta bancaria
   * @param {string} args.currency
   * @param {string} args.bankAccountId
   * @param {string} args.date
   * @param {string} args.notes
   * @param {string} args.loanIdToRepay - opcional: si parte del pago es para descontar de un préstamo
   * @param {number} args.loanRepayAmount - monto a descontar del préstamo
   */
  payCommission(args) {
    const user = db.getById(db.COLLECTIONS.users, args.userId);
    if (!user) throw new Error('Vendedor no encontrado');

    const amount = parseFloat(args.amount) || 0;
    if (amount <= 0) throw new Error('El monto debe ser mayor a 0');
    if (!args.bankAccountId) throw new Error('Selecciona una cuenta bancaria');

    const account = db.getById(db.COLLECTIONS.bankAccounts, args.bankAccountId);
    if (!account) throw new Error('Cuenta bancaria no encontrada');

    const ccy = args.currency || account.currency;

    // Crear el registro de pago
    const payment = {
      userId: user.id,
      userName: user.fullName || user.username,
      amount,
      currency: ccy,
      bankAccountId: args.bankAccountId,
      bankAccountName: account.name,
      date: args.date || new Date().toISOString().slice(0,10),
      notes: args.notes || '',
      loanRepaymentId: args.loanIdToRepay || null,
      loanRepayAmount: parseFloat(args.loanRepayAmount) || 0,
      createdAt: new Date().toISOString(),
      createdBy: window.auth?.currentUser()?.email || 'sistema'
    };
    const saved = db.save(db.COLLECTIONS.commissionPayments, payment);

    // Movimiento bancario (sale plata)
    if (typeof payments !== 'undefined' && payments.registerBankMove) {
      payments.registerBankMove({
        accountId: args.bankAccountId,
        type: 'WITHDRAWAL',
        amount,
        currency: ccy,
        date: saved.date,
        reference: `Pago de comisión a ${saved.userName}${saved.notes?` · ${saved.notes}`:''}`,
        counterpartyName: saved.userName
      });
    }

    // Si parte del pago descuenta un préstamo
    if (saved.loanRepaymentId && saved.loanRepayAmount > 0) {
      const loan = db.getById(db.COLLECTIONS.loans, saved.loanRepaymentId);
      if (loan && loan.status === 'OPEN') {
        const repayInLoanCcy = saved.loanRepayAmount;  // asumimos misma moneda
        loan.balance = Math.max(0, (loan.balance || 0) - repayInLoanCcy);
        loan.repayments = loan.repayments || [];
        loan.repayments.push({
          paymentId: saved.id,
          date: saved.date,
          amount: repayInLoanCcy,
          currency: loan.currency
        });
        if (loan.balance < 0.01) {
          loan.status = 'PAID';
          loan.paidAt = new Date().toISOString();
        }
        db.save(db.COLLECTIONS.loans, loan);
      }
    }

    return saved;
  },

  /** Anula un pago de comisión: reversa el movimiento bancario y suma préstamo si descontó */
  cancelCommissionPayment(paymentId, reason) {
    const p = db.getById(db.COLLECTIONS.commissionPayments, paymentId);
    if (!p) throw new Error('Pago no encontrado');
    if (p.cancelled) throw new Error('El pago ya está anulado');

    // Reversa movimiento bancario
    if (typeof payments !== 'undefined' && payments.registerBankMove) {
      payments.registerBankMove({
        accountId: p.bankAccountId,
        type: 'DEPOSIT',
        amount: p.amount,
        currency: p.currency,
        date: new Date().toISOString().slice(0,10),
        reference: `Reversa pago comisión ${p.userName} (${reason||'anulado'})`,
        counterpartyName: p.userName
      });
    }

    // Si descontó préstamo, devolver al saldo del préstamo
    if (p.loanRepaymentId && p.loanRepayAmount > 0) {
      const loan = db.getById(db.COLLECTIONS.loans, p.loanRepaymentId);
      if (loan) {
        loan.balance = (loan.balance || 0) + p.loanRepayAmount;
        loan.status = 'OPEN';
        loan.repayments = (loan.repayments || []).filter(r => r.paymentId !== p.id);
        db.save(db.COLLECTIONS.loans, loan);
      }
    }

    p.cancelled = true;
    p.cancellationReason = reason || '';
    p.cancelledAt = new Date().toISOString();
    return db.save(db.COLLECTIONS.commissionPayments, p);
  },

  // ==========================================================================
  // PRÉSTAMOS
  // ==========================================================================

  /**
   * Otorga un préstamo a un vendedor. Sale plata de cuenta bancaria.
   */
  giveLoan(args) {
    const user = db.getById(db.COLLECTIONS.users, args.userId);
    if (!user) throw new Error('Vendedor no encontrado');

    const amount = parseFloat(args.amount) || 0;
    if (amount <= 0) throw new Error('El monto debe ser mayor a 0');
    if (!args.bankAccountId) throw new Error('Selecciona una cuenta bancaria');

    const account = db.getById(db.COLLECTIONS.bankAccounts, args.bankAccountId);
    if (!account) throw new Error('Cuenta bancaria no encontrada');

    const ccy = args.currency || account.currency;

    const loan = {
      userId: user.id,
      userName: user.fullName || user.username,
      amount,
      originalAmount: amount,
      balance: amount,
      currency: ccy,
      bankAccountId: args.bankAccountId,
      bankAccountName: account.name,
      date: args.date || new Date().toISOString().slice(0,10),
      notes: args.notes || '',
      status: 'OPEN',
      repayments: [],
      createdAt: new Date().toISOString(),
      createdBy: window.auth?.currentUser()?.email || 'sistema'
    };
    const saved = db.save(db.COLLECTIONS.loans, loan);

    // Movimiento bancario: sale plata
    if (typeof payments !== 'undefined' && payments.registerBankMove) {
      payments.registerBankMove({
        accountId: args.bankAccountId,
        type: 'WITHDRAWAL',
        amount,
        currency: ccy,
        date: saved.date,
        reference: `Préstamo a ${saved.userName}${saved.notes?` · ${saved.notes}`:''}`,
        counterpartyName: saved.userName
      });
    }

    return saved;
  },

  /** Anula un préstamo: vuelve la plata a la cuenta */
  cancelLoan(loanId, reason) {
    const loan = db.getById(db.COLLECTIONS.loans, loanId);
    if (!loan) throw new Error('Préstamo no encontrado');
    if (loan.status === 'CANCELLED') throw new Error('Ya está anulado');

    // Solo se puede anular si no se pagó nada del préstamo
    if ((loan.repayments || []).length > 0) {
      throw new Error('No se puede anular un préstamo con pagos parciales. Primero anula los pagos asociados.');
    }

    // Reversa movimiento bancario
    if (typeof payments !== 'undefined' && payments.registerBankMove) {
      payments.registerBankMove({
        accountId: loan.bankAccountId,
        type: 'DEPOSIT',
        amount: loan.amount,
        currency: loan.currency,
        date: new Date().toISOString().slice(0,10),
        reference: `Reversa préstamo ${loan.userName} (${reason||'anulado'})`,
        counterpartyName: loan.userName
      });
    }

    loan.status = 'CANCELLED';
    loan.balance = 0;
    loan.cancellationReason = reason || '';
    loan.cancelledAt = new Date().toISOString();
    return db.save(db.COLLECTIONS.loans, loan);
  }
};
