// Sistema de banco de dados usando APIs REST
// Conecta ao backend para persistência real

// Função helper para obter API_BASE_URL (evita conflito de const)
function getApiBaseUrl() {
  return window.FitPointConfig?.API_BASE_URL || 
         (window.location.origin.includes('localhost') ? 'http://localhost:3000/api' : '/api');
}

// Função auxiliar para obter headers com autenticação
function getAuthHeaders() {
  const token = localStorage.getItem('fitpoint_admin_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

const DB = {
  // === PRODUTOS ===

  // Obtém todos os produtos
  async getProducts() {
    try {
      const response = await fetch(`${getApiBaseUrl()}/products`);
      if (!response.ok) throw new Error('Erro ao buscar produtos');
      return await response.json();
    } catch (error) {
      console.error('Erro ao buscar produtos:', error);
      // Fallback para JSON estático se API não estiver disponível
      try {
        const res = await fetch('/data/products.json');
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Fallback para JSON também falhou:', e);
      }
      return [];
    }
  },

  // Obtém um produto por ID
  async getProduct(id) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/products/${id}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Erro ao buscar produto');
      }
      return await response.json();
    } catch (error) {
      console.error('Erro ao buscar produto:', error);
      return null;
    }
  },

  // Adiciona um novo produto
  async addProduct(product) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/products`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(product)
      });
      
      if (!response.ok) {
        const error = await response.json();
        const errorMsg = error.error || 'Erro ao criar produto';
        if (response.status === 401 || response.status === 403) {
          throw new Error(`401: ${errorMsg}`);
        }
        throw new Error(errorMsg);
      }
      
      const result = await response.json();
      return product;
    } catch (error) {
      console.error('Erro ao adicionar produto:', error);
      throw error;
    }
  },

  // Atualiza um produto existente
  async updateProduct(id, updates) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/products/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates)
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Produto com ID "${id}" não encontrado`);
        }
        const error = await response.json();
        const errorMsg = error.error || 'Erro ao atualizar produto';
        if (response.status === 401 || response.status === 403) {
          throw new Error(`401: ${errorMsg}`);
        }
        throw new Error(errorMsg);
      }
      
      const updatedProduct = await this.getProduct(id);
      return updatedProduct;
    } catch (error) {
      console.error('Erro ao atualizar produto:', error);
      throw error;
    }
  },

  // Remove um produto
  async deleteProduct(id) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/products/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Produto com ID "${id}" não encontrado`);
        }
        const error = await response.json();
        const errorMsg = error.error || 'Erro ao deletar produto';
        if (response.status === 401 || response.status === 403) {
          throw new Error(`401: ${errorMsg}`);
        }
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('Erro ao deletar produto:', error);
      throw error;
    }
  },

  // === RECEITAS ===

  // Obtém todas as receitas
  async getRecipes() {
    try {
      const response = await fetch(`${getApiBaseUrl()}/recipes`);
      if (!response.ok) throw new Error('Erro ao buscar receitas');
      return await response.json();
    } catch (error) {
      console.error('Erro ao buscar receitas:', error);
      // Fallback para JSON estático se API não estiver disponível
      try {
        const res = await fetch('/data/recipes.json');
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('Fallback para JSON também falhou:', e);
      }
      return [];
    }
  },

  // Obtém uma receita por slug
  async getRecipe(slug) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/recipes/${slug}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Erro ao buscar receita');
      }
      return await response.json();
    } catch (error) {
      console.error('Erro ao buscar receita:', error);
      return null;
    }
  },

  // Adiciona uma nova receita
  async addRecipe(recipe) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/recipes`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(recipe)
      });
      
      if (!response.ok) {
        const error = await response.json();
        const errorMsg = error.error || 'Erro ao criar receita';
        if (response.status === 401 || response.status === 403) {
          throw new Error(`401: ${errorMsg}`);
        }
        throw new Error(errorMsg);
      }
      
      return recipe;
    } catch (error) {
      console.error('Erro ao adicionar receita:', error);
      throw error;
    }
  },

  // Atualiza uma receita existente
  async updateRecipe(slug, updates) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/recipes/${slug}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates)
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Receita com slug "${slug}" não encontrada`);
        }
        const error = await response.json();
        const errorMsg = error.error || 'Erro ao atualizar receita';
        if (response.status === 401 || response.status === 403) {
          throw new Error(`401: ${errorMsg}`);
        }
        throw new Error(errorMsg);
      }
      
      const updatedRecipe = await this.getRecipe(slug);
      return updatedRecipe;
    } catch (error) {
      console.error('Erro ao atualizar receita:', error);
      throw error;
    }
  },

  // Remove uma receita
  async deleteRecipe(slug) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/recipes/${slug}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Receita com slug "${slug}" não encontrada`);
        }
        const error = await response.json();
        const errorMsg = error.error || 'Erro ao deletar receita';
        if (response.status === 401 || response.status === 403) {
          throw new Error(`401: ${errorMsg}`);
        }
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('Erro ao deletar receita:', error);
      throw error;
    }
  }
};
