// Módulo Vendas do dia + Diário

let dailySalesSelectedDate = null;
let dailySalesProductsCache = [];
let dailySalesCustomersCache = [];
let diarioCart = [];
let diarioCartDiscount = 0;
let diarioSelectedCustomer = null;
let diarioAccessValue = 27;
let diarioComboboxesBound = false;
let diarioSearchTimers = { product: null, customer: null };
let diarioOptionProduct = null;
let diarioCustomerSearchSeq = 0;

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

function getProductOptions(product) {
  return Array.isArray(product?.options) ? product.options.filter(o => o && String(o.name || '').trim()) : [];
}

function findProductOption(product, optionId) {
  if (!optionId) return null;
  return getProductOptions(product).find(o => String(o.id) === String(optionId)) || null;
}

function isOptionUnique(opt) {
  return opt?.unique !== false;
}

function formatSelectedOptionsHint(selected) {
  if (!Array.isArray(selected) || selected.length === 0) return '';
  return selected.map(s => {
    const qty = Math.max(1, Number(s.quantity) || 1);
    return qty > 1 ? `${s.name} ×${qty}` : s.name;
  }).join(' · ');
}

function getDiarioOptionsAdjustment(selected) {
  if (!Array.isArray(selected) || selected.length === 0) return 0;
  const sum = selected.reduce((acc, s) => {
    const qty = Math.max(1, Number(s.quantity) || 1);
    return acc + (Number(s.price_adjustment) || 0) * qty;
  }, 0);
  return Math.round(sum * 100) / 100;
}

function getDiarioUnitPriceFromSelected(product, selected) {
  return Math.round((getProductBasePrice(product) + getDiarioOptionsAdjustment(selected)) * 100) / 100;
}

function diarioLineKey(productId, selectedOptions = []) {
  const sel = Array.isArray(selectedOptions) ? selectedOptions : [];
  if (!sel.length) return `${productId}::`;
  const part = [...sel]
    .map(s => `${s.id}:${Math.max(1, Number(s.quantity) || 1)}`)
    .sort()
    .join('|');
  return `${productId}::${part}`;
}

function getDiarioCartLineKey(line) {
  return diarioLineKey(line.productId, line.selectedOptions || []);
}

function formatDiarioPhoneDisplay(phone) {
  if (typeof formatPhoneDisplay === 'function') return formatPhoneDisplay(phone);
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone || '';
}

function upsertDiarioCustomerCache(customer) {
  if (!customer?.id) return;
  const idx = dailySalesCustomersCache.findIndex(c => String(c.id) === String(customer.id));
  if (idx >= 0) dailySalesCustomersCache[idx] = { ...dailySalesCustomersCache[idx], ...customer };
  else dailySalesCustomersCache.unshift(customer);
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

function updateDiarioCartRowTotal(lineKey) {
  const row = Array.from(document.querySelectorAll('[data-cart-line]'))
    .find(el => el.dataset.cartLine === lineKey);
  const line = diarioCart.find(l => getDiarioCartLineKey(l) === lineKey);
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
  updateDiarioCartSummary();
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
    DB.getLoyaltyCustomers({ page: 1, limit: 50, active: true }).catch(() => ({ items: [] }))
  ]);
  const list = Array.isArray(products) ? products : [];
  dailySalesProductsCache = list.filter(p => p && p.active !== false);
  dailySalesCustomersCache = Array.isArray(loyaltyData?.items)
    ? loyaltyData.items
    : (Array.isArray(loyaltyData) ? loyaltyData : []);
}

async function searchDiarioCustomersRemote(query) {
  const q = String(query || '').trim();
  if (!q) return dailySalesCustomersCache.slice(0, 12);
  try {
    const data = await DB.getLoyaltyCustomers({ q, page: 1, limit: 20, active: true });
    const items = data.items || [];
    items.forEach(upsertDiarioCustomerCache);
    return items;
  } catch (error) {
    if (handleAuthError(error)) return [];
    return filterDiarioCustomersLocal(q);
  }
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

function filterDiarioCustomersLocal(query) {
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
      const opts = getProductOptions(p);
      const base = getProductBasePrice(p);
      const meta = opts.length
        ? `${opts.length} adicional${opts.length > 1 ? 'is' : ''} · a partir de ${formatCurrency(base)}`
        : formatCurrency(base);
      return `<button type="button" class="diario-combobox-result-item" data-product-id="${escapeAttr(p.id)}">
        <span class="diario-combobox-result-name">${escapeHtml(p.name)}</span>
        <span class="diario-combobox-result-meta">${escapeHtml(meta)}</span>
      </button>`;
    }).join('');
  }
  container.classList.remove('hidden');
}

async function showDiarioCustomerResults(query) {
  const container = document.getElementById('daily-diario-customer-results');
  if (!container) return;
  const q = String(query || '').trim();
  const seq = ++diarioCustomerSearchSeq;
  container.innerHTML = '<p class="diario-combobox-empty">Buscando…</p>';
  container.classList.remove('hidden');

  const matches = await searchDiarioCustomersRemote(q);
  if (seq !== diarioCustomerSearchSeq) return;

  const createBtn = `<button type="button" class="diario-combobox-result-item diario-combobox-result-item--create" data-create-customer>
      <span class="diario-combobox-result-name">Cadastrar novo cliente</span>
      <span class="diario-combobox-result-meta">+</span>
    </button>`;

  if (matches.length === 0) {
    container.innerHTML = `<p class="diario-combobox-empty">Nenhum cliente encontrado.</p>${createBtn}`;
  } else {
    container.innerHTML = matches.map(c =>
      `<button type="button" class="diario-combobox-result-item" data-customer-id="${c.id}">
        <span class="diario-combobox-result-name">${escapeHtml(c.name)}</span>
        <span class="diario-combobox-result-meta">${escapeHtml(formatDiarioPhoneDisplay(c.phone))}</span>
      </button>`
    ).join('') + createBtn;
  }
  container.classList.remove('hidden');
}

function selectDiarioCustomer(customer) {
  diarioSelectedCustomer = { id: customer.id, name: customer.name };
  upsertDiarioCustomerCache(customer);
  const search = document.getElementById('daily-diario-customer-search');
  const selected = document.getElementById('daily-diario-customer-selected');
  const createBtn = document.getElementById('daily-diario-customer-create-btn');
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
  if (createBtn) createBtn.classList.add('hidden');
  hideDiarioResults('customer');
  updateDiarioLoyaltyUI();
}

function clearDiarioCustomer() {
  diarioSelectedCustomer = null;
  const search = document.getElementById('daily-diario-customer-search');
  const selected = document.getElementById('daily-diario-customer-selected');
  const createBtn = document.getElementById('daily-diario-customer-create-btn');
  if (search) {
    search.classList.remove('hidden');
    search.value = '';
    search.focus();
  }
  if (selected) {
    selected.classList.add('hidden');
    selected.innerHTML = '';
  }
  if (createBtn) createBtn.classList.remove('hidden');
  updateDiarioLoyaltyUI();
}

function openDiarioOptionModal(product) {
  const opts = getProductOptions(product);
  if (!opts.length) {
    addProductToDiarioCart(product.id, []);
    return;
  }

  diarioOptionProduct = product;

  const modal = document.getElementById('diario-option-modal');
  const title = document.getElementById('diario-option-modal-title');
  const subtitle = document.getElementById('diario-option-modal-subtitle');
  const list = document.getElementById('diario-option-modal-list');
  if (title) title.textContent = product.name;
  if (subtitle) subtitle.textContent = 'Selecione uma ou mais variações (opcional):';
  if (list) {
    list.innerHTML = opts.map(opt => {
      const adj = Number(opt.price_adjustment) || 0;
      const adjLabel = adj > 0 ? `+${formatCurrency(adj)}` : 'Incluso';
      const isUnique = isOptionUnique(opt);
      const checked = opt.default === true;
      const qtyVisible = checked && !isUnique;
      return `
        <div class="diario-option-item${checked ? ' is-selected' : ''}" data-option-id="${escapeAttr(opt.id)}">
          <input type="checkbox" class="diario-option-check" value="${escapeAttr(opt.id)}" ${checked ? 'checked' : ''} aria-label="${escapeAttr(opt.name)}">
          <div class="diario-option-item-body">
            <span class="diario-option-item-name">${escapeHtml(opt.name)}</span>
            <span class="diario-option-item-meta">
              <span>${escapeHtml(adjLabel)}</span>
              ${isUnique ? '<span class="diario-option-badge">Única</span>' : '<span class="diario-option-badge">Qtd livre</span>'}
            </span>
          </div>
          ${isUnique ? '' : `
            <div class="diario-option-qty-wrap${qtyVisible ? '' : ' hidden'}">
              <span class="diario-option-qty-label">Qtd</span>
              <input type="number" class="diario-option-qty" min="1" step="1" value="1" inputmode="numeric" aria-label="Quantidade de ${escapeAttr(opt.name)}">
            </div>
          `}
        </div>`;
    }).join('');

    list.querySelectorAll('.diario-option-item').forEach(row => {
      const check = row.querySelector('.diario-option-check');
      const qtyWrap = row.querySelector('.diario-option-qty-wrap');
      const qtyInput = row.querySelector('.diario-option-qty');

      check?.addEventListener('change', () => {
        row.classList.toggle('is-selected', check.checked);
        if (qtyWrap) qtyWrap.classList.toggle('hidden', !check.checked);
        updateDiarioOptionModalUnitPrice();
      });

      if (qtyInput) {
        qtyInput.addEventListener('click', (e) => e.stopPropagation());
        qtyInput.addEventListener('pointerdown', (e) => e.stopPropagation());
        qtyInput.addEventListener('input', () => {
          const parsed = parseLooseInt(qtyInput.value);
          if (parsed != null && parsed >= 1) {
            // keep raw while typing
          }
          updateDiarioOptionModalUnitPrice();
        });
        qtyInput.addEventListener('blur', () => {
          qtyInput.value = String(clampInt(parseLooseInt(qtyInput.value), 1, 1));
          updateDiarioOptionModalUnitPrice();
        });
      }

      row.addEventListener('click', (e) => {
        if (e.target.closest('.diario-option-qty-wrap') || e.target === check) return;
        if (!check) return;
        check.checked = !check.checked;
        check.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  updateDiarioOptionModalUnitPrice();
  modal?.classList.add('active');
}

function readDiarioOptionModalSelection() {
  if (!diarioOptionProduct) return [];
  const list = document.getElementById('diario-option-modal-list');
  if (!list) return [];
  const selected = [];
  list.querySelectorAll('.diario-option-item').forEach(row => {
    const check = row.querySelector('.diario-option-check');
    if (!check?.checked) return;
    const opt = findProductOption(diarioOptionProduct, check.value);
    if (!opt) return;
    const isUnique = isOptionUnique(opt);
    let qty = 1;
    if (!isUnique) {
      const qtyInput = row.querySelector('.diario-option-qty');
      qty = clampInt(parseLooseInt(qtyInput?.value), 1, 1);
      if (qtyInput) qtyInput.value = String(qty);
    }
    selected.push({
      id: String(opt.id),
      name: opt.name,
      price_adjustment: Math.max(0, Number(opt.price_adjustment) || 0),
      quantity: qty,
      unique: isUnique
    });
  });
  return selected;
}

function updateDiarioOptionModalUnitPrice() {
  const el = document.getElementById('diario-option-modal-unit-price');
  if (!el || !diarioOptionProduct) return;
  const selected = readDiarioOptionModalSelection();
  el.textContent = formatCurrency(getDiarioUnitPriceFromSelected(diarioOptionProduct, selected));
}

function closeDiarioOptionModal() {
  document.getElementById('diario-option-modal')?.classList.remove('active');
  diarioOptionProduct = null;
}

function confirmDiarioOptionSelection() {
  if (!diarioOptionProduct) return;
  const selected = readDiarioOptionModalSelection();
  const productId = diarioOptionProduct.id;
  closeDiarioOptionModal();
  addProductToDiarioCart(productId, selected);
}

function addProductToDiarioCart(productId, selectedOptions) {
  const product = dailySalesProductsCache.find(p => p.id === productId);
  if (!product) return;

  const selected = Array.isArray(selectedOptions) ? selectedOptions : [];
  const key = diarioLineKey(product.id, selected);
  const existing = diarioCart.find(line => getDiarioCartLineKey(line) === key);
  if (existing) {
    existing.quantity += 1;
  } else {
    diarioCart.push({
      productId: product.id,
      selectedOptions: selected,
      optionName: formatSelectedOptionsHint(selected),
      name: product.name,
      basePrice: getDiarioUnitPriceFromSelected(product, selected),
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

function removeFromDiarioCart(lineKey) {
  diarioCart = diarioCart.filter(line => getDiarioCartLineKey(line) !== lineKey);
  renderDiarioCart();
  updateDiarioLoyaltyUI();
}

function computeDiarioSubtotal() {
  return diarioCart.reduce((sum, line) => sum + computeDiarioLineTotal(line), 0);
}

function getDiarioCartDiscountApplied(subtotal = computeDiarioSubtotal()) {
  const disc = Math.max(0, Number(diarioCartDiscount) || 0);
  return Math.min(disc, Math.max(0, subtotal));
}

function computeDiarioSaleTotal() {
  const subtotal = computeDiarioSubtotal();
  return Math.max(0, Math.round((subtotal - getDiarioCartDiscountApplied(subtotal)) * 100) / 100);
}

function computeDiarioLoyaltyVisits() {
  const total = computeDiarioSaleTotal();
  const access = diarioAccessValue > 0 ? diarioAccessValue : 27;
  if (total <= 0 || access <= 0) return 0;
  return Math.floor(total / access);
}

function buildDiarioPayloadItems() {
  const lines = diarioCart.map(line => ({
    productId: line.productId,
    selectedOptions: Array.isArray(line.selectedOptions) ? line.selectedOptions : [],
    quantity: Math.max(1, Number(line.quantity) || 1),
    unitPrice: computeDiarioFinalPrice(line.basePrice, line.discount),
    lineTotal: computeDiarioLineTotal(line)
  }));

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const cartDisc = getDiarioCartDiscountApplied(subtotal);

  const toPayload = (line, unitPrice) => ({
    product_id: line.productId,
    selected_options: line.selectedOptions,
    quantity: line.quantity,
    unit_price: unitPrice
  });

  if (cartDisc <= 0 || subtotal <= 0) {
    return lines.map(line => toPayload(line, line.unitPrice));
  }

  let remaining = cartDisc;
  return lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    const share = isLast
      ? remaining
      : Math.min(remaining, Math.round((line.lineTotal / subtotal) * cartDisc * 100) / 100);
    remaining = Math.round((remaining - share) * 100) / 100;
    const discountedTotal = Math.max(0, Math.round((line.lineTotal - share) * 100) / 100);
    const unitPrice = Math.round((discountedTotal / line.quantity) * 100) / 100;
    return toPayload(line, unitPrice);
  });
}

function updateDiarioCartSummary() {
  const wrap = document.getElementById('daily-diario-cart-summary');
  const subtotalEl = document.getElementById('daily-diario-subtotal');
  const totalEl = document.getElementById('daily-diario-total');
  const discountInput = document.getElementById('daily-diario-cart-discount');
  if (!wrap) return;

  if (diarioCart.length === 0) {
    wrap.classList.add('hidden');
    diarioCartDiscount = 0;
    if (discountInput) discountInput.value = formatDecimalInput(0, MONEY_DECIMALS);
    return;
  }

  wrap.classList.remove('hidden');
  const subtotal = computeDiarioSubtotal();
  diarioCartDiscount = clampDecimal(diarioCartDiscount, 0, subtotal, 0, MONEY_DECIMALS);
  if (discountInput && document.activeElement !== discountInput) {
    discountInput.value = formatDecimalInput(diarioCartDiscount, MONEY_DECIMALS);
  }
  if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
  if (totalEl) totalEl.textContent = formatCurrency(computeDiarioSaleTotal());
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
    info.textContent = `${visits} ${visitLabel} automaticamente (${formatCurrency(total)} ÷ ${formatCurrency(access)})`;
  } else {
    info.textContent = `Ainda sem visita — falta atingir ${formatCurrency(access)} (total atual: ${formatCurrency(total)})`;
  }
}

function renderDiarioCart() {
  const container = document.getElementById('daily-diario-cart');
  if (!container) return;

  if (diarioCart.length === 0) {
    container.innerHTML = '<p class="daily-diario-cart-empty">Nenhum produto adicionado.</p>';
    updateDiarioCartSummary();
    return;
  }

  container.innerHTML = diarioCart.map(line => {
    const lineTotal = computeDiarioLineTotal(line);
    const key = getDiarioCartLineKey(line);
    const optionHint = line.optionName
      ? `<span class="daily-diario-cart-option">${escapeHtml(line.optionName)}</span>`
      : '';
    return `
      <div class="daily-diario-cart-row" data-cart-line="${escapeAttr(key)}">
        <div class="daily-diario-cart-row-name">
          <span class="daily-diario-cart-title">${escapeHtml(line.name)}</span>
          ${optionHint}
          <span class="daily-diario-cart-base">Unit.: ${formatCurrency(line.basePrice)}</span>
        </div>
        <div class="daily-diario-cart-row-fields">
          <label class="daily-diario-cart-field">
            <span>Qtd</span>
            <input type="number" min="1" step="1" value="${line.quantity}" data-cart-qty inputmode="numeric">
          </label>
          <label class="daily-diario-cart-field">
            <span>Desc. item</span>
            <input type="number" min="0" step="0.01" value="${formatDecimalInput(line.discount, MONEY_DECIMALS)}" data-cart-discount inputmode="decimal" title="Desconto por unidade (R$)">
          </label>
          <div class="daily-diario-cart-total">
            <span>Total</span>
            <strong>${formatCurrency(lineTotal)}</strong>
          </div>
          <button type="button" class="btn btn-danger btn-sm btn-icon daily-diario-cart-remove" data-remove-line="${escapeAttr(key)}" title="Remover" aria-label="Remover produto">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
  updateDiarioCartSummary();
  refreshIcons();
}

function onDiarioCartClick(e) {
  const removeBtn = e.target.closest('[data-remove-line]');
  if (removeBtn) {
    removeFromDiarioCart(removeBtn.dataset.removeLine);
    return;
  }
  const clearCustomer = e.target.closest('[data-clear-customer]');
  if (clearCustomer) {
    clearDiarioCustomer();
  }
}

function onDiarioCartInput(e) {
  const row = e.target.closest('[data-cart-line]');
  if (!row) return;
  const lineKey = row.dataset.cartLine;
  const line = diarioCart.find(l => getDiarioCartLineKey(l) === lineKey);
  if (!line) return;

  if (e.target.matches('[data-cart-qty]')) {
    const parsed = parseLooseInt(e.target.value);
    if (parsed != null && parsed >= 1) line.quantity = parsed;
    updateDiarioCartRowTotal(lineKey);
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
    updateDiarioCartRowTotal(lineKey);
    updateDiarioLoyaltyUI();
  }
}

function onDiarioCartBlur(e) {
  const row = e.target.closest('[data-cart-line]');
  if (!row) return;
  const lineKey = row.dataset.cartLine;
  const line = diarioCart.find(l => getDiarioCartLineKey(l) === lineKey);
  if (!line) return;

  if (e.target.matches('[data-cart-qty]')) {
    line.quantity = clampInt(parseLooseInt(e.target.value), 1, 1);
    e.target.value = String(line.quantity);
    updateDiarioCartRowTotal(lineKey);
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
    updateDiarioCartRowTotal(lineKey);
    updateDiarioLoyaltyUI();
  }
}

function onDiarioProductResultsClick(e) {
  const btn = e.target.closest('[data-product-id]');
  if (!btn) return;
  const product = dailySalesProductsCache.find(p => String(p.id) === String(btn.dataset.productId));
  if (!product) return;
  hideDiarioResults('product');
  if (getProductOptions(product).length) {
    openDiarioOptionModal(product);
  } else {
    addProductToDiarioCart(product.id, []);
  }
}

function onDiarioCustomerResultsClick(e) {
  const createBtn = e.target.closest('[data-create-customer]');
  if (createBtn) {
    openDiarioQuickCustomerModal();
    return;
  }
  const btn = e.target.closest('[data-customer-id]');
  if (!btn) return;
  const customer = dailySalesCustomersCache.find(c => String(c.id) === String(btn.dataset.customerId));
  if (customer) selectDiarioCustomer(customer);
}

function openDiarioQuickCustomerModal() {
  hideDiarioResults('customer');
  const modal = document.getElementById('diario-quick-customer-modal');
  const form = document.getElementById('diario-quick-customer-form');
  const nameInput = document.getElementById('diario-quick-customer-name');
  const phoneInput = document.getElementById('diario-quick-customer-phone');
  const search = document.getElementById('daily-diario-customer-search');
  form?.reset();
  if (search?.value) {
    const raw = search.value.trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 8 && nameInput && phoneInput) {
      phoneInput.value = formatDiarioPhoneDisplay(digits);
    } else if (nameInput) {
      nameInput.value = raw;
    }
  }
  modal?.classList.add('active');
  setTimeout(() => nameInput?.focus(), 50);
}

function closeDiarioQuickCustomerModal() {
  document.getElementById('diario-quick-customer-modal')?.classList.remove('active');
}

async function saveDiarioQuickCustomer(event) {
  event.preventDefault();
  const btn = event.submitter || document.querySelector('#diario-quick-customer-form button[type="submit"]');
  const name = document.getElementById('diario-quick-customer-name')?.value.trim() || '';
  const phone = document.getElementById('diario-quick-customer-phone')?.value.trim() || '';

  if (!name) {
    showToast('Informe o nome do cliente.', 'error');
    return;
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) {
    showToast('Telefone inválido (mínimo 10 dígitos).', 'error');
    return;
  }

  await withButtonLoading(btn, async () => {
    try {
      const customer = await DB.addLoyaltyCustomer({ name, phone });
      upsertDiarioCustomerCache(customer);
      selectDiarioCustomer(customer);
      closeDiarioQuickCustomerModal();
      showToast('Cliente cadastrado!', 'success');
    } catch (error) {
      if (handleAuthError(error)) return;
      showToast(error.message || 'Erro ao cadastrar cliente.', 'error');
    }
  }, 'Cadastrando…');
}

function onDiarioCartDiscountInput(e) {
  const input = e.target;
  if (!input || input.id !== 'daily-diario-cart-discount') return;

  const restricted = restrictDecimalString(input.value, MONEY_DECIMALS);
  if (input.value !== restricted) input.value = restricted;
  const parsed = parseLooseDecimal(restricted, MONEY_DECIMALS);
  if (parsed != null && parsed >= 0) {
    diarioCartDiscount = Math.min(parsed, computeDiarioSubtotal());
  }
  updateDiarioCartSummary();
  updateDiarioLoyaltyUI();
}

function onDiarioCartDiscountBlur(e) {
  const input = e.target;
  if (!input || input.id !== 'daily-diario-cart-discount') return;

  diarioCartDiscount = clampDecimal(
    parseLooseDecimal(input.value, MONEY_DECIMALS),
    0,
    computeDiarioSubtotal(),
    0,
    MONEY_DECIMALS
  );
  input.value = formatDecimalInput(diarioCartDiscount, MONEY_DECIMALS);
  updateDiarioCartSummary();
  updateDiarioLoyaltyUI();
}

function initDiarioComboboxes() {
  if (diarioComboboxesBound) return;
  diarioComboboxesBound = true;

  const productSearch = document.getElementById('daily-diario-product-search');
  const customerSearch = document.getElementById('daily-diario-customer-search');
  const cart = document.getElementById('daily-diario-cart');
  const cartDiscount = document.getElementById('daily-diario-cart-discount');
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
      }, 250);
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
  if (cartDiscount) {
    cartDiscount.addEventListener('input', onDiarioCartDiscountInput);
    cartDiscount.addEventListener('blur', onDiarioCartDiscountBlur);
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#diario-product-combobox')) hideDiarioResults('product');
    if (!e.target.closest('#diario-customer-combobox') && !e.target.closest('#daily-diario-customer-create-btn')) {
      hideDiarioResults('customer');
    }
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
  diarioCartDiscount = 0;
  diarioSelectedCustomer = null;

  const productSearch = document.getElementById('daily-diario-product-search');
  const customerSearch = document.getElementById('daily-diario-customer-search');
  const customerSelected = document.getElementById('daily-diario-customer-selected');
  const customerCreateBtn = document.getElementById('daily-diario-customer-create-btn');
  const cartDiscount = document.getElementById('daily-diario-cart-discount');

  if (productSearch) productSearch.value = '';
  if (customerSearch) {
    customerSearch.value = '';
    customerSearch.classList.remove('hidden');
  }
  if (customerSelected) {
    customerSelected.classList.add('hidden');
    customerSelected.innerHTML = '';
  }
  if (customerCreateBtn) customerCreateBtn.classList.remove('hidden');
  if (cartDiscount) cartDiscount.value = formatDecimalInput(0, MONEY_DECIMALS);

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
  diarioCartDiscount = clampDecimal(
    diarioCartDiscount,
    0,
    computeDiarioSubtotal(),
    0,
    MONEY_DECIMALS
  );

  await withButtonLoading(btn, async () => {
    try {
      const payload = {
        sale_date: getLocalDateString(),
        items: buildDiarioPayloadItems()
      };
      if (diarioSelectedCustomer) {
        payload.loyalty_customer_id = diarioSelectedCustomer.id;
      }

      const result = await DB.addDailySalesBatch(payload);

      diarioCart = [];
      diarioCartDiscount = 0;
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
