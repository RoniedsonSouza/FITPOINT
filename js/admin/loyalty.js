// Módulo Fidelidade

let loyaltyVisitsPerReward = 10;
let loyaltyAccessValue = 27;
let editingLoyaltyId = null;
let loyaltyPage = 1;
let loyaltySearch = '';
const loyaltyLimit = 10;
let loyaltySearchTimer = null;
let loyaltyLoading = false;
let loyaltyPaginationMeta = null;
let loyaltyActiveTab = 'customers';
let loyaltyRewardsPage = 1;
const loyaltyRewardsLimit = 10;
let loyaltyRewardsLoading = false;
let loyaltyRewardsPaginationMeta = null;

function updateLoyaltyRuleText() {
  const el = document.getElementById('loyalty-rule-text');
  if (el) {
    el.textContent = `A cada ${loyaltyVisitsPerReward} visitas, o cliente ganha um Shake ou Hype Drink.`;
  }
  const helpEl = document.getElementById('loyalty-access-help');
  if (helpEl) {
    const formatted = typeof formatCurrency === 'function'
      ? formatCurrency(loyaltyAccessValue)
      : `R$ ${loyaltyAccessValue}`;
    helpEl.textContent = `Vendas no Diário contam visitas automaticamente: a cada ${formatted} em compras, 1 visita.`;
  }
}

function loyaltyProgressLabel(c) {
  const n = loyaltyVisitsPerReward;
  const display = c.display_progress ?? c.progress ?? 0;
  if (c.cycle_complete) {
    return `${n}/${n} neste ciclo · Prêmio conquistado!`;
  }
  if ((c.total_visits || 0) === 0) {
    return `0/${n} neste ciclo · Faltam ${n}`;
  }
  return `${display}/${n} neste ciclo · Faltam ${c.visits_to_reward ?? (n - display)}`;
}

function loyaltyAvatarHtml(c, sizeClass = 'loyalty-card-avatar') {
  const initial = escapeAttr((c.name || '?').charAt(0).toUpperCase());
  if (c.avatar) {
    return `<img src="${escapeAttr(c.avatar)}" alt="" class="${sizeClass}" loading="lazy">`;
  }
  return `<span class="${sizeClass} loyalty-card-avatar--initial">${initial}</span>`;
}

function formatLoyaltyVisitAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const datePart = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const timePart = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${datePart} · ${timePart}`;
}

function formatRewardEarnedDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function loyaltyCycleHint(c) {
  const n = loyaltyVisitsPerReward;
  if (c.cycle_complete) return 'Prêmio!';
  const remaining = c.visits_to_reward ?? (n - (c.display_progress ?? c.progress ?? 0));
  return `Faltam ${remaining}`;
}

function getInactiveVisitDays(c) {
  const lastPositive = c.last_positive_visit_at ? new Date(c.last_positive_visit_at) : null;
  if (!lastPositive || Number.isNaN(lastPositive.getTime())) return null;
  return Math.floor((Date.now() - lastPositive.getTime()) / (24 * 60 * 60 * 1000));
}

function getInactiveVisitLabel(c) {
  if (!c.inactive_visit) return '';
  const days = getInactiveVisitDays(c);
  if (days == null) return 'Sem visita há mais de 3 dias';
  if (days === 0) return 'Sem visita hoje';
  if (days === 1) return 'Ausente há 1 dia';
  return `Ausente há ${days} dias`;
}

function loyaltyVisitSourceLabel(source) {
  if (source === 'daily_sales') return 'Venda';
  return 'Admin';
}

function renderLoyaltyHistoryEvent(event) {
  const when = formatLoyaltyVisitAt(event.created_at) || '—';
  const deltaClass = event.delta > 0 ? 'loyalty-history-delta--add' : 'loyalty-history-delta--remove';
  const deltaLabel = event.delta > 0 ? '+1' : '−1';
  return `
    <li class="loyalty-history-item">
      <span class="loyalty-history-when">${escapeHtml(when)}</span>
      <span class="loyalty-history-delta ${deltaClass}">${deltaLabel}</span>
      <span class="loyalty-history-source">${escapeHtml(loyaltyVisitSourceLabel(event.source))}</span>
    </li>`;
}

async function openLoyaltyHistoryModal(id) {
  const modal = document.getElementById('loyalty-history-modal');
  const title = document.getElementById('loyalty-history-title');
  const summaryEl = document.getElementById('loyalty-history-summary');
  const bodyEl = document.getElementById('loyalty-history-body');
  if (!modal || !bodyEl) return;

  title.textContent = 'Histórico de visitas';
  summaryEl.innerHTML = '';
  bodyEl.innerHTML = '<p class="text-sm text-black/50">Carregando…</p>';
  modal.classList.add('active');

  try {
    const data = await DB.getLoyaltyVisitHistory(id, { limit: 30 });
    const name = data.customer?.name || 'Cliente';
    title.textContent = name;

    const summary = data.summary || {};
    const lastPositive = formatLoyaltyVisitAt(summary.last_positive_visit_at);
    summaryEl.innerHTML = `
      <p class="loyalty-history-summary-line">Últimas visitas</p>
      <p class="loyalty-history-summary-meta">
        Última visita: ${lastPositive ? escapeHtml(lastPositive) : '—'}
      </p>`;

    const events = data.events || [];
    if (events.length === 0) {
      bodyEl.innerHTML = '<p class="text-sm text-black/50">Nenhum registro ainda.</p>';
    } else {
      bodyEl.innerHTML = `<ul class="loyalty-history-list">${events.map(renderLoyaltyHistoryEvent).join('')}</ul>`;
    }
  } catch (error) {
    if (!handleAuthError(error)) {
      bodyEl.innerHTML = `<p class="text-sm text-red-600">Erro: ${escapeHtml(error.message)}</p>`;
    }
  }
}

function closeLoyaltyHistoryModal() {
  document.getElementById('loyalty-history-modal')?.classList.remove('active');
}

function renderLoyaltyCustomerCard(c) {
  const n = loyaltyVisitsPerReward;
  const display = c.display_progress ?? c.progress ?? 0;
  const progressPct = Math.round((display / n) * 100);
  const inactiveLabel = getInactiveVisitLabel(c);
  const lastPositiveVisit = formatLoyaltyVisitAt(c.last_positive_visit_at);
  const lastVisit = formatLoyaltyVisitAt(c.last_visit_at);
  const statusBadges = [
    c.inactive_visit
      ? `<span class="chip loyalty-chip-absent" title="Cliente sem visita há mais de 3 dias"><i data-lucide="clock"></i>${escapeHtml(inactiveLabel)}</span>`
      : '',
    c.cycle_complete ? '<span class="chip loyalty-chip-cycle">Ciclo completo</span>' : '',
    !c.active ? '<span class="chip loyalty-chip-inactive">Inativo</span>' : ''
  ].filter(Boolean).join('');
  const cardClass = c.inactive_visit ? ' loyalty-card--inactive-visit' : '';
  const lastVisitDisplay = c.inactive_visit
    ? (lastPositiveVisit
      ? `<span class="loyalty-card-last-visit loyalty-card-last-visit--stale" title="Última visita positiva">Última visita: ${escapeHtml(lastPositiveVisit)}</span>`
      : '<span class="loyalty-card-last-visit loyalty-card-last-visit--stale" title="Sem registro de visita positiva">Sem visita registrada</span>')
    : (lastVisit
      ? `<span class="loyalty-card-last-visit" title="Última alteração de visita">${escapeHtml(lastVisit)}</span>`
      : '<span class="loyalty-card-last-visit loyalty-card-last-visit--empty"></span>');

  return `
    <div class="card loyalty-card${cardClass}" data-loyalty-id="${c.id}">
      <div class="loyalty-card-header">
        <div class="loyalty-card-identity">
          ${loyaltyAvatarHtml(c)}
          <div class="loyalty-card-info">
            <h3 class="loyalty-card-name">
              <span class="loyalty-card-name-text">${escapeHtml(c.name)}</span>
            </h3>
            <p class="loyalty-card-phone">${formatPhoneDisplay(c.phone)}</p>
          </div>
        </div>
        <div class="loyalty-card-actions">
          <button type="button" onclick="openLoyaltyHistoryModal(${c.id})" class="btn btn-outline btn-sm btn-icon" title="Histórico de visitas">
            <i data-lucide="history"></i>
          </button>
          <button type="button" onclick="editLoyaltyCustomer(${c.id})" class="btn btn-outline btn-sm btn-icon" title="Editar">
            <i data-lucide="edit"></i>
          </button>
          <button type="button" onclick="deleteLoyaltyCustomer(${c.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir">
            <i data-lucide="trash"></i>
          </button>
        </div>
      </div>
      <div class="loyalty-card-status">
        <div class="loyalty-card-cycle">
          <span class="loyalty-card-cycle-count" title="${escapeAttr(loyaltyProgressLabel(c))}">${display}/${n}</span>
          <div class="loyalty-card-progress" role="progressbar" aria-valuenow="${display}" aria-valuemin="0" aria-valuemax="${n}">
            <div class="loyalty-card-progress-bar ${c.cycle_complete ? 'loyalty-card-progress-bar--complete' : ''}" style="width: ${progressPct}%"></div>
          </div>
          <span class="loyalty-card-cycle-hint">${escapeHtml(loyaltyCycleHint(c))}</span>
        </div>
        <div class="loyalty-card-meta">
          <span>${c.total_visits} visita${c.total_visits === 1 ? '' : 's'} · ${c.total_rewards} prêmio${c.total_rewards === 1 ? '' : 's'}</span>
          ${statusBadges}
        </div>
      </div>
      ${c.rewards_pending > 0 ? `
      <div class="loyalty-card-rewards-pending">
        <span>🎁 ${c.rewards_pending} prêmio${c.rewards_pending === 1 ? '' : 's'} pendente${c.rewards_pending === 1 ? '' : 's'}</span>
        <button type="button" onclick="claimLoyaltyReward(event, ${c.id})" class="loyalty-claim-btn" title="Marcar prêmio como retirado" aria-label="Marcar prêmio como retirado">
          <i data-lucide="check"></i> Retirado
        </button>
      </div>` : ''}
      <div class="loyalty-card-footer">
        ${lastVisitDisplay}
        <div class="loyalty-visit-stepper">
          <button type="button" onclick="applyLoyaltyVisitDelta(event, ${c.id}, -1)" class="btn btn-outline btn-sm loyalty-visit-btn" title="Remover 1 visita" aria-label="Remover 1 visita">−1</button>
          <button type="button" onclick="applyLoyaltyVisitDelta(event, ${c.id}, 1)" class="btn btn-sm loyalty-visit-btn loyalty-visit-btn--add" title="Adicionar 1 visita" aria-label="Adicionar 1 visita">+1</button>
        </div>
      </div>
    </div>`;
}

function updateLoyaltyCustomerCardDom(id, customer) {
  const existing = document.querySelector(`[data-loyalty-id="${id}"]`);
  if (!existing) return false;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderLoyaltyCustomerCard(customer);
  const newCard = wrapper.firstElementChild;
  if (!newCard) return false;
  existing.replaceWith(newCard);
  refreshIcons();
  return true;
}

async function loadLoyaltySettings() {
  try {
    const settings = await DB.getLoyaltySettings();
    loyaltyVisitsPerReward = settings.visits_per_reward || 10;
    loyaltyAccessValue = Number(settings.access_value) || 27;
    const input = document.getElementById('loyalty-visits-per-reward');
    if (input) input.value = loyaltyVisitsPerReward;
    const accessInput = document.getElementById('loyalty-access-value');
    if (accessInput) accessInput.value = loyaltyAccessValue;
    updateLoyaltyRuleText();
  } catch (error) {
    console.error('Erro ao carregar configurações de fidelidade:', error);
  }
}

async function saveLoyaltySettings() {
  const btn = document.getElementById('btn-save-loyalty-settings');
  const input = document.getElementById('loyalty-visits-per-reward');
  const accessInput = document.getElementById('loyalty-access-value');
  const value = parseInt(input?.value, 10);
  const accessValue = Number(accessInput?.value);
  if (!input || Number.isNaN(value) || value < 2 || value > 100) {
    showToast('Informe um valor entre 2 e 100 visitas.', 'error');
    return;
  }
  if (!accessInput || !Number.isFinite(accessValue) || accessValue < 1 || accessValue > 10000) {
    showToast('Informe um valor de acesso entre R$ 1 e R$ 10.000.', 'error');
    return;
  }

  await withButtonLoading(btn, async () => {
    try {
      await DB.updateLoyaltySettings({
        visits_per_reward: value,
        access_value: Math.round(accessValue * 100) / 100
      });
      loyaltyVisitsPerReward = value;
      loyaltyAccessValue = Math.round(accessValue * 100) / 100;
      updateLoyaltyRuleText();
      showToast('Configuração salva!');
      await loadLoyaltyCustomers({ silent: true });
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, 'Salvando…');
}

function renderLoyaltyPagination(meta) {
  const el = document.getElementById('loyalty-pagination');
  if (!el) return;
  if (!meta.total) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  const prevDisabled = meta.page <= 1 || loyaltyLoading;
  const nextDisabled = meta.page >= meta.total_pages || loyaltyLoading;
  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p class="text-black/60">Página ${meta.page} de ${meta.total_pages} (${meta.total} clientes)</p>
      <div class="flex gap-2">
        <button type="button" class="btn btn-outline btn-sm" ${prevDisabled ? 'disabled' : ''} onclick="loyaltyChangePage(${meta.page - 1})">Anterior</button>
        <button type="button" class="btn btn-outline btn-sm" ${nextDisabled ? 'disabled' : ''} onclick="loyaltyChangePage(${meta.page + 1})">Próxima</button>
      </div>
    </div>`;
}

function loyaltyChangePage(page) {
  if (page < 1 || loyaltyLoading) return;
  loyaltyPage = page;
  loadLoyaltyCustomers();
}

function switchLoyaltyTab(tab) {
  loyaltyActiveTab = tab;
  document.querySelectorAll('[data-loyalty-tab]').forEach(btn => {
    const isActive = btn.dataset.loyaltyTab === tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.getElementById('loyalty-tab-customers')?.classList.toggle('hidden', tab !== 'customers');
  document.getElementById('loyalty-tab-rewards')?.classList.toggle('hidden', tab !== 'rewards');
  if (tab === 'rewards') {
    loadLoyaltyPendingRewards();
  }
}

function updateLoyaltyRewardsTabBadge(total) {
  const badge = document.getElementById('loyalty-rewards-tab-count');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = String(total);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderLoyaltyRewardItem(item) {
  return `
    <div class="card loyalty-reward-card" data-reward-customer="${item.customer_id}">
      <div class="loyalty-reward-card-info">
        <span class="loyalty-reward-card-name">${escapeHtml(item.name)}</span>
        <span class="loyalty-reward-card-meta">${escapeHtml(formatPhoneDisplay(item.phone))} · ${item.pending_count > 1 ? `${item.pending_count} prêmios · ` : ''}ganhou em ${formatRewardEarnedDate(item.oldest_earned_at)}</span>
      </div>
      <button type="button" onclick="claimLoyaltyReward(event, ${item.customer_id})" class="loyalty-claim-btn" title="Marcar prêmio como retirado" aria-label="Marcar prêmio como retirado">
        <i data-lucide="check"></i> Retirado
      </button>
    </div>`;
}

function renderLoyaltyRewardsPagination(meta) {
  const el = document.getElementById('loyalty-rewards-pagination');
  if (!el) return;
  if (!meta.total) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  const prevDisabled = meta.page <= 1 || loyaltyRewardsLoading;
  const nextDisabled = meta.page >= meta.total_pages || loyaltyRewardsLoading;
  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p class="text-black/60">Página ${meta.page} de ${meta.total_pages} (${meta.total} pendente${meta.total === 1 ? '' : 's'})</p>
      <div class="flex gap-2">
        <button type="button" class="btn btn-outline btn-sm" ${prevDisabled ? 'disabled' : ''} onclick="loyaltyRewardsChangePage(${meta.page - 1})">Anterior</button>
        <button type="button" class="btn btn-outline btn-sm" ${nextDisabled ? 'disabled' : ''} onclick="loyaltyRewardsChangePage(${meta.page + 1})">Próxima</button>
      </div>
    </div>`;
}

function loyaltyRewardsChangePage(page) {
  if (page < 1 || loyaltyRewardsLoading) return;
  loyaltyRewardsPage = page;
  loadLoyaltyPendingRewards();
}

async function loadLoyaltyPendingRewards({ silent = false } = {}) {
  const container = document.getElementById('loyalty-rewards-list');
  if (!container || typeof DB === 'undefined') return;

  loyaltyRewardsLoading = true;
  if (!silent) container.innerHTML = '<p class="text-black/60">Carregando...</p>';
  if (loyaltyRewardsPaginationMeta) renderLoyaltyRewardsPagination(loyaltyRewardsPaginationMeta);

  try {
    const data = await DB.getPendingLoyaltyRewards({ page: loyaltyRewardsPage, limit: loyaltyRewardsLimit });
    const items = data.items || [];

    if (data.total_pages > 0 && loyaltyRewardsPage > data.total_pages) {
      loyaltyRewardsPage = data.total_pages;
      loyaltyRewardsLoading = false;
      return loadLoyaltyPendingRewards({ silent });
    }

    loyaltyRewardsPaginationMeta = data;
    renderLoyaltyRewardsPagination(data);
    updateLoyaltyRewardsTabBadge(data.total);

    container.innerHTML = items.length === 0
      ? '<p class="text-black/60">Nenhum prêmio pendente.</p>'
      : items.map(renderLoyaltyRewardItem).join('');
    refreshIcons();
  } catch (error) {
    if (!handleAuthError(error)) {
      container.innerHTML = '<p class="text-red-600">Erro ao carregar prêmios pendentes.</p>';
    }
  } finally {
    loyaltyRewardsLoading = false;
  }
}

async function loadLoyaltyCustomers({ silent = false } = {}) {
  loadLoyaltyPendingRewards({ silent: true });
  const container = document.getElementById('loyalty-list');
  if (!container || typeof DB === 'undefined') return;

  const scrollY = window.scrollY;
  const hasExistingCards = container.querySelector('[data-loyalty-id]');

  loyaltyLoading = true;
  if (!silent || !hasExistingCards) {
    container.innerHTML = '<p class="text-black/60">Carregando...</p>';
  } else {
    container.classList.add('is-loading');
  }
  if (loyaltyPaginationMeta) renderLoyaltyPagination(loyaltyPaginationMeta);

  try {
    await loadLoyaltySettings();
    const data = await DB.getLoyaltyCustomers({
      q: loyaltySearch || undefined,
      page: loyaltyPage,
      limit: loyaltyLimit
    });
    const customers = data.items || [];

    if (data.total_pages > 0 && loyaltyPage > data.total_pages) {
      loyaltyPage = data.total_pages;
      loyaltyLoading = false;
      container.classList.remove('is-loading');
      return loadLoyaltyCustomers({ silent });
    }

    loyaltyPaginationMeta = data;
    renderLoyaltyPagination(data);

    if (customers.length === 0) {
      container.classList.remove('is-loading');
      container.innerHTML = loyaltySearch
        ? `<p class="text-black/60">Nenhum cliente encontrado para «${escapeAttr(loyaltySearch)}».</p>`
        : '<p class="text-black/60">Nenhum cliente cadastrado. Clique em "Novo cliente" para começar.</p>';
      if (silent) window.scrollTo(0, scrollY);
      return;
    }

    container.classList.remove('is-loading');
    container.innerHTML = customers.map(renderLoyaltyCustomerCard).join('');
    refreshIcons();

    if (silent) {
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
  } catch (error) {
    container.classList.remove('is-loading');
    container.innerHTML = '<p class="text-red-600">Erro ao carregar clientes de fidelidade.</p>';
  } finally {
    loyaltyLoading = false;
    if (loyaltyPaginationMeta) renderLoyaltyPagination(loyaltyPaginationMeta);
  }
}

function resetLoyaltyAvatarPreview() {
  const prev = document.getElementById('loyalty-avatar-preview');
  const fileIn = document.getElementById('loyalty-avatar-file');
  if (fileIn) fileIn.value = '';
  if (prev) {
    if (prev.src && prev.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
    prev.removeAttribute('src');
    prev.classList.add('hidden');
  }
  const avatarInput = document.getElementById('loyalty-avatar');
  if (avatarInput) avatarInput.value = '';
}

function openLoyaltyModal(customerId = null) {
  editingLoyaltyId = customerId;
  const modal = document.getElementById('loyalty-modal');
  const title = document.getElementById('loyalty-modal-title');
  const form = document.getElementById('loyalty-form');
  const activeGroup = document.getElementById('loyalty-active-group');

  resetLoyaltyAvatarPreview();

  if (customerId) {
    title.textContent = 'Editar cliente';
    activeGroup.style.display = 'block';
    DB.getLoyaltyCustomer(customerId).then(c => {
      if (!c) return;
      document.getElementById('loyalty-id-input').value = c.id;
      document.getElementById('loyalty-name').value = c.name;
      document.getElementById('loyalty-phone').value = formatPhoneDisplay(c.phone);
      document.getElementById('loyalty-total-visits').value = c.total_visits ?? 0;
      document.getElementById('loyalty-total-rewards').value = c.total_rewards ?? 0;
      document.getElementById('loyalty-active').checked = c.active !== false;
      const avatarInput = document.getElementById('loyalty-avatar');
      const prev = document.getElementById('loyalty-avatar-preview');
      if (avatarInput) avatarInput.value = c.avatar || '';
      if (prev && c.avatar) {
        prev.src = c.avatar;
        prev.classList.remove('hidden');
      }
    }).catch(err => {
      showToast('Erro ao carregar cliente: ' + (err.message || err), 'error');
    });
  } else {
    title.textContent = 'Novo cliente';
    form.reset();
    document.getElementById('loyalty-id-input').value = '';
    document.getElementById('loyalty-total-visits').value = '0';
    document.getElementById('loyalty-total-rewards').value = '0';
    document.getElementById('loyalty-active').checked = true;
    activeGroup.style.display = 'none';
  }
  modal.classList.add('active');
}

function closeLoyaltyModal() {
  resetLoyaltyAvatarPreview();
  document.getElementById('loyalty-modal').classList.remove('active');
  editingLoyaltyId = null;
}

async function saveLoyaltyCustomer(event) {
  event.preventDefault();
  const btn = event.submitter || document.querySelector('#loyalty-form button[type="submit"]');
  const name = document.getElementById('loyalty-name').value.trim();
  const phoneInput = document.getElementById('loyalty-phone');
  const phone = phoneInput?.value.trim() || '';
  const active = document.getElementById('loyalty-active').checked;

  if (!isValidBrazilianPhone(phone)) {
    showToast('Telefone inválido. Use DDD + número (10 ou 11 dígitos).', 'error');
    phoneInput?.focus();
    return;
  }
  const total_visits = parseInt(document.getElementById('loyalty-total-visits').value, 10) || 0;
  const total_rewards = parseInt(document.getElementById('loyalty-total-rewards').value, 10) || 0;
  let avatar = document.getElementById('loyalty-avatar').value.trim() || null;

  await withButtonLoading(btn, async () => {
    const fileInput = document.getElementById('loyalty-avatar-file');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      try {
        const { url } = await DB.uploadLoyaltyAvatar(fileInput.files[0]);
        avatar = url;
      } catch (err) {
        showToast('Erro no envio do avatar: ' + (err.message || err), 'error');
        throw err;
      }
    }

    const payload = { name, phone: normalizePhoneDigits(phone), avatar, total_visits, total_rewards };

    try {
      if (editingLoyaltyId) {
        payload.active = active;
        await DB.updateLoyaltyCustomer(editingLoyaltyId, payload);
        showToast('Cliente atualizado!');
      } else {
        await DB.addLoyaltyCustomer(payload);
        showToast('Cliente cadastrado!');
      }
      closeLoyaltyModal();
      await loadLoyaltyCustomers({ silent: true });
      if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, 'Salvando…');
}

function editLoyaltyCustomer(id) {
  openLoyaltyModal(id);
}

async function deleteLoyaltyCustomer(id) {
  if (!confirm('Excluir este cliente do programa de fidelidade?')) return;
  try {
    await DB.deleteLoyaltyCustomer(id);
    showToast('Cliente excluído!');
    await loadLoyaltyCustomers({ silent: true });
    if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}

async function applyLoyaltyVisitDelta(event, id, delta) {
  if (!delta || delta === 0) return;

  const btn = event?.currentTarget || event?.target;
  if (btn?.disabled || btn?.classList.contains('is-loading')) return;

  const stepper = btn?.closest('.loyalty-visit-stepper');
  stepper?.classList.add('is-busy');

  try {
    await withButtonLoading(btn, async () => {
      try {
        const result = await DB.registerLoyaltyVisit(id, delta);
        const earned = result.rewards_earned || 0;
        const n = result.visits_per_reward || loyaltyVisitsPerReward;
        if (earned > 0) {
          const name = result.customer?.name || 'Cliente';
          const msg = earned === 1
            ? `Parabéns! ${name} completou ${n} visitas e ganhou 1 prêmio!`
            : `Parabéns! ${name} ganhou ${earned} prêmios!`;
          showToast(msg, 'info');
        } else {
          showToast(delta > 0 ? 'Visita registrada.' : 'Visita removida.');
        }

        if (result.customer && !updateLoyaltyCustomerCardDom(id, result.customer)) {
          await loadLoyaltyCustomers({ silent: true });
        }
      } catch (error) {
        if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
      }
    }, '');
  } finally {
    stepper?.classList.remove('is-busy');
  }
}

async function claimLoyaltyReward(event, id) {
  const btn = event?.currentTarget || event?.target;
  if (btn?.disabled) return;

  await withButtonLoading(btn, async () => {
    try {
      const result = await DB.claimLoyaltyReward(id);
      showToast('Prêmio marcado como retirado.', 'success');
      if (result.customer && !updateLoyaltyCustomerCardDom(id, result.customer)) {
        await loadLoyaltyCustomers({ silent: true });
      }
      await loadLoyaltyPendingRewards({ silent: true });
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, '');
}

document.addEventListener('DOMContentLoaded', () => {
  setupPhoneInputMask('loyalty-phone');

  const loyaltySearchInput = document.getElementById('loyalty-search');
  if (loyaltySearchInput) {
    loyaltySearchInput.addEventListener('input', () => {
      clearTimeout(loyaltySearchTimer);
      loyaltySearchTimer = setTimeout(() => {
        loyaltySearch = loyaltySearchInput.value.trim();
        loyaltyPage = 1;
        loadLoyaltyCustomers();
      }, 300);
    });
  }

  const loyaltyAvatarFile = document.getElementById('loyalty-avatar-file');
  const loyaltyAvatarPreview = document.getElementById('loyalty-avatar-preview');
  if (loyaltyAvatarFile && loyaltyAvatarPreview) {
    loyaltyAvatarFile.addEventListener('change', () => {
      const f = loyaltyAvatarFile.files && loyaltyAvatarFile.files[0];
      if (loyaltyAvatarPreview.src && loyaltyAvatarPreview.src.startsWith('blob:')) {
        URL.revokeObjectURL(loyaltyAvatarPreview.src);
      }
      if (f) {
        loyaltyAvatarPreview.src = URL.createObjectURL(f);
        loyaltyAvatarPreview.classList.remove('hidden');
      }
    });
  }
});
