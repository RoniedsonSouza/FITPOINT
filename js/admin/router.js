// Navegação e dashboard do admin

const AdminRouter = {
  currentModule: 'dashboard',
  loadedModules: new Set(),

  routes: {
    dashboard: { hash: '#/', viewId: 'view-dashboard', label: 'Início' },
    categorias: { hash: '#/categorias', viewId: 'view-categories', label: 'Categorias', loader: 'loadCategories' },
    fidelidade: { hash: '#/fidelidade', viewId: 'view-loyalty', label: 'Fidelidade', loader: 'loadLoyaltyCustomers' },
    clientes: { hash: '#/clientes', viewId: 'view-clientes', label: 'Clientes', loader: 'loadClients' },
    produtos: { hash: '#/produtos', viewId: 'view-products', label: 'Produtos', loader: 'loadProducts' },
    diario: { hash: '#/diario', viewId: 'view-daily-diario', label: 'Diário', loader: 'loadDailyDiario' },
    relatorios: { hash: '#/relatorios', viewId: 'view-daily-sales', label: 'Relatórios', loader: 'loadDailySales' },
    eventos: { hash: '#/eventos', viewId: 'view-events', label: 'Eventos', loader: 'loadEvents' },
    emails: { hash: '#/emails', viewId: 'view-emails', label: 'E-mails', loader: 'loadEmailCampaigns' },
    distribuidores: { hash: '#/distribuidores', viewId: 'view-distributors', label: 'Distribuidores', loader: 'loadDistributors' },
    usuarios: { hash: '#/usuarios', viewId: 'view-users', label: 'Usuários', loader: 'loadUsers' }
  },

  init() {
    window.addEventListener('hashchange', () => this.handleHash());
    this.bindSidebar();
    this.bindModuleCards();
    this.bindMobileMenu();
    this.bindRefreshButton();
  },

  isAuthenticated() {
    return typeof Auth !== 'undefined' && Auth.isAuthenticated();
  },

  canAccessModule(module) {
    if (typeof AdminPermissions === 'undefined') return true;
    return AdminPermissions.canAccess(module);
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

  bindRefreshButton() {
    const btn = document.getElementById('admin-refresh-btn');
    if (!btn || btn.dataset.refreshBound === '1') return;
    btn.dataset.refreshBound = '1';
    btn.addEventListener('click', () => {
      if (typeof refreshAdminPanel === 'function') {
        refreshAdminPanel();
      }
    });
  },

  getRefreshLabel() {
    const parsed = this.parseHash();
    const module = this.canAccessModule(parsed.module) ? parsed.module : 'dashboard';
    const route = this.routes[module];
    const name = route?.label || 'painel';
    return `Atualizando ${name}…`;
  },

  async refreshCurrentModule() {
    if (!this.isAuthenticated()) return;
    if (typeof Auth !== 'undefined' && Auth.mustChangePassword()) return;

    const parsed = this.parseHash();
    let module = parsed.module;

    if (!this.canAccessModule(module)) {
      module = 'dashboard';
    }

    if (module === 'eventos') {
      if (typeof isTicketQrOverlayOpen === 'function' && isTicketQrOverlayOpen()) {
        if (typeof stopTicketQrScanner === 'function') {
          await stopTicketQrScanner({ reason: 'refresh' });
        }
      }
    }

    const route = this.routes[module];
    if (!route) return;

    if (module === 'dashboard') {
      await this.loadDashboardStats();
      return;
    }

    const loaderName = route.loader;
    if (loaderName && typeof window[loaderName] === 'function') {
      await window[loaderName]();
    }
  },

  parseHash() {
    const hash = window.location.hash || '#/';
    if (hash === '#/' || hash === '#') return { module: 'dashboard' };
    if (hash.startsWith('#/categorias')) return { module: 'categorias' };
    if (hash.startsWith('#/fidelidade')) return { module: 'fidelidade' };
    if (hash.startsWith('#/clientes')) return { module: 'clientes' };
    if (hash.startsWith('#/produtos')) return { module: 'produtos' };
    if (hash.startsWith('#/diario')) return { module: 'diario' };
    if (hash.startsWith('#/relatorios')) return { module: 'relatorios' };
    if (hash.startsWith('#/vendas')) return { module: 'relatorios', redirectFromVendas: true };
    if (hash.startsWith('#/usuarios')) return { module: 'usuarios' };
    if (hash.startsWith('#/emails')) return { module: 'emails' };
    if (hash.startsWith('#/distribuidores')) return { module: 'distribuidores' };
    if (hash.startsWith('#/eventos')) {
      const match = hash.match(/^#\/eventos(?:\/(\d+)(?:\/(lotes|validar|ingressos))?)?\/?$/);
      if (match) {
        const eventId = match[1] ? Number(match[1]) : null;
        const eventTab = match[2] || (eventId ? 'lotes' : null);
        return { module: 'eventos', eventId, eventTab };
      }
      return { module: 'eventos' };
    }
    return { module: 'dashboard' };
  },

  handleHash() {
    if (!this.isAuthenticated()) return;
    if (typeof Auth !== 'undefined' && Auth.mustChangePassword()) return;

    const parsed = this.parseHash();
    let { module } = parsed;

    // Compat: bookmarks antigos #/vendas → Relatórios
    if (parsed.redirectFromVendas) {
      window.location.hash = '#/relatorios';
      return;
    }

    if (!this.canAccessModule(module)) {
      window.location.hash = '#/';
      this.showModule('dashboard', true);
      return;
    }

    // Ajustar aba de evento sem permissão
    if (module === 'eventos' && parsed.eventId && typeof AdminPermissions !== 'undefined') {
      const tab = parsed.eventTab || 'lotes';
      if (!AdminPermissions.canAccessEventTab(tab)) {
        const fallback = AdminPermissions.defaultEventTab();
        const nextHash = fallback === 'lotes'
          ? `#/eventos/${parsed.eventId}`
          : `#/eventos/${parsed.eventId}/${fallback}`;
        if (window.location.hash !== nextHash) {
          window.location.hash = nextHash;
          return;
        }
      }
    }

    this.showModule(module, false);
  },

  navigate(module) {
    if (!this.canAccessModule(module)) {
      if (typeof showToast === 'function') {
        showToast('Sem permissão para este módulo', 'error');
      }
      return;
    }
    const route = this.routes[module];
    if (!route) return;
    // Sidebar "Eventos" sempre abre a lista, não o último evento
    if (window.location.hash !== route.hash) {
      window.location.hash = route.hash;
    } else {
      this.showModule(module, true);
    }
  },

  stopEventsQrIfNeeded(previousModule, module) {
    if (previousModule === 'eventos' && module !== 'eventos') {
      if (typeof releaseTicketQrCameraSync === 'function') releaseTicketQrCameraSync();
      if (typeof stopTicketQrScanner === 'function') stopTicketQrScanner({ reason: 'navigate' });
    }
  },

  showModule(module, forceReload) {
    if (!this.isAuthenticated()) return;
    if (typeof Auth !== 'undefined' && Auth.mustChangePassword()) return;

    if (!this.canAccessModule(module)) {
      module = 'dashboard';
    }

    const route = this.routes[module];
    if (!route) return;

    const previousModule = this.currentModule;
    this.stopEventsQrIfNeeded(previousModule, module);

    this.currentModule = module;

    document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('is-active'));
    document.getElementById(route.viewId)?.classList.add('is-active');

    document.querySelectorAll('[data-admin-nav]').forEach(el => {
      el.classList.toggle('is-active', el.dataset.adminNav === module);
    });

    if (typeof AdminPermissions !== 'undefined') {
      AdminPermissions.applyUi();
    }

    if (module === 'dashboard') {
      this.loadDashboardStats();
      return;
    }

    const loaderName = route.loader;
    if (loaderName && typeof window[loaderName] === 'function') {
      const alwaysReload = module === 'relatorios' || module === 'diario' || module === 'fidelidade' || module === 'clientes' || module === 'eventos' || module === 'usuarios' || module === 'emails';
      if (forceReload || alwaysReload || !this.loadedModules.has(module)) {
        window[loaderName]();
        this.loadedModules.add(module);
      }
    }
  },

  async loadDashboardStats() {
    const catEl = document.getElementById('stat-categories');
    const loyEl = document.getElementById('stat-loyalty');
    const clientsEl = document.getElementById('stat-clients');
    const prodEl = document.getElementById('stat-products');
    const diarioEl = document.getElementById('stat-diario');
    const relatoriosEl = document.getElementById('stat-relatorios');
    const eventsEl = document.getElementById('stat-events');
    const emailsEl = document.getElementById('stat-email-campaigns');
    const distEl = document.getElementById('stat-distributors');
    const dashItems = document.getElementById('dashboard-stat-items');
    const dashAccesses = document.getElementById('dashboard-stat-accesses');
    const dashRevenue = document.getElementById('dashboard-stat-revenue');
    const dashTop = document.getElementById('dashboard-stat-top');
    const dashMonthItems = document.getElementById('dashboard-stat-month-items');
    const dashMonthAccesses = document.getElementById('dashboard-stat-month-accesses');
    const dashMonthAccessAvg = document.getElementById('dashboard-stat-month-access-avg');
    const dashMonthRevenue = document.getElementById('dashboard-stat-month-revenue');
    const dashSummary = document.getElementById('dashboard-daily-summary');

    const canCat = this.canAccessModule('categorias');
    const canLoy = this.canAccessModule('fidelidade');
    const canClients = this.canAccessModule('clientes');
    const canProd = this.canAccessModule('produtos');
    const canSales = this.canAccessModule('diario') || this.canAccessModule('relatorios');
    const canEvents = this.canAccessModule('eventos');
    const canEmails = this.canAccessModule('emails');
    const canDist = this.canAccessModule('distribuidores');

    if (catEl && canCat) catEl.textContent = 'Carregando…';
    if (loyEl && canLoy) loyEl.textContent = 'Carregando…';
    if (clientsEl && canClients) clientsEl.textContent = 'Carregando…';
    if (prodEl && canProd) prodEl.textContent = 'Carregando…';
    if (diarioEl && canSales) diarioEl.textContent = 'Carregando…';
    if (relatoriosEl && canSales) relatoriosEl.textContent = 'Carregando…';
    if (eventsEl && canEvents) eventsEl.textContent = 'Carregando…';
    if (emailsEl && canEmails) emailsEl.textContent = 'Carregando…';
    if (distEl && canDist) distEl.textContent = 'Carregando…';

    const formatBRL = (value) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

    try {
      const [categories, products, loyaltyData, salesToday, events, emailCampaigns, distributors] = await Promise.all([
        canCat ? DB.getCategories().catch(() => []) : Promise.resolve([]),
        canProd ? DB.getProducts().catch(() => []) : Promise.resolve([]),
        (canLoy || canClients) ? DB.getLoyaltyCustomers({ page: 1, limit: 1 }).catch(() => ({ total: 0, items: [] })) : Promise.resolve({ total: 0, items: [] }),
        canSales ? DB.getTodaySalesSummary().catch(() => null) : Promise.resolve(null),
        canEvents ? DB.getEvents({ all: true }).catch(() => []) : Promise.resolve([]),
        canEmails ? DB.getEmailCampaigns({ limit: 50 }).catch(() => []) : Promise.resolve([]),
        canDist ? DB.getDistributors({ all: true }).catch(() => []) : Promise.resolve([])
      ]);

      if (canCat && catEl) {
        const activeCats = (categories || []).filter(c => c.active !== false).length;
        catEl.textContent = `${activeCats} categoria${activeCats !== 1 ? 's' : ''} ativa${activeCats !== 1 ? 's' : ''}`;
      }
      if (canProd && prodEl) {
        prodEl.textContent = `${(products || []).length} produto${(products || []).length !== 1 ? 's' : ''}`;
      }
      if (canLoy && loyEl) {
        const totalCustomers = loyaltyData.total ?? (loyaltyData.items || []).length;
        loyEl.textContent = `${totalCustomers} cliente${totalCustomers !== 1 ? 's' : ''}`;
      }
      if (canClients && clientsEl) {
        const totalCustomers = loyaltyData.total ?? (loyaltyData.items || []).length;
        clientsEl.textContent = `${totalCustomers} cliente${totalCustomers !== 1 ? 's' : ''}`;
      }

      if (canSales) {
        const totalItems = salesToday?.total_items ?? 0;
        const totalAccesses = salesToday?.total_accesses ?? 0;
        const totalRevenue = salesToday?.total_revenue ?? 0;
        const topProduct = salesToday?.top_product;
        const monthItems = salesToday?.month_items ?? 0;
        const monthAccesses = salesToday?.month_accesses ?? 0;
        const monthAccessAvg = salesToday?.month_access_avg ?? 0;
        const monthRevenue = salesToday?.month_revenue ?? 0;

        const todayLine = totalItems > 0
          ? `${totalItems} venda${totalItems !== 1 ? 's' : ''} · ${totalAccesses} acesso${totalAccesses !== 1 ? 's' : ''} · ${formatBRL(totalRevenue)} hoje`
          : 'Nenhuma venda hoje';

        if (diarioEl) diarioEl.textContent = todayLine;
        if (relatoriosEl) {
          relatoriosEl.textContent = monthItems > 0
            ? `${monthItems} venda${monthItems !== 1 ? 's' : ''} · ${formatBRL(monthRevenue)} no mês`
            : todayLine;
        }

        if (dashSummary) dashSummary.classList.remove('hidden');
        if (dashItems) dashItems.textContent = String(totalItems);
        if (dashAccesses) dashAccesses.textContent = String(totalAccesses);
        if (dashRevenue) dashRevenue.textContent = formatBRL(totalRevenue);
        if (dashTop) dashTop.textContent = topProduct || '—';
        if (dashMonthItems) dashMonthItems.textContent = String(monthItems);
        if (dashMonthAccesses) dashMonthAccesses.textContent = String(monthAccesses);
        if (dashMonthAccessAvg) {
          dashMonthAccessAvg.textContent = Number(monthAccessAvg).toLocaleString('pt-BR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1
          });
        }
        if (dashMonthRevenue) dashMonthRevenue.textContent = formatBRL(monthRevenue);
      } else if (dashSummary) {
        dashSummary.classList.add('hidden');
      }

      if (canEvents && eventsEl) {
        const activeEvents = (events || []).filter(e => e.active !== false).length;
        eventsEl.textContent = `${activeEvents} evento${activeEvents !== 1 ? 's' : ''} ativo${activeEvents !== 1 ? 's' : ''}`;
      }

      if (canEmails && emailsEl) {
        const total = (emailCampaigns || []).length;
        emailsEl.textContent = `${total} campanha${total !== 1 ? 's' : ''}`;
      }

      if (canDist && distEl) {
        const activeDist = (distributors || []).filter(d => d.active !== false).length;
        distEl.textContent = `${activeDist} distribuidor${activeDist !== 1 ? 'es' : ''} ativo${activeDist !== 1 ? 's' : ''}`;
      }
    } catch (error) {
      if (handleAuthError(error)) return;
      if (catEl) catEl.textContent = '—';
      if (loyEl) loyEl.textContent = '—';
      if (clientsEl) clientsEl.textContent = '—';
      if (prodEl) prodEl.textContent = '—';
      if (diarioEl) diarioEl.textContent = '—';
      if (relatoriosEl) relatoriosEl.textContent = '—';
      if (eventsEl) eventsEl.textContent = '—';
      if (emailsEl) emailsEl.textContent = '—';
      if (distEl) distEl.textContent = '—';
      if (dashItems) dashItems.textContent = '—';
      if (dashAccesses) dashAccesses.textContent = '—';
      if (dashRevenue) dashRevenue.textContent = '—';
      if (dashTop) dashTop.textContent = '—';
      if (dashMonthItems) dashMonthItems.textContent = '—';
      if (dashMonthAccesses) dashMonthAccesses.textContent = '—';
      if (dashMonthRevenue) dashMonthRevenue.textContent = '—';
    }
  },

  reset() {
    this.loadedModules.clear();
    this.currentModule = 'dashboard';
  }
};

function initAdminAfterLogin() {
  if (typeof Auth !== 'undefined' && Auth.currentUser && typeof AdminPermissions !== 'undefined') {
    AdminPermissions.init(Auth.currentUser);
  }

  AdminRouter.reset();
  const parsed = AdminRouter.parseHash();
  if (window.location.hash && parsed.module !== 'dashboard' && AdminRouter.canAccessModule(parsed.module)) {
    AdminRouter.handleHash();
  } else {
    window.location.hash = '#/';
    AdminRouter.showModule('dashboard', true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  AdminRouter.init();
});
