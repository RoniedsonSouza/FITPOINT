// Módulo Vendas do dia + Diário

let dailySalesSelectedDate = null;
let dailySalesProductsCache = [];
let dailySalesCustomersCache = [];
let diarioCart = [];
let diarioSelectedCustomer = null;
let diarioAccessValue = 27;
let diarioComboboxesBound = false;
let diarioSearchTimers = { product: null, customer: null };

function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shiftDailySalesDate(days) {
  const current = parseLocalDate(dailySalesSelectedDate || getLocalDateString());
  current.setDate(current.getDate() + days);
  dailySalesSelectedDate = getLocalDateString(current);
  const input = document.getElementById('daily-sales-date');
  if (input) input.value = dailySalesSelectedDate;
  loadDailySales();
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

function formatSaleTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDisplayDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function getProductBasePrice(product) {
  const promo = product.promo_price != null && product.promo_price !== '' ? Number(product.promo_price) : null;
  if (promo != null && !Number.isNaN(promo) && promo > 0) return promo;
  return Number(product.price) || 0;
}

function computeDiarioFinalPrice(basePrice, discount) {
  const base = Number(basePrice) || 0;
  const disc = Math.max(0, Number(discount) || 0);
  return Math.max(0, Math.round((base - disc) * 100) / 100);
}

function computeDiarioLineTotal(line) {
  const unit = computeDiarioFinalPrice(line.basePrice, line.discount);
  const qty = Math.max(1, Number(line.quantity) || 1);
  return Math.round(unit * qty * 100) / 100;
}

function getDiarioLinePreview(line, rawQty, rawDiscount) {
  const preview = { ...line };
  const parsedQty = parseLooseInt(rawQty);
  const parsedDisc = parseLooseDecimal(rawDiscount, MONEY_DECIMALS);
  if (parsedQty != null && parsedQty >= 1) preview.quantity = parsedQty;
  if (parsedDisc != null && parsedDisc >= 0) {
    preview.discount = Math.min(parsedDisc, preview.basePrice);
  }
  return preview;
}

function updateDiarioCartRowTotal(productId) {
  const row = Array.from(document.querySelectorAll('[data-cart-product]'))
    .find(el => el.dataset.cartProduct === productId);
  const line = diarioCart.find(l => l.productId === productId);
  if (!row || !line) return;

  const qtyInput = row.querySelector('[data-cart-qty]');
  const discInput = row.querySelector('[data-cart-discount]');
  const preview = getDiarioLinePreview(
    line,
    qtyInput?.value,
    discInput?.value
  );
  const totalEl = row.querySelector('.daily-diario-cart-total strong');
  if (totalEl) totalEl.textContent = formatCurrency(computeDiarioLineTotal(preview));
}

function normalizeSearchText(text) {
  return String(text || '').trim().toLowerCase();
}

function updateDailySalesSummary(summary) {
  const itemsEl = document.getElementById('daily-sales-stat-items');
  const revenueEl = document.getElementById('daily-sales-stat-revenue');
  const topEl = document.getElementById('daily-sales-stat-top');
  if (itemsEl) itemsEl.textContent = String(summary?.total_items ?? 0);
  if (revenueEl) revenueEl.textContent = formatCurrency(summary?.total_revenue ?? 0);
  if (topEl) topEl.textContent = summary?.top_product || '—';
}

async function fetchDailySalesCatalog() {
  const [products, loyaltyData] = await Promise.all([
    DB.getProducts().catch(() => []),
    DB.getLoyaltyCustomers({ page: 1, limit: 200 }).catch(() => ({ items: [] }))
  ]);
  dailySalesProductsCache = (products || []).filter(p => p.active !== false);
  dailySalesCustomersCache = loyaltyData.items || loyaltyData || [];
}

function filterDiarioProducts(query) {
  const q = normalizeSearchText(query);
  if (!q) return dailySalesProductsCache.slice(0, 12);
  return dailySalesProductsCache.filter(p => {
    const name = normalizeSearchText(p.name);
    const id = normalizeSearchText(p.id);
    return name.includes(q) || id.includes(q);
  }).slice(0, 12);
}

function filterDiarioCustomers(query) {
  const q = normalizeSearchText(query);
  const digits = q.replace(/\D/g, '');
  if (!q) return dailySalesCustomersCache.slice(0, 12);
  return dailySalesCustomersCache.filter(c => {
    const name = normalizeSearchText(c.name);
    const phone = String(c.phone || '').replace(/\D/g, '');
    return name.includes(q) || (digits && phone.includes(digits));
  }).slice(0, 12);
}

function hideDiarioResults(type) {
  const el = document.getElementById(type === 'product' ? 'daily-diario-product-results' : 'daily-diario-customer-results');
  if (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
}

function showDiarioProductResults(query) {
  const container = document.getElementById('daily-diario-product-results');
  if (!container) return;
  const matches = filterDiarioProducts(query);
  if (matches.length === 0) {
    container.innerHTML = '<p class="diario-combobox-empty">Nenhum produto encontrado.</p>';
  } else {
    container.innerHTML = matches.map(p => {
      const base = getProductBasePrice(p);
      return `<button type="button" class="diario-combobox-result-item" data-product-id="${escapeAttr(p.id)}">
        <span class="diario-combobox-result-name">${escapeHtml(p.name)}</span>
        <span class="diario-combobox-result-meta">${formatCurrency(base)}</span>
      </button>`;
    }).join('');
  }
  container.classList.remove('hidden');
}

function showDiarioCustomerResults(query) {
  const container = document.getElementById('daily-diario-customer-results');
  if (!container) return;
  const matches = filterDiarioCustomers(query);
  if (matches.length === 0) {
    container.innerHTML = '<p class="diario-combobox-empty">Nenhum cliente encontrado.</p>';
  } else {
    container.innerHTML = matches.map(c =>
      `<button type="button" class="diario-combobox-result-item" data-customer-id="${c.id}">
        <span class="diario-combobox-result-name">${escapeHtml(c.name)}</span>
      </button>`
    ).join('');
  }
  container.classList.remove('hidden');
}

function selectDiarioCustomer(customer) {
  diarioSelectedCustomer = { id: customer.id, name: customer.name };
  const search = document.getElementById('daily-diario-customer-search');
  const selected = document.getElementById('daily-diario-customer-selected');
  if (search) {
    search.value = '';
    search.classList.add('hidden');
  }
  if (selected) {
    selected.classList.remove('hidden');
    selected.innerHTML = `
      <span class="diario-combobox-selected-name">${escapeHtml(customer.name)}</span>
      <button type="button" class="diario-combobox-clear" data-clear-customer aria-label="Remover cliente">&times;</button>
    `;
  }
  hideDiarioResults('customer');
  updateDiarioLoyaltyUI();
}

function clearDiarioCustomer() {
  diarioSelectedCustomer = null;
  const search = document.getElementById('daily-diario-customer-search');
  const selected = document.getElementById('daily-diario-customer-selected');
  if (search) {
    search.classList.remove('hidden');
    search.value = '';
    search.focus();
  }
  if (selected) {
    selected.classList.add('hidden');
    selected.innerHTML = '';
  }
  updateDiarioLoyaltyUI();
}

function addProductToDiarioCart(productId) {
  const product = dailySalesProductsCache.find(p => p.id === productId);
  if (!product) return;

  const existing = diarioCart.find(line => line.productId === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    diarioCart.push({
      productId: product.id,
      name: product.name,
      basePrice: getProductBasePrice(product),
      quantity: 1,
      discount: 0
    });
  }

  const search = document.getElementById('daily-diario-product-search');
  if (search) search.value = '';
  hideDiarioResults('product');
  renderDiarioCart();
  updateDiarioLoyaltyUI();
}

function removeFromDiarioCart(productId) {
  diarioCart = diarioCart.filter(line => line.productId !== productId);
  renderDiarioCart();
  updateDiarioLoyaltyUI();
}

function computeDiarioSaleTotal() {
  return diarioCart.reduce((sum, line) => sum + computeDiarioLineTotal(line), 0);
}

function computeDiarioLoyaltyVisits() {
  const total = computeDiarioSaleTotal();
  const access = diarioAccessValue > 0 ? diarioAccessValue : 27;
  if (total <= 0 || access <= 0) return 0;
  return Math.floor(total / access);
}

function updateDiarioLoyaltyUI() {
  const wrap = document.getElementById('daily-diario-loyalty-wrap');
  const info = document.getElementById('daily-diario-loyalty-info');
  if (!wrap || !info) return;

  const hasCustomer = Boolean(diarioSelectedCustomer);
  const hasItems = diarioCart.length > 0;

  if (!hasCustomer || !hasItems) {
    wrap.classList.add('hidden');
    info.textContent = '';
    return;
  }

  wrap.classList.remove('hidden');
  const total = computeDiarioSaleTotal();
  const visits = computeDiarioLoyaltyVisits();
  const access = diarioAccessValue > 0 ? diarioAccessValue : 27;

  if (visits > 0) {
    const visitLabel = visits === 1 ? 'visita será contada' : 'visitas serão contadas';
    info.textContent = `${visits} ${visitLabel} (${formatCurrency(total)} ÷ ${formatCurrency(access)})`;
  } else {
    info.textContent = `Valor abaixo do acesso — fidelidade não contabilizada (${formatCurrency(total)} de ${formatCurrency(access)})`;
  }
}

function renderDiarioCart() {
  const container = document.getElementById('daily-diario-cart');
  if (!container) return;

  if (diarioCart.length === 0) {
    container.innerHTML = '<p class="daily-diario-cart-empty">Nenhum produto adicionado.</p>';
    return;
  }

  container.innerHTML = diarioCart.map(line => {
    const lineTotal = computeDiarioLineTotal(line);
    return `
      <div class="daily-diario-cart-row" data-cart-product="${escapeAttr(line.productId)}">
        <div class="daily-diario-cart-row-name">
          <span class="daily-diario-cart-title">${escapeHtml(line.name)}</span>
          <span class="daily-diario-cart-base">Base: ${formatCurrency(line.basePrice)}</span>
        </div>
        <div class="daily-diario-cart-row-fields">
          <label class="daily-diario-cart-field">
            <span>Qtd</span>
            <input type="number" min="1" step="1" value="${line.quantity}" data-cart-qty inputmode="numeric">
          </label>
          <label class="daily-diario-cart-field">
            <span>Desc. R$</span>
            <input type="number" min="0" step="0.01" value="${formatDecimalInput(line.discount, MONEY_DECIMALS)}" data-cart-discount inputmode="decimal">
          </label>
          <div class="daily-diario-cart-total">
            <span>Total</span>
            <strong>${formatCurrency(lineTotal)}</strong>
          </div>
          <button type="button" class="btn btn-danger btn-sm btn-icon daily-diario-cart-remove" data-remove-product="${escapeAttr(line.productId)}" title="Remover" aria-label="Remover produto">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
  refreshIcons();
}

function onDiarioCartClick(e) {
  const removeBtn = e.target.closest('[data-remove-product]');
  if (removeBtn) {
    removeFromDiarioCart(removeBtn.dataset.removeProduct);
    return;
  }
  const clearCustomer = e.target.closest('[data-clear-customer]');
  if (clearCustomer) {
    clearDiarioCustomer();
  }
}

function onDiarioCartInput(e) {
  const row = e.target.closest('[data-cart-product]');
  if (!row) return;
  const productId = row.dataset.cartProduct;
  const line = diarioCart.find(l => l.productId === productId);
  if (!line) return;

  if (e.target.matches('[data-cart-qty]')) {
    const parsed = parseLooseInt(e.target.value);
    if (parsed != null && parsed >= 1) line.quantity = parsed;
    updateDiarioCartRowTotal(productId);
    updateDiarioLoyaltyUI();
    return;
  }

  if (e.target.matches('[data-cart-discount]')) {
    const restricted = restrictDecimalString(e.target.value, MONEY_DECIMALS);
    if (e.target.value !== restricted) e.target.value = restricted;
    const parsed = parseLooseDecimal(restricted, MONEY_DECIMALS);
    if (parsed != null && parsed >= 0) {
      line.discount = Math.min(parsed, line.basePrice);
    }
    updateDiarioCartRowTotal(productId);
    updateDiarioLoyaltyUI();
  }
}

function onDiarioCartBlur(e) {
  const row = e.target.closest('[data-cart-product]');
  if (!row) return;
  const productId = row.dataset.cartProduct;
  const line = diarioCart.find(l => l.productId === productId);
  if (!line) return;

  if (e.target.matches('[data-cart-qty]')) {
    line.quantity = clampInt(parseLooseInt(e.target.value), 1, 1);
    e.target.value = String(line.quantity);
    updateDiarioCartRowTotal(productId);
    updateDiarioLoyaltyUI();
    return;
  }

  if (e.target.matches('[data-cart-discount]')) {
    line.discount = clampDecimal(
      parseLooseDecimal(e.target.value, MONEY_DECIMALS),
      0,
      line.basePrice,
      0,
      MONEY_DECIMALS
    );
    e.target.value = formatDecimalInput(line.discount, MONEY_DECIMALS);
    updateDiarioCartRowTotal(productId);
    updateDiarioLoyaltyUI();
  }
}

function onDiarioProductResultsClick(e) {
  const btn = e.target.closest('[data-product-id]');
  if (!btn) return;
  addProductToDiarioCart(btn.dataset.productId);
}

function onDiarioCustomerResultsClick(e) {
  const btn = e.target.closest('[data-customer-id]');
  if (!btn) return;
  const customer = dailySalesCustomersCache.find(c => String(c.id) === String(btn.dataset.customerId));
  if (customer) selectDiarioCustomer(customer);
}

function initDiarioComboboxes() {
  if (diarioComboboxesBound) return;
  diarioComboboxesBound = true;

  const productSearch = document.getElementById('daily-diario-product-search');
  const customerSearch = document.getElementById('daily-diario-customer-search');
  const cart = document.getElementById('daily-diario-cart');
  const productResults = document.getElementById('daily-diario-product-results');
  const customerResults = document.getElementById('daily-diario-customer-results');
  const customerSelected = document.getElementById('daily-diario-customer-selected');

  if (productSearch) {
    productSearch.addEventListener('input', () => {
      clearTimeout(diarioSearchTimers.product);
      diarioSearchTimers.product = setTimeout(() => {
        const q = productSearch.value.trim();
        if (!q) {
          hideDiarioResults('product');
          return;
        }
        showDiarioProductResults(q);
      }, 200);
    });
    productSearch.addEventListener('focus', () => {
      const q = productSearch.value.trim();
      if (q) showDiarioProductResults(q);
    });
  }

  if (customerSearch) {
    customerSearch.addEventListener('input', () => {
      clearTimeout(diarioSearchTimers.customer);
      diarioSearchTimers.customer = setTimeout(() => {
        const q = customerSearch.value.trim();
        if (!q) {
          hideDiarioResults('customer');
          return;
        }
        showDiarioCustomerResults(q);
      }, 200);
    });
    customerSearch.addEventListener('focus', () => {
      const q = customerSearch.value.trim();
      if (q) showDiarioCustomerResults(q);
    });
  }

  if (productResults) productResults.addEventListener('click', onDiarioProductResultsClick);
  if (customerResults) customerResults.addEventListener('click', onDiarioCustomerResultsClick);
  if (customerSelected) customerSelected.addEventListener('click', onDiarioCartClick);
  if (cart) {
    cart.addEventListener('click', onDiarioCartClick);
    cart.addEventListener('input', onDiarioCartInput);
    cart.addEventListener('blur', onDiarioCartBlur, true);
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#diario-product-combobox')) hideDiarioResults('product');
    if (!e.target.closest('#diario-customer-combobox')) hideDiarioResults('customer');
  });
}

function renderDailyDiarioDayStats(summary) {
  const statsEl = document.getElementById('daily-diario-day-stats');
  if (!statsEl) return;

  const dateLabel = formatDisplayDate(getLocalDateString());
  const totalItems = summary?.total_items ?? 0;
  const totalRevenue = summary?.total_revenue ?? 0;
  const itemsLabel = totalItems === 1 ? '1 item' : `${totalItems} itens`;
  statsEl.textContent = `${dateLabel} · ${itemsLabel} · ${formatCurrency(totalRevenue)} total`;
}

function renderDailyDiarioList(items, summary) {
  const listEl = document.getElementById('daily-diario-list');
  if (!listEl) return;

  renderDailyDiarioDayStats(summary);

  if (!items || items.length === 0) {
    listEl.innerHTML = '<p class="daily-diario-list-empty">Nenhuma venda hoje.</p>';
    return;
  }

  listEl.innerHTML = items.map(item => {
    const qtySuffix = item.quantity > 1 ? ` × ${item.quantity}` : '';
    const unitLine = `${formatCurrency(item.unit_price)} un.${qtySuffix}`;
    const customerBadge = item.customer_name
      ? `<span class="daily-diario-sale-badge daily-diario-sale-badge--customer">
          <i data-lucide="user" aria-hidden="true"></i>
          ${escapeHtml(item.customer_name)}
        </span>`
      : '';
    const loyaltyBadge = item.loyalty_customer_id
      ? `<span class="daily-diario-sale-badge daily-diario-sale-badge--loyalty">
          <i data-lucide="gift" aria-hidden="true"></i>
          Fidelidade
        </span>`
      : '';

    return `
      <div class="card daily-diario-sale-card">
        <div class="daily-diario-sale-main">
          <div class="daily-diario-sale-head">
            <p class="daily-diario-sale-title">${escapeHtml(item.product_name)}</p>
            <span class="daily-diario-sale-price">${formatCurrency(item.line_total)}</span>
          </div>
          <p class="daily-diario-sale-unit">${unitLine}</p>
          <div class="daily-diario-sale-meta">
            <span class="daily-diario-sale-meta-item">
              <i data-lucide="clock" aria-hidden="true"></i>
              ${formatSaleTime(item.created_at)}
            </span>
            ${customerBadge}
            ${loyaltyBadge}
          </div>
        </div>
      </div>
    `;
  }).join('');

  refreshIcons();
}

async function loadDailyDiarioList() {
  try {
    const data = await DB.getDailySales(getLocalDateString());
    renderDailyDiarioList(data.items || [], data.summary);
  } catch (error) {
    if (handleAuthError(error)) return;
    renderDailyDiarioDayStats(null);
    const listEl = document.getElementById('daily-diario-list');
    if (listEl) listEl.innerHTML = '<p class="daily-diario-list-empty">Erro ao carregar.</p>';
  }
}

async function loadDailyDiario() {
  if (typeof DB === 'undefined') return;

  diarioCart = [];
  diarioSelectedCustomer = null;

  const productSearch = document.getElementById('daily-diario-product-search');
  const customerSearch = document.getElementById('daily-diario-customer-search');
  const customerSelected = document.getElementById('daily-diario-customer-selected');

  if (productSearch) productSearch.value = '';
  if (customerSearch) {
    customerSearch.value = '';
    customerSearch.classList.remove('hidden');
  }
  if (customerSelected) {
    customerSelected.classList.add('hidden');
    customerSelected.innerHTML = '';
  }

  hideDiarioResults('product');
  hideDiarioResults('customer');
  renderDiarioCart();
  updateDiarioLoyaltyUI();
  initDiarioComboboxes();

  try {
    const settings = await DB.getLoyaltySettings().catch(() => ({}));
    diarioAccessValue = Number(settings.access_value) || 27;
    await fetchDailySalesCatalog();
    await loadDailyDiarioList();
    updateDiarioLoyaltyUI();
    productSearch?.focus();
    refreshIcons();
  } catch (error) {
    if (handleAuthError(error)) return;
    showToast('Erro ao carregar dados do diário.', 'error');
  }
}

async function loadDailySales() {
  const listEl = document.getElementById('daily-sales-list');
  const dateLabel = document.getElementById('daily-sales-date-label');
  if (!listEl || typeof DB === 'undefined') return;

  if (!dailySalesSelectedDate) {
    dailySalesSelectedDate = getLocalDateString();
  }

  const dateInput = document.getElementById('daily-sales-date');
  if (dateInput && dateInput.value !== dailySalesSelectedDate) {
    dateInput.value = dailySalesSelectedDate;
  }
  if (dateLabel) {
    dateLabel.textContent = formatDisplayDate(dailySalesSelectedDate);
  }

  listEl.innerHTML = '<p class="text-black/60">Carregando…</p>';

  try {
    const data = await DB.getDailySales(dailySalesSelectedDate);
    updateDailySalesSummary(data.summary);

    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<p class="text-black/60">Nenhuma venda registrada neste dia.</p>';
      refreshIcons();
      return;
    }

    listEl.innerHTML = items.map(item => `
      <div class="card daily-sales-list-item">
        <div class="daily-sales-list-item-main">
          <p class="daily-sales-list-item-title">${escapeHtml(item.product_name)}${item.quantity > 1 ? ` <span class="text-black/50 font-normal">×${item.quantity}</span>` : ''}</p>
          <p class="daily-sales-list-item-meta">
            ${formatSaleTime(item.created_at)}
            ${item.customer_name ? ` · ${escapeHtml(item.customer_name)}` : ''}
          </p>
        </div>
        <div class="daily-sales-list-item-actions">
          <span class="daily-sales-list-item-price">${formatCurrency(item.line_total)}</span>
          <button type="button" onclick="deleteDailySaleEntry(${item.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir" aria-label="Excluir venda">
            <i data-lucide="trash"></i>
          </button>
        </div>
      </div>
    `).join('');
    refreshIcons();
  } catch (error) {
    if (handleAuthError(error)) return;
    listEl.innerHTML = '<p class="text-red-600">Erro ao carregar vendas.</p>';
  }
}

function onDailySalesDateChange() {
  const input = document.getElementById('daily-sales-date');
  if (!input?.value) return;
  dailySalesSelectedDate = input.value;
  loadDailySales();
}

async function submitDailyDiario(event) {
  event.preventDefault();
  const btn = document.getElementById('daily-diario-submit-btn');

  if (diarioCart.length === 0) {
    showToast('Adicione ao menos um produto.', 'error');
    return;
  }

  diarioCart.forEach(line => {
    line.quantity = clampInt(line.quantity, 1, 1);
    line.discount = clampDecimal(line.discount, 0, line.basePrice, 0, MONEY_DECIMALS);
  });

  await withButtonLoading(btn, async () => {
    try {
      const payload = {
        sale_date: getLocalDateString(),
        items: diarioCart.map(line => ({
          product_id: line.productId,
          quantity: line.quantity,
          unit_price: computeDiarioFinalPrice(line.basePrice, line.discount)
        }))
      };
      if (diarioSelectedCustomer) {
        payload.loyalty_customer_id = diarioSelectedCustomer.id;
      }

      const result = await DB.addDailySalesBatch(payload);

      diarioCart = [];
      renderDiarioCart();
      updateDiarioLoyaltyUI();

      let msg = 'Venda registrada.';
      if (result.loyalty_applied) {
        const visits = result.loyalty_visits_applied || 1;
        if (visits === 1) {
          msg += ' 1 visita de fidelidade contabilizada.';
        } else {
          msg += ` ${visits} visitas de fidelidade contabilizadas.`;
        }
        if (result.rewards_earned > 0) {
          msg += ' Cliente ganhou prêmio!';
        }
      }
      showToast(msg, 'success');

      await loadDailyDiarioList();
      document.getElementById('daily-diario-product-search')?.focus();
      AdminRouter.loadDashboardStats();
    } catch (error) {
      if (handleAuthError(error)) return;
      showToast(error.message || 'Erro ao registrar venda.', 'error');
    }
  }, 'Registrando…');
}

async function deleteDailySaleEntry(id) {
  if (!confirm('Excluir este lançamento? A visita de fidelidade não será revertida.')) return;

  try {
    await DB.deleteDailySale(id);
    showToast('Lançamento excluído.', 'success');
    await loadDailySales();
    AdminRouter.loadDashboardStats();
  } catch (error) {
    if (handleAuthError(error)) return;
    showToast(error.message || 'Erro ao excluir.', 'error');
  }
}

function bindDailySalesEvents() {
  const dateInput = document.getElementById('daily-sales-date');
  if (dateInput && !dateInput.dataset.bound) {
    dateInput.dataset.bound = '1';
    dateInput.addEventListener('change', onDailySalesDateChange);
  }
}

document.addEventListener('DOMContentLoaded', bindDailySalesEvents);
