// Módulo Distribuidores

let editingDistributorId = null;
let herbalifeLevelsCache = null;

function escapeHtmlDist(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttrDist(str) {
  return escapeHtmlDist(str).replace(/'/g, '&#39;');
}

async function ensureHerbalifeLevels() {
  if (Array.isArray(herbalifeLevelsCache) && herbalifeLevelsCache.length) {
    return herbalifeLevelsCache;
  }
  herbalifeLevelsCache = await DB.getDistributorLevels();
  return herbalifeLevelsCache;
}

async function populateDistributorLevelSelect(selected) {
  const select = document.getElementById('distributor-level');
  if (!select) return;
  const levels = await ensureHerbalifeLevels();
  select.innerHTML = '<option value="">Selecione…</option>' + levels.map((level) => {
    const sel = level === selected ? ' selected' : '';
    return `<option value="${escapeAttrDist(level)}"${sel}>${escapeHtmlDist(level)}</option>`;
  }).join('');
}

function distributorAvatarHtml(d) {
  if (d.photo_url) {
    return `<img src="${escapeAttrDist(d.photo_url)}" alt="" class="h-12 w-12 rounded-full object-cover border border-black/10 shrink-0" loading="lazy">`;
  }
  const initial = (d.name || '?').trim().charAt(0).toUpperCase();
  return `<span class="h-12 w-12 rounded-full bg-fp-green/15 text-fp-green font-semibold flex items-center justify-center shrink-0">${escapeHtmlDist(initial)}</span>`;
}

async function loadDistributors() {
  const container = document.getElementById('distributors-list');
  if (!container || typeof DB === 'undefined') return;
  container.innerHTML = '<p class="text-black/60">Carregando...</p>';

  try {
    const distributors = await DB.getDistributors({ all: true });
    if (!distributors.length) {
      container.innerHTML = '<p class="text-black/60">Nenhum distribuidor. Clique em "Novo distribuidor".</p>';
      return;
    }

    container.innerHTML = distributors.map((d) => {
      const status = d.active !== false
        ? '<span class="text-fp-green text-xs font-medium">Ativo</span>'
        : '<span class="text-red-600 text-xs font-medium">Inativo</span>';
      return `
        <div class="card flex items-start gap-3">
          ${distributorAvatarHtml(d)}
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2 mb-0.5">
              <h3 class="font-semibold truncate">${escapeHtmlDist(d.name)}</h3>
              ${status}
            </div>
            <p class="text-xs text-fp-green font-medium">${escapeHtmlDist(d.herbalife_level)}</p>
            <p class="text-xs text-black/50 mt-1">${escapeHtmlDist(d.region_label)}</p>
            <p class="text-xs text-black/40 mt-0.5">Ordem: ${d.sort_order ?? 0}</p>
          </div>
          <div class="flex gap-2 shrink-0">
            <button type="button" onclick="editDistributor(${d.id})" class="btn btn-outline btn-sm btn-icon" title="Editar">
              <i data-lucide="edit"></i>
            </button>
            <button type="button" onclick="deleteDistributor(${d.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir">
              <i data-lucide="trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (typeof refreshIcons === 'function') refreshIcons();
  } catch (error) {
    if (typeof handleAuthError === 'function' && handleAuthError(error)) return;
    container.innerHTML = `<p class="text-red-600">Erro ao carregar distribuidores${error?.message ? ': ' + escapeHtmlDist(error.message) : '.'}</p>`;
  }
}

function resetDistributorPhotoPreview() {
  const prev = document.getElementById('distributor-photo-preview');
  const fileIn = document.getElementById('distributor-photo-file');
  const photoInput = document.getElementById('distributor-photo');
  if (fileIn) fileIn.value = '';
  if (photoInput) photoInput.value = '';
  if (prev) {
    prev.src = '';
    prev.classList.add('hidden');
  }
}

async function openDistributorModal(distributorId = null) {
  editingDistributorId = distributorId;
  const modal = document.getElementById('distributor-modal');
  const title = document.getElementById('distributor-modal-title');
  const form = document.getElementById('distributor-form');

  await populateDistributorLevelSelect();

  if (distributorId) {
    title.textContent = 'Editar distribuidor';
    const list = await DB.getDistributors({ all: true });
    const d = list.find((item) => item.id === distributorId);
    if (!d) return;
    document.getElementById('distributor-id-input').value = d.id;
    document.getElementById('distributor-name').value = d.name || '';
    await populateDistributorLevelSelect(d.herbalife_level);
    document.getElementById('distributor-region').value = d.region_label || '';
    document.getElementById('distributor-lat').value = d.lat ?? '';
    document.getElementById('distributor-lng').value = d.lng ?? '';
    document.getElementById('distributor-whatsapp').value = d.whatsapp || '';
    document.getElementById('distributor-phone').value = d.phone || '';
    document.getElementById('distributor-instagram').value = d.instagram || '';
    document.getElementById('distributor-description').value = d.description || '';
    document.getElementById('distributor-sort-order').value = d.sort_order ?? 0;
    document.getElementById('distributor-active').checked = d.active !== false;

    const photoInput = document.getElementById('distributor-photo');
    const prev = document.getElementById('distributor-photo-preview');
    const fileIn = document.getElementById('distributor-photo-file');
    if (fileIn) fileIn.value = '';
    if (photoInput) photoInput.value = d.photo_url || '';
    if (prev) {
      if (d.photo_url) {
        prev.src = d.photo_url;
        prev.classList.remove('hidden');
      } else {
        prev.src = '';
        prev.classList.add('hidden');
      }
    }
  } else {
    title.textContent = 'Novo distribuidor';
    form.reset();
    document.getElementById('distributor-id-input').value = '';
    document.getElementById('distributor-active').checked = true;
    document.getElementById('distributor-sort-order').value = '0';
    resetDistributorPhotoPreview();
    await populateDistributorLevelSelect();
  }

  modal.classList.add('active');
}

function closeDistributorModal() {
  document.getElementById('distributor-modal').classList.remove('active');
  editingDistributorId = null;
}

function editDistributor(id) {
  openDistributorModal(id);
}

async function saveDistributor(event) {
  event.preventDefault();
  const btn = event.submitter || document.querySelector('#distributor-form button[type="submit"]');

  const name = document.getElementById('distributor-name').value.trim();
  const herbalife_level = document.getElementById('distributor-level').value;
  const region_label = document.getElementById('distributor-region').value.trim();
  const lat = Number(document.getElementById('distributor-lat').value);
  const lng = Number(document.getElementById('distributor-lng').value);
  const whatsapp = document.getElementById('distributor-whatsapp').value.trim() || null;
  const phone = document.getElementById('distributor-phone').value.trim() || null;
  const instagram = document.getElementById('distributor-instagram').value.trim() || null;
  const description = document.getElementById('distributor-description').value.trim() || null;
  const sort_order = parseInt(document.getElementById('distributor-sort-order').value, 10) || 0;
  const active = document.getElementById('distributor-active').checked;

  let photo_url = document.getElementById('distributor-photo').value.trim() || null;

  await withButtonLoading(btn, async () => {
    try {
      const fileInput = document.getElementById('distributor-photo-file');
      if (fileInput?.files?.[0]) {
        try {
          const { url } = await DB.uploadDistributorPhoto(fileInput.files[0]);
          photo_url = url;
        } catch (err) {
          showToast('Erro no envio da foto: ' + (err.message || err), 'error');
          return;
        }
      }

      const payload = {
        name,
        herbalife_level,
        region_label,
        lat,
        lng,
        whatsapp,
        phone,
        instagram,
        description,
        photo_url,
        sort_order,
        active
      };

      if (editingDistributorId) {
        await DB.updateDistributor(editingDistributorId, payload);
        showToast('Distribuidor atualizado!');
      } else {
        await DB.addDistributor(payload);
        showToast('Distribuidor criado!');
      }
      closeDistributorModal();
      await loadDistributors();
      if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, 'Salvando…');
}

async function deleteDistributor(id) {
  if (!confirm('Excluir este distribuidor?')) return;
  try {
    await DB.deleteDistributor(id);
    showToast('Distribuidor excluído!');
    await loadDistributors();
    if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileIn = document.getElementById('distributor-photo-file');
  if (!fileIn) return;
  fileIn.addEventListener('change', () => {
    const prev = document.getElementById('distributor-photo-preview');
    const file = fileIn.files?.[0];
    if (!prev) return;
    if (!file) {
      prev.classList.add('hidden');
      return;
    }
    const url = URL.createObjectURL(file);
    prev.src = url;
    prev.classList.remove('hidden');
  });
});
