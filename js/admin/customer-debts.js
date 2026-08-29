// Lista compartilhada de clientes com débitos (Diário + Clientes)

const CustomerDebts = {
  activeDetailId: null,
  payingSaleId: null,

  formatPhone(phone) {
    if (typeof formatPhoneDisplay === 'function') return formatPhoneDisplay(phone);
    if (typeof formatDiarioPhoneDisplay === 'function') return formatDiarioPhoneDisplay(phone);
    return phone || '—';
  },

  formatMoney(value) {
    if (typeof formatCurrency === 'function') return formatCurrency(value);
    return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    const raw = String(dateStr).slice(0, 10);
    if (typeof parseLocalDate === 'function' && typeof formatDisplayDate === 'function') {
      try {
        return formatDisplayDate(raw);
      } catch (_) { /* fall through */ }
    }
    const [y, m, d] = raw.split('-');
    if (y && m && d) return `${d}/${m}/${y}`;
    return raw;
  },

  async loadList(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<p class="customer-debts-empty">Carregando…</p>';
    this.activeDetailId = null;

    try {
      const data = await DB.getDebtCustomers();
      const customers = data.customers || [];
      if (!customers.length) {
        container.innerHTML = '<p class="customer-debts-empty">Nenhum cliente com débito pendente.</p>';
        return;
      }

      container.innerHTML = customers.map((c) => `
        <div class="card customer-debt-card" data-debt-customer="${c.customer_id}">
          <button type="button" class="customer-debt-card-main" data-open-debt="${c.customer_id}">
            <div class="customer-debt-card-info">
              <strong class="customer-debt-card-name">${escapeHtml(c.name)}</strong>
              <span class="customer-debt-card-phone">${escapeHtml(this.formatPhone(c.phone))}</span>
            </div>
            <strong class="customer-debt-card-pending">${this.formatMoney(c.pending_total)}</strong>
          </button>
          <div class="customer-debt-detail hidden" data-debt-detail="${c.customer_id}"></div>
        </div>
      `).join('');

      if (!container.dataset.debtBound) {
        container.dataset.debtBound = '1';
        container.addEventListener('click', (e) => this.onListClick(e, containerId));
        container.addEventListener('input', (e) => this.onListInput(e));
      }
    } catch (error) {
      if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
      container.innerHTML = `<p class="customer-debts-empty">${escapeHtml(error.message || 'Erro ao carregar débitos.')}</p>`;
    }
  },

  onListInput(e) {
    if (!e.target.matches('[data-debt-pay-input]')) return;
    if (typeof applyDiarioMoneyMask === 'function') {
      applyDiarioMoneyMask(e.target);
    }
  },

  async onListClick(e, containerId) {
    const openBtn = e.target.closest('[data-open-debt]');
    if (openBtn) {
      const id = Number(openBtn.dataset.openDebt);
      await this.toggleDetail(id, containerId);
      return;
    }

    const payBtn = e.target.closest('[data-debt-pay-btn]');
    if (payBtn) {
      const saleId = Number(payBtn.dataset.debtPayBtn);
      const customerId = Number(payBtn.dataset.debtCustomer);
      await this.submitPayment(saleId, customerId, containerId, payBtn);
    }
  },

  async toggleDetail(customerId, containerId) {
    const detail = document.querySelector(`[data-debt-detail="${customerId}"]`);
    if (!detail) return;

    if (this.activeDetailId === customerId && !detail.classList.contains('hidden')) {
      detail.classList.add('hidden');
      detail.innerHTML = '';
      this.activeDetailId = null;
      return;
    }

    document.querySelectorAll('[data-debt-detail]').forEach((el) => {
      el.classList.add('hidden');
      el.innerHTML = '';
    });

    this.activeDetailId = customerId;
    detail.classList.remove('hidden');
    detail.innerHTML = '<p class="customer-debts-empty">Carregando detalhes…</p>';

    try {
      const data = await DB.getCustomerDebts(customerId);
      this.renderDetail(detail, data);
      if (typeof refreshIcons === 'function') refreshIcons();
    } catch (error) {
      if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
      detail.innerHTML = `<p class="customer-debts-empty">${escapeHtml(error.message || 'Erro ao carregar.')}</p>`;
    }
  },

  renderDetail(detailEl, data) {
    const items = data.items || [];
    const customer = data.customer || {};
    if (!items.length) {
      detailEl.innerHTML = '<p class="customer-debts-empty">Nenhum item pendente.</p>';
      return;
    }

    detailEl.innerHTML = `
      <div class="customer-debt-detail-head">
        <span>Total pendente: <strong>${this.formatMoney(customer.pending_total)}</strong></span>
      </div>
      <div class="customer-debt-items">
        ${items.map((item) => this.renderItemRow(item, customer.customer_id)).join('')}
      </div>
    `;
  },

  renderItemRow(item, customerId) {
    const maxPending = Number(item.amount_pending) || 0;
    return `
      <div class="customer-debt-item" data-debt-sale="${item.id}">
        <div class="customer-debt-item-info">
          <strong>${escapeHtml(item.product_name)}</strong>
          <span class="customer-debt-item-meta">
            ${escapeHtml(this.formatDate(item.sale_date))}
            · Qtd ${item.quantity}
            · Total ${this.formatMoney(item.line_total)}
          </span>
          <span class="customer-debt-item-meta">
            Pago ${this.formatMoney(item.amount_paid)}
            · Pendente ${this.formatMoney(item.amount_pending)}
          </span>
        </div>
        <div class="customer-debt-item-pay">
          <label class="daily-diario-cart-field-label">
            <span>Valor pago R$</span>
            <input type="text" inputmode="decimal"
              class="daily-diario-cart-discount"
              value="${typeof formatDiarioMoneyMaskDisplay === 'function' ? formatDiarioMoneyMaskDisplay(maxPending) : maxPending.toFixed(2).replace('.', ',')}"
              data-debt-pay-input="${item.id}"
              data-debt-max="${maxPending}"
              aria-label="Valor a pagar">
          </label>
          <button type="button" class="btn btn-primary btn-sm"
            data-debt-pay-btn="${item.id}"
            data-debt-customer="${customerId}">
            Registrar
          </button>
        </div>
      </div>
    `;
  },

  async submitPayment(saleId, customerId, containerId, btn) {
    const input = document.querySelector(`[data-debt-pay-input="${saleId}"]`);
    const max = Number(input?.dataset.debtMax) || 0;
    let amount = 0;
    if (typeof parseLooseDecimal === 'function') {
      amount = parseLooseDecimal(input?.value, typeof MONEY_DECIMALS === 'number' ? MONEY_DECIMALS : 2) || 0;
    } else {
      amount = Number(String(input?.value || '').replace(',', '.')) || 0;
    }
    amount = Math.round(amount * 100) / 100;

    if (!(amount > 0)) {
      showToast('Informe um valor pago válido.', 'error');
      return;
    }
    if (amount > max + 0.001) {
      showToast('Valor não pode exceder o pendente.', 'error');
      return;
    }

    const run = async () => {
      try {
        await DB.addDebtPayment(saleId, amount);
        showToast('Pagamento registrado.', 'success');
        await this.loadList(containerId);
      } catch (error) {
        if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
        showToast(error.message || 'Erro ao registrar pagamento.', 'error');
      }
    };

    if (typeof withButtonLoading === 'function' && btn) {
      await withButtonLoading(btn, run, '…');
    } else {
      await run();
    }
  }
};
