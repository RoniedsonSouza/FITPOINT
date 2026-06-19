// Módulo Categorias

let editingCategoryId = null;

async function loadCategories() {
  const container = document.getElementById('categories-list');
  if (!container || typeof DB === 'undefined') return;
  container.innerHTML = '<p class="text-black/60">Carregando...</p>';

  try {
    const categories = await DB.getCategories();
    if (categories.length === 0) {
      container.innerHTML = '<p class="text-black/60">Nenhuma categoria. Clique em "Nova Categoria".</p>';
      return;
    }
    container.innerHTML = categories.map(cat => `
      <div class="card flex items-center justify-between gap-3">
        <div>
          <h3 class="font-semibold">${escapeHtml(cat.name)}</h3>
          <p class="text-xs text-black/50">Ordem: ${cat.sort_order ?? 0}${cat.active === false ? ' · Inativa' : ''}</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button type="button" onclick="editCategory(${cat.id})" class="btn btn-outline btn-sm btn-icon" title="Editar">
            <i data-lucide="edit"></i>
          </button>
          <button type="button" onclick="deleteCategory(${cat.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir">
            <i data-lucide="trash"></i>
          </button>
        </div>
      </div>
    `).join('');
    refreshIcons();
    await populateCategorySelect();
  } catch (error) {
    container.innerHTML = '<p class="text-red-600">Erro ao carregar categorias.</p>';
  }
}

function openCategoryModal(categoryId = null) {
  editingCategoryId = categoryId;
  const modal = document.getElementById('category-modal');
  const title = document.getElementById('category-modal-title');
  const form = document.getElementById('category-form');

  if (categoryId) {
    title.textContent = 'Editar Categoria';
    DB.getCategories().then(cats => {
      const cat = cats.find(c => c.id === categoryId);
      if (!cat) return;
      document.getElementById('category-id-input').value = cat.id;
      document.getElementById('category-name').value = cat.name;
      document.getElementById('category-sort-order').value = cat.sort_order ?? 0;
      document.getElementById('category-active').checked = cat.active !== false;
    });
  } else {
    title.textContent = 'Nova Categoria';
    form.reset();
    document.getElementById('category-id-input').value = '';
    document.getElementById('category-active').checked = true;
    document.getElementById('category-sort-order').value = '0';
  }
  modal.classList.add('active');
}

function closeCategoryModal() {
  document.getElementById('category-modal').classList.remove('active');
  editingCategoryId = null;
}

async function saveCategory(event) {
  event.preventDefault();
  const btn = event.submitter || document.querySelector('#category-form button[type="submit"]');
  const name = document.getElementById('category-name').value.trim();
  const sort_order = parseInt(document.getElementById('category-sort-order').value, 10) || 0;
  const active = document.getElementById('category-active').checked;

  await withButtonLoading(btn, async () => {
    try {
      if (editingCategoryId) {
        await DB.updateCategory(editingCategoryId, { name, sort_order, active });
        showToast('Categoria atualizada!');
      } else {
        await DB.addCategory({ name, sort_order, active });
        showToast('Categoria criada!');
      }
      closeCategoryModal();
      await loadCategories();
      if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, 'Salvando…');
}

function editCategory(id) {
  openCategoryModal(id);
}

async function deleteCategory(id) {
  if (!confirm('Excluir esta categoria? Só é possível se nenhum produto a usar.')) return;
  try {
    await DB.deleteCategory(id);
    showToast('Categoria excluída!');
    await loadCategories();
    if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}
