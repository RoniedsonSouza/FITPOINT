// Página pública de eventos / detalhe / checkout de ingressos

(function () {
  let eventsData = [];
  let currentEvent = null;
  let currentLots = [];
  let checkoutAssignees = [];
  const DEFAULT_EMAIL_HINT = 'Enviaremos o QR Code neste e-mail após a confirmação do pagamento.';
  const GIFTED_EMAIL_HINT = 'Cada pessoa receberá o QR no e-mail informado.';

  function apiBase() {
    return window.FitPointConfig?.API_BASE_URL ||
      (window.location.origin.includes('localhost') ? 'http://localhost:3000/api' : '/api');
  }

  function formatBRL(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function hasActivePromo(lot) {
    return Boolean(lot && lot.promo_enabled && Number(lot.promo_qty) >= 2 && Number(lot.promo_price) > 0);
  }

  // Espelho de services/ticketPricing.js — o backend recalcula no checkout.
  function computeTotal(lot, qty) {
    const unitPrice = Number(lot.price);
    const baseTotal = round2(unitPrice * qty);
    if (!hasActivePromo(lot) || qty < Number(lot.promo_qty)) {
      return { total: baseTotal, savings: 0, promoApplied: false };
    }
    const promoQty = Number(lot.promo_qty);
    const promoPrice = Number(lot.promo_price);
    let total;
    if (lot.promo_mode === 'once') {
      total = promoPrice + (qty - promoQty) * unitPrice;
    } else if (lot.promo_mode === 'proportional') {
      total = (promoPrice / promoQty) * qty;
    } else {
      total = Math.floor(qty / promoQty) * promoPrice + (qty % promoQty) * unitPrice;
    }
    total = round2(total);
    if (total >= baseTotal) {
      return { total: baseTotal, savings: 0, promoApplied: false };
    }
    return { total, savings: round2(baseTotal - total), promoApplied: true };
  }

  function promoLabel(lot) {
    return `${lot.promo_qty} por ${formatBRL(lot.promo_price)}`;
  }

  function eventCoverUrl(ev) {
    return ev?.cover_url || ev?.image_url || null;
  }

  function eventLogoUrl(ev) {
    return ev?.logo_url || null;
  }

  function instagramUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    const handle = value.replace(/^@/, '').replace(/^instagram\.com\//i, '').replace(/^\//, '');
    if (!handle) return null;
    return `https://instagram.com/${encodeURIComponent(handle)}`;
  }

  function instagramHandle(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) {
      try {
        const u = new URL(value);
        const parts = u.pathname.split('/').filter(Boolean);
        return parts[0] ? `@${parts[0]}` : value;
      } catch (_) {
        return value;
      }
    }
    return value.startsWith('@') ? value : `@${value}`;
  }

  function showPaymentBanner() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const orderId = params.get('order');
    const el = document.getElementById('payment-status');
    if (!el || !payment) return;

    el.classList.remove('hidden');
    if (payment === 'success') {
      el.className = 'payment-banner payment-banner--success';
      el.textContent = 'Pagamento aprovado! Seu ingresso será enviado por e-mail em instantes. Confira também a caixa de spam.';
      if (orderId) {
        fetch(`${apiBase()}/tickets/orders/${orderId}/sync`, { method: 'POST' })
          .then((r) => r.json())
          .then((data) => {
            if (data.status === 'paid') {
              el.textContent = 'Pagamento confirmado! Verifique seu e-mail com o QR Code do ingresso.';
            }
          })
          .catch(() => {});
      }
    } else if (payment === 'failure') {
      el.className = 'payment-banner payment-banner--failure';
      el.textContent = 'Pagamento não concluído. Você pode tentar novamente escolhendo um lote abaixo.';
    } else if (payment === 'pending') {
      el.className = 'payment-banner payment-banner--pending';
      el.textContent = 'Pagamento pendente. Assim que for confirmado, o ingresso chega no e-mail informado.';
    } else {
      el.classList.add('hidden');
    }
  }

  async function loadEvents() {
    const list = document.getElementById('events-public-list');
    if (!list) return;
    list.innerHTML = '<p class="text-black/60">Carregando eventos…</p>';

    try {
      const response = await fetch(`${apiBase()}/events`);
      if (!response.ok) throw new Error('Falha ao carregar');
      eventsData = await response.json();

      if (!eventsData.length) {
        list.innerHTML = '<p class="text-black/60">Nenhum evento disponível no momento.</p>';
        return;
      }

      list.innerHTML = eventsData.map((ev) => {
        const lots = ev.lots || [];
        const minPrice = lots.length
          ? Math.min(...lots.map((l) => Number(l.price)))
          : null;
        const hasStock = lots.some((l) => l.quantity_available > 0);
        const promoLot = lots.find((l) => hasActivePromo(l) && l.quantity_available > 0);
        const cover = eventCoverUrl(ev);
        return `
          <article class="card flex flex-col overflow-hidden">
            <a href="/evento.html?id=${ev.id}" class="block">
              <div class="w-full h-44 bg-gradient-to-br from-fp-green/10 via-fp-fog to-fp-green2/10 overflow-hidden">
                ${cover
                  ? `<img src="${escapeHtml(cover)}" alt="" class="w-full h-full object-cover">`
                  : ''}
              </div>
            </a>
            <div class="p-5 flex flex-col flex-1">
              <h2 class="font-display text-xl font-bold">
                <a href="/evento.html?id=${ev.id}" class="hover:text-fp-green">${escapeHtml(ev.title)}</a>
              </h2>
              <p class="text-sm text-black/60 mt-2">${formatDate(ev.starts_at)}</p>
              ${ev.venue ? `<p class="text-sm text-black/60 mt-1">${escapeHtml(ev.venue)}</p>` : ''}
              ${promoLot ? `<p class="text-xs font-semibold mt-2 inline-flex items-center gap-1 text-fp-green">🎟 Promoção: ${promoLabel(promoLot)}</p>` : ''}
              ${ev.description ? `<p class="text-sm mt-3 line-clamp-3">${escapeHtml(ev.description)}</p>` : ''}
              <div class="mt-auto pt-4 flex items-center justify-between gap-3">
                <span class="text-sm font-semibold text-fp-green">
                  ${minPrice != null ? `A partir de ${formatBRL(minPrice)}` : 'Sem lotes'}
                </span>
                <a href="/evento.html?id=${ev.id}" class="btn ${!hasStock ? 'opacity-60 pointer-events-none' : ''}" ${!hasStock ? 'aria-disabled="true"' : ''}>
                  ${hasStock ? 'Ver detalhes' : 'Esgotado'}
                </a>
              </div>
            </div>
          </article>
        `;
      }).join('');
    } catch (err) {
      console.error(err);
      list.innerHTML = '<p class="text-red-600">Não foi possível carregar os eventos.</p>';
    }
  }

  function renderLotsList(lots) {
    if (!lots.length) {
      return '<p class="text-black/60 text-sm">Nenhum ingresso disponível no momento.</p>';
    }
    return lots.map((lot) => {
      const promo = hasActivePromo(lot)
        ? `<span class="text-xs font-semibold text-fp-green">Promo: ${promoLabel(lot)}</span>`
        : '';
      const available = lot.quantity_available > 0;
      return `
        <div class="lot-row">
          <div>
            <p class="font-semibold">${escapeHtml(lot.name)}</p>
            <p class="text-sm text-black/60 mt-0.5">${available ? `${lot.quantity_available} disponíveis` : 'Esgotado'}</p>
            ${promo ? `<p class="mt-1">${promo}</p>` : ''}
          </div>
          <div class="text-right">
            <p class="font-display text-lg font-bold text-fp-green">${formatBRL(lot.price)}</p>
            ${available
              ? `<button type="button" class="btn btn-outline mt-2 text-sm min-h-0 py-2 px-3" data-select-lot="${lot.id}">Comprar</button>`
              : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSponsors(sponsors) {
    if (!sponsors?.length) return '';
    const chips = sponsors.map((s) => {
      const href = instagramUrl(s.instagram);
      const handle = instagramHandle(s.instagram);
      const name = s.fantasy_name || handle;
      const logo = s.image_url
        ? `<img class="sponsor-logo" src="${escapeHtml(s.image_url)}" alt="${escapeHtml(name)}">`
        : '';
      const textBlock = (name || handle)
        ? `<span class="font-semibold text-sm">${escapeHtml(name)}</span>
           ${handle ? `<span class="text-xs text-fp-green">${escapeHtml(handle)}</span>` : ''}`
        : '';
      const inner = `${logo}${textBlock}`;
      if (href) {
        return `<a class="sponsor-chip" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      }
      return `<div class="sponsor-chip">${inner}</div>`;
    }).join('');
    return `
      <section class="mt-10">
        <h2 class="font-display text-xl font-bold mb-4">Patrocinadores</h2>
        <div class="flex flex-wrap gap-3">${chips}</div>
      </section>
    `;
  }

  function fillCheckoutForm(event, preferredLotId) {
    currentEvent = event;
    currentLots = (event.lots || []).filter((l) => l.quantity_available > 0);
    const panel = document.getElementById('checkout-panel');
    if (!panel) return;

    document.getElementById('checkout-event-title').textContent = 'Comprar ingresso';
    document.getElementById('checkout-event-meta').textContent =
      `${formatDate(event.starts_at)}${event.venue ? ' · ' + event.venue : ''}`;

    const lotSelect = document.getElementById('checkout-lot');
    if (!currentLots.length) {
      panel.classList.add('hidden');
      return;
    }

    lotSelect.innerHTML = currentLots.map((lot) => {
      const promo = hasActivePromo(lot) ? ` · ${promoLabel(lot)}` : '';
      return `<option value="${lot.id}">${escapeHtml(lot.name)} — ${formatBRL(lot.price)}${promo} (${lot.quantity_available} disp.)</option>`;
    }).join('');

    if (preferredLotId && currentLots.some((l) => l.id === preferredLotId)) {
      lotSelect.value = String(preferredLotId);
    }

    document.getElementById('checkout-qty').value = '1';
    checkoutAssignees = [null];
    renderCheckoutAssigneeSlots();
    resetPaymentPanels();
    updateTotal();
    panel.classList.remove('hidden');
  }

  function getCheckoutQty() {
    const raw = parseInt(document.getElementById('checkout-qty')?.value, 10);
    if (!raw || raw < 1) return 1;
    return Math.min(10, raw);
  }

  function ensureCheckoutAssigneesLength(qty) {
    const next = [];
    for (let i = 0; i < qty; i++) {
      next.push(checkoutAssignees[i] || null);
    }
    checkoutAssignees = next;
  }

  function updateCheckoutEmailHint() {
    const hintEl = document.getElementById('checkout-email-hint');
    if (!hintEl) return;
    const hasGifts = checkoutAssignees.some((a) => a !== null);
    hintEl.textContent = hasGifts ? GIFTED_EMAIL_HINT : DEFAULT_EMAIL_HINT;
  }

  function renderCheckoutAssigneeSlots() {
    const section = document.getElementById('checkout-gift-section');
    const container = document.getElementById('checkout-assignee-slots');
    if (!container || !section) return;

    const qty = getCheckoutQty();
    ensureCheckoutAssigneesLength(qty);
    section.classList.toggle('hidden', qty < 1);

    container.innerHTML = checkoutAssignees
      .map((assignee, index) => {
        const gifted = assignee !== null;
        const label =
          gifted && String(assignee.name || '').trim()
            ? escapeHtml(String(assignee.name).trim())
            : gifted
              ? 'Nome doado'
              : 'Seu nome';
        return `
          <div class="checkout-assignee-slot" data-checkout-slot="${index}">
            <div class="checkout-assignee-slot__head">
              <p>Ingresso ${index + 1} — ${label}</p>
              ${
                gifted
                  ? `<button type="button" class="btn btn-outline btn-sm" data-checkout-assignee-action="clear" data-checkout-slot="${index}">Limpar</button>`
                  : `<button type="button" class="btn btn-outline btn-sm" data-checkout-assignee-action="gift" data-checkout-slot="${index}">Dar ingresso</button>`
              }
            </div>
            ${
              gifted
                ? `<div class="checkout-assignee-fields">
                    <input type="text" class="checkout-slot-name" data-checkout-slot="${index}" value="${escapeHtml(assignee.name || '')}" placeholder="Nome do destinatário" autocomplete="name">
                    <input type="email" class="checkout-slot-email" data-checkout-slot="${index}" value="${escapeHtml(assignee.email || '')}" placeholder="E-mail do destinatário" autocomplete="email">
                    <input type="tel" class="checkout-slot-phone" data-checkout-slot="${index}" value="${escapeHtml(assignee.phone || '')}" placeholder="Telefone (opcional)" autocomplete="tel">
                  </div>`
                : ''
            }
          </div>`;
      })
      .join('');

    updateCheckoutEmailHint();
  }

  function giftCheckoutAssigneeSlot(index) {
    ensureCheckoutAssigneesLength(getCheckoutQty());
    if (index < 0 || index >= checkoutAssignees.length) return;
    checkoutAssignees[index] = { name: '', email: '', phone: '' };
    renderCheckoutAssigneeSlots();
    document.querySelector(`.checkout-slot-name[data-checkout-slot="${index}"]`)?.focus();
  }

  function clearCheckoutAssigneeSlot(index) {
    ensureCheckoutAssigneesLength(getCheckoutQty());
    if (index < 0 || index >= checkoutAssignees.length) return;
    checkoutAssignees[index] = null;
    renderCheckoutAssigneeSlots();
  }

  function updateCheckoutAssigneeField(index, field, value) {
    ensureCheckoutAssigneesLength(getCheckoutQty());
    if (index < 0 || index >= checkoutAssignees.length) return;
    if (!checkoutAssignees[index]) checkoutAssignees[index] = { name: '', email: '', phone: '' };
    checkoutAssignees[index][field] = value;
    const labelEl = document.querySelector(
      `.checkout-assignee-slot[data-checkout-slot="${index}"] .checkout-assignee-slot__head p`
    );
    if (labelEl && field === 'name') {
      const name = String(value || '').trim();
      labelEl.textContent = `Ingresso ${index + 1} — ${name || 'Nome doado'}`;
    }
  }

  function buildAssigneesPayload(qty) {
    ensureCheckoutAssigneesLength(qty);
    return checkoutAssignees.slice(0, qty).map((a) => {
      if (!a) return null;
      const phone = String(a.phone || '').trim();
      return {
        name: String(a.name || '').trim(),
        email: String(a.email || '').trim(),
        phone: phone || undefined
      };
    });
  }

  function validateCheckoutAssignees(qty) {
    ensureCheckoutAssigneesLength(qty);
    for (let i = 0; i < qty; i++) {
      const a = checkoutAssignees[i];
      if (!a) continue;
      const name = String(a.name || '').trim();
      const email = String(a.email || '').trim();
      if (!name || !email) {
        return `Preencha nome e e-mail do destinatário do ingresso ${i + 1}`;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return `E-mail do destinatário do ingresso ${i + 1} é inválido`;
      }
    }
    return null;
  }

  function onCheckoutQtyChange() {
    const qtyEl = document.getElementById('checkout-qty');
    if (qtyEl) {
      let qty = parseInt(qtyEl.value, 10);
      if (!qty || qty < 1) qty = 1;
      if (qty > 10) qty = 10;
      qtyEl.value = String(qty);
    }
    renderCheckoutAssigneeSlots();
    updateTotal();
  }

  function onCheckoutAssigneeClick(e) {
    const btn = e.target.closest('[data-checkout-assignee-action]');
    if (!btn) return;
    const index = Number(btn.dataset.checkoutSlot);
    if (Number.isNaN(index)) return;
    if (btn.dataset.checkoutAssigneeAction === 'gift') giftCheckoutAssigneeSlot(index);
    if (btn.dataset.checkoutAssigneeAction === 'clear') clearCheckoutAssigneeSlot(index);
  }

  function onCheckoutAssigneeInput(e) {
    const input = e.target.closest('.checkout-slot-name, .checkout-slot-email, .checkout-slot-phone');
    if (!input) return;
    const index = Number(input.dataset.checkoutSlot);
    if (Number.isNaN(index)) return;
    const field = input.classList.contains('checkout-slot-name')
      ? 'name'
      : input.classList.contains('checkout-slot-email')
        ? 'email'
        : 'phone';
    updateCheckoutAssigneeField(index, field, input.value);
  }

  async function loadEventDetail() {
    const root = document.getElementById('event-detail');
    if (!root) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) {
      root.innerHTML = '<p class="text-red-600">Evento não informado. <a class="text-fp-green underline" href="/eventos.html">Voltar aos eventos</a></p>';
      return;
    }

    root.innerHTML = '<p class="text-black/60">Carregando evento…</p>';

    try {
      const response = await fetch(`${apiBase()}/events/${id}`);
      if (!response.ok) throw new Error('Evento não encontrado');
      const ev = await response.json();
      currentEvent = ev;
      document.title = `${ev.title} — FitPoint Fitness`;

      const cover = eventCoverUrl(ev);
      const logo = eventLogoUrl(ev);
      const lots = ev.lots || [];
      const hasStock = lots.some((l) => l.quantity_available > 0);

      const titleEscaped = escapeHtml(ev.title);
      root.innerHTML = `
        <article>
          <div class="event-cover rounded-2xl overflow-hidden">
            ${cover
              ? `<button type="button" class="event-image-trigger" data-zoom-image="${escapeHtml(cover)}" data-zoom-alt="Capa de ${titleEscaped}" data-zoom-caption="${titleEscaped}" aria-label="Ampliar capa do evento">
                  <img src="${escapeHtml(cover)}" alt="">
                </button>`
              : ''}
          </div>
          <div class="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start -mt-10 sm:-mt-12 px-1 relative z-10">
            <div class="event-logo ml-3 sm:ml-6">
              ${logo
                ? `<button type="button" class="event-image-trigger" data-zoom-image="${escapeHtml(logo)}" data-zoom-alt="Logo de ${titleEscaped}" data-zoom-caption="${titleEscaped}" aria-label="Ampliar logo do evento">
                    <img src="${escapeHtml(logo)}" alt="Logo do evento">
                  </button>`
                : ''}
            </div>
            <div class="pt-2 sm:pt-14 flex-1 min-w-0">
              <h1 class="font-display text-3xl md:text-4xl font-bold">${escapeHtml(ev.title)}</h1>
              <p class="text-black/60 mt-2">${formatDate(ev.starts_at)}</p>
              ${ev.venue ? `<p class="text-black/60 mt-1">${escapeHtml(ev.venue)}</p>` : ''}
            </div>
          </div>

          ${ev.description
            ? `<section class="mt-8">
                <h2 class="font-display text-xl font-bold mb-3">Sobre o evento</h2>
                <p class="text-black/80 whitespace-pre-line leading-relaxed">${escapeHtml(ev.description)}</p>
              </section>`
            : ''}

          <section class="mt-10">
            <h2 class="font-display text-xl font-bold mb-2">Ingressos</h2>
            <div class="card px-5">${renderLotsList(lots)}</div>
            ${!hasStock ? '<p class="text-sm text-black/50 mt-3">Ingressos esgotados no momento.</p>' : ''}
          </section>

          ${renderSponsors(ev.sponsors)}

          ${hasStock
            ? `<div class="mt-8">
                <a href="#checkout-panel" class="btn" id="event-buy-cta">Comprar ingresso</a>
              </div>`
            : ''}
        </article>
      `;

      window.FitPointImageViewer?.bindZoomable(root);

      root.querySelectorAll('[data-select-lot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          fillCheckoutForm(ev, Number(btn.dataset.selectLot));
          document.getElementById('checkout-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      document.getElementById('event-buy-cta')?.addEventListener('click', (e) => {
        e.preventDefault();
        fillCheckoutForm(ev);
        document.getElementById('checkout-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      // Se voltou do pagamento com falha/pendente, já mostra o checkout
      const payment = params.get('payment');
      if (hasStock && (payment === 'failure' || payment === 'pending' || !payment)) {
        if (payment === 'failure' || payment === 'pending') {
          fillCheckoutForm(ev);
        }
      }
    } catch (err) {
      console.error(err);
      root.innerHTML = `<p class="text-red-600">${escapeHtml(err.message || 'Não foi possível carregar o evento.')} <a class="text-fp-green underline" href="/eventos.html">Voltar</a></p>`;
    }
  }

  function updateTotal() {
    const lotId = Number(document.getElementById('checkout-lot')?.value);
    const qty = parseInt(document.getElementById('checkout-qty')?.value, 10) || 1;
    const lot = currentLots.find((l) => l.id === lotId);
    const el = document.getElementById('checkout-total');
    const savingsEl = document.getElementById('checkout-savings');
    const hintEl = document.getElementById('checkout-promo-hint');

    if (!lot) {
      if (el) el.textContent = `Total: ${formatBRL(0)}`;
      savingsEl?.classList.add('hidden');
      hintEl?.classList.add('hidden');
      return;
    }

    const pricing = computeTotal(lot, qty);
    if (el) el.textContent = `Total: ${formatBRL(pricing.total)}`;

    if (savingsEl) {
      if (pricing.promoApplied) {
        savingsEl.textContent = `Promoção ${promoLabel(lot)} aplicada — você economiza ${formatBRL(pricing.savings)}`;
        savingsEl.classList.remove('hidden');
      } else {
        savingsEl.classList.add('hidden');
      }
    }

    if (hintEl) {
      if (hasActivePromo(lot) && !pricing.promoApplied && lot.quantity_available >= Number(lot.promo_qty)) {
        hintEl.textContent = `Leve ${lot.promo_qty} por ${formatBRL(lot.promo_price)}!`;
        hintEl.classList.remove('hidden');
      } else {
        hintEl.classList.add('hidden');
      }
    }

    updatePayButton();
    if (paymentMethod === 'card') refreshInstallments();
  }

  // ============================================================
  // Pagamento dentro do site (Pix e cartão) — sem redirecionamento
  // ============================================================
  let paymentMethod = 'pix';
  let mpInstance = null;
  let mpPublicKey = null;
  let cardBin = '';
  let cardPaymentMethodId = null;
  let cardIssuerId = null;
  let pollTimer = null;
  let pollTicks = 0;
  let countdownTimer = null;
  let activeOrderId = null;

  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatPhoneMask(value) {
    const d = onlyDigits(value).slice(0, 11);
    if (d.length > 10) {
      return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    }
    if (d.length > 6) {
      return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    }
    if (d.length > 2) {
      return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    }
    if (d.length > 0) {
      return `(${d}`;
    }
    return '';
  }

  function currentTotal() {
    const lotId = Number(document.getElementById('checkout-lot')?.value);
    const qty = parseInt(document.getElementById('checkout-qty')?.value, 10) || 1;
    const lot = currentLots.find((l) => l.id === lotId);
    return lot ? computeTotal(lot, qty).total : 0;
  }

  async function loadPaymentConfig() {
    try {
      const res = await fetch(`${apiBase()}/tickets/payment-config`);
      const data = await res.json().catch(() => ({}));
      mpPublicKey = data.public_key || null;
    } catch (_) {
      mpPublicKey = null;
    }
    const cardBtn = document.getElementById('pay-method-card');
    if (cardBtn && (!mpPublicKey || typeof MercadoPago === 'undefined')) {
      cardBtn.disabled = true;
      const hint = cardBtn.querySelector('span');
      if (hint) hint.textContent = 'Indisponível no momento — use Pix';
    }
  }

  function getMp() {
    if (!mpInstance && mpPublicKey && typeof MercadoPago !== 'undefined') {
      mpInstance = new MercadoPago(mpPublicKey, { locale: 'pt-BR' });
    }
    return mpInstance;
  }

  function setPaymentMethod(method) {
    paymentMethod = method;
    document.getElementById('pay-method-pix')?.classList.toggle('pay-method--active', method === 'pix');
    document.getElementById('pay-method-card')?.classList.toggle('pay-method--active', method === 'card');
    document.getElementById('card-fields')?.classList.toggle('hidden', method !== 'card');
    updatePayButton();
    if (method === 'card') {
      getMp();
      refreshInstallments();
    }
  }

  function updatePayButton() {
    const btn = document.getElementById('checkout-submit');
    if (!btn || btn.disabled) return;
    btn.textContent = paymentMethod === 'card'
      ? `Pagar ${formatBRL(currentTotal())}`
      : 'Gerar código Pix';
  }

  function fillDefaultInstallments() {
    const select = document.getElementById('card-installments');
    if (!select) return;
    const total = currentTotal();
    select.innerHTML = `<option value="1">1x de ${formatBRL(total)} à vista</option>`;
  }

  async function refreshInstallments() {
    const select = document.getElementById('card-installments');
    if (!select) return;
    const mp = getMp();
    const total = currentTotal();
    if (!mp || !cardBin || !total) {
      fillDefaultInstallments();
      return;
    }
    try {
      const result = await mp.getInstallments({
        amount: String(total),
        bin: cardBin,
        paymentTypeId: 'credit_card'
      });
      const costs = result?.[0]?.payer_costs || [];
      if (!costs.length) {
        fillDefaultInstallments();
        return;
      }
      const previous = select.value;
      select.innerHTML = costs
        .map((c) => `<option value="${c.installments}">${escapeHtml(c.recommended_message)}</option>`)
        .join('');
      if (previous && costs.some((c) => String(c.installments) === previous)) {
        select.value = previous;
      }
    } catch (_) {
      fillDefaultInstallments();
    }
  }

  async function detectCardBrand() {
    const digits = onlyDigits(document.getElementById('card-number')?.value);
    const bin = digits.slice(0, 8);
    if (bin.length < 6) {
      cardBin = '';
      cardPaymentMethodId = null;
      cardIssuerId = null;
      document.getElementById('card-brand')?.classList.add('hidden');
      return;
    }
    if (bin === cardBin) return;
    cardBin = bin;
    const mp = getMp();
    if (!mp) return;
    try {
      const result = await mp.getPaymentMethods({ bin });
      const pm = result?.results?.[0];
      if (pm) {
        cardPaymentMethodId = pm.id;
        cardIssuerId = pm.issuer?.id != null ? String(pm.issuer.id) : null;
        const brandEl = document.getElementById('card-brand');
        if (brandEl) {
          brandEl.textContent = pm.name || pm.id;
          brandEl.classList.remove('hidden');
        }
        refreshInstallments();
      } else {
        cardPaymentMethodId = null;
      }
    } catch (_) {
      cardPaymentMethodId = null;
    }
  }

  function setupPhoneInputMask() {
    const phoneEl = document.getElementById('checkout-phone');
    phoneEl?.addEventListener('input', () => {
      phoneEl.value = formatPhoneMask(phoneEl.value);
    });
  }

  function setupCardInputMasks() {
    const numberEl = document.getElementById('card-number');
    numberEl?.addEventListener('input', () => {
      const digits = onlyDigits(numberEl.value).slice(0, 19);
      numberEl.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
      detectCardBrand();
    });

    const expiryEl = document.getElementById('card-expiry');
    expiryEl?.addEventListener('input', () => {
      const digits = onlyDigits(expiryEl.value).slice(0, 4);
      expiryEl.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    });

    const cpfEl = document.getElementById('card-cpf');
    cpfEl?.addEventListener('input', () => {
      const d = onlyDigits(cpfEl.value).slice(0, 11);
      let out = d;
      if (d.length > 9) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
      else if (d.length > 6) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
      else if (d.length > 3) out = `${d.slice(0, 3)}.${d.slice(3)}`;
      cpfEl.value = out;
    });

    const cvvEl = document.getElementById('card-cvv');
    cvvEl?.addEventListener('input', () => {
      cvvEl.value = onlyDigits(cvvEl.value).slice(0, 4);
    });
  }

  function showCheckoutError(message) {
    const errEl = document.getElementById('checkout-error');
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    }
  }

  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function showPanel(panel) {
    // panel: 'form' | 'pix' | 'processing' | 'success'
    document.getElementById('checkout-form')?.classList.toggle('hidden', panel !== 'form');
    document.getElementById('pix-panel')?.classList.toggle('hidden', panel !== 'pix');
    document.getElementById('processing-panel')?.classList.toggle('hidden', panel !== 'processing');
    document.getElementById('success-panel')?.classList.toggle('hidden', panel !== 'success');
  }

  function resetPaymentPanels() {
    stopTimers();
    activeOrderId = null;
    showPanel('form');
    const btn = document.getElementById('checkout-submit');
    if (btn) btn.disabled = false;
    updatePayButton();
  }

  function showSuccess(orderId, amount) {
    stopTimers();
    const email = document.getElementById('checkout-email')?.value?.trim();
    const msgEl = document.getElementById('success-message');
    if (msgEl) {
      msgEl.textContent = email
        ? `Compra oficial confirmada. Seu ingresso com QR Code foi enviado para ${email}.`
        : 'Compra oficial confirmada. Seu ingresso com QR Code foi enviado por e-mail.';
    }
    const orderEl = document.getElementById('success-order');
    if (orderEl && orderId) {
      orderEl.textContent = `Pedido #${orderId} · Total ${formatBRL(amount)} · Guarde este número para qualquer atendimento.`;
    }
    showPanel('success');
    document.getElementById('checkout-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startPolling(orderId, amount) {
    stopTimersPollOnly();
    pollTicks = 0;
    pollTimer = setInterval(async () => {
      pollTicks++;
      try {
        // A cada 3 ciclos, força a conferência direto na operadora (cobre atraso de webhook)
        if (pollTicks % 3 === 0) {
          const syncRes = await fetch(`${apiBase()}/tickets/orders/${orderId}/sync`, { method: 'POST' });
          const sync = await syncRes.json().catch(() => ({}));
          if (sync.status === 'paid') {
            showSuccess(orderId, amount);
            return;
          }
        }
        const res = await fetch(`${apiBase()}/tickets/orders/${orderId}`);
        const data = await res.json().catch(() => ({}));
        if (data.status === 'paid') {
          showSuccess(orderId, amount);
        } else if (data.status === 'cancelled' || data.status === 'expired') {
          stopTimers();
          const statusEl = document.getElementById('pix-status');
          if (statusEl) statusEl.innerHTML = 'Pagamento não concluído. Gere um novo código para tentar de novo.';
          const procEl = document.getElementById('processing-panel');
          if (procEl && !procEl.classList.contains('hidden')) {
            resetPaymentPanels();
            showCheckoutError('Pagamento não aprovado. Tente novamente ou use outra forma de pagamento.');
          }
        }
      } catch (_) {
        /* tenta de novo no próximo ciclo */
      }
    }, 4000);
  }

  function stopTimersPollOnly() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPixCountdown(expiresAt) {
    if (countdownTimer) clearInterval(countdownTimer);
    const expiryEl = document.getElementById('pix-expiry');
    const end = new Date(expiresAt).getTime();
    if (!end || Number.isNaN(end)) return;

    const tick = () => {
      const remaining = Math.floor((end - Date.now()) / 1000);
      if (remaining <= 0) {
        stopTimers();
        if (expiryEl) expiryEl.textContent = 'Código expirado.';
        const statusEl = document.getElementById('pix-status');
        if (statusEl) statusEl.innerHTML = 'O código Pix expirou. Volte e gere um novo para concluir a compra.';
        const cancelBtn = document.getElementById('pix-cancel');
        if (cancelBtn) cancelBtn.textContent = 'Gerar novo código';
        return;
      }
      const m = String(Math.floor(remaining / 60)).padStart(2, '0');
      const s = String(remaining % 60).padStart(2, '0');
      if (expiryEl) expiryEl.textContent = `O código expira em ${m}:${s}`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function showPixPanel(data) {
    activeOrderId = data.order_id;
    const amountEl = document.getElementById('pix-amount');
    if (amountEl) amountEl.textContent = `Total: ${formatBRL(data.amount)}`;
    const qrEl = document.getElementById('pix-qr');
    if (qrEl && data.pix?.qr_code_base64) {
      qrEl.src = `data:image/png;base64,${data.pix.qr_code_base64}`;
    }
    const codeEl = document.getElementById('pix-code');
    if (codeEl) codeEl.value = data.pix?.qr_code || '';
    const statusEl = document.getElementById('pix-status');
    if (statusEl) statusEl.innerHTML = '<span class="waiting-dot"></span>Aguardando pagamento — a confirmação é automática';
    const cancelBtn = document.getElementById('pix-cancel');
    if (cancelBtn) cancelBtn.textContent = 'Cancelar e voltar';

    showPanel('pix');
    document.getElementById('checkout-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    startPixCountdown(data.pix?.expires_at);
    startPolling(data.order_id, data.amount);
  }

  async function copyPixCode() {
    const codeEl = document.getElementById('pix-code');
    const btn = document.getElementById('pix-copy-btn');
    if (!codeEl?.value) return;
    try {
      await navigator.clipboard.writeText(codeEl.value);
    } catch (_) {
      codeEl.select();
      document.execCommand('copy');
    }
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copiado!';
      setTimeout(() => { btn.textContent = prev; }, 2000);
    }
  }

  async function buildCardPayload() {
    const mp = getMp();
    if (!mp) {
      throw new Error('Pagamento com cartão indisponível no momento. Use Pix.');
    }
    const number = onlyDigits(document.getElementById('card-number')?.value);
    const expiry = onlyDigits(document.getElementById('card-expiry')?.value);
    const cvv = onlyDigits(document.getElementById('card-cvv')?.value);
    const holder = document.getElementById('card-holder')?.value?.trim();
    const cpf = onlyDigits(document.getElementById('card-cpf')?.value);
    const installments = parseInt(document.getElementById('card-installments')?.value, 10) || 1;

    if (number.length < 13) throw new Error('Confira o número do cartão.');
    if (expiry.length !== 4) throw new Error('Confira a validade do cartão (MM/AA).');
    if (cvv.length < 3) throw new Error('Confira o código de segurança (CVV).');
    if (!holder) throw new Error('Informe o nome impresso no cartão.');
    if (cpf.length !== 11) throw new Error('Informe o CPF do titular do cartão.');
    if (!cardPaymentMethodId) await detectCardBrand();
    if (!cardPaymentMethodId) throw new Error('Não reconhecemos a bandeira do cartão. Confira o número.');

    let token;
    try {
      token = await mp.createCardToken({
        cardNumber: number,
        cardholderName: holder,
        cardExpirationMonth: expiry.slice(0, 2),
        cardExpirationYear: `20${expiry.slice(2)}`,
        securityCode: cvv,
        identificationType: 'CPF',
        identificationNumber: cpf
      });
    } catch (_) {
      throw new Error('Dados do cartão inválidos. Revise as informações e tente novamente.');
    }
    if (!token?.id) {
      throw new Error('Não foi possível validar o cartão. Tente novamente.');
    }

    return {
      token: token.id,
      installments,
      payment_method_id: cardPaymentMethodId,
      issuer_id: cardIssuerId,
      identification_type: 'CPF',
      identification_number: cpf
    };
  }

  async function submitCheckout(e) {
    e.preventDefault();
    const btn = document.getElementById('checkout-submit');
    const errEl = document.getElementById('checkout-error');
    errEl?.classList.add('hidden');

    const qty = parseInt(document.getElementById('checkout-qty').value, 10) || 1;
    const assigneeError = validateCheckoutAssignees(qty);
    if (assigneeError) {
      showCheckoutError(assigneeError);
      return;
    }

    const payload = {
      lot_id: Number(document.getElementById('checkout-lot').value),
      quantity: qty,
      buyer_name: document.getElementById('checkout-name').value.trim(),
      buyer_email: document.getElementById('checkout-email').value.trim(),
      buyer_phone: onlyDigits(document.getElementById('checkout-phone').value) || undefined,
      assignees: buildAssigneesPayload(qty),
      payment_method: paymentMethod
    };

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = paymentMethod === 'card' ? 'Processando pagamento…' : 'Gerando código Pix…';

    try {
      if (paymentMethod === 'card') {
        payload.card = await buildCardPayload();
      }

      const res = await fetch(`${apiBase()}/tickets/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao processar o pagamento');

      if (data.payment_method === 'pix') {
        btn.disabled = false;
        btn.textContent = prev;
        showPixPanel(data);
        return;
      }

      if (data.status === 'approved') {
        showSuccess(data.order_id, data.amount);
        btn.disabled = false;
        btn.textContent = prev;
        return;
      }

      if (data.status === 'in_process') {
        activeOrderId = data.order_id;
        showPanel('processing');
        startPolling(data.order_id, data.amount);
        btn.disabled = false;
        btn.textContent = prev;
        return;
      }

      throw new Error('Não foi possível confirmar o pagamento. Tente novamente.');
    } catch (err) {
      showCheckoutError(err.message || 'Erro ao processar o pagamento');
      btn.disabled = false;
      btn.textContent = prev;
      updatePayButton();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    showPaymentBanner();
    const isDetail = Boolean(document.getElementById('event-detail'));
    if (isDetail) {
      loadEventDetail();
      loadPaymentConfig();
      setupPhoneInputMask();
      setupCardInputMasks();
      fillDefaultInstallments();
    } else {
      loadEvents();
    }
    document.getElementById('checkout-lot')?.addEventListener('change', updateTotal);
    document.getElementById('checkout-qty')?.addEventListener('input', onCheckoutQtyChange);
    document.getElementById('checkout-assignee-slots')?.addEventListener('click', onCheckoutAssigneeClick);
    document.getElementById('checkout-assignee-slots')?.addEventListener('input', onCheckoutAssigneeInput);
    document.getElementById('checkout-form')?.addEventListener('submit', submitCheckout);
    document.getElementById('pay-method-pix')?.addEventListener('click', () => setPaymentMethod('pix'));
    document.getElementById('pay-method-card')?.addEventListener('click', () => setPaymentMethod('card'));
    document.getElementById('pix-copy-btn')?.addEventListener('click', copyPixCode);
    document.getElementById('pix-cancel')?.addEventListener('click', resetPaymentPanels);
  });
})();
