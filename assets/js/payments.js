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

  /** 
   * Movimiento bancario (kardex de cuenta).
   * Si la moneda del movimiento difiere de la moneda de la cuenta, convierte
   * usando la tasa proporcionada (rate / rateType) o BCV por defecto.
   *
   * @param {object} args
   * @param {string} args.accountId
   * @param {string} args.type - DEPOSIT|OPENING|TRANSFER_IN|PAYMENT_IN|WITHDRAWAL|TRANSFER_OUT|PAYMENT_OUT|FEE|ADJUSTMENT
   * @param {number} args.amount - monto en la moneda especificada por `currency`
   * @param {string} args.currency - moneda del monto (USD, VES, EUR)
   * @param {number} args.rate - tasa de conversión (Bs por unidad de USD/EUR) cuando difiere de la cuenta
   * @param {string} args.rateType - 'BCV_USD'|'BINANCE'|'BCV_EUR'|'P2P_EUR'|'CUSTOM'
   * @param {string} args.date
   * @param {string} args.reference
   * @param {string} args.paymentId
   * @param {string} args.counterpartyName
   */
  registerBankMove({ accountId, type, amount, currency: moveCurrency, rate, rateType, date, reference, paymentId, counterpartyName }) {
    const account = db.getById(db.COLLECTIONS.bankAccounts, accountId);
    if (!account) throw new Error('Cuenta bancaria no encontrada');
    const isCredit = ['DEPOSIT','OPENING','TRANSFER_IN','PAYMENT_IN'].includes(type);
    const isDebit = ['WITHDRAWAL','TRANSFER_OUT','PAYMENT_OUT','FEE'].includes(type);
    const sign = isCredit ? 1 : (isDebit ? -1 : 1);

    const ccy = moveCurrency || account.currency;
    const amt = parseFloat(amount) || 0;

    // === CONVERSIÓN A MONEDA DE LA CUENTA ===
    // Si el movimiento es en una moneda distinta a la cuenta, hay que convertir
    // antes de actualizar el saldo.
    let amountInAccountCcy = amt;
    let conversionApplied = false;
    let usedRate = parseFloat(rate) || 0;
    let usedRateType = rateType || null;

    if (ccy !== account.currency) {
      conversionApplied = true;

      // Si no nos pasaron tasa, usar BCV por defecto
      if (!usedRate || usedRate <= 0) {
        if ((ccy === 'USD' && account.currency === 'VES') || (ccy === 'VES' && account.currency === 'USD')) {
          const r = currency.getRate('BCV_USD');
          usedRate = r?.value || 0;
          usedRateType = 'BCV_USD';
        } else if ((ccy === 'EUR' && account.currency === 'VES') || (ccy === 'VES' && account.currency === 'EUR')) {
          const r = currency.getRate('BCV_EUR');
          usedRate = r?.value || 0;
          usedRateType = 'BCV_EUR';
        }
      }

      if (!usedRate || usedRate <= 0) {
        throw new Error(`No hay tasa de conversión disponible entre ${ccy} y ${account.currency}`);
      }

      // Convertir a moneda de la cuenta usando VES como pivote
      let amtInVES = 0;
      if (ccy === 'VES') amtInVES = amt;
      else if (ccy === 'USD' || ccy === 'EUR') amtInVES = amt * usedRate;

      if (account.currency === 'VES') amountInAccountCcy = amtInVES;
      else if (account.currency === 'USD' || account.currency === 'EUR') {
        amountInAccountCcy = usedRate > 0 ? amtInVES / usedRate : 0;
      }
      amountInAccountCcy = Math.round(amountInAccountCcy * 100) / 100;
    }

    // Actualizar saldo de la cuenta (en SU moneda)
    account.balance = (parseFloat(account.balance) || 0) + (amountInAccountCcy * sign);
    db.save(db.COLLECTIONS.bankAccounts, account);

    const move = {
      accountId,
      accountName: account.name,
      type,
      direction: isCredit ? 'IN' : 'OUT',
      // Monto y moneda original del movimiento (lo que el usuario cobró/pagó)
      amount: amt,
      currency: ccy,
      // Equivalente en moneda de la cuenta (para el saldo)
      amountInAccountCurrency: amountInAccountCcy,
      accountCurrency: account.currency,
      // Datos de conversión si se aplicó
      conversionApplied,
      conversionRate: conversionApplied ? usedRate : null,
      conversionRateType: conversionApplied ? usedRateType : null,
      // Saldo después
      signedAmount: amountInAccountCcy * sign,
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

  /**
   * Transferencia entre dos cuentas bancarias.
   * Si las cuentas tienen monedas distintas, requiere rate (tasa de conversión).
   *
   * @param {object} args
   * @param {string} args.fromAccountId - cuenta origen
   * @param {string} args.toAccountId - cuenta destino
   * @param {number} args.amount - monto en moneda ORIGEN
   * @param {number} args.rate - tasa (solo si monedas distintas). Significa: cuántas unidades de la moneda más débil (VES) equivalen a 1 unidad de la moneda más fuerte (USD/EUR).
   * @param {string} args.rateType - 'BCV_USD' | 'BINANCE' | 'BCV_EUR' | 'P2P_EUR' | 'CUSTOM'
   * @param {string} args.rateLabel - etiqueta para mostrar
   * @param {string} args.date
   * @param {string} args.notes
   */
  transferBetweenAccounts({ fromAccountId, toAccountId, amount, rate, rateType, rateLabel, date, notes }) {
    if (fromAccountId === toAccountId) throw new Error('No podés transferir a la misma cuenta');
    const from = db.getById(db.COLLECTIONS.bankAccounts, fromAccountId);
    const to = db.getById(db.COLLECTIONS.bankAccounts, toAccountId);
    if (!from) throw new Error('Cuenta origen no encontrada');
    if (!to) throw new Error('Cuenta destino no encontrada');
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) throw new Error('El monto debe ser mayor a 0');
    if ((from.balance || 0) < amt - 0.001) {
      throw new Error(`Saldo insuficiente en ${from.name}: ${from.balance} ${from.currency}`);
    }

    const sameCurrency = from.currency === to.currency;
    let amountInDest = amt;

    if (!sameCurrency) {
      const r = parseFloat(rate) || 0;
      if (r <= 0) throw new Error('Para transferencias entre monedas distintas, debés indicar la tasa');

      // Convertir: usar VES como pivote
      // r es la tasa de la moneda fuerte (USD/EUR) en VES (cuántos Bs por 1 USD)
      let amtInVES = 0;
      if (from.currency === 'VES') amtInVES = amt;
      else if (from.currency === 'USD') amtInVES = amt * r;
      else if (from.currency === 'EUR') {
        // Si la tasa pasada es BCV_USD, no aplica para EUR. Asumimos que rate es la del par involucrado.
        // Si es EUR<->VES, r es Bs/EUR
        amtInVES = amt * r;
      }

      if (to.currency === 'VES') amountInDest = amtInVES;
      else if (to.currency === 'USD') amountInDest = r > 0 ? amtInVES / r : 0;
      else if (to.currency === 'EUR') amountInDest = r > 0 ? amtInVES / r : 0;
    }

    amountInDest = Math.round(amountInDest * 100) / 100;
    const transferDate = date || new Date().toISOString().slice(0,10);
    const transferRef = `TRF-${Date.now()}`;
    const noteText = notes ? ` · ${notes}` : '';

    // Movimiento OUT en cuenta origen
    const outMove = this.registerBankMove({
      accountId: fromAccountId,
      type: 'TRANSFER_OUT',
      amount: amt,
      currency: from.currency,
      date: transferDate,
      reference: `Transferencia a ${to.name}${noteText}`,
      counterpartyName: to.name
    });
    // Datos extras de la transferencia para trazabilidad
    outMove.transferRef = transferRef;
    outMove.transferToAccountId = toAccountId;
    outMove.transferToAccountName = to.name;
    if (!sameCurrency) {
      outMove.crossCurrency = true;
      outMove.transferRate = parseFloat(rate);
      outMove.transferRateType = rateType || 'CUSTOM';
      outMove.transferRateLabel = rateLabel || rateType || 'Tasa personalizada';
      outMove.transferAmountInDest = amountInDest;
    }
    db.save(db.COLLECTIONS.bankMoves, outMove);

    // Movimiento IN en cuenta destino
    const inMove = this.registerBankMove({
      accountId: toAccountId,
      type: 'TRANSFER_IN',
      amount: amountInDest,
      currency: to.currency,
      date: transferDate,
      reference: `Transferencia desde ${from.name}${noteText}`,
      counterpartyName: from.name
    });
    inMove.transferRef = transferRef;
    inMove.transferFromAccountId = fromAccountId;
    inMove.transferFromAccountName = from.name;
    if (!sameCurrency) {
      inMove.crossCurrency = true;
      inMove.transferRate = parseFloat(rate);
      inMove.transferRateType = rateType || 'CUSTOM';
      inMove.transferRateLabel = rateLabel || rateType || 'Tasa personalizada';
      inMove.transferAmountInSource = amt;
    }
    db.save(db.COLLECTIONS.bankMoves, inMove);

    return {
      ok: true,
      transferRef,
      from: { account: from, amount: amt, currency: from.currency },
      to: { account: to, amount: amountInDest, currency: to.currency },
      crossCurrency: !sameCurrency,
      rate: !sameCurrency ? parseFloat(rate) : null
    };
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
      // Determinar la tasa adecuada según las monedas involucradas
      // Prioridad: conversionRate (si vino del modal de conversión cruzada)
      //            > rateAtPayment (la tasa congelada del pago)
      //            > BCV (default en registerBankMove)
      const account = db.getById(db.COLLECTIONS.bankAccounts, saved.bankAccountId);
      let moveRate = null;
      let moveRateType = null;

      if (account && account.currency !== saved.currency) {
        // Hay conversión necesaria al saldo de la cuenta
        if (saved.conversionRate && saved.conversionRateType) {
          // Si el usuario eligió una tasa específica para la conversión cruzada
          // y esa conversión coincide con el par moneda-pago/moneda-cuenta, usarla
          moveRate = saved.conversionRate;
          moveRateType = saved.conversionRateType;
        } else if (saved.rateAtPayment) {
          moveRate = saved.rateAtPayment;
          moveRateType = saved.rateTypeAtPayment || 'BCV_USD';
        }
      }

      this.registerBankMove({
        accountId: saved.bankAccountId,
        type: data.direction === 'OUT' ? 'PAYMENT_OUT' : 'PAYMENT_IN',
        amount: saved.amount,
        currency: saved.currency,
        rate: moveRate,
        rateType: moveRateType,
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
        // IMPORTANTE: usar el equivalente en moneda de la cuenta para el saldo
        // En movimientos viejos (antes del fix) puede no existir amountInAccountCurrency,
        // en ese caso asumir que estaban en la moneda de la cuenta
        const amountForBalance = m.amountInAccountCurrency != null
          ? parseFloat(m.amountInAccountCurrency)
          : parseFloat(m.amount) || 0;
        realBalance += amountForBalance * sign;
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
