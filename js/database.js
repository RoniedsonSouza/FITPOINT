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

function getAuthHeadersMultipart() {
  const token = localStorage.getItem('fitpoint_admin_token');
  const headers = {};
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

  // Envia imagem do produto (multipart); retorna { url: '/uploads/products/...' }
  async uploadProductImage(file) {
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`${getApiBaseUrl()}/products/upload-image`, {
      method: 'POST',
      headers: getAuthHeadersMultipart(),
      body: formData
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errorMsg = err.error || 'Erro ao enviar imagem';
      if (response.status === 401 || response.status === 403) {
        throw new Error(`401: ${errorMsg}`);
      }
      throw new Error(errorMsg);
    }
    return response.json();
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

  // === CATEGORIAS ===

  async getCategories() {
    try {
      const response = await fetch(`${getApiBaseUrl()}/categories`);
      if (!response.ok) throw new Error('Erro ao buscar categorias');
      return await response.json();
    } catch (error) {
      console.error('Erro ao buscar categorias:', error);
      return [
        { id: 1, name: 'Bebida', slug: 'bebida', sort_order: 0, active: true },
        { id: 2, name: 'Lanche', slug: 'lanche', sort_order: 1, active: true }
      ];
    }
  },

  async addCategory(category) {
    const response = await fetch(`${getApiBaseUrl()}/categories`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(category)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao criar categoria';
      if (response.status === 401 || response.status === 403) {
        throw new Error(`401: ${errorMsg}`);
      }
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async updateCategory(id, updates) {
    const response = await fetch(`${getApiBaseUrl()}/categories/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao atualizar categoria';
      if (response.status === 401 || response.status === 403) {
        throw new Error(`401: ${errorMsg}`);
      }
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async deleteCategory(id) {
    const response = await fetch(`${getApiBaseUrl()}/categories/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao excluir categoria';
      if (response.status === 401 || response.status === 403) {
        throw new Error(`401: ${errorMsg}`);
      }
      throw new Error(errorMsg);
    }
  },

  // === FIDELIDADE ===

  async getLoyaltySettings() {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/settings`);
    if (!response.ok) throw new Error('Erro ao buscar configurações de fidelidade');
    return response.json();
  },

  async updateLoyaltySettings(settings) {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/settings`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao salvar configurações';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async getLoyaltyRankings() {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/rankings`);
    if (!response.ok) throw new Error('Erro ao buscar rankings de fidelidade');
    return response.json();
  },

  async getLoyaltyCustomers() {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/customers`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar clientes de fidelidade';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async addLoyaltyCustomer(customer) {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/customers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(customer)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao criar cliente';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async updateLoyaltyCustomer(id, updates) {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/customers/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao atualizar cliente';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async deleteLoyaltyCustomer(id) {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/customers/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao excluir cliente';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  },

  async registerLoyaltyVisit(id, delta = 1) {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/customers/${id}/visit`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ delta })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao registrar visita';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async uploadLoyaltyAvatar(file) {
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`${getApiBaseUrl()}/loyalty/upload-avatar`, {
      method: 'POST',
      headers: getAuthHeadersMultipart(),
      body: formData
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errorMsg = err.error || 'Erro ao enviar avatar';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
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
  }
};
