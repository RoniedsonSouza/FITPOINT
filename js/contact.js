(function () {
  'use strict';

  function getInstagramBranches() {
    var cfg = window.FitPointConfig || {};
    var list = cfg.INSTAGRAM_BRANCHES;
    if (Array.isArray(list) && list.length) return list;
    return [
      { city: 'Cariacica', handle: 'fitpointitaciba' },
      { city: 'Viana', handle: 'f_itpoint' }
    ];
  }

  function ensureInstagramModal() {
    if (document.getElementById('contact-ig-modal')) return;

    var root = document.createElement('div');
    root.id = 'contact-ig-modal';
    root.className = 'fixed inset-0 z-[70] hidden flex items-end md:items-center justify-center p-3 md:p-4';
    root.setAttribute('aria-hidden', 'true');

    var backdrop = document.createElement('div');
    backdrop.className = 'absolute inset-0 bg-black/50';

    var panel = document.createElement('div');
    panel.className = 'relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-black/10 p-5 sm:p-6';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'contact-ig-modal-title');

    var title = document.createElement('h3');
    title.id = 'contact-ig-modal-title';
    title.className = 'font-display font-bold text-lg text-fp-ink';
    title.textContent = 'Qual loja no Instagram?';

    var hint = document.createElement('p');
    hint.className = 'text-sm text-black/65 mt-2';
    hint.textContent = 'Escolha a filial para abrir o chat no Instagram.';

    var list = document.createElement('div');
    list.className = 'mt-5 flex flex-col gap-2';

    getInstagramBranches().forEach(function (b) {
      var handle = String(b.handle || '').replace(/^@/, '');
      if (!handle) return;
      var city = String(b.city || 'Loja');
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'w-full text-left rounded-xl border border-black/12 bg-white hover:bg-fp-fog/80 px-4 py-3.5 transition-colors focus:outline-none focus:ring-2 focus:ring-fp-green/30 focus:border-fp-green';
      row.setAttribute('data-ig-handle', handle);
      row.innerHTML =
        '<span class="block font-semibold text-fp-ink">' + city + '</span>' +
        '<span class="block text-sm text-black/55 mt-0.5">@' + handle + '</span>';
      list.appendChild(row);
    });

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'mt-4 w-full text-sm font-medium text-black/50 hover:text-fp-green py-2';
    cancel.textContent = 'Cancelar';

    panel.appendChild(title);
    panel.appendChild(hint);
    panel.appendChild(list);
    panel.appendChild(cancel);
    root.appendChild(backdrop);
    root.appendChild(panel);
    document.body.appendChild(root);

    function close() {
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
    }

    backdrop.addEventListener('click', close);
    cancel.addEventListener('click', close);
    list.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof HTMLElement)) return;
      var row = t.closest('[data-ig-handle]');
      if (!row || !list.contains(row)) return;
      var handle = row.getAttribute('data-ig-handle');
      if (!handle) return;
      close();
      window.open('https://ig.me/m/' + encodeURIComponent(handle), '_blank', 'noopener,noreferrer');
    });
  }

  function openInstagramModal() {
    ensureInstagramModal();
    var root = document.getElementById('contact-ig-modal');
    if (!root) return;
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
  }

  function initContactActions() {
    var ig = document.getElementById('contact-instagram');
    if (ig) {
      ig.addEventListener('click', function (e) {
        e.preventDefault();
        openInstagramModal();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContactActions);
  } else {
    initContactActions();
  }
})();
