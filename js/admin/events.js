// Módulo Eventos / Ingressos

let editingEventId = null;
let editingLotId = null;
let selectedEventId = null;
let currentEventTab = 'lotes';
let eventsCache = [];
let savedEventLogoUrl = null;
let savedEventCoverUrl = null;
let ticketQrScanner = null;
let ticketQrScanBusy = false;
let ticketQrStarting = false;
let ticketQrStopPromise = null;
let ticketQrStartSession = 0;
let ticketQrLastCode = '';
let ticketQrLastAt = 0;
let ticketQrLifecycleBound = false;
const TICKET_QR_COOLDOWN_MS = 2500;
const EVENT_TABS = ['lotes', 'validar', 'ingressos'];

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
  // datetime-local já é horário local — gravar como TIMESTAMP WITHOUT TIME ZONE (sem deslocar para UTC).
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(String(value).trim());
  if (!match) return null;
  return `${match[1]}:00`;
}

function formatEventDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function getDefaultEventTab() {
  if (typeof AdminPermissions !== 'undefined') {
    return AdminPermissions.defaultEventTab();
  }
  return 'lotes';
}

function resolveAllowedEventTab(tab) {
  const fallback = getDefaultEventTab();
  if (!EVENT_TABS.includes(tab)) return fallback;
  if (typeof AdminPermissions !== 'undefined' && !AdminPermissions.canAccessEventTab(tab)) {
    return fallback;
  }
  return tab;
}

function parseEventsHash() {
  if (typeof AdminRouter !== 'undefined' && typeof AdminRouter.parseHash === 'function') {
    const parsed = AdminRouter.parseHash();
    if (parsed.module === 'eventos') {
      const rawTab = EVENT_TABS.includes(parsed.eventTab) ? parsed.eventTab : getDefaultEventTab();
      return {
        eventId: parsed.eventId || null,
        tab: resolveAllowedEventTab(rawTab)
      };
    }
  }
  const hash = window.location.hash || '#/eventos';
  const match = hash.match(/^#\/eventos(?:\/(\d+)(?:\/(lotes|validar|ingressos))?)?\/?$/);
  if (!match) return { eventId: null, tab: getDefaultEventTab() };
  const rawTab = EVENT_TABS.includes(match[2]) ? match[2] : getDefaultEventTab();
  return {
    eventId: match[1] ? Number(match[1]) : null,
    tab: resolveAllowedEventTab(rawTab)
  };
}

function buildEventDetailHash(id, tab = 'lotes') {
  const safeTab = resolveAllowedEventTab(tab);
  if (safeTab === 'lotes') return `#/eventos/${id}`;
  return `#/eventos/${id}/${safeTab}`;
}

function stopEventsQrCamera() {
  if (typeof releaseTicketQrCameraSync === 'function') releaseTicketQrCameraSync();
  if (typeof stopTicketQrScanner === 'function') stopTicketQrScanner({ reason: 'navigate' });
}

function showEventsListView() {
  stopEventsQrCamera();
  selectedEventId = null;
  currentEventTab = getDefaultEventTab();
  document.getElementById('events-list-panel')?.classList.remove('hidden');
  document.getElementById('event-detail-panel')?.classList.add('hidden');
  const resultEl = document.getElementById('ticket-validate-result');
  if (resultEl) resultEl.textContent = '';
  if (typeof AdminPermissions !== 'undefined') AdminPermissions.applyUi();
}

function backToEventsList() {
  if (window.location.hash !== '#/eventos') {
    window.location.hash = '#/eventos';
  } else {
    showEventsListView();
    renderEventsList();
    refreshIcons();
  }
}

function openEventDetail(id, tab = null) {
  const safeTab = resolveAllowedEventTab(tab || getDefaultEventTab());
  const nextHash = buildEventDetailHash(id, safeTab);
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  } else {
    loadEventDetail(id, safeTab);
  }
}

function setEventTab(tab) {
  if (!selectedEventId) return;
  const safeTab = resolveAllowedEventTab(tab);
  if (typeof AdminPermissions !== 'undefined' && !AdminPermissions.canAccessEventTab(safeTab)) {
    showToast('Sem permissão para esta aba', 'error');
    return;
  }
  const nextHash = buildEventDetailHash(selectedEventId, safeTab);
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  } else {
    applyEventTab(safeTab);
  }
}

function applyEventTab(tab) {
  const safeTab = resolveAllowedEventTab(tab);
  const previousTab = currentEventTab;
  currentEventTab = safeTab;

  if (previousTab === 'validar' && safeTab !== 'validar') {
    stopEventsQrCamera();
  }

  if (typeof AdminPermissions !== 'undefined') AdminPermissions.applyUi();

  document.querySelectorAll('[data-event-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.eventTab === safeTab);
  });
  document.querySelectorAll('[data-event-tab-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.eventTabPanel !== safeTab);
  });

  if (safeTab === 'ingressos') {
    loadTicketsAdmin();
  }
  refreshIcons();
}

function editSelectedEvent() {
  if (selectedEventId) editEvent(selectedEventId);
}

async function loadEvents() {
  const container = document.getElementById('events-list');
  if (!container || typeof DB === 'undefined') return;

  const { eventId, tab } = parseEventsHash();

  if (!eventId) {
    showEventsListView();
    container.innerHTML = '<p class="text-black/60">Carregando...</p>';
  }

  try {
    eventsCache = await DB.getEvents({ all: true });

    if (eventId) {
      if (!eventsCache.some((e) => e.id === eventId)) {
        showToast('Evento não encontrado', 'error');
        window.location.hash = '#/eventos';
        return;
      }
      await loadEventDetail(eventId, tab);
      return;
    }

    renderEventsList();
    refreshIcons();
  } catch (error) {
    if (handleAuthError(error)) return;
    if (!eventId) {
      container.innerHTML = '<p class="text-red-600">Erro ao carregar eventos.</p>';
    } else {
      showToast('Erro ao carregar eventos', 'error');
      window.location.hash = '#/eventos';
    }
  }
}

function canManageLotsUi() {
  return typeof AdminPermissions === 'undefined' || AdminPermissions.canManageEventLots();
}

function renderEventsList() {
  const container = document.getElementById('events-list');
  if (!container) return;

  if (!eventsCache.length) {
    container.innerHTML = canManageLotsUi()
      ? '<p class="text-black/60">Nenhum evento. Clique em "Novo evento".</p>'
      : '<p class="text-black/60">Nenhum evento disponível.</p>';
    return;
  }

  const canEdit = canManageLotsUi();
  container.innerHTML = eventsCache.map((ev) => `
    <div class="card">
      <div class="flex flex-col gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold">${escapeHtml(ev.title)}</h3>
            <p class="text-xs text-black/50 mt-1">${formatEventDate(ev.starts_at)}${ev.venue ? ' · ' + escapeHtml(ev.venue) : ''}</p>
            <p class="text-xs mt-1 ${ev.active === false ? 'text-red-600' : 'text-fp-green'}">${ev.active === false ? 'Inativo' : 'Ativo'}</p>
          </div>
          ${canEdit ? `
          <div class="flex gap-2 shrink-0">
            <button type="button" onclick="editEvent(${ev.id})" class="btn btn-outline btn-sm btn-icon" title="Editar">
              <i data-lucide="edit"></i>
            </button>
            <button type="button" onclick="deleteEvent(${ev.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir">
              <i data-lucide="trash"></i>
            </button>
          </div>` : ''}
        </div>
        <button type="button" onclick="openEventDetail(${ev.id})" class="btn btn-primary btn-sm w-full sm:w-auto">
          <i data-lucide="settings-2"></i> Gerenciar
        </button>
      </div>
    </div>
  `).join('');
  if (typeof AdminPermissions !== 'undefined') AdminPermissions.applyUi();
}

async function loadEventDetail(id, tab = null) {
  tab = resolveAllowedEventTab(tab || getDefaultEventTab());
  if (typeof AdminPermissions !== 'undefined') AdminPermissions.applyUi();
  const listPanel = document.getElementById('events-list-panel');
  const panel = document.getElementById('event-detail-panel');
  const titleEl = document.getElementById('event-detail-title');
  const metaEl = document.getElementById('event-detail-meta');
  const lotsEl = document.getElementById('event-lots-list');
  if (!panel || !lotsEl) return;

  selectedEventId = id;
  listPanel?.classList.add('hidden');
  panel.classList.remove('hidden');

  const ev = eventsCache.find((e) => e.id === id);
  if (titleEl) titleEl.textContent = ev ? ev.title : 'Evento';
  if (metaEl) {
    const status = ev?.active === false ? 'Inativo' : 'Ativo';
    const statusClass = ev?.active === false ? 'text-red-600' : 'text-fp-green';
    metaEl.innerHTML = `${formatEventDate(ev?.starts_at)}${ev?.venue ? ' · ' + escapeHtml(ev.venue) : ''} · <span class="${statusClass}">${status}</span>`;
  }

  applyEventTab(tab);

  lotsEl.innerHTML = '<p class="text-black/60 text-sm">Carregando lotes…</p>';
  try {
    const lots = await DB.getEventLots(id);
    if (!lots.length) {
      lotsEl.innerHTML = canManageLotsUi()
        ? '<p class="text-black/60 text-sm">Nenhum lote. Crie o primeiro lote de ingressos.</p>'
        : '<p class="text-black/60 text-sm">Nenhum lote cadastrado.</p>';
    } else {
      const canEdit = canManageLotsUi();
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
          ${canEdit ? `
          <div class="flex gap-2 shrink-0">
            <button type="button" onclick="editLot(${lot.id})" class="btn btn-outline btn-sm btn-icon" title="Editar lote">
              <i data-lucide="edit"></i>
            </button>
            <button type="button" onclick="deleteLot(${lot.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir lote">
              <i data-lucide="trash"></i>
            </button>
          </div>` : ''}
        </div>
      `).join('');
    }
    refreshIcons();
  } catch (error) {
    if (handleAuthError(error)) return;
    lotsEl.innerHTML = '<p class="text-red-600 text-sm">Erro ao carregar lotes.</p>';
  }
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
    <div class="event-sponsor-image-wrap">
      <img class="event-sponsor-preview hidden" alt="Logo do patrocinador">
      <label class="event-sponsor-image-btn" title="Adicionar logo">
        <i data-lucide="image"></i>
        <input type="file" class="event-sponsor-file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Logo do patrocinador">
      </label>
    </div>
    <input type="text" class="event-sponsor-name flex-1 min-w-0" placeholder="Nome" value="" aria-label="Nome fantasia">
    <input type="text" class="event-sponsor-instagram flex-1 min-w-0" placeholder="@instagram" value="" aria-label="Instagram">
    <button type="button" class="btn btn-danger btn-sm btn-icon" title="Remover patrocinador" aria-label="Remover">
      <i data-lucide="trash-2"></i>
    </button>
  `;
  const nameInput = row.querySelector('.event-sponsor-name');
  const igInput = row.querySelector('.event-sponsor-instagram');
  const fileInput = row.querySelector('.event-sponsor-file');
  const preview = row.querySelector('.event-sponsor-preview');

  if (sponsor) {
    nameInput.value = sponsor.fantasy_name || '';
    igInput.value = sponsor.instagram || '';
    if (sponsor.image_url) {
      row.dataset.savedImageUrl = sponsor.image_url;
      setSponsorRowPreview(row, sponsor.image_url);
    }
  }

  fileInput?.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (preview?.src && preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }
    if (f) {
      setSponsorRowPreview(row, URL.createObjectURL(f));
    } else {
      setSponsorRowPreview(row, row.dataset.savedImageUrl || null);
    }
  });

  row.querySelector('button')?.addEventListener('click', () => {
    if (preview?.src && preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }
    row.remove();
  });

  list.appendChild(row);
  refreshIcons();
}

function setSponsorRowPreview(row, url) {
  const preview = row.querySelector('.event-sponsor-preview');
  const imageBtn = row.querySelector('.event-sponsor-image-btn');
  if (!preview) return;
  if (url) {
    preview.src = url;
    preview.classList.remove('hidden');
    imageBtn?.classList.add('hidden');
  } else {
    if (preview.src && preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }
    preview.removeAttribute('src');
    preview.classList.add('hidden');
    imageBtn?.classList.remove('hidden');
  }
}

function revokeSponsorRowPreviews() {
  document.querySelectorAll('#event-sponsors-list .event-sponsor-row').forEach((row) => {
    const preview = row.querySelector('.event-sponsor-preview');
    if (preview?.src && preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }
  });
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
    const image_url = row.dataset.savedImageUrl || null;
    if (!fantasy_name && !instagram && !image_url) return;
    sponsors.push({ fantasy_name, instagram, image_url });
  });
  return sponsors;
}

async function collectEventSponsorsWithUploads() {
  const rows = document.querySelectorAll('#event-sponsors-list .event-sponsor-row');
  const sponsors = [];
  for (const row of rows) {
    const fantasy_name = row.querySelector('.event-sponsor-name')?.value?.trim() || '';
    const instagram = row.querySelector('.event-sponsor-instagram')?.value?.trim() || '';
    let image_url = row.dataset.savedImageUrl || null;
    const fileInput = row.querySelector('.event-sponsor-file');
    if (fileInput?.files?.[0]) {
      const { url } = await DB.uploadEventImage(fileInput.files[0]);
      image_url = url;
      row.dataset.savedImageUrl = url;
      fileInput.value = '';
      setSponsorRowPreview(row, url);
    }
    if (!fantasy_name && !instagram && !image_url) continue;
    sponsors.push({ fantasy_name, instagram, image_url });
  }
  return sponsors;
}

function openEventModal(eventId = null) {
  if (!canManageLotsUi()) {
    showToast('Sem permissão para gerenciar eventos', 'error');
    return;
  }
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
  revokeSponsorRowPreviews();
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

      payload.sponsors = await collectEventSponsorsWithUploads();

      if (editingEventId) {
        await DB.updateEvent(editingEventId, payload);
        showToast('Evento atualizado!');
        closeEventModal();
        await loadEvents();
      } else {
        const created = await DB.addEvent(payload);
        showToast('Evento criado!');
        closeEventModal();
        openEventDetail(created.id, 'lotes');
      }
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

async function deleteEvent(id) {
  if (!canManageLotsUi()) {
    showToast('Sem permissão para gerenciar eventos', 'error');
    return;
  }
  if (!confirm('Excluir este evento? Lotes sem vendas também serão removidos.')) return;
  try {
    await DB.deleteEvent(id);
    showToast('Evento excluído!');
    if (selectedEventId === id) {
      selectedEventId = null;
      window.location.hash = '#/eventos';
    } else {
      await loadEvents();
    }
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}

function openLotModal(lotId = null) {
  if (!canManageLotsUi()) {
    showToast('Sem permissão para gerenciar lotes', 'error');
    return;
  }
  if (!selectedEventId) {
    showToast('Abra um evento para gerenciar lotes', 'error');
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
      await loadEventDetail(selectedEventId, 'lotes');
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
    await loadEventDetail(selectedEventId, 'lotes');
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}

function ticketStatusInfo(status) {
  if (status === 'used') return { label: 'Usado', cls: 'tickets-admin-status--used' };
  if (status === 'cancelled') return { label: 'Cancelado', cls: 'tickets-admin-status--cancelled' };
  return { label: 'Válido', cls: 'tickets-admin-status--valid' };
}

function renderTicketStatusBadge(status) {
  const { label, cls } = ticketStatusInfo(status);
  return `<span class="tickets-admin-status ${cls}">${label}</span>`;
}

function renderTicketStatusText(status) {
  return ticketStatusInfo(status).label;
}

async function loadTicketsAdmin() {
  const container = document.getElementById('tickets-admin-list');
  const statusFilter = document.getElementById('tickets-status-filter');
  const search = document.getElementById('tickets-search');
  if (!container || !selectedEventId) return;

  container.innerHTML = '<p class="text-black/60 text-sm">Carregando ingressos…</p>';
  try {
    const data = await DB.getTickets({
      event_id: selectedEventId,
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
      <div class="tickets-admin-mobile">
        ${items
          .map(
            (t) => `
          <article class="tickets-admin-card">
            <div class="tickets-admin-card-head">
              <span class="tickets-admin-card-code" title="${escapeHtml(t.code)}">${escapeHtml(t.code)}</span>
              ${renderTicketStatusBadge(t.status)}
            </div>
            <p class="tickets-admin-card-buyer" title="${escapeHtml(t.buyer_name)}">${escapeHtml(t.buyer_name)}</p>
            <p class="tickets-admin-card-meta" title="${escapeHtml(t.buyer_email)} · ${escapeHtml(t.lot_name)}">
              ${escapeHtml(t.buyer_email)} · ${escapeHtml(t.lot_name)}
            </p>
          </article>`
          )
          .join('')}
      </div>
      <div class="tickets-admin-table-wrap overflow-x-auto">
        <table class="tickets-admin-table w-full text-sm">
          <thead>
            <tr class="text-left text-black/50 border-b border-black/10">
              <th class="py-2 pr-3">Código</th>
              <th class="py-2 pr-3">Comprador</th>
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
                <td class="py-2 pr-3">${escapeHtml(t.lot_name)}</td>
                <td class="py-2">${renderTicketStatusText(t.status)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="tickets-admin-total">${data.total} ingresso(s)</p>
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
  const trimmed = fromScanner ? normalizeTicketCodeFromQr(code) : String(code || '').trim();
  if (!trimmed) {
    if (fromScanner) setTicketQrOverlayResult('QR inválido ou vazio.', 'error');
    else showToast('Informe o código', 'error');
    return false;
  }

  if (input && !fromScanner) input.value = trimmed;

  const run = async () => {
    try {
      const data = await DB.validateTicket(trimmed);
      const successText = `OK — ${data.ticket.buyer_name} · ${data.ticket.event_title} · ${data.ticket.lot_name}`;
      if (resultEl) {
        resultEl.className = 'mt-3 text-sm text-fp-green';
        resultEl.textContent = successText;
      }
      setTicketQrOverlayResult(successText, 'success');
      showToast('Ingresso validado!');
      if (input) input.value = '';
      await loadTicketsAdmin();
      return true;
    } catch (error) {
      if (handleAuthError(error)) return false;
      const extra = error.data?.ticket
        ? ` (${error.data.ticket.buyer_name || ''} · ${error.data.ticket.status || ''})`
        : '';
      const errorText = error.message + extra;
      if (resultEl) {
        resultEl.className = 'mt-3 text-sm text-red-600';
        resultEl.textContent = errorText;
      }
      setTicketQrOverlayResult(errorText, 'error');
      showToast(error.message, 'error');
      return false;
    }
  };

  if (fromScanner) {
    return run();
  }
  if (!btn) {
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

function isTicketQrOverlayOpen() {
  const overlay = document.getElementById('ticket-qr-overlay');
  return Boolean(overlay && !overlay.classList.contains('hidden'));
}

function setTicketQrOverlayOpen(open) {
  const overlay = document.getElementById('ticket-qr-overlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !open);
  overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body.classList.toggle('ticket-qr-open', open);
  refreshIcons();
}

function setTicketQrLoading(loading) {
  document.getElementById('ticket-qr-loading')?.classList.toggle('hidden', !loading);
}

function setTicketQrOverlayResult(message, type = '') {
  if (!isTicketQrOverlayOpen()) return;
  const el = document.getElementById('ticket-qr-overlay-result');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'ticket-qr-overlay-result';
  if (type === 'success') el.classList.add('is-success');
  if (type === 'error') el.classList.add('is-error');
  if (type === 'pending') el.classList.add('is-pending');
}

function clearTicketQrReaderElement() {
  const readerEl = document.getElementById('ticket-qr-reader');
  if (readerEl) readerEl.innerHTML = '';
}

function releaseTicketQrCameraTracks() {
  const readerEl = document.getElementById('ticket-qr-reader');
  if (!readerEl) return;
  readerEl.querySelectorAll('video').forEach((video) => {
    const stream = video.srcObject;
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {
          /* ignore */
        }
      });
    }
    video.srcObject = null;
    video.removeAttribute('src');
  });
}

function releaseTicketQrCameraSync() {
  const scanner = ticketQrScanner;
  ticketQrScanner = null;
  ticketQrStarting = false;
  ticketQrStartSession += 1;
  ticketQrScanBusy = false;

  if (scanner) {
    try {
      scanner.stop().catch(() => {});
    } catch (_) {
      /* ignore */
    }
    try {
      scanner.clear();
    } catch (_) {
      /* ignore */
    }
  }

  releaseTicketQrCameraTracks();
  clearTicketQrReaderElement();
  setTicketQrLoading(false);
  setTicketQrOverlayOpen(false);
}

async function stopTicketQrScanner(options = {}) {
  if (ticketQrStopPromise) return ticketQrStopPromise;

  ticketQrStopPromise = (async () => {
    const scanner = ticketQrScanner;
    ticketQrScanner = null;
    ticketQrStarting = false;
    ticketQrStartSession += 1;

    setTicketQrLoading(false);
    setTicketQrOverlayOpen(false);

    if (options.clearResult !== false) {
      const overlayResult = document.getElementById('ticket-qr-overlay-result');
      if (overlayResult) {
        overlayResult.textContent = '';
        overlayResult.className = 'ticket-qr-overlay-result';
      }
    }

    if (scanner) {
      try {
        await scanner.stop();
      } catch (_) {
        /* ignore — may already be stopped */
      }
      try {
        scanner.clear();
      } catch (_) {
        /* ignore */
      }
    }

    releaseTicketQrCameraTracks();
    clearTicketQrReaderElement();
    ticketQrScanBusy = false;
  })();

  try {
    await ticketQrStopPromise;
  } finally {
    ticketQrStopPromise = null;
  }
}

function normalizeTicketCodeFromQr(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('code') || url.searchParams.get('ticket') || url.searchParams.get('ingresso');
    if (fromQuery) return fromQuery.trim().toUpperCase().replace(/\s+/g, '');
    const pathPart = url.pathname.split('/').filter(Boolean).pop();
    if (pathPart && /^[A-Za-z0-9-]+$/.test(pathPart)) return pathPart.toUpperCase().replace(/-/g, '');
  } catch (_) {
    /* not a URL */
  }

  return text.toUpperCase().replace(/\s+/g, '');
}

async function pauseTicketQrScanner() {
  if (!ticketQrScanner) return;
  try {
    await ticketQrScanner.pause(true);
  } catch (_) {
    /* ignore */
  }
}

async function resumeTicketQrScanner() {
  if (!ticketQrScanner || !isTicketQrOverlayOpen()) return;
  try {
    await ticketQrScanner.resume();
  } catch (_) {
    /* ignore */
  }
}

async function onTicketQrDecoded(decodedText) {
  const code = normalizeTicketCodeFromQr(decodedText);
  if (!code || ticketQrScanBusy || !ticketQrScanner || !isTicketQrOverlayOpen()) return;

  const now = Date.now();
  if (code === ticketQrLastCode && now - ticketQrLastAt < TICKET_QR_COOLDOWN_MS) return;

  ticketQrScanBusy = true;
  ticketQrLastCode = code;
  ticketQrLastAt = now;
  setTicketQrOverlayResult('QR detectado — validando…', 'pending');

  await pauseTicketQrScanner();

  try {
    await submitTicketValidation(code, { fromScanner: true });
  } finally {
    setTimeout(async () => {
      ticketQrScanBusy = false;
      if (isTicketQrOverlayOpen()) {
        await resumeTicketQrScanner();
      }
    }, TICKET_QR_COOLDOWN_MS);
  }
}

function getTicketQrScanConfig() {
  const config = {
    fps: 15,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
      return { width: Math.max(size, 180), height: Math.max(size, 180) };
    },
    aspectRatio: 1.0,
    disableFlip: false
  };

  if (typeof Html5QrcodeSupportedFormats !== 'undefined') {
    config.formatsToSupport = [Html5QrcodeSupportedFormats.QR_CODE];
  }

  return config;
}

async function startTicketQrScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Biblioteca de QR não carregada. Recarregue a página.', 'error');
    return;
  }
  if (ticketQrStarting) return;
  if (ticketQrStopPromise) await ticketQrStopPromise;
  if (ticketQrScanner) {
    setTicketQrOverlayOpen(true);
    return;
  }

  const readerEl = document.getElementById('ticket-qr-reader');
  if (!readerEl) return;

  ticketQrStarting = true;
  const session = ++ticketQrStartSession;
  setTicketQrOverlayResult('');
  setTicketQrOverlayOpen(true);
  setTicketQrLoading(true);
  clearTicketQrReaderElement();

  ticketQrScanner = new Html5Qrcode('ticket-qr-reader', { verbose: false });
  const config = getTicketQrScanConfig();
  const onSuccess = (decodedText) => {
    void onTicketQrDecoded(decodedText);
  };

  const tryStart = async (cameraConfig) => {
    await ticketQrScanner.start(cameraConfig, config, onSuccess, () => {});
  };

  const isStaleSession = () => session !== ticketQrStartSession || !isTicketQrOverlayOpen();

  try {
    await tryStart({ facingMode: 'environment' });
    if (isStaleSession()) {
      await stopTicketQrScanner({ clearResult: false });
      return;
    }
    setTicketQrLoading(false);
  } catch (err) {
    console.warn('QR scanner rear camera error:', err);
    if (isStaleSession()) {
      await stopTicketQrScanner({ clearResult: false });
      return;
    }
    try {
      try {
        await ticketQrScanner.stop();
      } catch (_) {
        /* ignore */
      }
      clearTicketQrReaderElement();
      await tryStart({ facingMode: 'user' });
      if (isStaleSession()) {
        await stopTicketQrScanner({ clearResult: false });
        return;
      }
      setTicketQrLoading(false);
    } catch (err2) {
      console.warn('QR scanner fallback error:', err2);
      if (isStaleSession()) {
        await stopTicketQrScanner({ clearResult: false });
        return;
      }
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
      await stopTicketQrScanner();
    }
  } finally {
    if (session === ticketQrStartSession) ticketQrStarting = false;
  }
}

function wireTicketQrLifecycle() {
  if (ticketQrLifecycleBound || typeof window === 'undefined') return;
  ticketQrLifecycleBound = true;

  window.addEventListener('pagehide', () => {
    releaseTicketQrCameraSync();
  });

  window.addEventListener('beforeunload', () => {
    releaseTicketQrCameraSync();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && (ticketQrScanner || ticketQrStarting)) {
      stopTicketQrScanner({ reason: 'hidden' });
    }
  });

  window.addEventListener('hashchange', () => {
    if (typeof AdminRouter !== 'undefined' && AdminRouter.parseHash?.() !== 'eventos') {
      stopTicketQrScanner({ reason: 'navigate' });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isTicketQrOverlayOpen()) {
      e.preventDefault();
      stopTicketQrScanner({ reason: 'escape' });
    }
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    wireEventImagePreviews();
    wireTicketQrLifecycle();
  });
}
