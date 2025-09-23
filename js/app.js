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

function renderProductCard(p){
  const image = (p.image && p.image.trim()) ? p.image : FALLBACK_IMAGE;
  const tags = (p.tags||[]).map(
    t=>`<span class="chip"><i data-lucide="tag"></i>${t}</span>`
  ).join('');
  return `
    <article class="card">
      <img src="${image}" alt="${p.name}" class="w-full aspect-[4/3] object-cover" onerror="this.src='${FALLBACK_IMAGE}';this.onerror=null;">
      <div class="p-4">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold flex items-center gap-2">
            <i data-lucide="${p.category==='Bebida' ? 'cup-soda' : 'sandwich'}"></i>${p.name}
          </h3>
          <span style="color:var(--fp-green)" class="font-bold">
            ${currency(p.price)}
          </span>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <span class="chip"><i data-lucide="layers"></i>${p.category}</span>
          ${tags}
        </div>
      </div>
    </article>
  `;
}

function renderRecipeCard(r){
  const image = (r.image && r.image.trim()) ? r.image : FALLBACK_IMAGE;
  return `
    <article class="card">
      <img src="${image}" alt="${r.title}" class="w-full aspect-[4/3] object-cover" onerror="this.src='${FALLBACK_IMAGE}';this.onerror=null;">
      <div class="p-4">
        <h3 class="font-semibold flex items-center gap-2">
          <i data-lucide="chef-hat"></i>${r.title}
        </h3>
        <p class="text-sm text-black/60 mt-1 flex items-center gap-2">
          <i data-lucide="timer"></i> ${r.time} min • <i data-lucide="users"></i> ${r.servings} ${r.servings > 1 ? 'porções' : 'porção'}
        </p>
        ${r.kcal ? `<p class="text-sm text-black/70 mt-1 flex items-center gap-2">
          <i data-lucide="flame"></i> ${r.kcal} kcal • <i data-lucide="beef"></i> ${r.protein_g||0} g proteína
        </p>` : ''}
        <details class="mt-3 text-sm">
          <summary class="cursor-pointer" style="color:var(--fp-green)">
            Passos
          </summary>
          <ol class="list-decimal pl-5 mt-2">
            ${(r.steps||[]).map(s=>`<li class="mb-1">${s}</li>`).join('')}
          </ol>
        </details>
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
    const data = await loadJSON('/data/products.json');
    const best = data.filter(p => p.active).slice(0, 4).map(p => p.name).join(' · ');
    box.textContent = best || 'Em breve novidades';
    refreshIcons();
}

async function initMenu() {
    if (document.body.dataset.page !== 'menu') return;
    const grid = document.querySelector('#menu-grid');
    const sel = document.querySelector('#filter-category');
    const search = document.querySelector('#search');

    const data = (await loadJSON('/data/products.json')).filter(p => p.active);
    [...new Set(data.map(p => p.category))].forEach(c => {
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
        grid.innerHTML = list.map(renderProductCard).join('') || '<p>Nenhum item encontrado.</p>';
        refreshIcons();
    }
    sel.addEventListener('change', apply);
    search.addEventListener('input', apply);
    apply();
}

async function initRecipes() {
    if (document.body.dataset.page !== 'recipes') return;
    const grid = document.querySelector('#recipes-grid');
    const data = await loadJSON('/data/recipes.json');
    grid.innerHTML = data.map(renderRecipeCard).join('');
    refreshIcons();
}

initHome(); initMenu(); initRecipes(); refreshIcons();







