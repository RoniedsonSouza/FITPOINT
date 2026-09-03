// Módulo Clientes (cadastro sem lógica de fidelidade)

let editingClientId = null;
let clientsPage = 1;
let clientsSearch = '';
const clientsLimit = 10;
let clientsSearchTimer = null;
let clientsLoading = false;
let clientsPaginationMeta = null;
let clientsActiveTab = 'all';
let clientsEventsBound = false;

function clientsAvatarHtml(c, sizeClass = 'loyalty-card-avatar') {
  const initial = escapeAttr((c.name || '?').charAt(0).toUpperCase());
  if (c.avatar) {
    return `<img src="${escapeAttr(c.avatar)}" alt="" class="${sizeClass}" loading="lazy">`;
  }
  return `<span class="${sizeClass} loyalty-card-avatar--initial">${initial}</span>`;
}

function renderClientCard(c) {
  const statusBadges = !c.active
    ? '<span class="chip loyalty-chip-inactive">Inativo</span>'
    : '';

  return `
    <div class="card loyalty-card" data-client-id="${c.id}">
      <div class="loyalty-card-header">
        <div class="loyalty-card-identity">
          ${clientsAvatarHtml(c)}
          <div class="loyalty-card-info">
            <h3 class="loyalty-card-name">
              <span class="loyalty-card-name-text">${escapeHtml(c.name)}</span>
            </h3>
            <p class="loyalty-card-phone">${formatPhoneDisplay(c.phone)}</p>
          </div>
        </div>
        <div class="loyalty-card-actions">
          <button type="button" onclick="editClient(${c.id})" class="btn btn-outline btn-sm btn-icon" title="Editar">
            <i data-lucide="edit"></i>
          </button>
          <button type="button" onclick="deleteClient(${c.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir">
            <i data-lucide="trash"></i>
          </button>
        </div>
      </div>
      ${statusBadges ? `<div class="loyalty-card-status"><div class="loyalty-card-meta">${statusBadges}</div></div>` : ''}
    </div>`;
}

function renderClientsPagination(meta) {
  const el = document.getElementById('clients-pagination');
  if (!el) return;
  if (!meta.total) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  const prevDisabled = meta.page <= 1 || clientsLoading;
  const nextDisabled = meta.page >= meta.total_pages || clientsLoading;
  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p class="text-black/60">Página ${meta.page} de ${meta.total_pages} (${meta.total} clientes)</p>
      <div class="flex gap-2">
        <button type="button" class="btn btn-outline btn-sm" ${prevDisabled ? 'disabled' : ''} onclick="clientsChangePage(${meta.page - 1})">Anterior</button>
        <button type="button" class="btn btn-outline btn-sm" ${nextDisabled ? 'disabled' : ''} onclick="clientsChangePage(${meta.page + 1})">Próxima</button>
      </div>
    </div>`;
}

function clientsChangePage(page) {
  if (page < 1 || clientsLoading) return;
  clientsPage = page;
  loadClientsList();
}

function switchClientsTab(tab) {
  clientsActiveTab = tab;
  document.querySelectorAll('[data-clients-tab]').forEach((btn) => {
    const isActive = btn.dataset.clientsTab === tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.getElementById('clients-tab-all')?.classList.toggle('hidden', tab !== 'all');
  document.getElementById('clients-tab-debts')?.classList.toggle('hidden', tab !== 'debts');
  if (tab === 'debts' && typeof CustomerDebts !== 'undefined') {
    CustomerDebts.loadList('clients-debts-list');
  }
}

function bindClientsEvents() {
  if (clientsEventsBound) return;
  clientsEventsBound = true;

  const search = document.getElementById('clients-search');
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(clientsSearchTimer);
      clientsSearchTimer = setTimeout(() => {
        clientsSearch = search.value.trim();
        clientsPage = 1;
        loadClientsList();
      }, 250);
    });
  }

  const phone = document.getElementById('clients-phone');
  if (phone && typeof setupPhoneInputMask === 'function') {
    setupPhoneInputMask('clients-phone');
  }

  const avatarFile = document.getElementById('clients-avatar-file');
  if (avatarFile) {
    avatarFile.addEventListener('change', () => {
      const file = avatarFile.files?.[0];
      const prev = document.getElementById('clients-avatar-preview');
      if (!file || !prev) return;
      if (prev.src && prev.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      prev.src = URL.createObjectURL(file);
      prev.classList.remove('hidden');
    });
  }
}

function resetClientsAvatarPreview() {
  const prev = document.getElementById('clients-avatar-preview');
  const fileIn = document.getElementById('clients-avatar-file');
  if (fileIn) fileIn.value = '';
  if (prev) {
    if (prev.src && prev.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
    prev.removeAttribute('src');
    prev.classList.add('hidden');
  }
  const avatarInput = document.getElementById('clients-avatar');
  if (avatarInput) avatarInput.value = '';
}

function openClientsModal(customerId = null) {
  editingClientId = customerId;
  const modal = document.getElementById('clients-modal');
  const title = document.getElementById('clients-modal-title');
  const activeGroup = document.getElementById('clients-active-group');
  document.getElementById('clients-form')?.reset();
  resetClientsAvatarPreview();
  document.getElementById('clients-id-input').value = '';
  document.getElementById('clients-active').checked = true;
  if (activeGroup) activeGroup.style.display = customerId ? '' : 'none';

  if (customerId) {
    if (title) title.textContent = 'Editar cliente';
    DB.getLoyaltyCustomer(customerId).then((c) => {
      document.getElementById('clients-id-input').value = c.id;
      document.getElementById('clients-name').value = c.name || '';
      document.getElementById('clients-phone').value = formatPhoneDisplay(c.phone);
      document.getElementById('clients-email').value = c.email || '';
      document.getElementById('clients-active').checked = c.active !== false;
      if (c.avatar) {
        document.getElementById('clients-avatar').value = c.avatar;
        const prev = document.getElementById('clients-avatar-preview');
        if (prev) {
          prev.src = c.avatar;
          prev.classList.remove('hidden');
        }
      }
    }).catch((error) => {
      if (!handleAuthError(error)) showToast(error.message || 'Erro ao carregar cliente.', 'error');
    });
  } else if (title) {
    title.textContent = 'Novo cliente';
  }

  modal?.classList.add('active');
}

function closeClientsModal() {
  document.getElementById('clients-modal')?.classList.remove('active');
  editingClientId = null;
  resetClientsAvatarPreview();
}

async function saveClient(event) {
  event.preventDefault();
  const btn = event.submitter || event.target.querySelector('button[type="submit"]');
  const name = document.getElementById('clients-name')?.value.trim();
  const phoneInput = document.getElementById('clients-phone');
  const phone = phoneInput?.value.trim() || '';
  if (!name || !phone) {
    showToast('Nome e telefone são obrigatórios.', 'error');
    return;
  }
  if (typeof isValidBrazilianPhone === 'function' && !isValidBrazilianPhone(phone)) {
    showToast('Telefone inválido. Use DDD + número (10 ou 11 dígitos).', 'error');
    phoneInput?.focus();
    return;
  }

  await withButtonLoading(btn, async () => {
    try {
      let avatar = document.getElementById('clients-avatar')?.value || null;
      const file = document.getElementById('clients-avatar-file')?.files?.[0];
      if (file) {
        const uploaded = await DB.uploadLoyaltyAvatar(file);
        avatar = uploaded.url || uploaded.avatar || uploaded;
      }

      const payload = {
        name,
        phone: typeof normalizePhoneDigits === 'function' ? normalizePhoneDigits(phone) : phone,
        email: document.getElementById('clients-email')?.value.trim() || null,
        avatar: avatar || undefined
      };
      if (editingClientId) {
        payload.active = document.getElementById('clients-active')?.checked !== false;
        await DB.updateLoyaltyCustomer(editingClientId, payload);
        showToast('Cliente atualizado.', 'success');
      } else {
        await DB.addLoyaltyCustomer(payload);
        showToast('Cliente cadastrado.', 'success');
      }
      closeClientsModal();
      await loadClientsList({ silent: true });
      AdminRouter.loadDashboardStats();
    } catch (error) {
      if (!handleAuthError(error)) showToast(error.message || 'Erro ao salvar cliente.', 'error');
    }
  }, 'Salvando…');
}

function editClient(id) {
  openClientsModal(id);
}

async function deleteClient(id) {
  if (!confirm('Excluir este cliente?')) return;
  try {
    await DB.deleteLoyaltyCustomer(id);
    showToast('Cliente excluído.', 'success');
    await loadClientsList({ silent: true });
    AdminRouter.loadDashboardStats();
  } catch (error) {
    if (!handleAuthError(error)) showToast(error.message || 'Erro ao excluir.', 'error');
  }
}

async function loadClientsList({ silent = false } = {}) {
  const container = document.getElementById('clients-list');
  if (!container || typeof DB === 'undefined') return;

  clientsLoading = true;
  if (!silent) container.innerHTML = '<p class="text-black/60">Carregando...</p>';
  if (clientsPaginationMeta) renderClientsPagination(clientsPaginationMeta);

  try {
    const data = await DB.getLoyaltyCustomers({
      q: clientsSearch || undefined,
      page: clientsPage,
      limit: clientsLimit
    });
    const customers = data.items || [];

    if (data.total_pages > 0 && clientsPage > data.total_pages) {
      clientsPage = data.total_pages;
      clientsLoading = false;
      return loadClientsList({ silent });
    }

    clientsPaginationMeta = data;
    renderClientsPagination(data);

    if (customers.length === 0) {
      container.innerHTML = clientsSearch
        ? `<p class="text-black/60">Nenhum cliente encontrado para «${escapeAttr(clientsSearch)}».</p>`
        : '<p class="text-black/60">Nenhum cliente cadastrado. Clique em "Novo cliente" para começar.</p>';
      return;
    }

    container.innerHTML = customers.map(renderClientCard).join('');
    refreshIcons();
  } catch (error) {
    if (!handleAuthError(error)) {
      container.innerHTML = '<p class="text-red-600">Erro ao carregar clientes.</p>';
    }
  } finally {
    clientsLoading = false;
    if (clientsPaginationMeta) renderClientsPagination(clientsPaginationMeta);
  }
}

async function loadClients() {
  bindClientsEvents();
  if (window.__clientsOpenDebtsTab) {
    clientsActiveTab = 'debts';
    window.__clientsOpenDebtsTab = false;
  }
  if (clientsActiveTab === 'debts') {
    switchClientsTab('debts');
  } else {
    switchClientsTab('all');
    await loadClientsList();
  }
  refreshIcons();
}
