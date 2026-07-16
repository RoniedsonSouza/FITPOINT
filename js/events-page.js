// Página pública de eventos / checkout de ingressos

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
      el.textContent = 'Pagamento não concluído. Você pode tentar novamente escolhendo um evento abaixo.';
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
        return `
          <article class="card flex flex-col">
            ${ev.image_url ? `<img src="${escapeHtml(ev.image_url)}" alt="" class="w-full h-44 object-cover">` : ''}
            <div class="p-5 flex flex-col flex-1">
              <h2 class="font-display text-xl font-bold">${escapeHtml(ev.title)}</h2>
              <p class="text-sm text-black/60 mt-2">${formatDate(ev.starts_at)}</p>
              ${ev.venue ? `<p class="text-sm text-black/60 mt-1">${escapeHtml(ev.venue)}</p>` : ''}
              ${ev.description ? `<p class="text-sm mt-3 line-clamp-3">${escapeHtml(ev.description)}</p>` : ''}
              <div class="mt-auto pt-4 flex items-center justify-between gap-3">
                <span class="text-sm font-semibold text-fp-green">
                  ${minPrice != null ? `A partir de ${formatBRL(minPrice)}` : 'Sem lotes'}
                </span>
                <button type="button" class="btn" data-buy-event="${ev.id}" ${!hasStock ? 'disabled' : ''}>
                  ${hasStock ? 'Comprar' : 'Esgotado'}
                </button>
              </div>
            </div>
          </article>
        `;
      }).join('');

      list.querySelectorAll('[data-buy-event]').forEach((btn) => {
        btn.addEventListener('click', () => openCheckout(Number(btn.dataset.buyEvent)));
      });
    } catch (err) {
      console.error(err);
      list.innerHTML = '<p class="text-red-600">Não foi possível carregar os eventos.</p>';
    }
  }

  async function openCheckout(eventId) {
    const list = document.getElementById('events-public-list');
    const panel = document.getElementById('checkout-panel');
    const errEl = document.getElementById('checkout-error');
    if (errEl) {
      errEl.classList.add('hidden');
      errEl.textContent = '';
    }

    try {
      const response = await fetch(`${apiBase()}/events/${eventId}`);
      if (!response.ok) throw new Error('Evento não encontrado');
      currentEvent = await response.json();
      currentLots = (currentEvent.lots || []).filter((l) => l.quantity_available > 0);

      if (!currentLots.length) {
        alert('Não há ingressos disponíveis para este evento.');
        return;
      }

      document.getElementById('checkout-event-title').textContent = currentEvent.title;
      document.getElementById('checkout-event-meta').textContent =
        `${formatDate(currentEvent.starts_at)}${currentEvent.venue ? ' · ' + currentEvent.venue : ''}`;

      const lotSelect = document.getElementById('checkout-lot');
      lotSelect.innerHTML = currentLots.map((lot) =>
        `<option value="${lot.id}">${escapeHtml(lot.name)} — ${formatBRL(lot.price)} (${lot.quantity_available} disp.)</option>`
      ).join('');

      document.getElementById('checkout-qty').value = '1';
      updateTotal();

      list?.classList.add('hidden');
      panel?.classList.remove('hidden');
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      alert(err.message || 'Erro ao abrir checkout');
    }
  }

  function closeCheckout() {
    document.getElementById('checkout-panel')?.classList.add('hidden');
    document.getElementById('events-public-list')?.classList.remove('hidden');
    currentEvent = null;
    currentLots = [];
  }

  function updateTotal() {
    const lotId = Number(document.getElementById('checkout-lot')?.value);
    const qty = parseInt(document.getElementById('checkout-qty')?.value, 10) || 1;
    const lot = currentLots.find((l) => l.id === lotId);
    const total = lot ? Number(lot.price) * qty : 0;
    const el = document.getElementById('checkout-total');
    if (el) el.textContent = `Total: ${formatBRL(total)}`;
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
    loadEvents();
    document.getElementById('checkout-back')?.addEventListener('click', closeCheckout);
    document.getElementById('checkout-lot')?.addEventListener('change', updateTotal);
    document.getElementById('checkout-qty')?.addEventListener('input', updateTotal);
    document.getElementById('checkout-form')?.addEventListener('submit', submitCheckout);
  });
})();
