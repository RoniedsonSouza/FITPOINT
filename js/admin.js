// Script da página de administração

let editingProductId = null;

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
      return `
      <div class="card">
        ${product.image ? `<div class="mb-3 h-36 rounded-lg overflow-hidden border border-black/10 bg-black/5"><img src="${product.image}" alt="" class="w-full h-full object-cover" loading="lazy"></div>` : ''}
        <div class="flex items-start justify-between mb-2 gap-2">
          <h3 class="font-semibold text-lg">${product.name}</h3>
          ${priceHtml}
        </div>
        <p class="text-sm text-black/60 mb-2">ID: ${product.id}</p>
        <p class="text-sm text-black/60 mb-2">Categoria: ${product.category}</p>
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

  if (productId) {
    // Modo edição
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
      document.getElementById('product-category').value = product.category;
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
    // Modo criação
    title.textContent = 'Adicionar Produto';
    form.reset();
    document.getElementById('product-id-input').value = generateProductId();
    document.getElementById('product-active').checked = true;
    document.getElementById('product-is-kit').checked = false;
    document.getElementById('product-promo-price').value = '';
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
    active
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

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('product-image-file');
  const preview = document.getElementById('product-image-preview');
  if (!fileInput || !preview) return;
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
});
