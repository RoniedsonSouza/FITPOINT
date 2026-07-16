// Módulo Eventos / Ingressos

let editingEventId = null;
let editingLotId = null;
let selectedEventId = null;
let eventsCache = [];

function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
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
      document.getElementById('event-image-url').value = ev.image_url || '';
      document.getElementById('event-active').checked = ev.active !== false;
    }
  } else {
    title.textContent = 'Novo evento';
    form.reset();
    document.getElementById('event-id-input').value = '';
    document.getElementById('event-active').checked = true;
  }
  modal.classList.add('active');
}

function closeEventModal() {
  document.getElementById('event-modal')?.classList.remove('active');
  editingEventId = null;
}

function editEvent(id) {
  openEventModal(id);
}

async function saveEvent(event) {
  event.preventDefault();
  const btn = event.submitter || document.querySelector('#event-form button[type="submit"]');
  const payload = {
    title: document.getElementById('event-title').value.trim(),
    description: document.getElementById('event-description').value.trim(),
    venue: document.getElementById('event-venue').value.trim(),
    starts_at: fromDatetimeLocalValue(document.getElementById('event-starts-at').value),
    image_url: document.getElementById('event-image-url').value.trim() || null,
    active: document.getElementById('event-active').checked
  };

  if (!payload.starts_at) {
    showToast('Informe a data/hora do evento', 'error');
    return;
  }

  await withButtonLoading(btn, async () => {
    try {
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
    });
  } else {
    title.textContent = 'Novo lote';
    form.reset();
    document.getElementById('lot-id-input').value = '';
    document.getElementById('lot-active').checked = true;
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
  const payload = {
    name: document.getElementById('lot-name').value.trim(),
    price: parseFloat(document.getElementById('lot-price').value),
    quantity_total: parseInt(document.getElementById('lot-quantity').value, 10),
    sales_start: fromDatetimeLocalValue(document.getElementById('lot-sales-start').value),
    sales_end: fromDatetimeLocalValue(document.getElementById('lot-sales-end').value),
    active: document.getElementById('lot-active').checked
  };

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

async function validateTicketCode(event) {
  event.preventDefault();
  const input = document.getElementById('ticket-validate-code');
  const resultEl = document.getElementById('ticket-validate-result');
  const btn = event.submitter || document.querySelector('#ticket-validate-form button[type="submit"]');
  const code = input?.value?.trim();
  if (!code) {
    showToast('Informe o código', 'error');
    return;
  }

  await withButtonLoading(btn, async () => {
    try {
      const data = await DB.validateTicket(code);
      if (resultEl) {
        resultEl.className = 'mt-3 text-sm text-fp-green';
        resultEl.textContent = `OK — ${data.ticket.buyer_name} · ${data.ticket.event_title} · ${data.ticket.lot_name}`;
      }
      showToast('Ingresso validado!');
      input.value = '';
      await loadTicketsAdmin();
    } catch (error) {
      if (handleAuthError(error)) return;
      if (resultEl) {
        resultEl.className = 'mt-3 text-sm text-red-600';
        const extra = error.data?.ticket
          ? ` (${error.data.ticket.buyer_name || ''} · ${error.data.ticket.status || ''})`
          : '';
        resultEl.textContent = error.message + extra;
      }
      showToast(error.message, 'error');
    }
  }, 'Validando…');
}
