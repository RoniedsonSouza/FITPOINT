// Script da página de administração

let currentTab = 'products';
let editingProductId = null;
let editingRecipeSlug = null;

// Função para alternar entre tabs
function showTab(tab) {
  currentTab = tab;
  const productsSection = document.getElementById('section-products');
  const recipesSection = document.getElementById('section-recipes');
  const tabProducts = document.getElementById('tab-products');
  const tabRecipes = document.getElementById('tab-recipes');

  if (tab === 'products') {
    productsSection.style.display = 'block';
    recipesSection.style.display = 'none';
    tabProducts.classList.add('border-fp-green', 'text-fp-green');
    tabProducts.classList.remove('border-transparent');
    tabRecipes.classList.remove('border-fp-green', 'text-fp-green');
    tabRecipes.classList.add('border-transparent');
  } else {
    productsSection.style.display = 'none';
    recipesSection.style.display = 'block';
    tabRecipes.classList.add('border-fp-green', 'text-fp-green');
    tabRecipes.classList.remove('border-transparent');
    tabProducts.classList.remove('border-fp-green', 'text-fp-green');
    tabProducts.classList.add('border-transparent');
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

    container.innerHTML = products.map(product => `
      <div class="card">
        <div class="flex items-start justify-between mb-2">
          <h3 class="font-semibold text-lg">${product.name}</h3>
          <span class="text-fp-green font-bold">R$ ${product.price.toFixed(2)}</span>
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
        ${!product.active ? '<span class="chip" style="background: #fee2e2; color: #dc2626; margin-top: 0.5rem;">Inativo</span>' : ''}
      </div>
    `).join('');

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
      document.getElementById('product-id').value = product.id;
      document.getElementById('product-id-input').value = product.id;
      document.getElementById('product-id-input').disabled = true;
      document.getElementById('product-name').value = product.name;
      document.getElementById('product-price').value = product.price;
      document.getElementById('product-category').value = product.category;
      document.getElementById('product-tags').value = (product.tags || []).join(', ');
      document.getElementById('product-image').value = product.image || '';
      document.getElementById('product-active').checked = product.active !== false;
    } catch (error) {
      alert('Erro ao carregar produto: ' + error.message);
      return;
    }
  } else {
    // Modo criação
    title.textContent = 'Adicionar Produto';
    form.reset();
    document.getElementById('product-id').value = '';
    document.getElementById('product-id-input').disabled = false;
    document.getElementById('product-active').checked = true;
  }

  modal.classList.add('active');
}

function closeProductModal() {
  const modal = document.getElementById('product-modal');
  modal.classList.remove('active');
  editingProductId = null;
}

async function saveProduct(event) {
  event.preventDefault();

  const idInput = document.getElementById('product-id-input');
  const id = editingProductId || idInput.value.trim();
  const name = document.getElementById('product-name').value.trim();
  const price = parseFloat(document.getElementById('product-price').value);
  const category = document.getElementById('product-category').value;
  const tagsInput = document.getElementById('product-tags').value.trim();
  const image = document.getElementById('product-image').value.trim();
  const active = document.getElementById('product-active').checked;

  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

  const productData = {
    id,
    name,
    price,
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

// === RECEITAS ===

async function loadRecipes() {
  if (typeof DB === 'undefined') {
    console.error('DB não está definido');
    const container = document.getElementById('recipes-list');
    container.innerHTML = '<p class="text-red-600">Erro: Módulo DB não carregado. Recarregue a página.</p>';
    return;
  }
  
  const container = document.getElementById('recipes-list');
  container.innerHTML = '<p class="text-black/60">Carregando...</p>';

  try {
    const recipes = await DB.getRecipes();

    if (recipes.length === 0) {
      container.innerHTML = '<p class="text-black/60">Nenhuma receita cadastrada. Clique em "Adicionar Receita" para começar.</p>';
      return;
    }

    container.innerHTML = recipes.map(recipe => `
      <div class="card">
        <h3 class="font-semibold text-lg mb-2">${recipe.title}</h3>
        <p class="text-sm text-black/60 mb-2">Slug: ${recipe.slug}</p>
        <div class="text-sm text-black/70 mb-3">
          ${recipe.time ? `<span class="chip"><i data-lucide="timer"></i> ${recipe.time} min</span>` : ''}
          ${recipe.servings ? `<span class="chip"><i data-lucide="users"></i> ${recipe.servings} porções</span>` : ''}
          ${recipe.kcal ? `<span class="chip"><i data-lucide="flame"></i> ${recipe.kcal} kcal</span>` : ''}
          ${recipe.protein_g ? `<span class="chip"><i data-lucide="beef"></i> ${recipe.protein_g}g proteína</span>` : ''}
        </div>
        <div class="flex gap-2">
          <button onclick="editRecipe('${recipe.slug}')" class="btn btn-outline" style="padding: 0.5rem 1rem;">
            <i data-lucide="edit"></i> Editar
          </button>
          <button onclick="deleteRecipe('${recipe.slug}')" class="btn btn-danger" style="padding: 0.5rem 1rem;">
            <i data-lucide="trash"></i> Excluir
          </button>
        </div>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    console.error('Erro ao carregar receitas:', error);
    container.innerHTML = '<p class="text-red-600">Erro ao carregar receitas. Verifique se o servidor está rodando.</p>';
  }
}

async function openRecipeModal(recipeSlug = null) {
  editingRecipeSlug = recipeSlug;
  const modal = document.getElementById('recipe-modal');
  const form = document.getElementById('recipe-form');
  const title = document.getElementById('recipe-modal-title');

  if (recipeSlug) {
    // Modo edição
    try {
      const recipe = await DB.getRecipe(recipeSlug);
      if (!recipe) {
        alert('Receita não encontrada');
        return;
      }
      title.textContent = 'Editar Receita';
      document.getElementById('recipe-slug-input').value = recipe.slug;
      document.getElementById('recipe-slug').value = recipe.slug;
      document.getElementById('recipe-slug').disabled = true;
      document.getElementById('recipe-title').value = recipe.title;
      document.getElementById('recipe-image').value = recipe.image || '';
      document.getElementById('recipe-time').value = recipe.time || '';
      document.getElementById('recipe-servings').value = recipe.servings || 1;
      document.getElementById('recipe-kcal').value = recipe.kcal || '';
      document.getElementById('recipe-protein').value = recipe.protein_g || 0;
      document.getElementById('recipe-steps').value = (recipe.steps || []).join('\n');
      document.getElementById('recipe-tips').value = (recipe.tips || []).join('\n');
    } catch (error) {
      alert('Erro ao carregar receita: ' + error.message);
      return;
    }
  } else {
    // Modo criação
    title.textContent = 'Adicionar Receita';
    form.reset();
    document.getElementById('recipe-slug-input').value = '';
    document.getElementById('recipe-slug').disabled = false;
    document.getElementById('recipe-servings').value = 1;
    document.getElementById('recipe-protein').value = 0;
  }

  modal.classList.add('active');
}

function closeRecipeModal() {
  const modal = document.getElementById('recipe-modal');
  modal.classList.remove('active');
  editingRecipeSlug = null;
}

async function saveRecipe(event) {
  event.preventDefault();

  const slugInput = document.getElementById('recipe-slug');
  const slug = editingRecipeSlug || slugInput.value.trim();
  const title = document.getElementById('recipe-title').value.trim();
  const image = document.getElementById('recipe-image').value.trim();
  const time = parseInt(document.getElementById('recipe-time').value) || undefined;
  const servings = parseInt(document.getElementById('recipe-servings').value) || 1;
  const kcal = parseInt(document.getElementById('recipe-kcal').value) || undefined;
  const protein_g = parseInt(document.getElementById('recipe-protein').value) || 0;
  const stepsInput = document.getElementById('recipe-steps').value.trim();
  const tipsInput = document.getElementById('recipe-tips').value.trim();

  const steps = stepsInput ? stepsInput.split('\n').map(s => s.trim()).filter(s => s) : [];
  const tips = tipsInput ? tipsInput.split('\n').map(t => t.trim()).filter(t => t) : [];

  const recipeData = {
    slug,
    title,
    image: image || undefined,
    time,
    servings,
    kcal,
    protein_g,
    steps,
    tips
  };

  try {
    if (editingRecipeSlug) {
      await DB.updateRecipe(editingRecipeSlug, recipeData);
      alert('Receita atualizada com sucesso!');
    } else {
      await DB.addRecipe(recipeData);
      alert('Receita adicionada com sucesso!');
    }
    closeRecipeModal();
    await loadRecipes();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      if (typeof logout === 'function') logout();
    } else {
      alert('Erro: ' + error.message);
    }
  }
}

function editRecipe(slug) {
  openRecipeModal(slug);
}

async function deleteRecipe(slug) {
  if (!confirm('Tem certeza que deseja excluir esta receita?')) {
    return;
  }

  try {
    await DB.deleteRecipe(slug);
    alert('Receita excluída com sucesso!');
    await loadRecipes();
  } catch (error) {
    if (error.message.includes('401') || error.message.includes('403')) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      if (typeof logout === 'function') logout();
    } else {
      alert('Erro: ' + error.message);
    }
  }
}
