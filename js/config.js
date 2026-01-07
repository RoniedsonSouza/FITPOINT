// Configuração compartilhada para FitPoint
// Este arquivo deve ser carregado primeiro

(function() {
  'use strict';
  
  // API Base URL - definido uma única vez
  window.FitPointConfig = window.FitPointConfig || {};
  window.FitPointConfig.API_BASE_URL = window.location.origin.includes('localhost') 
    ? 'http://localhost:3000/api' 
    : '/api';
})();

