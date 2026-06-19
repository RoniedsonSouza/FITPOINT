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
    if (typeof DB !== 'undefined') {
        try {
            return await DB.getProducts();
        } catch (e) {
            console.warn('Erro ao carregar produtos da API, usando JSON', e);
        }
    }
    return await loadJSON('/data/products.json');
}

async function loadCategoriesData() {
    if (typeof DB !== 'undefined') {
        try {
            return (await DB.getCategories()).filter(c => c.active !== false);
        } catch (e) {
            console.warn('Erro ao carregar categorias da API', e);
        }
    }
    return [
        { id: 1, name: 'Bebida', slug: 'bebida', sort_order: 0, active: true },
        { id: 2, name: 'Lanche', slug: 'lanche', sort_order: 1, active: true }
    ];
}

function categorySlug(name) {
    return stripAccents(String(name || '').trim().toLowerCase())
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'categoria';
}

function productDetailUrl(id) {
    return '/produto.html?id=' + encodeURIComponent(String(id));
}

function getProductOptions(p) {
    return Array.isArray(p.options) ? p.options : [];
}

function getDefaultProductOption(p) {
    const opts = getProductOptions(p);
    if (!opts.length) return null;
    return opts.find(o => o.default) || opts[0];
}

function minPriceWithOptions(p) {
    const opts = getProductOptions(p);
    const base = unitPriceForProduct(p);
    if (!opts.length) return base;
    return Math.min(...opts.map(o => base + (Number(o.price_adjustment) || 0)));
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
        <img src="${image}" alt="${escapeHtml(p.name)}" class="w-full aspect-[4/3] object-contain bg-black/[0.04]" onerror="this.src='${FALLBACK_IMAGE}';this.onerror=null;">
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

function productOptionsSummaryHtml(p) {
  const opts = getProductOptions(p);
  if (!opts.length) return '';
  const names = opts.map(o => escapeHtml(o.name)).join(' · ');
  return `<p class="text-[0.65rem] sm:text-xs text-black/55 leading-snug">${names}</p>`;
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
  const opts = getProductOptions(p);
  const defaultOpt = getDefaultProductOption(p);
  const defaultOptId = defaultOpt ? String(defaultOpt.id).replace(/"/g, '&quot;') : '';
  const detailUrl = productDetailUrl(p.id);
  const hasOpts = opts.length > 0;
  const displayBase = hasOpts ? minPriceWithOptions(p) : unitPriceForProduct(p);
  const priceBlock = onPromo && !hasOpts
    ? `<span class="flex flex-col items-end leading-tight shrink-0">
         <span class="text-[0.65rem] sm:text-xs text-black/45 line-through font-normal tabular-nums">${currency(Number(p.price))}</span>
         <span style="color:var(--fp-green)" class="font-bold text-xs sm:text-sm tabular-nums">${currency(Number(p.promo_price))}</span>
       </span>`
    : hasOpts
    ? `<span style="color:var(--fp-green)" class="font-bold shrink-0 text-xs sm:text-sm tabular-nums leading-tight text-right">
         <span class="block text-[0.6rem] sm:text-[0.65rem] text-black/45 font-normal">A partir de</span>
         ${currency(displayBase)}
       </span>`
    : `<span style="color:var(--fp-green)" class="font-bold shrink-0 text-xs sm:text-sm tabular-nums">${currency(Number(p.price))}</span>`;
  return `
    <article class="card h-full">
      <a href="${detailUrl}" class="block relative group">
        ${badges}
        <img src="${image}" alt="${escapeHtml(p.name)}" class="w-full aspect-[4/3] object-contain bg-black/[0.04]" onerror="this.src='${FALLBACK_IMAGE}';this.onerror=null;">
      </a>
      <div class="p-2.5 sm:p-4 flex flex-col flex-1 min-h-0">
        <div class="flex items-start justify-between gap-1 sm:gap-2">
          <h3 class="text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-1.5 min-w-0 leading-snug">
            <i class="shrink-0 w-3.5 h-3.5 sm:w-4 sm:h-4" data-lucide="${cat.icon}"></i>
            <a href="${detailUrl}" class="truncate hover:text-fp-green transition-colors">${escapeHtml(p.name)}</a>
          </h3>
          ${priceBlock}
        </div>
        ${productOptionsSummaryHtml(p)}
        <div class="my-2 sm:mt-2 flex flex-wrap gap-1 sm:gap-2">
          <span class="chip chip-tag chip-cat--${cat.mod}"><i data-lucide="${cat.icon}"></i>${escapeHtml(p.category)}</span>
          ${tags}
        </div>
        <button type="button" class="btn mt-auto pt-2.5 w-full justify-center text-xs sm:text-sm py-2 sm:py-2.5 leading-tight" data-add-to-cart data-product-id="${idAttr}"${defaultOptId ? ` data-option-id="${defaultOptId}"` : ''}>
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

function bindCartAddClick(container) {
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-add-to-cart]');
        if (!btn || !container.contains(btn)) return;
        e.preventDefault();
        const id = btn.getAttribute('data-product-id');
        const optionId = btn.getAttribute('data-option-id');
        if (id == null || !window.FitPointCart || !window.FitPointCart.addById) return;
        window.FitPointCart.addById(id, optionId || undefined);
    });
}

function renderMenuSections(products, categories) {
    const catOrder = categories.length
        ? [...categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
        : [...new Set(products.map(p => p.category))].map((name, i) => ({ name, sort_order: i }));

    const byCat = new Map();
    products.forEach(p => {
        const key = p.category || 'Outros';
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key).push(p);
    });

    const seen = new Set();
    let html = '';

    catOrder.forEach(cat => {
        const name = cat.name;
        if (!byCat.has(name)) return;
        seen.add(name);
        const slug = categorySlug(name);
        html += `
          <section id="cat-${slug}" class="menu-category-section scroll-mt-24">
            <h2 class="font-display text-lg sm:text-xl font-bold mb-3 sm:mb-4 flex items-center gap-2">
              <i data-lucide="${categoryChipMeta(name).icon}" class="w-5 h-5 text-fp-green"></i>
              ${escapeHtml(name)}
            </h2>
            <div class="grid grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4 lg:gap-6 items-stretch">
              ${byCat.get(name).map(renderMenuProductCard).join('')}
            </div>
          </section>`;
    });

    byCat.forEach((list, name) => {
        if (seen.has(name)) return;
        const slug = categorySlug(name);
        html += `
          <section id="cat-${slug}" class="menu-category-section scroll-mt-24">
            <h2 class="font-display text-lg sm:text-xl font-bold mb-3 sm:mb-4">${escapeHtml(name)}</h2>
            <div class="grid grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4 lg:gap-6 items-stretch">
              ${list.map(renderMenuProductCard).join('')}
            </div>
          </section>`;
    });

    return html || '<p class="text-center py-8 text-black/50 text-sm">Nenhum item encontrado.</p>';
}

function renderCategoryNav(categories, products) {
    const catOrder = categories.length
        ? [...categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
        : [...new Set(products.map(p => p.category))].map(name => ({ name }));

    const withProducts = catOrder.filter(c => products.some(p => p.category === c.name));
    if (withProducts.length <= 1) return '';

    return `<div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin" id="menu-category-nav" role="navigation" aria-label="Categorias">
      ${withProducts.map(c => {
        const slug = categorySlug(c.name);
        return `<a href="#cat-${slug}" class="menu-cat-chip shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border border-black/10 bg-white hover:bg-fp-fog hover:border-fp-green/30 transition-colors">${escapeHtml(c.name)}</a>`;
      }).join('')}
    </div>`;
}

async function initMenu() {
    if (document.body.dataset.page !== 'menu') return;
    const sectionsEl = document.querySelector('#menu-sections');
    const navSlot = document.querySelector('#menu-category-nav-slot');
    const sel = document.querySelector('#filter-category');
    const search = document.querySelector('#search');
    if (!sectionsEl) return;

    const [data, categories] = await Promise.all([
        loadProductsData(),
        loadCategoriesData()
    ]);
    const active = data.filter(p => p.active !== false);

    if (typeof window.FitPointCart !== 'undefined' && window.FitPointCart.setCatalog) {
        window.FitPointCart.setCatalog(active);
    }

    if (sel) {
        sel.innerHTML = '<option value="">Todas categorias</option>';
        const catNames = categories.length
            ? categories.map(c => c.name)
            : [...new Set(active.map(p => p.category))];
        catNames.forEach(c => {
            sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
        });
    }

    function apply() {
        const q = (search?.value || '').toLowerCase();
        const c = sel?.value || '';
        const list = active.filter(p => {
            const okC = !c || p.category === c;
            const okQ = !q || (p.name + p.category + (p.tags || []).join(' ') + getProductOptions(p).map(o => o.name).join(' ')).toLowerCase().includes(q);
            return okC && okQ;
        });
        if (navSlot) {
            navSlot.innerHTML = c ? '' : renderCategoryNav(categories, list);
        }
        sectionsEl.innerHTML = renderMenuSections(list, categories);
        refreshIcons();
    }

    if (sel) sel.addEventListener('change', apply);
    if (search) search.addEventListener('input', apply);
    if (!sectionsEl.dataset.cartBound) {
        sectionsEl.dataset.cartBound = '1';
        bindCartAddClick(sectionsEl);
    }
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
        bindCartAddClick(grid);
    }
    refreshIcons();
}

function nutritionTableHtml(nutrition) {
    const n = nutrition || {};
    const rows = [
        ['Calorias', n.kcal != null ? n.kcal + ' kcal' : null],
        ['Proteínas', n.protein_g != null ? n.protein_g + ' g' : null],
        ['Carboidratos', n.carbs_g != null ? n.carbs_g + ' g' : null],
        ['Gorduras', n.fat_g != null ? n.fat_g + ' g' : null],
        ['Fibras', n.fiber_g != null ? n.fiber_g + ' g' : null]
    ].filter(([, v]) => v != null);
    if (!rows.length) return '';
    return `
      <div class="mt-6">
        <h3 class="font-display font-bold text-base mb-3">Informações nutricionais</h3>
        <dl class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          ${rows.map(([label, val]) => `
            <div class="rounded-xl bg-fp-fog/80 px-3 py-2.5 border border-black/5">
              <dt class="text-xs text-black/55">${escapeHtml(label)}</dt>
              <dd class="font-semibold text-sm mt-0.5">${escapeHtml(String(val))}</dd>
            </div>
          `).join('')}
        </dl>
      </div>`;
}

async function initProductDetail() {
    if (document.body.dataset.page !== 'product') return;
    const container = document.getElementById('product-detail');
    if (!container) return;

    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
        container.innerHTML = '<p class="text-center py-12 text-black/50">Produto não encontrado.</p>';
        return;
    }

    let product = null;
    if (typeof DB !== 'undefined') {
        product = await DB.getProduct(id);
    }
    if (!product) {
        const all = await loadProductsData();
        product = all.find(p => String(p.id) === String(id));
    }
    if (!product || product.active === false) {
        container.innerHTML = `<p class="text-center py-12 text-black/50">Produto não encontrado ou indisponível. <a href="/cardapio.html" class="text-fp-green underline">Ver cardápio</a></p>`;
        return;
    }

    if (typeof window.FitPointCart !== 'undefined' && window.FitPointCart.setCatalog) {
        const catalog = await loadProductsData();
        window.FitPointCart.setCatalog(catalog.filter(p => p.active !== false));
    }

    const image = (product.image && product.image.trim()) ? product.image : FALLBACK_IMAGE;
    const cat = categoryChipMeta(product.category);
    const opts = getProductOptions(product);
    let selectedOptId = opts.length ? '' : null;

    function currentOption() {
        if (!selectedOptId) return null;
        return opts.find(o => String(o.id) === String(selectedOptId)) || null;
    }

    function currentPrice() {
        const base = unitPriceForProduct(product);
        const opt = currentOption();
        return base + (opt ? (Number(opt.price_adjustment) || 0) : 0);
    }

    function renderDetail() {
        const onPromo = productHasPromo(product);
        const price = currentPrice();
        const opt = currentOption();
        const tags = (product.tags || []).map(t => {
            const { icon, mod } = productTagMeta(t);
            return `<span class="chip chip-tag chip-tag--${mod}"><i data-lucide="${icon}"></i>${escapeHtml(t)}</span>`;
        }).join('');

        const optionsHtml = opts.length ? `
          <div class="mt-5">
            <h3 class="font-display font-bold text-base mb-2">Opções</h3>
            <div class="space-y-2" id="product-options-radios">
              <label class="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${!selectedOptId ? 'border-fp-green bg-fp-green/5' : 'border-black/10 hover:border-black/20'}">
                <input type="radio" name="product-option" value="" ${!selectedOptId ? 'checked' : ''} class="shrink-0">
                <span class="flex-1 font-medium text-sm">Nenhum</span>
                <span class="text-sm font-semibold text-fp-green">Incluso</span>
              </label>
              ${opts.map(o => `
                <label class="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${String(o.id) === String(selectedOptId) ? 'border-fp-green bg-fp-green/5' : 'border-black/10 hover:border-black/20'}">
                  <input type="radio" name="product-option" value="${escapeHtml(String(o.id))}" ${String(o.id) === String(selectedOptId) ? 'checked' : ''} class="shrink-0">
                  <span class="flex-1 font-medium text-sm">${escapeHtml(o.name)}</span>
                  <span class="text-sm font-semibold text-fp-green">${o.price_adjustment > 0 ? '+' + currency(Number(o.price_adjustment)) : 'Incluso'}</span>
                </label>
              `).join('')}
            </div>
          </div>` : '';

        const priceHtml = onPromo && !opts.length
            ? `<span class="text-black/45 line-through text-lg">${currency(Number(product.price))}</span>
               <span class="text-2xl font-bold text-fp-green">${currency(Number(product.promo_price))}</span>`
            : `<span class="text-2xl font-bold text-fp-green">${currency(price)}</span>`;

        container.innerHTML = `
          <div class="grid md:grid-cols-2 gap-6 md:gap-10">
            <div class="relative rounded-2xl overflow-hidden bg-black/[0.04] border border-black/5">
              ${productImageBadgesHtml(product)}
              <img src="${image}" alt="${escapeHtml(product.name)}" class="w-full max-h-80 md:max-h-96 object-contain mx-auto" onerror="this.src='${FALLBACK_IMAGE}';this.onerror=null;">
            </div>
            <div>
              <a href="/cardapio.html" class="text-sm text-black/50 hover:text-fp-green inline-flex items-center gap-1 mb-3">
                <i data-lucide="arrow-left" class="w-4 h-4"></i> Voltar ao cardápio
              </a>
              <span class="chip chip-tag chip-cat--${cat.mod}"><i data-lucide="${cat.icon}"></i>${escapeHtml(product.category)}</span>
              <h1 class="font-display text-2xl sm:text-3xl font-bold mt-2">${escapeHtml(product.name)}</h1>
              <div class="flex items-baseline gap-2 mt-3">${priceHtml}</div>
              ${product.description ? `<p class="mt-4 text-black/75 leading-relaxed text-sm sm:text-base whitespace-pre-line">${escapeHtml(product.description)}</p>` : ''}
              <div class="mt-3 flex flex-wrap gap-2">${tags}</div>
              ${optionsHtml}
              ${nutritionTableHtml(product.nutrition)}
              <button type="button" id="product-add-cart" class="btn w-full justify-center mt-6 py-3 text-base">
                Adicionar ao carrinho
              </button>
            </div>
          </div>`;

        const radios = container.querySelectorAll('input[name="product-option"]');
        radios.forEach(r => {
            r.addEventListener('change', () => {
                selectedOptId = r.value;
                renderDetail();
            });
        });

        const addBtn = document.getElementById('product-add-cart');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (window.FitPointCart && window.FitPointCart.addById) {
                    window.FitPointCart.addById(
                        product.id,
                        opts.length ? (selectedOptId || null) : undefined
                    );
                }
            });
        }

        refreshIcons();
    }

    renderDetail();
}

function loyaltyPublicAvatarHtml(item, sizeClass = '') {
    const cls = sizeClass || 'loyalty-avatar';
    const initial = escapeHtml((item.display_name || '?').charAt(0).toUpperCase());
    if (item.avatar) {
        return `<img src="${escapeHtml(item.avatar)}" alt="" class="${cls}" loading="lazy">`;
    }
    return `<span class="${cls} loyalty-avatar--initial">${initial}</span>`;
}

function loyaltyParticipantMeta(item, n) {
    if (item.cycle_complete) {
        return `${n}/${n} visitas · Prêmio conquistado!`;
    }
    if ((item.total_visits || 0) === 0) {
        return `0/${n} visitas · Faltam ${n}`;
    }
    return `${item.progress}/${n} visitas · Faltam ${item.visits_to_reward}`;
}

function renderLoyaltyParticipantsList(items, n) {
    if (!items.length) {
        return '<p class="loyalty-empty">Nenhum participante cadastrado ainda. Visite a FitPoint e seja o primeiro!</p>';
    }
    return items.map((item, i) => {
        const pos = i + 1;
        const pct = Math.round((item.progress / n) * 100);
        const topClass = pos <= 3 ? ' loyalty-rank-pos--top' : '';
        const completeClass = item.cycle_complete ? ' loyalty-rank-item--complete' : '';
        const barClass = item.cycle_complete ? 'loyalty-progress-bar--complete' : '';
        return `
          <div class="loyalty-rank-item${completeClass}">
            ${loyaltyPublicAvatarHtml(item, 'loyalty-avatar loyalty-avatar--lg')}
            <span class="loyalty-rank-pos${topClass}">${pos}</span>
            <div class="loyalty-rank-body">
              <p class="loyalty-rank-name">${escapeHtml(item.display_name)}</p>
              <p class="loyalty-rank-meta">${escapeHtml(loyaltyParticipantMeta(item, n))}</p>
              <div class="loyalty-progress" role="progressbar" aria-valuenow="${item.progress}" aria-valuemin="0" aria-valuemax="${n}">
                <div class="loyalty-progress-bar ${barClass}" style="width: ${pct}%"></div>
              </div>
            </div>
          </div>`;
    }).join('');
}

function renderLoyaltyWinnersList(items, n) {
    if (!items.length) {
        return `<p class="loyalty-empty">Ainda não há ganhadores. Complete ${n} visitas e apareça aqui!</p>`;
    }
    return items.map((item, i) => {
        const pos = i + 1;
        const podiumClass = pos === 1 ? ' loyalty-winner-card--gold' : pos === 2 ? ' loyalty-winner-card--silver' : pos === 3 ? ' loyalty-winner-card--bronze' : '';
        const medal = pos <= 3 ? `<span class="loyalty-winner-medal">${pos}º</span>` : '';
        const label = item.total_rewards === 1 ? '1 prêmio' : `${item.total_rewards} prêmios`;
        return `
          <div class="loyalty-winner-card${podiumClass}">
            ${medal}
            ${loyaltyPublicAvatarHtml(item, 'loyalty-avatar loyalty-avatar--winner')}
            <div class="loyalty-winner-body">
              <p class="loyalty-rank-name">${escapeHtml(item.display_name)}</p>
              <p class="loyalty-rank-meta">${item.total_visits} visitas no total</p>
            </div>
            <span class="loyalty-winner-badge"><i data-lucide="gift" class="w-3.5 h-3.5"></i> ${escapeHtml(label)}</span>
          </div>`;
    }).join('');
}

async function initLoyalty() {
    if (document.body.dataset.page !== 'loyalty') return;
    const inProgressEl = document.getElementById('loyalty-in-progress');
    const winnersEl = document.getElementById('loyalty-winners');
    const ruleEl = document.getElementById('loyalty-hero-rule');
    const statParticipants = document.getElementById('loyalty-stat-participants');
    const statWinners = document.getElementById('loyalty-stat-winners');
    if (!inProgressEl || !winnersEl) return;

    try {
        let data = { in_progress: [], winners: [], visits_per_reward: 10 };
        if (typeof DB !== 'undefined') {
            data = await DB.getLoyaltyRankings();
        }
        const n = data.visits_per_reward || 10;
        if (ruleEl) {
            ruleEl.innerHTML = `A cada <strong>${n} visitas</strong> com consumo mínimo, ganhe um <strong>Shake</strong> ou <strong>Hype Drink</strong>!`;
        }
        const participants = data.in_progress || [];
        const winners = data.winners || [];
        if (statParticipants) statParticipants.textContent = String(participants.length);
        if (statWinners) statWinners.textContent = String(winners.length);
        inProgressEl.innerHTML = renderLoyaltyParticipantsList(participants, n);
        winnersEl.innerHTML = renderLoyaltyWinnersList(winners, n);
    } catch (e) {
        console.error(e);
        inProgressEl.innerHTML = '<p class="loyalty-empty">Não foi possível carregar o ranking.</p>';
        winnersEl.innerHTML = '<p class="loyalty-empty">Não foi possível carregar os ganhadores.</p>';
    }
    refreshIcons();
}

initMobileMenu(); highlightActiveNav(); initHome(); initMenu(); initPromos(); initProductDetail(); initLoyalty(); refreshIcons();

