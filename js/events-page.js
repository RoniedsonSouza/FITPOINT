// Página pública de eventos / detalhe / checkout de ingressos

(function () {
  let eventsData = [];
  let currentEvent = null;
  let currentLots = [];

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
      const inner = `
        <span class="font-semibold text-sm">${escapeHtml(s.fantasy_name || handle)}</span>
        <span class="text-xs text-fp-green">${escapeHtml(handle)}</span>
      `;
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
    updateTotal();
    panel.classList.remove('hidden');
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

      root.innerHTML = `
        <article>
          <div class="event-cover rounded-2xl overflow-hidden">
            ${cover ? `<img src="${escapeHtml(cover)}" alt="">` : ''}
          </div>
          <div class="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start -mt-10 sm:-mt-12 px-1 relative z-10">
            <div class="event-logo ml-3 sm:ml-6">
              ${logo ? `<img src="${escapeHtml(logo)}" alt="Logo do evento">` : ''}
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
  }

  async function submitCheckout(e) {
    e.preventDefault();
    const btn = document.getElementById('checkout-submit');
    const errEl = document.getElementById('checkout-error');
    errEl?.classList.add('hidden');

    const payload = {
      lot_id: Number(document.getElementById('checkout-lot').value),
      quantity: parseInt(document.getElementById('checkout-qty').value, 10) || 1,
      buyer_name: document.getElementById('checkout-name').value.trim(),
      buyer_email: document.getElementById('checkout-email').value.trim(),
      buyer_phone: document.getElementById('checkout-phone').value.trim() || undefined
    };

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Redirecionando…';

    try {
      const data = typeof DB !== 'undefined' && DB.checkoutTicket
        ? await DB.checkoutTicket(payload)
        : await (async () => {
            const res = await fetch(`${apiBase()}/tickets/checkout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'Erro no checkout');
            return body;
          })();

      if (!data.init_point) {
        throw new Error('Link de pagamento não retornado');
      }
      window.location.href = data.init_point;
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Erro ao iniciar pagamento';
        errEl.classList.remove('hidden');
      }
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    showPaymentBanner();
    const isDetail = Boolean(document.getElementById('event-detail'));
    if (isDetail) {
      loadEventDetail();
    } else {
      loadEvents();
    }
    document.getElementById('checkout-lot')?.addEventListener('change', updateTotal);
    document.getElementById('checkout-qty')?.addEventListener('input', updateTotal);
    document.getElementById('checkout-form')?.addEventListener('submit', submitCheckout);
  });
})();
