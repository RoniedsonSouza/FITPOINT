// Helpers compartilhados do admin

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
    <button type="button" class="btn btn-danger btn-sm btn-icon option-remove" title="Remover">
      <i data-lucide="trash-2"></i>
    </button>
  `;
  row.querySelector('.option-remove').addEventListener('click', () => {
    row.remove();
    ensureOptionDefaultRadio();
  });
  list.appendChild(row);
  ensureOptionDefaultRadio();
  refreshIcons();
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

async function populateCategorySelect(selectedName) {
  const sel = document.getElementById('product-category');
  if (!sel) return;
  try {
    const categories = await DB.getCategories();
    const active = categories.filter(c => c.active !== false);
    sel.innerHTML = '<option value="">Selecione…</option>' +
      active.map(c => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`).join('');
    if (selectedName) sel.value = selectedName;
  } catch (e) {
    console.error(e);
  }
}
