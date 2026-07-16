// Módulo Eventos / Ingressos

let editingEventId = null;
let editingLotId = null;
let selectedEventId = null;
let eventsCache = [];
let savedEventLogoUrl = null;
let savedEventCoverUrl = null;
let ticketQrScanner = null;
let ticketQrScanBusy = false;
let ticketQrLastCode = '';
let ticketQrLastAt = 0;
const TICKET_QR_COOLDOWN_MS = 2500;

function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

const LOT_PROMO_MODE_LABELS = {
  repeat: 'pacote repetido',
  once: 'aplicada uma vez',
  proportional: 'unitário promocional'
};

function lotHasPromo(lot) {
  return Boolean(lot && lot.promo_enabled && Number(lot.promo_qty) >= 2 && Number(lot.promo_price) > 0);
}

// Espelho de services/ticketPricing.js (apenas para pré-visualização no admin)
function computeLotTotal(price, promo, qty) {
  const unit = Number(price);
  const base = Math.round(unit * qty * 100) / 100;
  if (!promo || qty < promo.qty) return base;
  let total;
  if (promo.mode === 'once') {
    total = promo.price + (qty - promo.qty) * unit;
  } else if (promo.mode === 'proportional') {
    total = (promo.price / promo.qty) * qty;
  } else {
    total = Math.floor(qty / promo.qty) * promo.price + (qty % promo.qty) * unit;
  }
  total = Math.round(total * 100) / 100;
  return total >= base ? base : total;
}

function toggleLotPromoFields() {
  const enabled = document.getElementById('lot-promo-enabled')?.checked;
  document.getElementById('lot-promo-fields')?.classList.toggle('hidden', !enabled);
  updateLotPromoPreview();
}

function updateLotPromoPreview() {
  const el = document.getElementById('lot-promo-preview');
  if (!el) return;
  const enabled = document.getElementById('lot-promo-enabled')?.checked;
  const price = parseFloat(document.getElementById('lot-price')?.value);
  const qty = parseInt(document.getElementById('lot-promo-qty')?.value, 10);
  const promoPrice = parseFloat(document.getElementById('lot-promo-price')?.value);
  const mode = document.getElementById('lot-promo-mode')?.value || 'repeat';

  if (!enabled || !price || !qty || qty < 2 || !promoPrice) {
    el.textContent = '';
    return;
  }
  if (promoPrice >= price * qty) {
    el.textContent = `Atenção: o preço do pacote precisa ser menor que ${formatBRL(price * qty)} para haver desconto.`;
    return;
  }
  const promo = { qty, price: promoPrice, mode };
  const samples = [1, qty, qty + 1, qty * 2]
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .map((n) => `${n} = ${formatBRL(computeLotTotal(price, promo, n))}`);
  el.textContent = `Exemplo: ${samples.join(' · ')}`;
}

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatEventDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

async function loadEvents() {
  const container = document.getElementById('events-list');
  if (!container || typeof DB === 'undefined') return;
  container.innerHTML = '<p class="text-black/60">Carregando...</p>';

  try {
    eventsCache = await DB.getEvents({ all: true });
    renderEventsList();
    if (!selectedEventId) {
      await loadTicketsAdmin();
    }
    refreshIcons();
  } catch (error) {
    if (handleAuthError(error)) return;
    container.innerHTML = '<p class="text-red-600">Erro ao carregar eventos.</p>';
  }
}

function renderEventsList() {
  const container = document.getElementById('events-list');
  if (!container) return;

  if (!eventsCache.length) {
    container.innerHTML = '<p class="text-black/60">Nenhum evento. Clique em "Novo evento".</p>';
    document.getElementById('event-detail-panel')?.classList.add('hidden');
    return;
  }

  container.innerHTML = eventsCache.map((ev) => `
    <div class="card ${selectedEventId === ev.id ? 'ring-2 ring-fp-green' : ''}">
      <div class="flex items-start justify-between gap-3">
        <button type="button" class="text-left flex-1" onclick="selectEvent(${ev.id})">
          <h3 class="font-semibold">${escapeHtml(ev.title)}</h3>
          <p class="text-xs text-black/50 mt-1">${formatEventDate(ev.starts_at)}${ev.venue ? ' · ' + escapeHtml(ev.venue) : ''}</p>
          <p class="text-xs mt-1 ${ev.active === false ? 'text-red-600' : 'text-fp-green'}">${ev.active === false ? 'Inativo' : 'Ativo'}</p>
        </button>
        <div class="flex gap-2 shrink-0">
          <button type="button" onclick="editEvent(${ev.id})" class="btn btn-outline btn-sm btn-icon" title="Editar">
            <i data-lucide="edit"></i>
          </button>
          <button type="button" onclick="deleteEvent(${ev.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir">
            <i data-lucide="trash"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');

  if (selectedEventId && !eventsCache.some((e) => e.id === selectedEventId)) {
    selectedEventId = null;
    document.getElementById('event-detail-panel')?.classList.add('hidden');
  } else if (selectedEventId) {
    selectEvent(selectedEventId);
  }
}

async function selectEvent(id) {
  selectedEventId = id;
  const panel = document.getElementById('event-detail-panel');
  const titleEl = document.getElementById('event-detail-title');
  const lotsEl = document.getElementById('event-lots-list');
  if (!panel || !lotsEl) return;

  panel.classList.remove('hidden');
  const ev = eventsCache.find((e) => e.id === id);
  if (titleEl) titleEl.textContent = ev ? ev.title : 'Evento';

  renderEventsListHighlight();

  lotsEl.innerHTML = '<p class="text-black/60 text-sm">Carregando lotes…</p>';
  try {
    const lots = await DB.getEventLots(id);
    if (!lots.length) {
      lotsEl.innerHTML = '<p class="text-black/60 text-sm">Nenhum lote. Crie o primeiro lote de ingressos.</p>';
    } else {
      lotsEl.innerHTML = lots.map((lot) => `
        <div class="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 class="font-semibold text-sm">${escapeHtml(lot.name)}</h4>
            <p class="text-xs text-black/50 mt-1">
              ${formatBRL(lot.price)} · ${lot.quantity_sold}/${lot.quantity_total} vendidos
              · ${lot.quantity_available} disponíveis
              ${lot.active === false ? ' · Inativo' : ''}
            </p>
            ${lotHasPromo(lot) ? `<p class="text-xs text-fp-green font-semibold mt-1">Promo: ${lot.promo_qty} por ${formatBRL(lot.promo_price)} (${LOT_PROMO_MODE_LABELS[lot.promo_mode] || lot.promo_mode})</p>` : ''}
          </div>
          <div class="flex gap-2 shrink-0">
            <button type="button" onclick="editLot(${lot.id})" class="btn btn-outline btn-sm btn-icon" title="Editar lote">
              <i data-lucide="edit"></i>
            </button>
            <button type="button" onclick="deleteLot(${lot.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir lote">
              <i data-lucide="trash"></i>
            </button>
          </div>
        </div>
      `).join('');
    }
    refreshIcons();
  } catch (error) {
    if (handleAuthError(error)) return;
    lotsEl.innerHTML = '<p class="text-red-600 text-sm">Erro ao carregar lotes.</p>';
  }

  const filter = document.getElementById('tickets-event-filter');
  if (filter) {
    if (filter.options.length <= 1 && eventsCache.length) {
      filter.innerHTML =
        '<option value="">Todos os eventos</option>' +
        eventsCache.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('');
    }
    filter.value = String(id);
  }
  await loadTicketsAdmin();
}

function renderEventsListHighlight() {
  const container = document.getElementById('events-list');
  if (!container || !eventsCache.length) return;
  // Re-render only selection ring via selectEvent calling renderEventsList causes recursion;
  // instead update rings after list exists:
  container.querySelectorAll('[onclick^="selectEvent"]').forEach((btn) => {
    const match = btn.getAttribute('onclick')?.match(/selectEvent\((\d+)\)/);
    const id = match ? Number(match[1]) : null;
    const card = btn.closest('.card');
    if (card) {
      card.classList.toggle('ring-2', id === selectedEventId);
      card.classList.toggle('ring-fp-green', id === selectedEventId);
    }
  });
}

function setEventImagePreview(previewId, url) {
  const prevImg = document.getElementById(previewId);
  if (!prevImg) return;
  if (prevImg.src && prevImg.src.startsWith('blob:')) URL.revokeObjectURL(prevImg.src);
  if (url) {
    prevImg.src = url;
    prevImg.classList.remove('hidden');
  } else {
    prevImg.removeAttribute('src');
    prevImg.classList.add('hidden');
  }
}

function clearEventImageFields() {
  const logoFile = document.getElementById('event-logo-file');
  const coverFile = document.getElementById('event-cover-file');
  if (logoFile) logoFile.value = '';
  if (coverFile) coverFile.value = '';
  savedEventLogoUrl = null;
  savedEventCoverUrl = null;
  setEventImagePreview('event-logo-preview', null);
  setEventImagePreview('event-cover-preview', null);
}

function addEventSponsorRow(sponsor = null) {
  const list = document.getElementById('event-sponsors-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'event-sponsor-row';
  row.innerHTML = `
    <input type="text" class="event-sponsor-name flex-1 min-w-0" placeholder="Nome" value="" aria-label="Nome fantasia">
    <input type="text" class="event-sponsor-instagram flex-1 min-w-0" placeholder="@instagram" value="" aria-label="Instagram">
    <button type="button" class="btn btn-danger btn-sm btn-icon" title="Remover patrocinador" aria-label="Remover">
      <i data-lucide="trash-2"></i>
    </button>
  `;
  const nameInput = row.querySelector('.event-sponsor-name');
  const igInput = row.querySelector('.event-sponsor-instagram');
  if (sponsor) {
    nameInput.value = sponsor.fantasy_name || '';
    igInput.value = sponsor.instagram || '';
  }
  row.querySelector('button')?.addEventListener('click', () => {
    row.remove();
  });
  list.appendChild(row);
  refreshIcons();
}

function renderEventSponsors(sponsors) {
  const list = document.getElementById('event-sponsors-list');
  if (!list) return;
  list.innerHTML = '';
  const items = Array.isArray(sponsors) ? sponsors : [];
  if (!items.length) {
    addEventSponsorRow();
    return;
  }
  items.forEach((s) => addEventSponsorRow(s));
}

function collectEventSponsors() {
  const rows = document.querySelectorAll('#event-sponsors-list .event-sponsor-row');
  const sponsors = [];
  rows.forEach((row) => {
    const fantasy_name = row.querySelector('.event-sponsor-name')?.value?.trim() || '';
    const instagram = row.querySelector('.event-sponsor-instagram')?.value?.trim() || '';
    if (!fantasy_name && !instagram) return;
    sponsors.push({ fantasy_name, instagram });
  });
  return sponsors;
}

function openEventModal(eventId = null) {
  editingEventId = eventId;
  const modal = document.getElementById('event-modal');
  const title = document.getElementById('event-modal-title');
  const form = document.getElementById('event-form');

  if (eventId) {
    title.textContent = 'Editar evento';
    const ev = eventsCache.find((e) => e.id === eventId);
    if (ev) {
      document.getElementById('event-id-input').value = ev.id;
      document.getElementById('event-title').value = ev.title || '';
      document.getElementById('event-description').value = ev.description || '';
      document.getElementById('event-venue').value = ev.venue || '';
      document.getElementById('event-starts-at').value = toDatetimeLocalValue(ev.starts_at);
      document.getElementById('event-active').checked = ev.active !== false;
      savedEventLogoUrl = ev.logo_url || null;
      savedEventCoverUrl = ev.cover_url || null;
      setEventImagePreview('event-logo-preview', savedEventLogoUrl);
      setEventImagePreview('event-cover-preview', savedEventCoverUrl);
      const logoFile = document.getElementById('event-logo-file');
      const coverFile = document.getElementById('event-cover-file');
      if (logoFile) logoFile.value = '';
      if (coverFile) coverFile.value = '';
      renderEventSponsors(ev.sponsors);
    }
  } else {
    title.textContent = 'Novo evento';
    form.reset();
    document.getElementById('event-id-input').value = '';
    document.getElementById('event-active').checked = true;
    clearEventImageFields();
    renderEventSponsors([]);
  }
  modal.classList.add('active');
  refreshIcons();
}

function closeEventModal() {
  const logoPrev = document.getElementById('event-logo-preview');
  const coverPrev = document.getElementById('event-cover-preview');
  if (logoPrev?.src?.startsWith('blob:')) URL.revokeObjectURL(logoPrev.src);
  if (coverPrev?.src?.startsWith('blob:')) URL.revokeObjectURL(coverPrev.src);
  document.getElementById('event-modal')?.classList.remove('active');
  editingEventId = null;
}

function editEvent(id) {
  openEventModal(id);
}

async function saveEvent(event) {
  event.preventDefault();
  const btn = event.submitter || document.querySelector('#event-form button[type="submit"]');
  let logo_url = savedEventLogoUrl;
  let cover_url = savedEventCoverUrl;

  const payload = {
    title: document.getElementById('event-title').value.trim(),
    description: document.getElementById('event-description').value.trim(),
    venue: document.getElementById('event-venue').value.trim(),
    starts_at: fromDatetimeLocalValue(document.getElementById('event-starts-at').value),
    logo_url,
    cover_url,
    sponsors: collectEventSponsors(),
    active: document.getElementById('event-active').checked
  };

  if (!payload.starts_at) {
    showToast('Informe a data/hora do evento', 'error');
    return;
  }

  await withButtonLoading(btn, async () => {
    try {
      const logoFile = document.getElementById('event-logo-file');
      if (logoFile?.files?.[0]) {
        const { url } = await DB.uploadEventImage(logoFile.files[0]);
        logo_url = url;
        savedEventLogoUrl = url;
        payload.logo_url = url;
      }
      const coverFile = document.getElementById('event-cover-file');
      if (coverFile?.files?.[0]) {
        const { url } = await DB.uploadEventImage(coverFile.files[0]);
        cover_url = url;
        savedEventCoverUrl = url;
        payload.cover_url = url;
      }

      if (editingEventId) {
        await DB.updateEvent(editingEventId, payload);
        showToast('Evento atualizado!');
      } else {
        const created = await DB.addEvent(payload);
        selectedEventId = created.id;
        showToast('Evento criado!');
      }
      closeEventModal();
      await loadEvents();
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, 'Salvando…');
}

function wireEventImagePreviews() {
  const pairs = [
    ['event-logo-file', 'event-logo-preview', () => savedEventLogoUrl],
    ['event-cover-file', 'event-cover-preview', () => savedEventCoverUrl]
  ];
  pairs.forEach(([fileId, previewId, getSavedUrl]) => {
    const fileInput = document.getElementById(fileId);
    const preview = document.getElementById(previewId);
    if (!fileInput || !preview) return;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (preview.src && preview.src.startsWith('blob:')) {
        URL.revokeObjectURL(preview.src);
      }
      if (f) {
        preview.src = URL.createObjectURL(f);
        preview.classList.remove('hidden');
      } else {
        const saved = getSavedUrl();
        if (saved) {
          preview.src = saved;
          preview.classList.remove('hidden');
        } else {
          preview.removeAttribute('src');
          preview.classList.add('hidden');
        }
      }
    });
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', wireEventImagePreviews);
}

async function deleteEvent(id) {
  if (!confirm('Excluir este evento? Lotes sem vendas também serão removidos.')) return;
  try {
    await DB.deleteEvent(id);
    if (selectedEventId === id) selectedEventId = null;
    showToast('Evento excluído!');
    await loadEvents();
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}

function openLotModal(lotId = null) {
  if (!selectedEventId) {
    showToast('Selecione um evento primeiro', 'error');
    return;
  }
  editingLotId = lotId;
  const modal = document.getElementById('lot-modal');
  const title = document.getElementById('lot-modal-title');
  const form = document.getElementById('lot-form');

  if (lotId) {
    title.textContent = 'Editar lote';
    DB.getEventLots(selectedEventId).then((lots) => {
      const lot = lots.find((l) => l.id === lotId);
      if (!lot) return;
      document.getElementById('lot-id-input').value = lot.id;
      document.getElementById('lot-name').value = lot.name || '';
      document.getElementById('lot-price').value = lot.price;
      document.getElementById('lot-quantity').value = lot.quantity_total;
      document.getElementById('lot-sales-start').value = toDatetimeLocalValue(lot.sales_start);
      document.getElementById('lot-sales-end').value = toDatetimeLocalValue(lot.sales_end);
      document.getElementById('lot-active').checked = lot.active !== false;
      document.getElementById('lot-promo-enabled').checked = lot.promo_enabled === true;
      document.getElementById('lot-promo-qty').value = lot.promo_qty ?? '';
      document.getElementById('lot-promo-price').value = lot.promo_price ?? '';
      document.getElementById('lot-promo-mode').value = lot.promo_mode || 'repeat';
      toggleLotPromoFields();
    });
  } else {
    title.textContent = 'Novo lote';
    form.reset();
    document.getElementById('lot-id-input').value = '';
    document.getElementById('lot-active').checked = true;
    document.getElementById('lot-promo-enabled').checked = false;
    document.getElementById('lot-promo-mode').value = 'repeat';
    toggleLotPromoFields();
  }
  modal.classList.add('active');
}

function closeLotModal() {
  document.getElementById('lot-modal')?.classList.remove('active');
  editingLotId = null;
}

function editLot(id) {
  openLotModal(id);
}

async function saveLot(event) {
  event.preventDefault();
  if (!selectedEventId) return;
  const btn = event.submitter || document.querySelector('#lot-form button[type="submit"]');
  const promoEnabled = document.getElementById('lot-promo-enabled').checked;
  const promoQtyRaw = document.getElementById('lot-promo-qty').value;
  const promoPriceRaw = document.getElementById('lot-promo-price').value;
  const payload = {
    name: document.getElementById('lot-name').value.trim(),
    price: parseFloat(document.getElementById('lot-price').value),
    quantity_total: parseInt(document.getElementById('lot-quantity').value, 10),
    sales_start: fromDatetimeLocalValue(document.getElementById('lot-sales-start').value),
    sales_end: fromDatetimeLocalValue(document.getElementById('lot-sales-end').value),
    active: document.getElementById('lot-active').checked,
    promo_enabled: promoEnabled,
    promo_qty: promoQtyRaw ? parseInt(promoQtyRaw, 10) : null,
    promo_price: promoPriceRaw ? parseFloat(promoPriceRaw) : null,
    promo_mode: document.getElementById('lot-promo-mode').value || 'repeat'
  };

  if (promoEnabled) {
    if (!payload.promo_qty || payload.promo_qty < 2) {
      showToast('Quantidade da promoção deve ser pelo menos 2', 'error');
      return;
    }
    if (!payload.promo_price || payload.promo_price <= 0) {
      showToast('Informe o preço do pacote promocional', 'error');
      return;
    }
    if (payload.promo_price >= payload.price * payload.promo_qty) {
      showToast('Preço do pacote deve ser menor que a soma dos ingressos sem desconto', 'error');
      return;
    }
  }

  await withButtonLoading(btn, async () => {
    try {
      if (editingLotId) {
        await DB.updateEventLot(selectedEventId, editingLotId, payload);
        showToast('Lote atualizado!');
      } else {
        await DB.addEventLot(selectedEventId, payload);
        showToast('Lote criado!');
      }
      closeLotModal();
      await selectEvent(selectedEventId);
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, 'Salvando…');
}

async function deleteLot(id) {
  if (!selectedEventId) return;
  if (!confirm('Excluir este lote?')) return;
  try {
    await DB.deleteEventLot(selectedEventId, id);
    showToast('Lote excluído!');
    await selectEvent(selectedEventId);
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}

async function loadTicketsAdmin() {
  const container = document.getElementById('tickets-admin-list');
  const filter = document.getElementById('tickets-event-filter');
  const statusFilter = document.getElementById('tickets-status-filter');
  const search = document.getElementById('tickets-search');
  if (!container) return;

  if (filter && filter.options.length <= 1 && eventsCache.length) {
    filter.innerHTML =
      '<option value="">Todos os eventos</option>' +
      eventsCache.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('');
    if (selectedEventId) filter.value = String(selectedEventId);
  }

  container.innerHTML = '<p class="text-black/60 text-sm">Carregando ingressos…</p>';
  try {
    const data = await DB.getTickets({
      event_id: filter?.value || undefined,
      status: statusFilter?.value || undefined,
      q: search?.value?.trim() || undefined,
      limit: 50
    });
    const items = data.items || [];
    if (!items.length) {
      container.innerHTML = '<p class="text-black/60 text-sm">Nenhum ingresso encontrado.</p>';
      return;
    }
    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-black/50 border-b border-black/10">
              <th class="py-2 pr-3">Código</th>
              <th class="py-2 pr-3">Comprador</th>
              <th class="py-2 pr-3">Evento</th>
              <th class="py-2 pr-3">Lote</th>
              <th class="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (t) => `
              <tr class="border-b border-black/5">
                <td class="py-2 pr-3 font-mono text-xs">${escapeHtml(t.code)}</td>
                <td class="py-2 pr-3">${escapeHtml(t.buyer_name)}<br><span class="text-xs text-black/50">${escapeHtml(t.buyer_email)}</span></td>
                <td class="py-2 pr-3">${escapeHtml(t.event_title)}</td>
                <td class="py-2 pr-3">${escapeHtml(t.lot_name)}</td>
                <td class="py-2">${t.status === 'used' ? 'Usado' : t.status === 'cancelled' ? 'Cancelado' : 'Válido'}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-black/50 mt-2">${data.total} ingresso(s)</p>
    `;
  } catch (error) {
    if (handleAuthError(error)) return;
    container.innerHTML = '<p class="text-red-600 text-sm">Erro ao carregar ingressos.</p>';
  }
}

async function submitTicketValidation(code, options = {}) {
  const { fromScanner = false } = options;
  const input = document.getElementById('ticket-validate-code');
  const resultEl = document.getElementById('ticket-validate-result');
  const btn = document.querySelector('#ticket-validate-form button[type="submit"]');
  const trimmed = String(code || '').trim();
  if (!trimmed) {
    showToast('Informe o código', 'error');
    return false;
  }

  if (input) input.value = trimmed;

  const run = async () => {
    try {
      const data = await DB.validateTicket(trimmed);
      if (resultEl) {
        resultEl.className = 'mt-3 text-sm text-fp-green';
        resultEl.textContent = `OK — ${data.ticket.buyer_name} · ${data.ticket.event_title} · ${data.ticket.lot_name}`;
      }
      showToast('Ingresso validado!');
      if (input) input.value = '';
      await loadTicketsAdmin();
      return true;
    } catch (error) {
      if (handleAuthError(error)) return false;
      if (resultEl) {
        resultEl.className = 'mt-3 text-sm text-red-600';
        const extra = error.data?.ticket
          ? ` (${error.data.ticket.buyer_name || ''} · ${error.data.ticket.status || ''})`
          : '';
        resultEl.textContent = error.message + extra;
      }
      showToast(error.message, 'error');
      return false;
    }
  };

  if (fromScanner || !btn) {
    return run();
  }
  let ok = false;
  await withButtonLoading(btn, async () => {
    ok = await run();
  }, 'Validando…');
  return ok;
}

async function validateTicketCode(event) {
  event.preventDefault();
  const input = document.getElementById('ticket-validate-code');
  await submitTicketValidation(input?.value);
}

function setTicketQrUiActive(active) {
  document.getElementById('ticket-qr-reader-wrap')?.classList.toggle('hidden', !active);
  document.getElementById('ticket-qr-start-btn')?.classList.toggle('hidden', active);
  document.getElementById('ticket-qr-stop-btn')?.classList.toggle('hidden', !active);
  refreshIcons();
}

async function onTicketQrDecoded(decodedText) {
  const code = String(decodedText || '').trim();
  if (!code || ticketQrScanBusy) return;

  const now = Date.now();
  if (code === ticketQrLastCode && now - ticketQrLastAt < TICKET_QR_COOLDOWN_MS) return;

  ticketQrScanBusy = true;
  ticketQrLastCode = code;
  ticketQrLastAt = now;
  try {
    await submitTicketValidation(code, { fromScanner: true });
  } finally {
    setTimeout(() => {
      ticketQrScanBusy = false;
    }, TICKET_QR_COOLDOWN_MS);
  }
}

async function startTicketQrScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Biblioteca de QR não carregada. Recarregue a página.', 'error');
    return;
  }
  if (ticketQrScanner) {
    setTicketQrUiActive(true);
    return;
  }

  const readerEl = document.getElementById('ticket-qr-reader');
  if (!readerEl) return;

  setTicketQrUiActive(true);
  ticketQrScanner = new Html5Qrcode('ticket-qr-reader');

  const config = { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 };
  const onSuccess = (decodedText) => {
    onTicketQrDecoded(decodedText);
  };

  const tryStart = async (cameraConfig) => {
    await ticketQrScanner.start(cameraConfig, config, onSuccess, () => {});
  };

  try {
    await tryStart({ facingMode: 'environment' });
  } catch (err) {
    console.warn('QR scanner rear camera error:', err);
    try {
      try {
        await ticketQrScanner.stop();
      } catch (_) {
        /* ignore */
      }
      await tryStart({ facingMode: 'user' });
    } catch (err2) {
      console.warn('QR scanner fallback error:', err2);
      await stopTicketQrScanner();
      const insecure = typeof window !== 'undefined' && !window.isSecureContext;
      const msg = insecure
        ? 'Câmera exige HTTPS (ou localhost). Use o código manual ou acesse via HTTPS.'
        : 'Não foi possível acessar a câmera. Verifique a permissão ou digite o código.';
      showToast(msg, 'error');
      const resultEl = document.getElementById('ticket-validate-result');
      if (resultEl) {
        resultEl.className = 'mt-3 text-sm text-red-600';
        resultEl.textContent = msg;
      }
    }
  }
}

async function stopTicketQrScanner() {
  if (ticketQrScanner) {
    try {
      await ticketQrScanner.stop();
    } catch (_) {
      /* ignore — may already be stopped */
    }
    try {
      ticketQrScanner.clear();
    } catch (_) {
      /* ignore */
    }
    ticketQrScanner = null;
  }
  ticketQrScanBusy = false;
  setTicketQrUiActive(false);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (ticketQrScanner) {
      try {
        ticketQrScanner.stop();
      } catch (_) {
        /* ignore */
      }
    }
  });
}
