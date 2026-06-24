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

function formatPhoneDisplay(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return phone || '';
}

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

function loyaltyProgressLabelShort(c) {
  const n = loyaltyVisitsPerReward;
  const display = c.display_progress ?? c.progress ?? 0;
  if (c.cycle_complete) {
    return `${n}/${n} · Prêmio!`;
  }
  if ((c.total_visits || 0) === 0) {
    return `0/${n} · faltam ${n}`;
  }
  return `${display}/${n} · faltam ${c.visits_to_reward ?? (n - display)}`;
}

function loyaltyAvatarHtml(c, sizeClass = 'loyalty-card-avatar') {
  const initial = escapeAttr((c.name || '?').charAt(0).toUpperCase());
  if (c.avatar) {
    return `<img src="${escapeAttr(c.avatar)}" alt="" class="${sizeClass}" loading="lazy">`;
  }
  return `<span class="${sizeClass} loyalty-card-avatar--initial">${initial}</span>`;
}

function renderLoyaltyCustomerCard(c) {
  const n = loyaltyVisitsPerReward;
  const display = c.display_progress ?? c.progress ?? 0;
  const progressPct = Math.round((display / n) * 100);
  const cycleChip = c.cycle_complete
    ? '<span class="chip loyalty-chip-cycle">Ciclo completo!</span>'
    : '';
  const progressFull = loyaltyProgressLabel(c);
  const progressShort = loyaltyProgressLabelShort(c);

  return `
    <div class="card loyalty-card" data-loyalty-id="${c.id}">
      <div class="loyalty-card-header">
        <div class="loyalty-card-identity">
          ${loyaltyAvatarHtml(c)}
          <div class="loyalty-card-info">
            <h3 class="loyalty-card-name">${escapeHtml(c.name)}</h3>
            <p class="loyalty-card-phone">${formatPhoneDisplay(c.phone)}</p>
          </div>
        </div>
        <div class="loyalty-card-actions">
          <button type="button" onclick="editLoyaltyCustomer(${c.id})" class="btn btn-outline btn-sm btn-icon" title="Editar">
            <i data-lucide="edit"></i>
          </button>
          <button type="button" onclick="deleteLoyaltyCustomer(${c.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir">
            <i data-lucide="trash"></i>
          </button>
        </div>
      </div>
      <div class="loyalty-card-chips">
        <span class="chip">${c.total_visits} visita(s)</span>
        <span class="chip loyalty-chip-progress" title="${escapeAttr(progressFull)}">
          <span class="loyalty-chip-progress-full">${progressFull}</span>
          <span class="loyalty-chip-progress-short">${progressShort}</span>
        </span>
        <span class="chip loyalty-chip-rewards">${c.total_rewards} prêmio(s)</span>
        ${cycleChip}
        ${!c.active ? '<span class="chip loyalty-chip-inactive">Inativo</span>' : ''}
      </div>
      <div class="loyalty-card-progress" role="progressbar" aria-valuenow="${display}" aria-valuemin="0" aria-valuemax="${n}">
        <div class="loyalty-card-progress-bar ${c.cycle_complete ? 'loyalty-card-progress-bar--complete' : ''}" style="width: ${progressPct}%"></div>
      </div>
      <div class="loyalty-visit-row">
        <span class="loyalty-visit-label">Registrar visita:</span>
        <div class="loyalty-visit-stepper">
          <button type="button" onclick="applyLoyaltyVisitDelta(event, ${c.id}, -1)" class="btn btn-outline btn-sm loyalty-visit-btn" title="Remover 1 visita" aria-label="Remover 1 visita">−1</button>
          <button type="button" onclick="applyLoyaltyVisitDelta(event, ${c.id}, 1)" class="btn btn-outline btn-sm loyalty-visit-btn" title="Adicionar 1 visita" aria-label="Adicionar 1 visita">+1</button>
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

async function loadLoyaltyCustomers({ silent = false } = {}) {
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
  const phone = document.getElementById('loyalty-phone').value.trim();
  const active = document.getElementById('loyalty-active').checked;
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

    const payload = { name, phone, avatar, total_visits, total_rewards };

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

document.addEventListener('DOMContentLoaded', () => {
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
