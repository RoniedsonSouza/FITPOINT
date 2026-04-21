// Utils
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const currency = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const FALLBACK_IMAGE = '/assets/default-card.png';
let lucideReady;
function loadLucide(){
  if (window.lucide) return Promise.resolve();
  if (!lucideReady) {
    lucideReady = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/lucide@latest';
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }
  return lucideReady;
}

async function loadJSON(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Falha ao carregar ${path}`);
    return res.json();
}

// Função auxiliar para carregar produtos (API REST ou JSON)
async function loadProductsData() {
    // Tenta usar API REST primeiro
    if (typeof DB !== 'undefined') {
        try {
            return await DB.getProducts();
        } catch (e) {
            console.warn('Erro ao carregar produtos da API, usando JSON', e);
        }
    }
    // Fallback para JSON
    return await loadJSON('/data/products.json');
}

/** Preço promocional preenchido e menor que o preço normal → em promoção */
function productHasPromo(p) {
  const v = p.promo_price;
  if (v == null || v === '') return false;
  const promo = Number(v);
  const base = Number(p.price);
  if (Number.isNaN(promo) || Number.isNaN(base)) return false;
  return promo >= 0 && promo < base;
}

function unitPriceForProduct(p) {
  return productHasPromo(p) ? Number(p.promo_price) : Number(p.price);
}

function productIsKit(p) {
  return p.is_kit === true || p.is_kit === 1 || p.is_kit === 'true';
}

const BADGE_ICONS = {
  promo:
    '<svg class="product-badge__icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8.5 1.2c.3 1.1.1 2.1-.4 3-.3-.6-.8-1.1-1.3-1.4.9 1.6.7 3.5-.7 4.8-.2-.7-.6-1.3-1.1-1.8-.1 1.8-1.1 3.1-3 3.9 1.7-2 1.4-4 .9-5.3 1.2 1 2.3 2.5 2.7 4.4.6-1.5.5-3.1-.1-4.5.8.9 1.5 2.1 1.8 3.5.4-1.8 0-3.6-1.1-5.1 1.4 1.1 2.5 2.8 2.8 4.7.3-1.9-.2-3.8-1.3-5.4z"/></svg>',
  kit:
    '<svg class="product-badge__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 2.5 4.5V12l5.5 2.5L13.5 12V4.5L8 1.5z"/><path d="M2.5 4.5 8 7l5.5-2.5M8 7v6.5"/></svg>'
};

/** Selos no canto superior direito da imagem (promo + kit) */
function productImageBadgesHtml(p) {
  const promo = productHasPromo(p);
  const kit = productIsKit(p);
  if (!promo && !kit) return '';
  const promoSpan = promo
    ? `<span class="product-badge product-badge--promo" aria-label="Promoção">${BADGE_ICONS.promo}<span class="product-badge__label">Promoção</span></span>`
    : '';
  const kitSpan = kit
    ? `<span class="product-badge product-badge--kit" aria-label="Kit">${BADGE_ICONS.kit}<span class="product-badge__label">Kit</span></span>`
    : '';
  return `<div class="product-image-badges"><div class="product-badges-rail" role="group" aria-label="Destaques">${promoSpan}${kitSpan}</div></div>`;
}
function initMobileMenu(){
  const toggle = document.getElementById('mobile-menu-toggle');
  const drawer = document.getElementById('mobile-menu');
  if (!toggle || !drawer) return;
  const panel = drawer.querySelector('[data-menu-panel]');
  const overlay = drawer.querySelector('[data-menu-overlay]');
  const closers = drawer.querySelectorAll('[data-menu-close]');
  let isOpen = false;
  let lastFocused = null;
  let closeTimeoutId = null;

  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  };

  const openMenu = () => {
    if (isOpen) return;
    if (closeTimeoutId) {
      clearTimeout(closeTimeoutId);
      closeTimeoutId = null;
    }
    isOpen = true;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawer.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    toggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      if (panel) panel.classList.remove('translate-x-full');
      if (overlay) {
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');
      }
    });
    const firstFocusable = panel ? panel.querySelector('a,button') : null;
    if (firstFocusable instanceof HTMLElement) {
      setTimeout(() => firstFocusable.focus(), 150);
    }
    document.addEventListener('keydown', handleKeydown);
  };

  const finalizeClose = () => {
    drawer.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    if (lastFocused instanceof HTMLElement && document.contains(lastFocused)) {
      lastFocused.focus({ preventScroll: true });
    } else {
      toggle.focus({ preventScroll: true });
    }
    lastFocused = null;
    closeTimeoutId = null;
  };

  const closeMenu = () => {
    if (!isOpen) return;
    isOpen = false;
    toggle.setAttribute('aria-expanded', 'false');
    if (panel) panel.classList.add('translate-x-full');
    if (overlay) {
      overlay.classList.remove('opacity-100');
      overlay.classList.add('opacity-0');
    }
    document.removeEventListener('keydown', handleKeydown);

    if (panel) {
      const fallback = setTimeout(() => {
        finalizeClose();
      }, 220);
      closeTimeoutId = fallback;
      const onTransitionEnd = (event) => {
        if (event.propertyName !== 'transform') return;
        clearTimeout(fallback);
        panel.removeEventListener('transitionend', onTransitionEnd);
        finalizeClose();
      };
      panel.addEventListener('transitionend', onTransitionEnd, { once: true });
    } else {
      finalizeClose();
    }
  };
  toggle.addEventListener('click', () => (isOpen ? closeMenu() : openMenu()));
  closers.forEach(el => el.addEventListener('click', closeMenu));
}

function highlightActiveNav(){
  const page = document.body.dataset.page;
  if (!page) return;
  $$('[data-nav]').forEach(link => {
    const isActive = link.dataset.nav === page;
    link.classList.toggle('text-fp-green', isActive);
    link.classList.toggle('font-semibold', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function stripAccents(s) {
  return String(s).normalize('NFD').replace(/\p{M}+/gu, '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function categoryChipMeta(category) {
  const n = stripAccents(String(category || '').trim().toLowerCase());
  if (n.includes('bebida')) return { icon: 'cup-soda', mod: 'bebida' };
  if (n.includes('lanche')) return { icon: 'sandwich', mod: 'lanche' };
  return { icon: 'layers', mod: 'default' };
}

/** Ícone Lucide + variante de cor por tipo de selo (vitaminas, fibras, baixa caloria, etc.) */
function productTagMeta(raw) {
  const n = stripAccents(String(raw).trim().toLowerCase());
  if (n.includes('vitamina')) return { icon: 'pill', mod: 'vitamins' };
  if (n.includes('baixa') && (n.includes('calor') || n.includes('kcal'))) return { icon: 'feather', mod: 'lowcal' };
  if (n.includes('fibra')) return { icon: 'wheat', mod: 'fiber' };
  if (n.includes('proteic')) return { icon: 'beef', mod: 'protein' };
  if (n.includes('detox')) return { icon: 'droplets', mod: 'detox' };
  if (n.includes('energia') || n.includes('energet')) return { icon: 'zap', mod: 'energy' };
  if (n.includes('vendido') || n.includes('popular') || n.includes('destaque')) return { icon: 'trending-up', mod: 'bestseller' };
  return { icon: 'tag', mod: 'default' };
}

function renderProductCard(p){
  const image = (p.image && p.image.trim()) ? p.image : FALLBACK_IMAGE;
  const cat = categoryChipMeta(p.category);
  const onPromo = productHasPromo(p);
  const badges = productImageBadgesHtml(p);
  const priceBlock = onPromo
    ? `<span class="flex flex-col items-end leading-tight"><span class="text-sm text-black/45 line-through font-normal">${currency(Number(p.price))}</span><span style="color:var(--fp-green)" class="font-bold">${currency(Number(p.promo_price))}</span></span>`
    : `<span style="color:var(--fp-green)" class="font-bold">${currency(Number(p.price))}</span>`;
  const tags = (p.tags || []).map(t => {
    const { icon, mod } = productTagMeta(t);
    return `<span class="chip chip-tag chip-tag--${mod}"><i data-lucide="${icon}"></i>${escapeHtml(t)}</span>`;
  }).join('');
  return `
    <article class="card">
      <div class="relative">
        ${badges}
        <img src="${image}" alt="${escapeHtml(p.name)}" class="w-full aspect-[4/3] object-cover" onerror="this.src='${FALLBACK_IMAGE}';this.onerror=null;">
      </div>
      <div class="p-4">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold flex items-center gap-2">
            <i data-lucide="${p.category==='Bebida' ? 'cup-soda' : 'sandwich'}"></i>${escapeHtml(p.name)}
          </h3>
          ${priceBlock}
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <span class="chip chip-tag chip-cat--${cat.mod}"><i data-lucide="${cat.icon}"></i>${escapeHtml(p.category)}</span>
          ${tags}
        </div>
      </div>
    </article>
  `;
}

function renderMenuProductCard(p){
  const image = (p.image && p.image.trim()) ? p.image : FALLBACK_IMAGE;
  const cat = categoryChipMeta(p.category);
  const tags = (p.tags || []).map(t => {
    const { icon, mod } = productTagMeta(t);
    return `<span class="chip chip-tag chip-tag--${mod}"><i data-lucide="${icon}"></i>${escapeHtml(t)}</span>`;
  }).join('');
  const idAttr = String(p.id).replace(/"/g, '&quot;');
  const onPromo = productHasPromo(p);
  const badges = productImageBadgesHtml(p);
  const priceBlock = onPromo
    ? `<span class="flex flex-col items-end leading-tight shrink-0">
         <span class="text-[0.65rem] sm:text-xs text-black/45 line-through font-normal tabular-nums">${currency(Number(p.price))}</span>
         <span style="color:var(--fp-green)" class="font-bold text-xs sm:text-sm tabular-nums">${currency(Number(p.promo_price))}</span>
       </span>`
    : `<span style="color:var(--fp-green)" class="font-bold shrink-0 text-xs sm:text-sm tabular-nums">${currency(Number(p.price))}</span>`;
  return `
    <article class="card h-full">
      <div class="relative">
        ${badges}
        <img src="${image}" alt="${escapeHtml(p.name)}" class="w-full aspect-[4/3] object-cover" onerror="this.src='${FALLBACK_IMAGE}';this.onerror=null;">
      </div>
      <div class="p-2.5 sm:p-4 flex flex-col flex-1 min-h-0">
        <div class="flex items-start justify-between gap-1 sm:gap-2">
          <h3 class="text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-1.5 min-w-0 leading-snug">
            <i class="shrink-0 w-3.5 h-3.5 sm:w-4 sm:h-4" data-lucide="${p.category==='Bebida' ? 'cup-soda' : 'sandwich'}"></i><span class="truncate">${escapeHtml(p.name)}</span>
          </h3>
          ${priceBlock}
        </div>
        <div class="mt-1.5 sm:mt-2 flex flex-wrap gap-1 sm:gap-2">
          <span class="chip chip-tag chip-cat--${cat.mod}"><i data-lucide="${cat.icon}"></i>${escapeHtml(p.category)}</span>
          ${tags}
        </div>
        <button type="button" class="btn mt-2 pt-2.5 w-full justify-center text-xs sm:text-sm py-2 sm:py-2.5 leading-tight" data-add-to-cart data-product-id="${idAttr}">
          <span class="sm:hidden">Adicionar</span><span class="hidden sm:inline">Adicionar ao carrinho</span>
        </button>
      </div>
    </article>
  `;
}


function refreshIcons() {
  loadLucide().then(() => {
    try { window.lucide && window.lucide.createIcons(); } catch (e) { }
  });
}

// Chame após cada render:
async function initHome() {
    const box = document.getElementById('home-best');
    if (!box) return;
    const data = await loadProductsData();
    const best = data.filter(p => p.active !== false).slice(0, 4).map(p => p.name).join(' · ');
    box.textContent = best || 'Em breve novidades';
    refreshIcons();
}

async function initMenu() {
    if (document.body.dataset.page !== 'menu') return;
    const grid = document.querySelector('#menu-grid');
    const sel = document.querySelector('#filter-category');
    const search = document.querySelector('#search');

    const data = (await loadProductsData()).filter(p => p.active !== false);
    if (typeof window.FitPointCart !== 'undefined' && window.FitPointCart.setCatalog) {
        window.FitPointCart.setCatalog(data);
    }

    const categories = [...new Set(data.map(p => p.category))];
    categories.forEach(c => {
        sel.insertAdjacentHTML('beforeend', `<option value="${c}">${c}</option>`);
    });

    function apply() {
        const q = (search.value || '').toLowerCase();
        const c = sel.value;
        const list = data.filter(p => {
            const okC = !c || p.category === c;
            const okQ = !q || (p.name + p.category + (p.tags || []).join(' ')).toLowerCase().includes(q);
            return okC && okQ;
        });
        grid.innerHTML = list.map(renderMenuProductCard).join('') || '<p class="col-span-full text-center py-8 text-black/50 text-sm">Nenhum item encontrado.</p>';
        refreshIcons();
    }
    sel.addEventListener('change', apply);
    search.addEventListener('input', apply);
    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-add-to-cart]');
        if (!btn || !grid.contains(btn)) return;
        const id = btn.getAttribute('data-product-id');
        if (id != null && window.FitPointCart && window.FitPointCart.addById) {
            window.FitPointCart.addById(id);
        }
    });
    apply();
}

async function initPromos() {
    if (document.body.dataset.page !== 'promos') return;
    const grid = document.querySelector('#promos-grid');
    if (!grid) return;
    const data = (await loadProductsData()).filter(p => p.active !== false);
    if (typeof window.FitPointCart !== 'undefined' && window.FitPointCart.setCatalog) {
        window.FitPointCart.setCatalog(data);
    }
    const promos = data.filter(productHasPromo);
    grid.innerHTML = promos.length
      ? promos.map(renderMenuProductCard).join('')
      : '<p class="col-span-full text-center py-12 text-black/55 text-sm">Nenhuma promoção no momento. Confira o <a href="/cardapio.html" class="text-fp-green font-medium underline">cardápio completo</a>.</p>';
    if (!grid.dataset.cartBound) {
        grid.dataset.cartBound = '1';
        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-add-to-cart]');
            if (!btn || !grid.contains(btn)) return;
            const id = btn.getAttribute('data-product-id');
            if (id != null && window.FitPointCart && window.FitPointCart.addById) {
                window.FitPointCart.addById(id);
            }
        });
    }
    refreshIcons();
}

initMobileMenu(); highlightActiveNav(); initHome(); initMenu(); initPromos(); refreshIcons();

