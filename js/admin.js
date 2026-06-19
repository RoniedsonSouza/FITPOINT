// Script da página de administração

let editingProductId = null;
let editingCategoryId = null;

/** ID único para API (apenas a-z, 0-9 e hífen) */
function generateProductId() {
  const time = Date.now().toString(36);
  let suffix = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(5);
    crypto.getRandomValues(buf);
    suffix = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  } else {
    suffix = Math.random().toString(36).slice(2, 12);
  }
  return `p-${time}-${suffix}`;
}

function generateOptionId() {
  return `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function parseNutritionField(id) {
  const el = document.getElementById(id);
  if (!el || el.value.trim() === '') return null;
  const n = Number(el.value);
  return Number.isNaN(n) || n < 0 ? null : n;
}

function readNutritionFromForm() {
  const nutrition = {};
  const kcal = parseNutritionField('product-nutrition-kcal');
  const protein = parseNutritionField('product-nutrition-protein');
  const carbs = parseNutritionField('product-nutrition-carbs');
  const fat = parseNutritionField('product-nutrition-fat');
  const fiber = parseNutritionField('product-nutrition-fiber');
  if (kcal != null) nutrition.kcal = Math.round(kcal);
  if (protein != null) nutrition.protein_g = protein;
  if (carbs != null) nutrition.carbs_g = carbs;
  if (fat != null) nutrition.fat_g = fat;
  if (fiber != null) nutrition.fiber_g = fiber;
  return nutrition;
}

function fillNutritionForm(nutrition) {
  const n = nutrition || {};
  document.getElementById('product-nutrition-kcal').value = n.kcal != null ? n.kcal : '';
  document.getElementById('product-nutrition-protein').value = n.protein_g != null ? n.protein_g : '';
  document.getElementById('product-nutrition-carbs').value = n.carbs_g != null ? n.carbs_g : '';
  document.getElementById('product-nutrition-fat').value = n.fat_g != null ? n.fat_g : '';
  document.getElementById('product-nutrition-fiber').value = n.fiber_g != null ? n.fiber_g : '';
}

function clearNutritionForm() {
  ['product-nutrition-kcal', 'product-nutrition-protein', 'product-nutrition-carbs', 'product-nutrition-fat', 'product-nutrition-fiber']
    .forEach(id => { document.getElementById(id).value = ''; });
}

function addProductOptionRow(option = null) {
  const list = document.getElementById('product-options-list');
  if (!list) return;
  const rowId = option?.id || generateOptionId();
  const row = document.createElement('div');
  row.className = 'product-option-row flex flex-wrap gap-2 items-end p-2 rounded-lg border border-black/10 bg-black/[0.02]';
  row.dataset.optionId = rowId;
  row.innerHTML = `
    <div class="flex-1 min-w-[8rem]">
      <label class="text-xs text-black/60">Nome</label>
      <input type="text" class="option-name" value="${option ? escapeAttr(option.name) : ''}" placeholder="Ex.: Com frango">
    </div>
    <div class="w-28">
      <label class="text-xs text-black/60">+ R$</label>
      <input type="number" class="option-price" step="0.01" min="0" value="${option ? Number(option.price_adjustment || 0) : 0}">
    </div>
    <label class="flex items-center gap-1 text-sm pb-2 cursor-pointer shrink-0">
      <input type="radio" name="product-option-default" class="option-default" value="${rowId}" ${option?.default ? 'checked' : ''}>
      Padrão
    </label>
    <button type="button" class="btn btn-danger shrink-0 option-remove" style="padding: 0.4rem 0.6rem;" title="Remover">
      <i data-lucide="trash-2"></i>
    </button>
  `;
  row.querySelector('.option-remove').addEventListener('click', () => {
    row.remove();
    ensureOptionDefaultRadio();
  });
  list.appendChild(row);
  ensureOptionDefaultRadio();
  if (window.lucide) window.lucide.createIcons();
}

function ensureOptionDefaultRadio() {
  const radios = document.querySelectorAll('#product-options-list .option-default');
  if (radios.length === 1 && !radios[0].checked) {
    radios[0].checked = true;
  }
}

function clearProductOptions() {
  const list = document.getElementById('product-options-list');
  if (list) list.innerHTML = '';
}

function fillProductOptions(options) {
  clearProductOptions();
  (options || []).forEach(opt => addProductOptionRow(opt));
}

function readProductOptionsFromForm() {
  const rows = document.querySelectorAll('#product-options-list .product-option-row');
  const options = [];
  rows.forEach(row => {
    const name = row.querySelector('.option-name')?.value.trim();
    if (!name) return;
    const priceAdj = parseFloat(row.querySelector('.option-price')?.value) || 0;
    const id = row.dataset.optionId || generateOptionId();
    const isDefault = row.querySelector('.option-default')?.checked === true;
    options.push({
      id,
      name,
      price_adjustment: Math.max(0, priceAdj),
      default: isDefault
    });
  });
  if (options.length > 0 && !options.some(o => o.default)) {
    options[0].default = true;
  }
  return options;
}

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function populateCategorySelect(selectedName) {
  const sel = document.getElementById('product-category');
  if (!sel) return;
  try {
    const categories = await DB.getCategories();
    const active = categories.filter(c => c.active !== false);
    sel.innerHTML = '<option value="">Selecione…</option>' +
      active.map(c => `<option value="${escapeAttr(c.name)}">${escapeAttr(c.name)}</option>`).join('');
    if (selectedName) sel.value = selectedName;
  } catch (e) {
    console.error(e);
  }
}

// === CATEGORIAS ===

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
      <div class="card !mb-0 flex items-center justify-between gap-3">
        <div>
          <h3 class="font-semibold">${escapeAttr(cat.name)}</h3>
          <p class="text-xs text-black/50">Ordem: ${cat.sort_order ?? 0}${cat.active === false ? ' · Inativa' : ''}</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button type="button" onclick="editCategory(${cat.id})" class="btn btn-outline" style="padding: 0.4rem 0.75rem;">
            <i data-lucide="edit"></i>
          </button>
          <button type="button" onclick="deleteCategory(${cat.id})" class="btn btn-danger" style="padding: 0.4rem 0.75rem;">
            <i data-lucide="trash"></i>
          </button>
        </div>
      </div>
    `).join('');
    if (window.lucide) window.lucide.createIcons();
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
  const name = document.getElementById('category-name').value.trim();
  const sort_order = parseInt(document.getElementById('category-sort-order').value, 10) || 0;
  const active = document.getElementById('category-active').checked;

  try {
    if (editingCategoryId) {
      await DB.updateCategory(editingCategoryId, { name, sort_order, active });
      alert('Categoria atualizada!');
    } else {
      await DB.addCategory({ name, sort_order, active });
      alert('Categoria criada!');
    }
    closeCategoryModal();
    await loadCategories();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      alert('Sessão expirada. Faça login novamente.');
      if (typeof logout === 'function') logout();
    } else {
      alert('Erro: ' + error.message);
    }
  }
}

function editCategory(id) {
  openCategoryModal(id);
}

async function deleteCategory(id) {
  if (!confirm('Excluir esta categoria? Só é possível se nenhum produto a usar.')) return;
  try {
    await DB.deleteCategory(id);
    alert('Categoria excluída!');
    await loadCategories();
  } catch (error) {
    alert('Erro: ' + error.message);
  }
}

// === PRODUTOS ===

async function loadProducts() {
  if (typeof DB === 'undefined') {
    console.error('DB não está definido');
    const container = document.getElementById('products-list');
    container.innerHTML = '<p class="text-red-600">Erro: Módulo DB não carregado. Recarregue a página.</p>';
    return;
  }

  const container = document.getElementById('products-list');
  container.innerHTML = '<p class="text-black/60">Carregando...</p>';

  try {
    const products = await DB.getProducts();

    if (products.length === 0) {
      container.innerHTML = '<p class="text-black/60">Nenhum produto cadastrado. Clique em "Adicionar Produto" para começar.</p>';
      return;
    }

    container.innerHTML = products.map(product => {
      const promo = product.promo_price != null && product.promo_price !== '' ? Number(product.promo_price) : null;
      const hasPromo = promo != null && !Number.isNaN(promo) && promo < Number(product.price);
      const priceHtml = hasPromo
        ? `<span class="text-right leading-tight"><span class="block text-black/45 line-through text-sm font-normal">R$ ${Number(product.price).toFixed(2)}</span><span class="text-fp-green font-bold">R$ ${promo.toFixed(2)}</span></span>`
        : `<span class="text-fp-green font-bold">R$ ${Number(product.price).toFixed(2)}</span>`;
      const optsCount = (product.options || []).length;
      return `
      <div class="card">
        ${product.image ? `<div class="mb-3 h-36 rounded-lg overflow-hidden border border-black/10 bg-black/5"><img src="${product.image}" alt="" class="w-full h-full object-contain" loading="lazy"></div>` : ''}
        <div class="flex items-start justify-between mb-2 gap-2">
          <h3 class="font-semibold text-lg">${product.name}</h3>
          ${priceHtml}
        </div>
        <p class="text-sm text-black/60 mb-2">ID: ${product.id}</p>
        <p class="text-sm text-black/60 mb-2">Categoria: ${product.category}</p>
        ${optsCount ? `<p class="text-xs text-black/50 mb-2">${optsCount} opção(ões)</p>` : ''}
        <div class="flex flex-wrap gap-1 mb-3">
          ${(product.tags || []).map(tag => `<span class="chip">${tag}</span>`).join('')}
        </div>
        <div class="flex gap-2">
          <button onclick="editProduct('${product.id}')" class="btn btn-outline" style="padding: 0.5rem 1rem;">
            <i data-lucide="edit"></i> Editar
          </button>
          <button onclick="deleteProduct('${product.id}')" class="btn btn-danger" style="padding: 0.5rem 1rem;">
            <i data-lucide="trash"></i> Excluir
          </button>
        </div>
        ${product.is_kit ? '<span class="chip" style="background: rgba(79, 70, 229, 0.12); color: #4338ca; margin-top: 0.35rem;">Kit</span>' : ''}
        ${!product.active ? '<span class="chip" style="background: #fee2e2; color: #dc2626; margin-top: 0.5rem;">Inativo</span>' : ''}
      </div>
    `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    console.error('Erro ao carregar produtos:', error);
    container.innerHTML = '<p class="text-red-600">Erro ao carregar produtos. Verifique se o servidor está rodando.</p>';
  }
}

async function openProductModal(productId = null) {
  editingProductId = productId;
  const modal = document.getElementById('product-modal');
  const form = document.getElementById('product-form');
  const title = document.getElementById('product-modal-title');

  await populateCategorySelect();

  if (productId) {
    try {
      const product = await DB.getProduct(productId);
      if (!product) {
        alert('Produto não encontrado');
        return;
      }
      title.textContent = 'Editar Produto';
      document.getElementById('product-id-input').value = product.id;
      document.getElementById('product-name').value = product.name;
      document.getElementById('product-price').value = product.price;
      document.getElementById('product-promo-price').value =
        product.promo_price != null && product.promo_price !== '' ? product.promo_price : '';
      await populateCategorySelect(product.category);
      document.getElementById('product-description').value = product.description || '';
      fillNutritionForm(product.nutrition);
      fillProductOptions(product.options);
      document.getElementById('product-tags').value = (product.tags || []).join(', ');
      document.getElementById('product-image').value = product.image || '';
      const prevImg = document.getElementById('product-image-preview');
      const fileIn = document.getElementById('product-image-file');
      if (fileIn) fileIn.value = '';
      if (prevImg) {
        if (prevImg.src && prevImg.src.startsWith('blob:')) URL.revokeObjectURL(prevImg.src);
        if (product.image) {
          prevImg.src = product.image;
          prevImg.classList.remove('hidden');
        } else {
          prevImg.removeAttribute('src');
          prevImg.classList.add('hidden');
        }
      }
      document.getElementById('product-active').checked = product.active !== false;
      document.getElementById('product-is-kit').checked =
        product.is_kit === true || product.is_kit === 1 || product.is_kit === 'true';
    } catch (error) {
      alert('Erro ao carregar produto: ' + error.message);
      return;
    }
  } else {
    title.textContent = 'Adicionar Produto';
    form.reset();
    document.getElementById('product-id-input').value = generateProductId();
    document.getElementById('product-active').checked = true;
    document.getElementById('product-is-kit').checked = false;
    document.getElementById('product-promo-price').value = '';
    document.getElementById('product-description').value = '';
    clearNutritionForm();
    clearProductOptions();
    await populateCategorySelect();
    const prevImg = document.getElementById('product-image-preview');
    const fileIn = document.getElementById('product-image-file');
    if (fileIn) fileIn.value = '';
    if (prevImg) {
      if (prevImg.src && prevImg.src.startsWith('blob:')) URL.revokeObjectURL(prevImg.src);
      prevImg.removeAttribute('src');
      prevImg.classList.add('hidden');
    }
  }

  modal.classList.add('active');
  if (window.lucide) window.lucide.createIcons();
}

function closeProductModal() {
  const prevImg = document.getElementById('product-image-preview');
  if (prevImg && prevImg.src && prevImg.src.startsWith('blob:')) {
    URL.revokeObjectURL(prevImg.src);
  }
  const modal = document.getElementById('product-modal');
  modal.classList.remove('active');
  editingProductId = null;
}

async function saveProduct(event) {
  event.preventDefault();

  const idInput = document.getElementById('product-id-input');
  let id = editingProductId || idInput.value.trim();
  if (!editingProductId && !id) {
    id = generateProductId();
    idInput.value = id;
  }
  const name = document.getElementById('product-name').value.trim();
  const price = parseFloat(document.getElementById('product-price').value);
  const promoRaw = document.getElementById('product-promo-price').value.trim();
  let promo_price = null;
  if (promoRaw !== '') {
    const pr = parseFloat(promoRaw);
    if (Number.isNaN(pr) || pr < 0) {
      alert('Preço promocional inválido.');
      return;
    }
    if (pr >= price) {
      alert('O preço promocional deve ser menor que o preço normal.');
      return;
    }
    promo_price = pr;
  }
  const category = document.getElementById('product-category').value;
  if (!category) {
    alert('Selecione uma categoria.');
    return;
  }
  const description = document.getElementById('product-description').value.trim();
  const nutrition = readNutritionFromForm();
  const options = readProductOptionsFromForm();
  const tagsInput = document.getElementById('product-tags').value.trim();
  let image = document.getElementById('product-image').value.trim();
  const active = document.getElementById('product-active').checked;
  const is_kit = document.getElementById('product-is-kit').checked;

  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

  const fileInput = document.getElementById('product-image-file');
  if (fileInput && fileInput.files && fileInput.files[0]) {
    try {
      const { url } = await DB.uploadProductImage(fileInput.files[0]);
      image = url;
      document.getElementById('product-image').value = url;
    } catch (err) {
      alert('Erro no envio da imagem: ' + (err.message || err));
      return;
    }
  }

  const productData = {
    id,
    name,
    price,
    promo_price,
    is_kit,
    category,
    tags,
    image: image || undefined,
    active,
    description: description || null,
    nutrition,
    options
  };

  try {
    if (editingProductId) {
      await DB.updateProduct(editingProductId, productData);
      alert('Produto atualizado com sucesso!');
    } else {
      await DB.addProduct(productData);
      alert('Produto adicionado com sucesso!');
    }
    closeProductModal();
    await loadProducts();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      if (typeof logout === 'function') logout();
    } else {
      alert('Erro: ' + error.message);
    }
  }
}

function editProduct(id) {
  openProductModal(id);
}

async function deleteProduct(id) {
  if (!confirm('Tem certeza que deseja excluir este produto?')) {
    return;
  }

  try {
    await DB.deleteProduct(id);
    alert('Produto excluído com sucesso!');
    await loadProducts();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      if (typeof logout === 'function') logout();
    } else {
      alert('Erro: ' + error.message);
    }
  }
}

// === FIDELIDADE ===

let loyaltyVisitsPerReward = 10;
let editingLoyaltyId = null;
let loyaltyPage = 1;
let loyaltySearch = '';
const loyaltyLimit = 10;
let loyaltySearchTimer = null;

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
  const input = document.getElementById('loyalty-visits-per-reward');
  const value = parseInt(input?.value, 10);
  if (!input || Number.isNaN(value) || value < 2 || value > 100) {
    alert('Informe um valor entre 2 e 100 visitas.');
    return;
  }
  try {
    await DB.updateLoyaltySettings({ visits_per_reward: value });
    loyaltyVisitsPerReward = value;
    updateLoyaltyRuleText();
    alert('Configuração salva!');
    await loadLoyaltyCustomers();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      alert('Sessão expirada. Faça login novamente.');
      if (typeof logout === 'function') logout();
    } else {
      alert('Erro: ' + error.message);
    }
  }
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
  const prevDisabled = meta.page <= 1;
  const nextDisabled = meta.page >= meta.total_pages;
  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p class="text-black/60">Página ${meta.page} de ${meta.total_pages} (${meta.total} clientes)</p>
      <div class="flex gap-2">
        <button type="button" class="btn btn-outline" style="padding:0.4rem 0.75rem;font-size:0.8125rem" ${prevDisabled ? 'disabled' : ''} onclick="loyaltyChangePage(${meta.page - 1})">Anterior</button>
        <button type="button" class="btn btn-outline" style="padding:0.4rem 0.75rem;font-size:0.8125rem" ${nextDisabled ? 'disabled' : ''} onclick="loyaltyChangePage(${meta.page + 1})">Próxima</button>
      </div>
    </div>`;
}

function loyaltyChangePage(page) {
  if (page < 1) return;
  loyaltyPage = page;
  loadLoyaltyCustomers();
}

async function loadLoyaltyCustomers() {
  const container = document.getElementById('loyalty-list');
  if (!container || typeof DB === 'undefined') return;
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
        <div class="card !mb-0">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex gap-3 min-w-0 flex-1">
              ${loyaltyAvatarHtml(c)}
              <div class="min-w-0 flex-1">
                <h3 class="font-semibold text-lg">${escapeAttr(c.name)}</h3>
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
                  <button type="button" onclick="applyLoyaltyVisitDelta(${c.id}, -1)" class="btn btn-outline" style="padding: 0.45rem 0.65rem; font-size: 0.8125rem;" title="Remover 1 visita">−1</button>
                  <button type="button" onclick="applyLoyaltyVisitDelta(${c.id}, 1)" class="btn btn-outline" style="padding: 0.45rem 0.65rem; font-size: 0.8125rem;" title="Adicionar 1 visita">+1</button>
                </div>
              </div>
            </div>
            <div class="flex flex-wrap gap-2 shrink-0">
              <button type="button" onclick="editLoyaltyCustomer(${c.id})" class="btn btn-outline" style="padding: 0.5rem 0.75rem;">
                <i data-lucide="edit"></i>
              </button>
              <button type="button" onclick="deleteLoyaltyCustomer(${c.id})" class="btn btn-danger" style="padding: 0.5rem 0.75rem;">
                <i data-lucide="trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    container.innerHTML = '<p class="text-red-600">Erro ao carregar clientes de fidelidade.</p>';
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
      alert('Erro ao carregar cliente: ' + (err.message || err));
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
  const name = document.getElementById('loyalty-name').value.trim();
  const phone = document.getElementById('loyalty-phone').value.trim();
  const active = document.getElementById('loyalty-active').checked;
  const total_visits = parseInt(document.getElementById('loyalty-total-visits').value, 10) || 0;
  const total_rewards = parseInt(document.getElementById('loyalty-total-rewards').value, 10) || 0;
  let avatar = document.getElementById('loyalty-avatar').value.trim() || null;

  const fileInput = document.getElementById('loyalty-avatar-file');
  if (fileInput && fileInput.files && fileInput.files[0]) {
    try {
      const { url } = await DB.uploadLoyaltyAvatar(fileInput.files[0]);
      avatar = url;
    } catch (err) {
      alert('Erro no envio do avatar: ' + (err.message || err));
      return;
    }
  }

  const payload = { name, phone, avatar, total_visits, total_rewards };

  try {
    if (editingLoyaltyId) {
      payload.active = active;
      await DB.updateLoyaltyCustomer(editingLoyaltyId, payload);
      alert('Cliente atualizado!');
    } else {
      await DB.addLoyaltyCustomer(payload);
      alert('Cliente cadastrado!');
    }
    closeLoyaltyModal();
    await loadLoyaltyCustomers();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      alert('Sessão expirada. Faça login novamente.');
      if (typeof logout === 'function') logout();
    } else {
      alert('Erro: ' + error.message);
    }
  }
}

function editLoyaltyCustomer(id) {
  openLoyaltyModal(id);
}

async function deleteLoyaltyCustomer(id) {
  if (!confirm('Excluir este cliente do programa de fidelidade?')) return;
  try {
    await DB.deleteLoyaltyCustomer(id);
    alert('Cliente excluído!');
    await loadLoyaltyCustomers();
  } catch (error) {
    alert('Erro: ' + error.message);
  }
}

async function applyLoyaltyVisitDelta(id, delta) {
  if (!delta || delta === 0) return;

  try {
    const result = await DB.registerLoyaltyVisit(id, delta);
    const earned = result.rewards_earned || 0;
    const n = result.visits_per_reward || loyaltyVisitsPerReward;
    if (earned > 0) {
      const name = result.customer?.name || 'Cliente';
      const msg = earned === 1
        ? `Parabéns! ${name} completou ${n} visitas e ganhou 1 prêmio (Shake ou Hype Drink)!`
        : `Parabéns! ${name} ganhou ${earned} prêmios!`;
      alert(msg);
    }
    await loadLoyaltyCustomers();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      alert('Sessão expirada. Faça login novamente.');
      if (typeof logout === 'function') logout();
    } else {
      alert('Erro: ' + error.message);
    }
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

  const fileInput = document.getElementById('product-image-file');
  const preview = document.getElementById('product-image-preview');
  if (fileInput && preview) {
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (preview.src && preview.src.startsWith('blob:')) {
        URL.revokeObjectURL(preview.src);
      }
      if (f) {
        preview.src = URL.createObjectURL(f);
        preview.classList.remove('hidden');
      }
    });
  }
});
