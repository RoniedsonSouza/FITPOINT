// Gestão de usuários admin (apenas super-admin)

const DEFAULT_SYSTEM_PASSWORD = 'fit@123';

let editingUserId = null;

function emptyPermissionsForm() {
  return {
    produtos: false,
    fidelidade: false,
    vendas: false,
    distribuidores: false,
    eventos: { enabled: false, lotes: false, validar: false }
  };
}

function summarizePermissions(user) {
  if (user.isSuperAdmin) return 'Super-admin (acesso total)';
  const p = user.permissions || emptyPermissionsForm();
  const parts = [];
  if (p.produtos) parts.push('Produtos');
  if (p.fidelidade) parts.push('Fidelidade');
  if (p.vendas) parts.push('Vendas (Diário e Relatórios)');
  if (p.distribuidores) parts.push('Distribuidores');
  if (p.eventos?.enabled) {
    const sub = ['Ingressos'];
    if (p.eventos.lotes) sub.push('Lotes');
    if (p.eventos.validar) sub.push('Validar');
    parts.push(`Eventos (${sub.join(', ')})`);
  }
  return parts.length ? parts.join(' · ') : 'Nenhuma permissão';
}

async function loadUsers() {
  const list = document.getElementById('users-list');
  if (!list) return;
  if (typeof AdminPermissions !== 'undefined' && !AdminPermissions.isSuperAdmin()) {
    list.innerHTML = '<p class="text-red-600 text-sm">Sem permissão para gerenciar usuários.</p>';
    return;
  }

  list.innerHTML = '<p class="text-black/60 text-sm">Carregando…</p>';
  try {
    const users = await DB.getAdminUsers();
    if (!users.length) {
      list.innerHTML = '<p class="text-black/60 text-sm">Nenhum usuário cadastrado.</p>';
      return;
    }

    list.innerHTML = users.map((u) => {
      const status = u.active
        ? '<span class="text-fp-green text-xs font-medium">Ativo</span>'
        : '<span class="text-red-600 text-xs font-medium">Inativo</span>';
      const badge = u.isSuperAdmin
        ? '<span class="text-xs bg-fp-green/10 text-fp-green px-2 py-0.5 rounded-full">Super-admin</span>'
        : '';
      const mustChange = u.mustChangePassword
        ? '<span class="text-xs text-fp-orange">Troca de senha pendente</span>'
        : '';
      const actions = u.isSuperAdmin
        ? ''
        : `
          <button type="button" class="btn btn-outline btn-sm" onclick="openUserModal(${u.id})">
            <i data-lucide="edit"></i> Editar
          </button>
          <button type="button" class="btn btn-outline btn-sm" onclick="resetUserPassword(${u.id})">
            <i data-lucide="key"></i> Redefinir senha
          </button>
          ${u.active
            ? `<button type="button" class="btn btn-outline btn-sm text-red-600" onclick="deactivateUser(${u.id})">
                <i data-lucide="user-x"></i> Desativar
              </button>`
            : `<button type="button" class="btn btn-outline btn-sm" onclick="activateUser(${u.id})">
                <i data-lucide="user-check"></i> Ativar
              </button>`
          }
        `;

      return `
        <div class="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2 mb-1">
              <p class="font-semibold truncate">${escapeHtml(u.email || u.username)}</p>
              ${badge}
              ${status}
              ${mustChange}
            </div>
            <p class="text-sm text-black/60">${escapeHtml(summarizePermissions(u))}</p>
          </div>
          <div class="flex flex-wrap gap-2 shrink-0">${actions}</div>
        </div>
      `;
    }).join('');

    if (typeof refreshIcons === 'function') refreshIcons();
  } catch (error) {
    if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
    list.innerHTML = `<p class="text-red-600 text-sm">${escapeHtml(error.message)}</p>`;
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readPermissionsFromForm() {
  const eventosEnabled = document.getElementById('user-perm-eventos')?.checked;
  return {
    produtos: !!document.getElementById('user-perm-produtos')?.checked,
    fidelidade: !!document.getElementById('user-perm-fidelidade')?.checked,
    vendas: !!document.getElementById('user-perm-vendas')?.checked,
    distribuidores: !!document.getElementById('user-perm-distribuidores')?.checked,
    eventos: {
      enabled: !!eventosEnabled,
      lotes: !!eventosEnabled && !!document.getElementById('user-perm-eventos-lotes')?.checked,
      validar: !!eventosEnabled && !!document.getElementById('user-perm-eventos-validar')?.checked
    }
  };
}

function fillPermissionsForm(permissions) {
  const p = permissions || emptyPermissionsForm();
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };
  set('user-perm-produtos', p.produtos);
  set('user-perm-fidelidade', p.fidelidade);
  set('user-perm-vendas', p.vendas);
  set('user-perm-distribuidores', p.distribuidores);
  set('user-perm-eventos', p.eventos?.enabled);
  set('user-perm-eventos-lotes', p.eventos?.lotes);
  set('user-perm-eventos-validar', p.eventos?.validar);
  toggleEventosSubPermissions();
}

function toggleEventosSubPermissions() {
  const enabled = !!document.getElementById('user-perm-eventos')?.checked;
  const sub = document.getElementById('user-eventos-subperms');
  if (sub) sub.style.display = enabled ? '' : 'none';
  ['user-perm-eventos-lotes', 'user-perm-eventos-validar'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

function toggleDefaultPasswordField() {
  const useDefault = !!document.getElementById('user-use-default-password')?.checked;
  const wrap = document.getElementById('user-custom-password-wrap');
  const input = document.getElementById('user-custom-password');
  if (wrap) wrap.style.display = useDefault ? 'none' : '';
  if (input) {
    input.disabled = useDefault;
    input.required = !useDefault && !editingUserId;
  }
}

function openUserModal(id = null) {
  editingUserId = id;
  const modal = document.getElementById('user-modal');
  const title = document.getElementById('user-modal-title');
  const emailInput = document.getElementById('user-email');
  const activeInput = document.getElementById('user-active');
  const passwordSection = document.getElementById('user-password-section');
  const errorEl = document.getElementById('user-form-error');

  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  if (id) {
    if (title) title.textContent = 'Editar usuário';
    if (passwordSection) passwordSection.style.display = 'none';
    DB.getAdminUsers().then((users) => {
      const u = users.find((x) => x.id === id);
      if (!u) {
        showToast('Usuário não encontrado', 'error');
        return;
      }
      if (emailInput) emailInput.value = u.email || u.username || '';
      if (activeInput) activeInput.checked = u.active !== false;
      fillPermissionsForm(u.permissions);
      modal?.classList.add('active');
      if (typeof refreshIcons === 'function') refreshIcons();
    }).catch((err) => {
      if (typeof handleAuthError === 'function' && handleAuthError(err)) return;
      showToast(err.message, 'error');
    });
  } else {
    if (title) title.textContent = 'Novo usuário';
    if (passwordSection) passwordSection.style.display = '';
    if (emailInput) emailInput.value = '';
    if (activeInput) activeInput.checked = true;
    const useDefault = document.getElementById('user-use-default-password');
    if (useDefault) useDefault.checked = true;
    const customPass = document.getElementById('user-custom-password');
    if (customPass) customPass.value = '';
    fillPermissionsForm(emptyPermissionsForm());
    toggleDefaultPasswordField();
    modal?.classList.add('active');
    if (typeof refreshIcons === 'function') refreshIcons();
  }
}

function closeUserModal() {
  editingUserId = null;
  document.getElementById('user-modal')?.classList.remove('active');
}

async function saveUser(event) {
  event.preventDefault();
  const errorEl = document.getElementById('user-form-error');
  const btn = document.getElementById('user-save-btn');
  const email = document.getElementById('user-email')?.value?.trim();
  const active = !!document.getElementById('user-active')?.checked;
  const permissions = readPermissionsFromForm();

  if (errorEl) errorEl.style.display = 'none';

  await withButtonLoading(btn, async () => {
    try {
      if (editingUserId) {
        await DB.updateAdminUser(editingUserId, { email, active, permissions });
        showToast('Usuário atualizado', 'success');
      } else {
        const useDefaultPassword = !!document.getElementById('user-use-default-password')?.checked;
        const password = document.getElementById('user-custom-password')?.value || '';
        if (!useDefaultPassword && password.length < 6) {
          throw new Error('Senha deve ter pelo menos 6 caracteres');
        }
        await DB.createAdminUser({
          email,
          active,
          permissions,
          useDefaultPassword,
          password: useDefaultPassword ? undefined : password
        });
        showToast(
          useDefaultPassword
            ? `Usuário criado. Senha inicial: ${DEFAULT_SYSTEM_PASSWORD}`
            : 'Usuário criado com senha personalizada',
          'success'
        );
      }
      closeUserModal();
      await loadUsers();
    } catch (error) {
      if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
      if (errorEl) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
      } else {
        showToast(error.message, 'error');
      }
    }
  }, 'Salvando…');
}

async function resetUserPassword(id) {
  const useDefault = confirm(
    `Redefinir senha para o padrão do sistema (${DEFAULT_SYSTEM_PASSWORD})?\n\nOK = senha padrão\nCancelar = informar senha personalizada`
  );

  let payload = { resetPassword: true, useDefaultPassword: true };
  if (!useDefault) {
    const custom = prompt('Digite a nova senha temporária (mín. 6 caracteres):');
    if (!custom) return;
    if (custom.length < 6) {
      showToast('Senha deve ter pelo menos 6 caracteres', 'error');
      return;
    }
    payload = { resetPassword: true, useDefaultPassword: false, password: custom };
  }

  try {
    await DB.updateAdminUser(id, payload);
    showToast(
      payload.useDefaultPassword
        ? `Senha redefinida para ${DEFAULT_SYSTEM_PASSWORD}. Troca obrigatória no próximo login.`
        : 'Senha redefinida. Troca obrigatória no próximo login.',
      'success'
    );
    await loadUsers();
  } catch (error) {
    if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
    showToast(error.message, 'error');
  }
}

async function deactivateUser(id) {
  if (!confirm('Desativar este usuário?')) return;
  try {
    await DB.deleteAdminUser(id);
    showToast('Usuário desativado', 'success');
    await loadUsers();
  } catch (error) {
    if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
    showToast(error.message, 'error');
  }
}

async function activateUser(id) {
  try {
    await DB.updateAdminUser(id, { active: true });
    showToast('Usuário ativado', 'success');
    await loadUsers();
  } catch (error) {
    if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
    showToast(error.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('user-perm-eventos')?.addEventListener('change', toggleEventosSubPermissions);
  document.getElementById('user-use-default-password')?.addEventListener('change', toggleDefaultPasswordField);
});
