// Controle de permissões no painel admin (cliente)

const AdminPermissions = {
  user: null,

  init(user) {
    this.user = user || null;
    this.applyUi();
  },

  clear() {
    this.user = null;
  },

  isSuperAdmin() {
    return !!(this.user && this.user.isSuperAdmin);
  },

  getPermissions() {
    if (!this.user) return null;
    if (this.isSuperAdmin()) return null;
    return this.user.permissions || {
      produtos: false,
      fidelidade: false,
      vendas: false,
      distribuidores: false,
      emails: false,
      eventos: { enabled: false, lotes: false, validar: false }
    };
  },

  canAccess(module) {
    if (!this.user) return false;
    if (this.isSuperAdmin()) return true;

    if (module === 'dashboard') return true;
    if (module === 'categorias' || module === 'usuarios') return false;
    if (module === 'diario' || module === 'relatorios') return this.canAccess('vendas');
    if (module === 'clientes') return this.canAccess('fidelidade');

    const perms = this.getPermissions();
    if (!perms) return false;

    if (module === 'produtos') return !!perms.produtos;
    if (module === 'fidelidade') return !!perms.fidelidade;
    if (module === 'vendas') return !!perms.vendas;
    if (module === 'distribuidores') return !!perms.distribuidores;
    if (module === 'emails') return !!perms.emails;
    if (module === 'eventos') return !!(perms.eventos && perms.eventos.enabled);
    return false;
  },

  canAccessEventTab(tab) {
    if (!this.canAccess('eventos')) return false;
    if (this.isSuperAdmin()) return true;
    if (tab === 'ingressos') return true;
    const ev = this.getPermissions()?.eventos || {};
    if (tab === 'lotes') return !!ev.lotes;
    if (tab === 'validar') return !!ev.validar;
    return false;
  },

  canManageEventLots() {
    return this.canAccessEventTab('lotes');
  },

  defaultEventTab() {
    if (this.canAccessEventTab('lotes')) return 'lotes';
    if (this.canAccessEventTab('validar')) return 'validar';
    return 'ingressos';
  },

  applyUi() {
    const isSuper = this.isSuperAdmin();

    document.querySelectorAll('[data-admin-nav]').forEach((el) => {
      const module = el.dataset.adminNav;
      if (module === 'usuarios') {
        el.style.display = isSuper ? '' : 'none';
        return;
      }
      if (module === 'dashboard') {
        el.style.display = '';
        return;
      }
      el.style.display = this.canAccess(module) ? '' : 'none';
    });

    document.querySelectorAll('[data-module-card]').forEach((el) => {
      const module = el.dataset.moduleCard;
      el.style.display = this.canAccess(module) ? '' : 'none';
    });

    // Resumo diário no dashboard só se tiver vendas
    const dashSummary = document.getElementById('dashboard-daily-summary');
    if (dashSummary && !this.canAccess('vendas') && !isSuper) {
      dashSummary.classList.add('hidden');
    }

    // Botões de eventos que exigem lotes
    document.querySelectorAll('[data-requires-event-lotes]').forEach((el) => {
      el.style.display = this.canManageEventLots() ? '' : 'none';
    });

    document.querySelectorAll('[data-event-tab]').forEach((btn) => {
      const tab = btn.dataset.eventTab;
      btn.style.display = this.canAccessEventTab(tab) ? '' : 'none';
    });
  }
};
