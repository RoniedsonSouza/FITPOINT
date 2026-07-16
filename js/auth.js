// Sistema de autenticação para área admin

// Função helper para obter API_BASE_URL (evita conflito de const)
function getApiBaseUrl() {
  return window.FitPointConfig?.API_BASE_URL ||
         (window.location.origin.includes('localhost') ? 'http://localhost:3000/api' : '/api');
}

// Armazenar token no localStorage
const TOKEN_KEY = 'fitpoint_admin_token';

const Auth = {
  currentUser: null,

  // Login (email ou username legado)
  async login(email, password) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao fazer login');
      }

      const data = await response.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      this.currentUser = data.user || null;
      return data;
    } catch (error) {
      console.error('Erro no login:', error);
      throw error;
    }
  },

  // Logout
  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.currentUser = null;
    if (typeof AdminPermissions !== 'undefined') {
      AdminPermissions.clear();
    }
  },

  // Verificar se está autenticado (checagem local rápida)
  isAuthenticated() {
    return !!localStorage.getItem(TOKEN_KEY);
  },

  // Validar sessão no servidor
  async validateSession() {
    const token = this.getToken();
    if (!token) {
      this.currentUser = null;
      return null;
    }

    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        this.logout();
        return null;
      }

      const data = await response.json();
      this.currentUser = data.user || null;
      return this.currentUser;
    } catch (error) {
      console.error('Erro ao validar sessão:', error);
      this.logout();
      return null;
    }
  },

  async changePassword(newPassword, currentPassword) {
    const payload = { newPassword };
    if (currentPassword) payload.currentPassword = currentPassword;

    const response = await fetch(`${getApiBaseUrl()}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeader()
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Erro ao alterar senha');
    }

    if (this.currentUser) {
      this.currentUser.mustChangePassword = false;
    }
    return response.json();
  },

  mustChangePassword() {
    return !!(this.currentUser && this.currentUser.mustChangePassword);
  },

  // Obter token
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  // Obter header de autorização
  getAuthHeader() {
    const token = this.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  },

  // Sincronizar logout entre abas
  initStorageSync(onLogout) {
    if (this._storageSyncBound) return;
    this._storageSyncBound = true;

    window.addEventListener('storage', (e) => {
      if (e.key === TOKEN_KEY && e.newValue === null && typeof onLogout === 'function') {
        onLogout();
      }
    });
  }
};
