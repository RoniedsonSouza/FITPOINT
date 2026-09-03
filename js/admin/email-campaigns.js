// Campanhas de e-mail (admin)

let emailCampaignDetailPoll = null;
let emailCampaignEventsCache = [];
let emailCampaignManualEmails = [];

const EMAIL_CAMPAIGN_STATUS_LABELS = {
  queued: 'Na fila',
  sending: 'Enviando',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada'
};

const EMAIL_TAG_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stopEmailCampaignDetailPoll() {
  if (emailCampaignDetailPoll) {
    clearInterval(emailCampaignDetailPoll);
    emailCampaignDetailPoll = null;
  }
}

function showEmailCampaignsList() {
  stopEmailCampaignDetailPoll();
  document.getElementById('email-campaigns-list-panel')?.classList.remove('hidden');
  document.getElementById('email-campaign-form-panel')?.classList.add('hidden');
  document.getElementById('email-campaign-detail-panel')?.classList.add('hidden');
  loadEmailCampaigns({ silent: true });
}

function openEmailCampaignForm() {
  stopEmailCampaignDetailPoll();
  document.getElementById('email-campaigns-list-panel')?.classList.add('hidden');
  document.getElementById('email-campaign-detail-panel')?.classList.add('hidden');
  document.getElementById('email-campaign-form-panel')?.classList.remove('hidden');

  const form = document.getElementById('email-campaign-form');
  form?.reset();
  document.getElementById('email-campaign-theme').value = 'evento';
  document.getElementById('email-campaign-preview-count').textContent = 'Destinatários: —';
  resetEmailCampaignManualTags();
  setEmailCampaignManualPanelOpen(false);
  onEmailCampaignThemeChange();
  loadEmailCampaignEventOptions();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function loadEmailCampaignEventOptions() {
  const eventSelect = document.getElementById('email-campaign-event');
  const lotSelect = document.getElementById('email-campaign-lot');
  if (!eventSelect) return;

  eventSelect.innerHTML = '<option value="">Selecione…</option>';
  if (lotSelect) {
    lotSelect.innerHTML = '<option value="">Todos os lotes do evento</option>';
    lotSelect.disabled = true;
  }

  try {
    emailCampaignEventsCache = await DB.getEvents({ all: true });
    (emailCampaignEventsCache || []).forEach((ev) => {
      const opt = document.createElement('option');
      opt.value = String(ev.id);
      opt.textContent = ev.title || `Evento #${ev.id}`;
      eventSelect.appendChild(opt);
    });
  } catch (error) {
    if (!handleAuthError(error)) {
      showToast(error.message || 'Erro ao carregar eventos.', 'error');
    }
  }
}

async function onEmailCampaignEventChange() {
  const eventId = document.getElementById('email-campaign-event')?.value;
  const lotSelect = document.getElementById('email-campaign-lot');
  if (!lotSelect) return;

  lotSelect.innerHTML = '<option value="">Todos os lotes do evento</option>';
  if (!eventId) {
    lotSelect.disabled = true;
    return;
  }

  lotSelect.disabled = true;
  try {
    const lots = await DB.getEventLots(eventId);
    (lots || []).forEach((lot) => {
      const opt = document.createElement('option');
      opt.value = String(lot.id);
      opt.textContent = lot.name || `Lote #${lot.id}`;
      lotSelect.appendChild(opt);
    });
    lotSelect.disabled = false;
  } catch (error) {
    if (!handleAuthError(error)) {
      showToast(error.message || 'Erro ao carregar lotes.', 'error');
    }
  }
}

function onEmailCampaignThemeChange() {
  const theme = document.getElementById('email-campaign-theme')?.value;
  const eventoFields = document.getElementById('email-campaign-evento-fields');
  const hint = document.getElementById('email-campaign-shortcut-hint');
  const isEvento = theme === 'evento';

  if (eventoFields) {
    eventoFields.classList.toggle('hidden', !isEvento);
    eventoFields.style.display = isEvento ? '' : 'none';
  }

  if (hint) {
    hint.classList.toggle('hidden', isEvento);
  }

  if (!isEvento) {
    const eventSelect = document.getElementById('email-campaign-event');
    const lotSelect = document.getElementById('email-campaign-lot');
    if (eventSelect) eventSelect.value = '';
    if (lotSelect) {
      lotSelect.innerHTML = '<option value="">Todos os lotes do evento</option>';
      lotSelect.disabled = true;
      lotSelect.value = '';
    }
  }
}

function setEmailCampaignManualPanelOpen(open) {
  const panel = document.getElementById('email-campaign-manual-panel');
  const toggle = document.getElementById('email-campaign-manual-toggle');
  if (!panel || !toggle) return;

  panel.classList.toggle('is-collapsed', !open);
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.classList.toggle('is-open', open);

  if (open) {
    document.getElementById('email-campaign-manual-input')?.focus();
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function toggleEmailCampaignManualPanel() {
  const toggle = document.getElementById('email-campaign-manual-toggle');
  const isOpen = toggle?.getAttribute('aria-expanded') === 'true';
  setEmailCampaignManualPanelOpen(!isOpen);
}

function normalizeManualEmailTag(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidManualEmailTag(value) {
  return EMAIL_TAG_REGEX.test(normalizeManualEmailTag(value));
}

function syncEmailCampaignManualHidden() {
  const hidden = document.getElementById('email-campaign-manual');
  if (hidden) hidden.value = emailCampaignManualEmails.join('\n');
  const countEl = document.getElementById('email-campaign-manual-count');
  if (countEl) countEl.textContent = String(emailCampaignManualEmails.length);
}

function renderEmailCampaignManualTags() {
  const list = document.getElementById('email-campaign-manual-tags');
  if (!list) return;

  list.innerHTML = emailCampaignManualEmails.map((email, index) => `
    <span class="email-tag" data-email-index="${index}">
      <span class="email-tag-text">${escapeHtml(email)}</span>
      <button type="button" class="email-tag-remove" aria-label="Remover ${escapeHtml(email)}"
        onclick="removeEmailCampaignManualTag(${index})">&times;</button>
    </span>
  `).join('');

  syncEmailCampaignManualHidden();
}

function resetEmailCampaignManualTags() {
  emailCampaignManualEmails = [];
  const input = document.getElementById('email-campaign-manual-input');
  if (input) input.value = '';
  renderEmailCampaignManualTags();
}

function addEmailCampaignManualTag(raw, { silentInvalid = false } = {}) {
  const email = normalizeManualEmailTag(raw);
  if (!email) return false;

  if (!isValidManualEmailTag(email)) {
    if (!silentInvalid) {
      showToast(`E-mail inválido: ${raw.trim()}`, 'error');
    }
    return false;
  }

  if (emailCampaignManualEmails.includes(email)) {
    return false;
  }

  emailCampaignManualEmails.push(email);
  renderEmailCampaignManualTags();
  return true;
}

function removeEmailCampaignManualTag(index) {
  if (index < 0 || index >= emailCampaignManualEmails.length) return;
  emailCampaignManualEmails.splice(index, 1);
  renderEmailCampaignManualTags();
  document.getElementById('email-campaign-manual-input')?.focus();
}

function commitEmailCampaignManualInput({ silentInvalid = false } = {}) {
  const input = document.getElementById('email-campaign-manual-input');
  if (!input) return;
  const value = input.value;
  if (!value.trim()) {
    input.value = '';
    return;
  }

  const parts = value.split(/[\s,;]+/).filter(Boolean);
  let added = 0;
  parts.forEach((part) => {
    if (addEmailCampaignManualTag(part, { silentInvalid: parts.length > 1 || silentInvalid })) {
      added += 1;
    }
  });

  if (parts.length > 1 && added === 0 && !silentInvalid) {
    showToast('Nenhum e-mail válido encontrado.', 'error');
  }

  input.value = '';
}

function handleEmailCampaignManualKeydown(event) {
  const input = event.target;
  if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
    event.preventDefault();
    commitEmailCampaignManualInput();
    return;
  }

  if (event.key === 'Backspace' && !input.value && emailCampaignManualEmails.length) {
    event.preventDefault();
    removeEmailCampaignManualTag(emailCampaignManualEmails.length - 1);
  }
}

function handleEmailCampaignManualPaste(event) {
  const text = event.clipboardData?.getData('text') || '';
  if (!text || !/[@,;\s]/.test(text)) return;

  event.preventDefault();
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  parts.forEach((part) => addEmailCampaignManualTag(part, { silentInvalid: true }));
  const invalid = parts.filter((part) => part && !isValidManualEmailTag(part));
  if (invalid.length) {
    showToast(`${invalid.length} e-mail(s) inválido(s) ignorado(s).`, 'error');
  }
}

function handleEmailCampaignManualBlur() {
  commitEmailCampaignManualInput({ silentInvalid: true });
}

function readEmailCampaignFormPayload() {
  const theme = document.getElementById('email-campaign-theme')?.value;
  commitEmailCampaignManualInput({ silentInvalid: true });

  const payload = {
    theme,
    subject: document.getElementById('email-campaign-subject')?.value || '',
    body: document.getElementById('email-campaign-body')?.value || '',
    manualEmails: emailCampaignManualEmails.slice()
  };

  if (theme === 'evento') {
    const eventId = document.getElementById('email-campaign-event')?.value;
    const lotId = document.getElementById('email-campaign-lot')?.value;
    if (eventId) payload.eventId = Number(eventId);
    if (lotId) payload.lotId = Number(lotId);
  }

  return payload;
}

async function previewEmailCampaignRecipients() {
  const btn = document.querySelector('#email-campaign-form .btn-outline');
  await withButtonLoading(btn, async () => {
    try {
      const payload = readEmailCampaignFormPayload();
      const result = await DB.previewEmailCampaignRecipients(payload);
      const el = document.getElementById('email-campaign-preview-count');
      if (el) {
        el.textContent =
          `Destinatários: ${result.count}` +
          (result.shortcutCount || result.manualCount
            ? ` (atalho ${result.shortcutCount || 0} · manual ${result.manualCount || 0})`
            : '');
      }
      showToast(`${result.count} destinatário(s) após deduplicação.`, 'success');
    } catch (error) {
      if (!handleAuthError(error)) {
        showToast(error.message || 'Erro ao pré-visualizar.', 'error');
      }
    }
  }, 'Calculando…');
}

async function submitEmailCampaign(event) {
  event.preventDefault();
  const btn = event.submitter || event.target.querySelector('button[type="submit"]');
  const payload = readEmailCampaignFormPayload();

  if (!payload.subject.trim() || !payload.body.trim()) {
    showToast('Assunto e corpo são obrigatórios.', 'error');
    return;
  }

  await withButtonLoading(btn, async () => {
    try {
      const preview = await DB.previewEmailCampaignRecipients(payload);
      if (!preview.count) {
        showToast('Nenhum destinatário. Use o atalho de evento/lote ou a lista manual.', 'error');
        return;
      }
      if (!confirm(`Enviar campanha para ${preview.count} destinatário(s)?`)) return;

      const campaign = await DB.createEmailCampaign(payload);
      showToast('Campanha enfileirada.', 'success');
      openEmailCampaignDetail(campaign.id);
    } catch (error) {
      if (!handleAuthError(error)) {
        showToast(error.message || 'Erro ao criar campanha.', 'error');
      }
    }
  }, 'Enviando…');
}

async function loadEmailCampaigns({ silent = false } = {}) {
  const list = document.getElementById('email-campaigns-list');
  if (!list) return;

  showEmailCampaignsListPanelsOnly();
  if (!silent) list.innerHTML = '<p class="text-black/60">Carregando…</p>';

  try {
    const campaigns = await DB.getEmailCampaigns();
    const stat = document.getElementById('stat-email-campaigns');
    if (stat) stat.textContent = String(campaigns.length);

    if (!campaigns.length) {
      list.innerHTML = '<p class="text-black/60">Nenhuma campanha ainda.</p>';
      return;
    }

    list.innerHTML = campaigns.map((c) => {
      const statusLabel = EMAIL_CAMPAIGN_STATUS_LABELS[c.status] || c.status;
      const progress = `${c.sent_count || 0}/${c.total_count || 0}` +
        (c.failed_count ? ` · ${c.failed_count} falha(s)` : '');
      const created = c.created_at
        ? new Date(c.created_at).toLocaleString('pt-BR')
        : '—';
      return `
        <article class="card email-campaign-card" role="button" tabindex="0"
          onclick="openEmailCampaignDetail(${c.id})"
          onkeydown="if(event.key==='Enter')openEmailCampaignDetail(${c.id})">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs text-black/50 mb-1">${escapeHtml(c.theme_label || c.theme)} · ${escapeHtml(statusLabel)}</p>
              <h3 class="font-semibold text-base">${escapeHtml(c.subject)}</h3>
              <p class="text-sm text-black/60 mt-1">${escapeHtml(progress)}</p>
            </div>
            <span class="text-xs text-black/40 whitespace-nowrap">${escapeHtml(created)}</span>
          </div>
        </article>
      `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (error) {
    if (!handleAuthError(error)) {
      list.innerHTML = `<p class="text-red-600 text-sm">${escapeHtml(error.message || 'Erro ao carregar')}</p>`;
    }
  }
}

function showEmailCampaignsListPanelsOnly() {
  stopEmailCampaignDetailPoll();
  document.getElementById('email-campaigns-list-panel')?.classList.remove('hidden');
  document.getElementById('email-campaign-form-panel')?.classList.add('hidden');
  document.getElementById('email-campaign-detail-panel')?.classList.add('hidden');
}

function renderEmailCampaignDetail(campaign) {
  const el = document.getElementById('email-campaign-detail');
  if (!el) return;

  const statusLabel = EMAIL_CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status;
  const jobs = campaign.jobs || [];
  const failedJobs = jobs.filter((j) => j.status === 'failed');
  const pendingJobs = jobs.filter((j) => j.status === 'pending' || j.status === 'processing');

  el.innerHTML = `
    <div class="mb-4">
      <p class="text-xs text-black/50 mb-1">${escapeHtml(campaign.theme_label || campaign.theme)} · ${escapeHtml(statusLabel)}</p>
      <h2 class="font-display text-xl font-bold">${escapeHtml(campaign.subject)}</h2>
      <p class="text-sm text-black/60 mt-2">
        Enviados ${campaign.sent_count || 0} / ${campaign.total_count || 0}
        ${campaign.failed_count ? ` · Falhas ${campaign.failed_count}` : ''}
        ${pendingJobs.length ? ` · Pendentes ${pendingJobs.length}` : ''}
      </p>
    </div>
    <div class="form-group">
      <label>Corpo</label>
      <pre class="email-campaign-body-preview">${escapeHtml(campaign.body || '')}</pre>
    </div>
    ${failedJobs.length ? `
      <div class="mt-4">
        <h3 class="font-semibold mb-2">Falhas</h3>
        <ul class="grid gap-2 text-sm">
          ${failedJobs.map((j) => `
            <li class="border border-red-200 rounded-lg p-2 bg-red-50/50">
              <strong>${escapeHtml(j.to_email)}</strong>
              <span class="text-black/60"> — ${escapeHtml(j.last_error || 'erro')}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''}
    <div class="mt-4">
      <h3 class="font-semibold mb-2">Destinatários (${jobs.length})</h3>
      <div class="email-campaign-jobs-list">
        ${jobs.slice(0, 100).map((j) => `
          <div class="email-campaign-job-row">
            <span>${escapeHtml(j.to_email)}</span>
            <span class="text-xs text-black/50">${escapeHtml(j.status)}</span>
          </div>
        `).join('')}
        ${jobs.length > 100 ? `<p class="text-xs text-black/50 mt-2">Mostrando 100 de ${jobs.length}.</p>` : ''}
      </div>
    </div>
  `;
}

async function openEmailCampaignDetail(id) {
  stopEmailCampaignDetailPoll();
  document.getElementById('email-campaigns-list-panel')?.classList.add('hidden');
  document.getElementById('email-campaign-form-panel')?.classList.add('hidden');
  document.getElementById('email-campaign-detail-panel')?.classList.remove('hidden');

  const el = document.getElementById('email-campaign-detail');
  if (el) el.innerHTML = '<p class="text-black/60">Carregando…</p>';

  const load = async () => {
    try {
      const campaign = await DB.getEmailCampaign(id);
      renderEmailCampaignDetail(campaign);
      return campaign.status === 'queued' || campaign.status === 'sending';
    } catch (error) {
      if (!handleAuthError(error) && el) {
        el.innerHTML = `<p class="text-red-600 text-sm">${escapeHtml(error.message || 'Erro')}</p>`;
      }
      return false;
    }
  };

  const keepPolling = await load();
  if (keepPolling) {
    emailCampaignDetailPoll = setInterval(async () => {
      const again = await load();
      if (!again) stopEmailCampaignDetailPoll();
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('email-campaign-theme')?.addEventListener('change', onEmailCampaignThemeChange);
  document.getElementById('email-campaign-event')?.addEventListener('change', onEmailCampaignEventChange);

  const manualInput = document.getElementById('email-campaign-manual-input');
  manualInput?.addEventListener('keydown', handleEmailCampaignManualKeydown);
  manualInput?.addEventListener('paste', handleEmailCampaignManualPaste);
  manualInput?.addEventListener('blur', handleEmailCampaignManualBlur);
});
