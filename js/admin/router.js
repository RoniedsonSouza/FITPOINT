// Navegação e dashboard do admin

const AdminRouter = {
  currentModule: 'dashboard',
  loadedModules: new Set(),

  routes: {
    dashboard: { hash: '#/', viewId: 'view-dashboard', label: 'Início' },
    categorias: { hash: '#/categorias', viewId: 'view-categories', label: 'Categorias', loader: 'loadCategories' },
    fidelidade: { hash: '#/fidelidade', viewId: 'view-loyalty', label: 'Fidelidade', loader: 'loadLoyaltyCustomers' },
    produtos: { hash: '#/produtos', viewId: 'view-products', label: 'Produtos', loader: 'loadProducts' },
    vendas: { hash: '#/vendas', viewId: 'view-daily-sales', label: 'Vendas do dia', loader: 'loadDailySales' },
    diario: { hash: '#/diario', viewId: 'view-daily-diario', label: 'Diário', loader: 'loadDailyDiario' },
    eventos: { hash: '#/eventos', viewId: 'view-events', label: 'Eventos', loader: 'loadEvents' }
  },

  init() {
    window.addEventListener('hashchange', () => this.handleHash());
    this.bindSidebar();
    this.bindModuleCards();
    this.bindMobileMenu();
  },

  isAuthenticated() {
    return typeof Auth !== 'undefined' && Auth.isAuthenticated();
  },

  bindSidebar() {
    document.querySelectorAll('[data-admin-nav]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const module = el.dataset.adminNav;
        this.navigate(module);
        this.closeMobileSidebar();
      });
    });
  },

  bindModuleCards() {
    document.querySelectorAll('[data-module-card]').forEach(el => {
      el.addEventListener('click', () => {
        this.navigate(el.dataset.moduleCard);
      });
    });
  },

  bindMobileMenu() {
    const toggle = document.getElementById('admin-menu-toggle');
    const sidebar = document.getElementById('admin-sidebar');
    const overlay = document.getElementById('admin-sidebar-overlay');

    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('is-open');
        overlay?.classList.toggle('is-visible');
      });
    }

    if (overlay) {
      overlay.addEventListener('click', () => this.closeMobileSidebar());
    }
  },

  closeMobileSidebar() {
    document.getElementById('admin-sidebar')?.classList.remove('is-open');
    document.getElementById('admin-sidebar-overlay')?.classList.remove('is-visible');
  },

  parseHash() {
    const hash = window.location.hash || '#/';
    if (hash === '#/' || hash === '#') return 'dashboard';
    if (hash.startsWith('#/categorias')) return 'categorias';
    if (hash.startsWith('#/fidelidade')) return 'fidelidade';
    if (hash.startsWith('#/produtos')) return 'produtos';
    if (hash.startsWith('#/diario')) return 'diario';
    if (hash.startsWith('#/vendas')) return 'vendas';
    if (hash.startsWith('#/eventos')) return 'eventos';
    return 'dashboard';
  },

  handleHash() {
    if (!this.isAuthenticated()) return;
    const module = this.parseHash();
    this.showModule(module, false);
  },

  navigate(module) {
    const route = this.routes[module];
    if (!route) return;
    if (window.location.hash !== route.hash) {
      window.location.hash = route.hash;
    } else {
      this.showModule(module, true);
    }
  },

  showModule(module, forceReload) {
    if (!this.isAuthenticated()) return;

    const route = this.routes[module];
    if (!route) return;

    this.currentModule = module;

    document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('is-active'));
    document.getElementById(route.viewId)?.classList.add('is-active');

    document.querySelectorAll('[data-admin-nav]').forEach(el => {
      const navModule = module === 'diario' ? 'vendas' : module;
      el.classList.toggle('is-active', el.dataset.adminNav === navModule);
    });

    if (module === 'dashboard') {
      this.loadDashboardStats();
      return;
    }

    const loaderName = route.loader;
    if (loaderName && typeof window[loaderName] === 'function') {
      const alwaysReload = module === 'vendas' || module === 'diario' || module === 'fidelidade' || module === 'eventos';
      if (forceReload || alwaysReload || !this.loadedModules.has(module)) {
        window[loaderName]();
        this.loadedModules.add(module);
      }
    }
  },

  async loadDashboardStats() {
    const catEl = document.getElementById('stat-categories');
    const loyEl = document.getElementById('stat-loyalty');
    const prodEl = document.getElementById('stat-products');
    const salesEl = document.getElementById('stat-daily-sales');
    const eventsEl = document.getElementById('stat-events');
    const dashItems = document.getElementById('dashboard-stat-items');
    const dashRevenue = document.getElementById('dashboard-stat-revenue');
    const dashTop = document.getElementById('dashboard-stat-top');
    const dashSummary = document.getElementById('dashboard-daily-summary');

    if (catEl) catEl.textContent = 'Carregando…';
    if (loyEl) loyEl.textContent = 'Carregando…';
    if (prodEl) prodEl.textContent = 'Carregando…';
    if (salesEl) salesEl.textContent = 'Carregando…';
    if (eventsEl) eventsEl.textContent = 'Carregando…';

    const formatBRL = (value) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

    try {
      const [categories, products, loyaltyData, salesToday, events] = await Promise.all([
        DB.getCategories().catch(() => []),
        DB.getProducts().catch(() => []),
        DB.getLoyaltyCustomers({ page: 1, limit: 1 }),
        DB.getTodaySalesSummary().catch(() => null),
        DB.getEvents({ all: true }).catch(() => [])
      ]);

      const activeCats = (categories || []).filter(c => c.active !== false).length;
      if (catEl) catEl.textContent = `${activeCats} categoria${activeCats !== 1 ? 's' : ''} ativa${activeCats !== 1 ? 's' : ''}`;
      if (prodEl) prodEl.textContent = `${(products || []).length} produto${(products || []).length !== 1 ? 's' : ''}`;
      const totalCustomers = loyaltyData.total ?? (loyaltyData.items || []).length;
      if (loyEl) loyEl.textContent = `${totalCustomers} cliente${totalCustomers !== 1 ? 's' : ''}`;

      const totalItems = salesToday?.total_items ?? 0;
      const totalRevenue = salesToday?.total_revenue ?? 0;
      const topProduct = salesToday?.top_product;

      if (salesEl) {
        salesEl.textContent = totalItems > 0
          ? `${totalItems} venda${totalItems !== 1 ? 's' : ''} · ${formatBRL(totalRevenue)} hoje`
          : 'Nenhuma venda hoje';
      }

      const activeEvents = (events || []).filter(e => e.active !== false).length;
      if (eventsEl) {
        eventsEl.textContent = `${activeEvents} evento${activeEvents !== 1 ? 's' : ''} ativo${activeEvents !== 1 ? 's' : ''}`;
      }

      if (dashSummary) dashSummary.classList.remove('hidden');
      if (dashItems) dashItems.textContent = String(totalItems);
      if (dashRevenue) dashRevenue.textContent = formatBRL(totalRevenue);
      if (dashTop) dashTop.textContent = topProduct || '—';
    } catch (error) {
      if (handleAuthError(error)) return;
      if (catEl) catEl.textContent = '—';
      if (loyEl) loyEl.textContent = '—';
      if (prodEl) prodEl.textContent = '—';
      if (salesEl) salesEl.textContent = '—';
      if (eventsEl) eventsEl.textContent = '—';
      if (dashItems) dashItems.textContent = '—';
      if (dashRevenue) dashRevenue.textContent = '—';
      if (dashTop) dashTop.textContent = '—';
    }
  },

  reset() {
    this.loadedModules.clear();
    this.currentModule = 'dashboard';
  }
};

function initAdminAfterLogin() {
  AdminRouter.reset();
  if (window.location.hash && AdminRouter.parseHash() !== 'dashboard') {
    AdminRouter.handleHash();
  } else {
    window.location.hash = '#/';
    AdminRouter.showModule('dashboard', true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  AdminRouter.init();
});
