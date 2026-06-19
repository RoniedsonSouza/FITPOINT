// Módulo Produtos

let editingProductId = null;

async function loadProducts() {
  if (typeof DB === 'undefined') {
    const container = document.getElementById('products-list');
    if (container) {
      container.innerHTML = '<p class="text-red-600">Erro: Módulo DB não carregado. Recarregue a página.</p>';
    }
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
      const pid = escapeAttr(product.id);
      return `
      <div class="card">
        ${product.image ? `<div class="mb-3 h-36 rounded-lg overflow-hidden border border-black/10 bg-black/5"><img src="${escapeAttr(product.image)}" alt="" class="w-full h-full object-contain" loading="lazy"></div>` : ''}
        <div class="flex items-start justify-between mb-2 gap-2">
          <h3 class="font-semibold text-lg">${escapeHtml(product.name)}</h3>
          ${priceHtml}
        </div>
        <p class="text-sm text-black/60 mb-2">ID: ${escapeHtml(product.id)}</p>
        <p class="text-sm text-black/60 mb-2">Categoria: ${escapeHtml(product.category)}</p>
        ${optsCount ? `<p class="text-xs text-black/50 mb-2">${optsCount} opção(ões)</p>` : ''}
        <div class="flex flex-wrap gap-1 mb-3">
          ${(product.tags || []).map(tag => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="flex gap-2">
          <button onclick="editProduct('${pid}')" class="btn btn-outline btn-sm">
            <i data-lucide="edit"></i> Editar
          </button>
          <button onclick="deleteProduct('${pid}')" class="btn btn-danger btn-sm">
            <i data-lucide="trash"></i> Excluir
          </button>
        </div>
        ${product.is_kit ? '<span class="chip" style="background: rgba(79, 70, 229, 0.12); color: #4338ca; margin-top: 0.35rem;">Kit</span>' : ''}
        ${!product.active ? '<span class="chip" style="background: #fee2e2; color: #dc2626; margin-top: 0.5rem;">Inativo</span>' : ''}
      </div>
    `;
    }).join('');

    refreshIcons();
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
        showToast('Produto não encontrado', 'error');
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
      showToast('Erro ao carregar produto: ' + error.message, 'error');
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
  refreshIcons();
}

function closeProductModal() {
  const prevImg = document.getElementById('product-image-preview');
  if (prevImg && prevImg.src && prevImg.src.startsWith('blob:')) {
    URL.revokeObjectURL(prevImg.src);
  }
  document.getElementById('product-modal').classList.remove('active');
  editingProductId = null;
}

async function saveProduct(event) {
  event.preventDefault();
  const btn = event.submitter || document.querySelector('#product-form button[type="submit"]');

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
      showToast('Preço promocional inválido.', 'error');
      return;
    }
    if (pr >= price) {
      showToast('O preço promocional deve ser menor que o preço normal.', 'error');
      return;
    }
    promo_price = pr;
  }
  const category = document.getElementById('product-category').value;
  if (!category) {
    showToast('Selecione uma categoria.', 'error');
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

  await withButtonLoading(btn, async () => {
    const fileInput = document.getElementById('product-image-file');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      try {
        const { url } = await DB.uploadProductImage(fileInput.files[0]);
        image = url;
        document.getElementById('product-image').value = url;
      } catch (err) {
        showToast('Erro no envio da imagem: ' + (err.message || err), 'error');
        throw err;
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
        showToast('Produto atualizado com sucesso!');
      } else {
        await DB.addProduct(productData);
        showToast('Produto adicionado com sucesso!');
      }
      closeProductModal();
      await loadProducts();
      if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, 'Salvando…');
}

function editProduct(id) {
  openProductModal(id);
}

async function deleteProduct(id) {
  if (!confirm('Tem certeza que deseja excluir este produto?')) return;

  try {
    await DB.deleteProduct(id);
    showToast('Produto excluído com sucesso!');
    await loadProducts();
    if (typeof AdminRouter !== 'undefined') AdminRouter.loadDashboardStats();
  } catch (error) {
    if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
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
