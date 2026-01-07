// Sistema de autenticação para área admin

// Função helper para obter API_BASE_URL (evita conflito de const)
function getApiBaseUrl() {
  return window.FitPointConfig?.API_BASE_URL || 
         (window.location.origin.includes('localhost') ? 'http://localhost:3000/api' : '/api');
}

// Armazenar token no localStorage
const TOKEN_KEY = 'fitpoint_admin_token';

const Auth = {
  // Login
  async login(username, password) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao fazer login');
      }

      const data = await response.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      return data;
    } catch (error) {
      console.error('Erro no login:', error);
      throw error;
    }
  },

  // Logout
  logout() {
    localStorage.removeItem(TOKEN_KEY);
  },

  // Verificar se está autenticado
  isAuthenticated() {
    return !!localStorage.getItem(TOKEN_KEY);
  },

  // Obter token
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  // Obter header de autorização
  getAuthHeader() {
    const token = this.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }
};
