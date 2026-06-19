// Módulo Fidelidade

let loyaltyVisitsPerReward = 10;
let editingLoyaltyId = null;
let loyaltyPage = 1;
let loyaltySearch = '';
const loyaltyLimit = 10;
let loyaltySearchTimer = null;
let loyaltyLoading = false;

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

function loyaltyAvatarHtml(c, sizeClass = 'h-12 w-12') {
  const initial = escapeAttr((c.name || '?').charAt(0).toUpperCase());
  if (c.avatar) {
    return `<img src="${escapeAttr(c.avatar)}" alt="" class="${sizeClass} rounded-full object-cover border border-black/10 shrink-0" loading="lazy">`;
  }
  return `<span class="${sizeClass} rounded-full bg-fp-green/10 text-fp-green font-bold flex items-center justify-center shrink-0 border border-black/10">${initial}</span>`;
}

async function loadLoyaltySettings() {
  try {
    const settings = await DB.getLoyaltySettings();
    loyaltyVisitsPerReward = settings.visits_per_reward || 10;
    const input = document.getElementById('loyalty-visits-per-reward');
    if (input) input.value = loyaltyVisitsPerReward;
    updateLoyaltyRuleText();
  } catch (error) {
    console.error('Erro ao carregar configurações de fidelidade:', error);
  }
}

async function saveLoyaltySettings() {
  const btn = document.getElementById('btn-save-loyalty-settings');
  const input = document.getElementById('loyalty-visits-per-reward');
  const value = parseInt(input?.value, 10);
  if (!input || Number.isNaN(value) || value < 2 || value > 100) {
    showToast('Informe um valor entre 2 e 100 visitas.', 'error');
    return;
  }

  await withButtonLoading(btn, async () => {
    try {
      await DB.updateLoyaltySettings({ visits_per_reward: value });
      loyaltyVisitsPerReward = value;
      updateLoyaltyRuleText();
      showToast('Configuração salva!');
      await loadLoyaltyCustomers();
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

async function loadLoyaltyCustomers() {
  const container = document.getElementById('loyalty-list');
  if (!container || typeof DB === 'undefined') return;
  loyaltyLoading = true;
  container.innerHTML = '<p class="text-black/60">Carregando...</p>';

  try {
    await loadLoyaltySettings();
    const data = await DB.getLoyaltyCustomers({
      q: loyaltySearch || undefined,
      page: loyaltyPage,
      limit: loyaltyLimit
    });
    const customers = data.items || [];
    renderLoyaltyPagination(data);

    if (customers.length === 0) {
      container.innerHTML = loyaltySearch
        ? `<p class="text-black/60">Nenhum cliente encontrado para «${escapeAttr(loyaltySearch)}».</p>`
        : '<p class="text-black/60">Nenhum cliente cadastrado. Clique em "Novo cliente" para começar.</p>';
      return;
    }

    const n = loyaltyVisitsPerReward;
    container.innerHTML = customers.map(c => {
      const display = c.display_progress ?? c.progress ?? 0;
      const progressPct = Math.round((display / n) * 100);
      const cycleChip = c.cycle_complete
        ? '<span class="chip" style="background: rgba(245, 124, 0, 0.12); color: #c2410c;">Ciclo completo!</span>'
        : '';
      return `
        <div class="card">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex gap-3 min-w-0 flex-1">
              ${loyaltyAvatarHtml(c)}
              <div class="min-w-0 flex-1">
                <h3 class="font-semibold text-lg">${escapeHtml(c.name)}</h3>
                <p class="text-sm text-black/60">${formatPhoneDisplay(c.phone)}</p>
                <div class="mt-2 flex flex-wrap gap-2 text-xs">
                  <span class="chip">${c.total_visits} visita(s)</span>
                  <span class="chip">${loyaltyProgressLabel(c)}</span>
                  <span class="chip" style="background: rgba(245, 124, 0, 0.12); color: #c2410c;">${c.total_rewards} prêmio(s)</span>
                  ${cycleChip}
                  ${!c.active ? '<span class="chip" style="background: #fee2e2; color: #dc2626;">Inativo</span>' : ''}
                </div>
                <div class="mt-2 h-2 rounded-full bg-black/10 overflow-hidden max-w-xs">
                  <div class="h-full ${c.cycle_complete ? 'bg-fp-orange' : 'bg-fp-green'} rounded-full transition-all" style="width: ${progressPct}%"></div>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <span class="text-xs text-black/55">Registrar visita:</span>
                  <button type="button" onclick="applyLoyaltyVisitDelta(${c.id}, -1)" class="btn btn-outline btn-sm" title="Remover 1 visita">−1</button>
                  <button type="button" onclick="applyLoyaltyVisitDelta(${c.id}, 1)" class="btn btn-outline btn-sm" title="Adicionar 1 visita">+1</button>
                </div>
              </div>
            </div>
            <div class="flex flex-wrap gap-2 shrink-0">
              <button type="button" onclick="editLoyaltyCustomer(${c.id})" class="btn btn-outline btn-sm btn-icon" title="Editar">
                <i data-lucide="edit"></i>
              </button>
              <button type="button" onclick="deleteLoyaltyCustomer(${c.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir">
                <i data-lucide="trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    refreshIcons();
  } catch (error) {
    container.innerHTML = '<p class="text-red-600">Erro ao carregar clientes de fidelidade.</p>';
  } finally {
    loyaltyLoading = false;
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
      await loadLoyaltyCustomers();
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
    await loadLoyaltyCustomers();
    if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}

async function applyLoyaltyVisitDelta(id, delta) {
  if (!delta || delta === 0 || loyaltyLoading) return;

  loyaltyLoading = true;
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
    await loadLoyaltyCustomers();
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  } finally {
    loyaltyLoading = false;
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
