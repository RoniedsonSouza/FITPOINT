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

  // Envia imagem do evento (multipart); retorna { url: '/uploads/events/...' }
  async uploadEventImage(file) {
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`${getApiBaseUrl()}/events/upload-image`, {
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

  async getLoyaltyRankings(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    const url = `${getApiBaseUrl()}/loyalty/rankings${query ? `?${query}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Erro ao buscar rankings de fidelidade');
    return response.json();
  },

  async getLoyaltyCustomers(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.active != null) {
      qs.set('active', params.active === true || params.active === 'true' ? 'true' : String(params.active));
    }
    const query = qs.toString();
    const url = `${getApiBaseUrl()}/loyalty/customers${query ? `?${query}` : ''}`;
    const response = await fetch(url, {
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

  async getLoyaltyCustomer(id) {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/customers/${id}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar cliente';
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

  async getLoyaltyVisitHistory(id, { limit = 30 } = {}) {
    const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    const response = await fetch(`${getApiBaseUrl()}/loyalty/customers/${id}/visits${qs}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar histórico de visitas';
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

  // === VENDAS DO DIA ===

  async getBestSellers(limit = 4) {
    const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    const response = await fetch(`${getApiBaseUrl()}/daily-sales/bestsellers${qs}`);
    if (!response.ok) throw new Error('Erro ao buscar mais vendidos');
    const data = await response.json();
    return data.items || [];
  },

  async getDailySales(date) {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    const response = await fetch(`${getApiBaseUrl()}/daily-sales${qs}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar vendas do dia';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async getDailyDiaryDayStatus(date) {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    const response = await fetch(`${getApiBaseUrl()}/daily-sales/day-status${qs}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar status do diário';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async setDailyDiaryDayStatus(sale_date, registered) {
    const response = await fetch(`${getApiBaseUrl()}/daily-sales/day-status`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ sale_date, registered: Boolean(registered) })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao atualizar status do diário';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async getDailySalesSummary(date) {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    const response = await fetch(`${getApiBaseUrl()}/daily-sales/summary${qs}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar resumo de vendas';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async getTodaySalesSummary() {
    const response = await fetch(`${getApiBaseUrl()}/daily-sales/summary/today`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar resumo de hoje';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async addDailySale(payload) {
    const response = await fetch(`${getApiBaseUrl()}/daily-sales`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao registrar venda';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async addDailySalesBatch(payload) {
    const response = await fetch(`${getApiBaseUrl()}/daily-sales/batch`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao registrar vendas';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async deleteDailySale(id) {
    const response = await fetch(`${getApiBaseUrl()}/daily-sales/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao excluir venda';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  // === DISTRIBUIDORES ===

  async getDistributorLevels() {
    const response = await fetch(`${getApiBaseUrl()}/distributors/levels`);
    if (!response.ok) throw new Error('Erro ao buscar níveis Herbalife');
    return response.json();
  },

  async getDistributors(params = {}) {
    const qs = new URLSearchParams();
    if (params.all) qs.set('all', '1');
    const query = qs.toString();
    const response = await fetch(`${getApiBaseUrl()}/distributors${query ? `?${query}` : ''}`, {
      headers: params.all ? getAuthHeaders() : undefined
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar distribuidores';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async addDistributor(payload) {
    const response = await fetch(`${getApiBaseUrl()}/distributors`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao criar distribuidor';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async updateDistributor(id, updates) {
    const response = await fetch(`${getApiBaseUrl()}/distributors/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao atualizar distribuidor';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async deleteDistributor(id) {
    const response = await fetch(`${getApiBaseUrl()}/distributors/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao excluir distribuidor';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  },

  async uploadDistributorPhoto(file) {
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`${getApiBaseUrl()}/distributors/upload-photo`, {
      method: 'POST',
      headers: getAuthHeadersMultipart(),
      body: formData
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errorMsg = err.error || 'Erro ao enviar foto';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  // === EVENTOS / INGRESSOS ===

  async getEvents(params = {}) {
    const qs = new URLSearchParams();
    if (params.all) qs.set('all', '1');
    const query = qs.toString();
    const response = await fetch(`${getApiBaseUrl()}/events${query ? `?${query}` : ''}`, {
      headers: params.all ? getAuthHeaders() : undefined
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar eventos';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async getEvent(id) {
    const response = await fetch(`${getApiBaseUrl()}/events/${id}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar evento';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async addEvent(payload) {
    const response = await fetch(`${getApiBaseUrl()}/events`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao criar evento';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async updateEvent(id, updates) {
    const response = await fetch(`${getApiBaseUrl()}/events/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao atualizar evento';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async deleteEvent(id) {
    const response = await fetch(`${getApiBaseUrl()}/events/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao excluir evento';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  },

  async getEventLots(eventId) {
    const response = await fetch(`${getApiBaseUrl()}/events/${eventId}/lots`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar lotes';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async addEventLot(eventId, payload) {
    const response = await fetch(`${getApiBaseUrl()}/events/${eventId}/lots`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao criar lote';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async updateEventLot(eventId, lotId, updates) {
    const response = await fetch(`${getApiBaseUrl()}/events/${eventId}/lots/${lotId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao atualizar lote';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async deleteEventLot(eventId, lotId) {
    const response = await fetch(`${getApiBaseUrl()}/events/${eventId}/lots/${lotId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao excluir lote';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  },

  async getTickets(params = {}) {
    const qs = new URLSearchParams();
    if (params.event_id) qs.set('event_id', String(params.event_id));
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    const response = await fetch(`${getApiBaseUrl()}/tickets${query ? `?${query}` : ''}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar ingressos';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async validateTicket(code) {
    const response = await fetch(`${getApiBaseUrl()}/tickets/validate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ code })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMsg = data.error || 'Erro ao validar ingresso';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      const err = new Error(errorMsg);
      err.data = data;
      err.status = response.status;
      throw err;
    }
    return data;
  },

  async checkoutTicket(payload) {
    const response = await fetch(`${getApiBaseUrl()}/tickets/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Erro ao iniciar pagamento');
    }
    return response.json();
  },

  async issueVipTicket(payload) {
    const response = await fetch(`${getApiBaseUrl()}/tickets/issue-vip`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Erro ao emitir ingresso VIP');
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
  },

  // === USUÁRIOS ADMIN ===

  _throwHttpError(response, error, fallback) {
    const msg = error.error || fallback;
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${response.status}: ${msg}`);
    }
    throw new Error(msg);
  },

  async getAdminUsers() {
    const response = await fetch(`${getApiBaseUrl()}/auth/users`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this._throwHttpError(response, error, 'Erro ao listar usuários');
    }
    return response.json();
  },

  async createAdminUser(payload) {
    const response = await fetch(`${getApiBaseUrl()}/auth/users`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this._throwHttpError(response, error, 'Erro ao criar usuário');
    }
    return response.json();
  },

  async updateAdminUser(id, payload) {
    const response = await fetch(`${getApiBaseUrl()}/auth/users/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this._throwHttpError(response, error, 'Erro ao atualizar usuário');
    }
    return response.json();
  },

  async deleteAdminUser(id) {
    const response = await fetch(`${getApiBaseUrl()}/auth/users/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this._throwHttpError(response, error, 'Erro ao desativar usuário');
    }
    return response.json();
  },

  async changeAdminPassword(payload) {
    const response = await fetch(`${getApiBaseUrl()}/auth/change-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this._throwHttpError(response, error, 'Erro ao alterar senha');
    }
    return response.json();
  }
};
