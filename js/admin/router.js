// Navegação e dashboard do admin

const AdminRouter = {
  currentModule: 'dashboard',
  loadedModules: new Set(),

  routes: {
    dashboard: { hash: '#/', viewId: 'view-dashboard', label: 'Início' },
    categorias: { hash: '#/categorias', viewId: 'view-categories', label: 'Categorias', loader: 'loadCategories' },
    fidelidade: { hash: '#/fidelidade', viewId: 'view-loyalty', label: 'Fidelidade', loader: 'loadLoyaltyCustomers' },
    produtos: { hash: '#/produtos', viewId: 'view-products', label: 'Produtos', loader: 'loadProducts' }
  },

  init() {
    window.addEventListener('hashchange', () => this.handleHash());
    this.bindSidebar();
    this.bindModuleCards();
    this.bindMobileMenu();
    this.handleHash();
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
    return 'dashboard';
  },

  handleHash() {
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
    const route = this.routes[module];
    if (!route) return;

    this.currentModule = module;

    document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('is-active'));
    document.getElementById(route.viewId)?.classList.add('is-active');

    document.querySelectorAll('[data-admin-nav]').forEach(el => {
      el.classList.toggle('is-active', el.dataset.adminNav === module);
    });

    if (module === 'dashboard') {
      this.loadDashboardStats();
      return;
    }

    const loaderName = route.loader;
    if (loaderName && typeof window[loaderName] === 'function') {
      if (forceReload || !this.loadedModules.has(module)) {
        window[loaderName]();
        this.loadedModules.add(module);
      }
    }
  },

  async loadDashboardStats() {
    const catEl = document.getElementById('stat-categories');
    const loyEl = document.getElementById('stat-loyalty');
    const prodEl = document.getElementById('stat-products');

    if (catEl) catEl.textContent = 'Carregando…';
    if (loyEl) loyEl.textContent = 'Carregando…';
    if (prodEl) prodEl.textContent = 'Carregando…';

    try {
      const [categories, products, loyaltyData] = await Promise.all([
        DB.getCategories().catch(() => []),
        DB.getProducts().catch(() => []),
        DB.getLoyaltyCustomers({ page: 1, limit: 1 }).catch(() => ({ total: 0 }))
      ]);

      const activeCats = (categories || []).filter(c => c.active !== false).length;
      if (catEl) catEl.textContent = `${activeCats} categoria${activeCats !== 1 ? 's' : ''} ativa${activeCats !== 1 ? 's' : ''}`;
      if (prodEl) prodEl.textContent = `${(products || []).length} produto${(products || []).length !== 1 ? 's' : ''}`;
      const totalCustomers = loyaltyData.total ?? (loyaltyData.items || []).length;
      if (loyEl) loyEl.textContent = `${totalCustomers} cliente${totalCustomers !== 1 ? 's' : ''}`;
    } catch (error) {
      if (catEl) catEl.textContent = '—';
      if (loyEl) loyEl.textContent = '—';
      if (prodEl) prodEl.textContent = '—';
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
