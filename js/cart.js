(function () {
  'use strict';

  const STORAGE_KEY = 'fitpoint_cart';

  const currency = function (v) {
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  let catalogById = new Map();
  var lines = [];

  function readStorage() {
    try {
      var t = localStorage.getItem(STORAGE_KEY);
      var arr = t ? JSON.parse(t) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }

  function unitPriceFromProduct(p) {
    var base = Number(p.price);
    var pp = p.promo_price;
    if (pp != null && pp !== '' && !isNaN(Number(pp))) {
      var promo = Number(pp);
      if (!isNaN(promo) && promo >= 0 && promo < base) return promo;
    }
    return base;
  }

  function lineKey(line) {
    return String(line.id) + '::' + String(line.option_id || '');
  }

  function findOption(p, optionId) {
    var opts = p.options || [];
    if (!optionId) return null;
    for (var i = 0; i < opts.length; i++) {
      if (String(opts[i].id) === String(optionId)) return opts[i];
    }
    return null;
  }

  function getDefaultOption(p) {
    var opts = p.options || [];
    if (!opts.length) return null;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].default) return opts[i];
    }
    return opts[0];
  }

  function linePriceFromProduct(p, option) {
    var base = unitPriceFromProduct(p);
    if (!option) return base;
    return base + (Number(option.price_adjustment) || 0);
  }

  function lineDisplayName(p, option) {
    if (!option) return p.name;
    return p.name + ' (' + option.name + ')';
  }

  function syncCatalogPrices() {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var p = catalogById.get(String(line.id));
      if (p) {
        var opt = line.option_id ? findOption(p, line.option_id) : null;
        line.price = linePriceFromProduct(p, opt);
        line.name = lineDisplayName(p, opt);
        if (opt) {
          line.option_name = opt.name;
          line.option_adjustment = Number(opt.price_adjustment) || 0;
        }
      }
    }
  }

  function setCatalog(products) {
    catalogById = new Map((products || []).map(function (p) { return [String(p.id), p]; }));
    lines = readStorage();
    syncCatalogPrices();
    lines = lines.filter(function (l) { return catalogById.has(String(l.id)); });
    writeStorage();
    render();
  }

  function addById(id, optionId) {
    var p = catalogById.get(String(id));
    if (!p) return;
    var opts = p.options || [];
    var option = null;
    if (opts.length) {
      if (optionId === null || optionId === '') {
        option = null;
        optionId = '';
      } else if (optionId === undefined) {
        option = getDefaultOption(p);
        if (!option) return;
        optionId = option.id;
      } else {
        option = findOption(p, optionId);
        if (!option) return;
        optionId = option.id;
      }
    }
    var price = linePriceFromProduct(p, option);
    var sid = String(p.id);
    var key = sid + '::' + String(optionId || '');
    var existing = null;
    for (var i = 0; i < lines.length; i++) {
      if (lineKey(lines[i]) === key) { existing = lines[i]; break; }
    }
    var displayName = lineDisplayName(p, option);
    if (existing) existing.qty += 1;
    else {
      var line = { id: sid, name: displayName, price: price, qty: 1 };
      if (option) {
        line.option_id = String(option.id);
        line.option_name = option.name;
        line.option_adjustment = Number(option.price_adjustment) || 0;
      }
      lines.push(line);
    }
    writeStorage();
    render();
    showItemAddedFeedback(displayName);
  }

  function setQty(lineKeyVal, qty) {
    var n = Math.max(0, parseInt(String(qty), 10) || 0);
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lineKey(lines[i]) === String(lineKeyVal)) { idx = i; break; }
    }
    if (idx < 0) return;
    if (n <= 0) {
      lines.splice(idx, 1);
    } else {
      lines[idx].qty = n;
    }
    writeStorage();
    render();
  }

  function resetCartForm() {
    var pay = document.getElementById('cart-payment');
    var ful = document.getElementById('cart-fulfillment');
    var notes = document.getElementById('cart-notes');
    if (pay) pay.value = '';
    if (ful) ful.value = 'retirada';
    if (notes) notes.value = '';
  }

  function clear() {
    lines = [];
    writeStorage();
    resetCartForm();
    render();
  }

  function totalItems() {
    return lines.reduce(function (s, l) { return s + l.qty; }, 0);
  }

  function totalMoney() {
    return lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showItemAddedFeedback(productName) {
    var existing = document.getElementById('fp-item-added');
    if (existing) existing.remove();

    var box = document.createElement('div');
    box.id = 'fp-item-added';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.className =
      'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[85] max-w-[min(90vw,22rem)] rounded-2xl bg-white text-fp-ink px-5 py-4 text-sm shadow-2xl border border-black/10 text-center pointer-events-none';
    box.innerHTML =
      '<p class="font-semibold text-fp-green">Adicionado ao pedido</p>' +
      '<p class="mt-1.5 text-black/75 leading-snug">' + escapeHtml(productName) + '</p>';
    document.body.appendChild(box);

    window.setTimeout(function () {
      if (box.parentNode) box.remove();
    }, 2000);
  }

  function escapeAttr(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '&quot;');
  }

  function getCartFormValues() {
    var pay = document.getElementById('cart-payment');
    var ful = document.getElementById('cart-fulfillment');
    var notesEl = document.getElementById('cart-notes');
    var paymentLabel = '';
    var paymentVal = '';
    if (pay && pay.value) {
      paymentVal = pay.value;
      var opt = pay.options[pay.selectedIndex];
      paymentLabel = opt ? String(opt.textContent || '').trim() : paymentVal;
    }
    var fulfillmentVal = 'retirada';
    var fulfillmentLabel = 'Retirada na loja';
    if (ful && ful.value) {
      fulfillmentVal = ful.value;
      var o2 = ful.options[ful.selectedIndex];
      fulfillmentLabel = o2 ? String(o2.textContent || '').trim() : fulfillmentVal;
    }
    var notes = notesEl ? String(notesEl.value || '').trim() : '';
    return {
      paymentVal: paymentVal,
      paymentLabel: paymentLabel,
      fulfillmentVal: fulfillmentVal,
      fulfillmentLabel: fulfillmentLabel,
      notes: notes
    };
  }

  function buildMessage() {
    var meta = getCartFormValues();
    var out = '*Pedido FitPoint*\n\n';
    lines.forEach(function (l) {
      var sub = l.price * l.qty;
      out += '• ' + l.qty + 'x ' + l.name + ' — ' + currency(sub) + '\n';
    });
    out += '\n*Total:* ' + currency(totalMoney());
    out += '\n\n*Pagamento:* ' + (meta.paymentLabel || '—');
    out += '\n*Recebimento:* ' + meta.fulfillmentLabel;
    if (meta.notes) {
      out += '\n\n*Endereço e observações:*\n' + meta.notes;
    }
    return out;
  }

  function openWhatsApp() {
    var cfg = window.FitPointConfig || {};
    var num = cfg.WHATSAPP_E164 || '';
    if (!num || lines.length === 0) return;
    if (isWhatsAppUnavailable()) return;
    if (!validateCartForSend()) return;
    var text = buildMessage();
    var url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function isWhatsAppUnavailable() {
    return false;
  }

  function restoreWhatsAppButton(btn) {
    if (!btn) return;
    var flag = btn.nextElementSibling;
    if (flag && flag.getAttribute && flag.getAttribute('data-fp-wa-unavail-flag') === '1') {
      flag.remove();
    }
    delete btn.dataset.unavailableDecorated;
    btn.classList.remove('cursor-not-allowed');
  }

  function decorateWhatsAppUnavailable(btn) {
    if (!btn) return;
    btn.disabled = true;
    btn.classList.add('cursor-not-allowed');
    btn.classList.remove('opacity-75');
    if (btn.dataset.unavailableDecorated === '1') return;
    btn.dataset.unavailableDecorated = '1';

    var flag = document.createElement('span');
    flag.setAttribute('data-fp-wa-unavail-flag', '1');
    flag.className = 'pointer-events-none absolute -top-2 right-1 inline-flex items-center rounded-full border border-fp-orange/45 bg-fp-orange text-white px-2.5 py-1 text-[0.62rem] font-extrabold uppercase tracking-[0.08em] shadow-md';
    flag.textContent = 'temporariamente indisponivel';

    var wrap = btn.parentNode;
    if (wrap) {
      wrap.classList.add('relative');
      wrap.insertBefore(flag, btn.nextSibling);
    }
  }

  /** Mesmas regras do WhatsApp / Instagram antes de enviar */
  function validateCartForSend() {
    if (lines.length === 0) return false;
    var meta = getCartFormValues();
    if (!meta.paymentVal) {
      window.alert('Selecione a forma de pagamento antes de enviar o pedido.');
      return false;
    }
    if (meta.fulfillmentVal === 'entrega' && !meta.notes) {
      window.alert('Para entrega, preencha o endereço completo em "Endereço e observações".');
      return false;
    }
    return true;
  }

  var igModalOpen = false;
  var igModalLastFocus = null;
  var sendModalOpen = false;
  var sendModalLastFocus = null;

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
    if (document.getElementById('fp-ig-branch-modal')) return;

    var root = document.createElement('div');
    root.id = 'fp-ig-branch-modal';
    root.className = 'fixed inset-0 z-[70] hidden flex items-end md:items-center justify-center p-3 md:p-4';
    root.setAttribute('aria-hidden', 'true');

    var backdrop = document.createElement('div');
    backdrop.className = 'absolute inset-0 bg-black/50';
    backdrop.setAttribute('aria-hidden', 'true');

    var panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'fp-ig-branch-title');
    panel.className = 'relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-black/10 p-5 sm:p-6 max-h-[min(90dvh,520px)] overflow-y-auto';

    var title = document.createElement('h3');
    title.id = 'fp-ig-branch-title';
    title.className = 'font-display font-bold text-lg text-fp-ink';
    title.textContent = 'Qual loja no Instagram?';

    var hint = document.createElement('p');
    hint.className = 'text-sm text-black/65 mt-2 leading-snug';
    hint.textContent = 'Escolha a filial para abrir o chat da loja. O texto do pedido será copiado para você colar na conversa (o Instagram não preenche a mensagem automaticamente).';

    var listEl = document.createElement('div');
    listEl.className = 'mt-5 flex flex-col gap-2';

    getInstagramBranches().forEach(function (b) {
      var h = String(b.handle || '').replace(/^@/, '');
      if (!h) return;
      var city = escapeHtml(String(b.city || b.place || 'Loja'));
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full text-left rounded-xl border border-black/12 bg-white hover:bg-fp-fog/80 px-4 py-3.5 transition-colors focus:outline-none focus:ring-2 focus:ring-fp-green/30 focus:border-fp-green';
      btn.setAttribute('data-ig-handle', h);
      btn.innerHTML =
        '<span class="block font-semibold text-fp-ink">' + city + '</span>' +
        '<span class="block text-sm text-black/55 mt-0.5">@' + escapeHtml(h) + '</span>';
      listEl.appendChild(btn);
    });

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'mt-4 w-full text-sm font-medium text-black/50 hover:text-fp-green py-2';
    cancel.setAttribute('data-ig-dismiss', '1');
    cancel.textContent = 'Cancelar';

    panel.appendChild(title);
    panel.appendChild(hint);
    panel.appendChild(listEl);
    panel.appendChild(cancel);
    root.appendChild(backdrop);
    root.appendChild(panel);
    document.body.appendChild(root);

    function close() {
      closeInstagramModal();
    }

    backdrop.addEventListener('click', close);
    cancel.addEventListener('click', close);
    listEl.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof HTMLElement)) return;
      var row = t.closest('[data-ig-handle]');
      if (!row || !listEl.contains(row)) return;
      var handle = row.getAttribute('data-ig-handle');
      if (handle) openInstagramChat(handle);
    });
  }

  function openInstagramModal() {
    ensureInstagramModal();
    var root = document.getElementById('fp-ig-branch-modal');
    if (!root) return;
    igModalLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    igModalOpen = true;
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    var first = root.querySelector('[data-ig-handle]');
    if (first instanceof HTMLElement) {
      setTimeout(function () { first.focus(); }, 50);
    }
  }

  function closeInstagramModal() {
    var root = document.getElementById('fp-ig-branch-modal');
    if (root) {
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
    }
    igModalOpen = false;
    if (igModalLastFocus && document.contains(igModalLastFocus)) {
      igModalLastFocus.focus({ preventScroll: true });
    }
    igModalLastFocus = null;
  }

  function ensureSendChannelModal() {
    if (document.getElementById('fp-send-channel-modal')) return;

    var root = document.createElement('div');
    root.id = 'fp-send-channel-modal';
    root.className = 'fixed inset-0 z-[72] hidden flex items-end md:items-center justify-center p-3 md:p-4';
    root.setAttribute('aria-hidden', 'true');

    var backdrop = document.createElement('div');
    backdrop.className = 'absolute inset-0 bg-black/50';
    backdrop.setAttribute('aria-hidden', 'true');

    var panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'fp-send-channel-title');
    panel.className = 'relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-black/10 p-5 sm:p-6 max-h-[min(90dvh,560px)] overflow-y-auto';

    var title = document.createElement('h3');
    title.id = 'fp-send-channel-title';
    title.className = 'font-display font-bold text-lg text-fp-ink';
    title.textContent = 'Para onde enviar o pedido?';

    var hint = document.createElement('p');
    hint.className = 'text-sm text-black/65 mt-2 leading-snug';
    hint.textContent = 'Escolha o canal. Vamos aplicar o envio com a mesma lógica atual para WhatsApp ou Instagram.';

    var actions = document.createElement('div');
    actions.className = 'mt-5 flex flex-col gap-2';

    var waBtn = document.createElement('button');
    waBtn.type = 'button';
    waBtn.className = 'w-full rounded-xl border border-black/12 bg-white hover:bg-fp-fog/80 px-4 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-fp-green/30 focus:border-fp-green';
    waBtn.setAttribute('data-send-channel', 'whatsapp');
    waBtn.innerHTML =
      '<span class="block font-semibold text-fp-ink">WhatsApp</span>' +
      '<span class="block text-sm text-black/55 mt-0.5">Abrir conversa com a mensagem do pedido preenchida.</span>';

    var igBtn = document.createElement('button');
    igBtn.type = 'button';
    igBtn.className = 'w-full rounded-xl border border-black/12 bg-white hover:bg-fp-fog/80 px-4 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-fp-green/30 focus:border-fp-green';
    igBtn.setAttribute('data-send-channel', 'instagram');
    igBtn.innerHTML =
      '<span class="block font-semibold text-fp-ink">Instagram</span>' +
      '<span class="block text-sm text-black/55 mt-0.5">Escolher filial e abrir o chat no Instagram.</span>';

    var igInfo = document.createElement('p');
    igInfo.className = 'mt-4 text-xs sm:text-sm text-black/70 leading-snug rounded-lg border border-fp-orange/35 bg-fp-orange/8 px-3 py-2.5';
    igInfo.innerHTML =
      '<strong class="text-fp-ink">Atenção:</strong> no Instagram, o texto do pedido formatado será copiado para a <strong class="text-fp-ink">área de transferência</strong>. Com o chat aberto, basta <strong class="text-fp-ink">colar</strong> a mensagem para enviar.';

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'mt-4 w-full text-sm font-medium text-black/50 hover:text-fp-green py-2';
    cancel.setAttribute('data-send-dismiss', '1');
    cancel.textContent = 'Cancelar';

    actions.appendChild(waBtn);
    actions.appendChild(igBtn);
    panel.appendChild(title);
    panel.appendChild(hint);
    panel.appendChild(actions);
    panel.appendChild(igInfo);
    panel.appendChild(cancel);
    root.appendChild(backdrop);
    root.appendChild(panel);
    document.body.appendChild(root);

    function close() {
      closeSendChannelModal();
    }

    backdrop.addEventListener('click', close);
    cancel.addEventListener('click', close);
    actions.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof HTMLElement)) return;
      var row = t.closest('[data-send-channel]');
      if (!row || !actions.contains(row)) return;
      var channel = row.getAttribute('data-send-channel');
      closeSendChannelModal();
      if (channel === 'whatsapp') openWhatsApp();
      if (channel === 'instagram') openInstagramPicker();
    });
  }

  function openSendChannelModal() {
    if (lines.length === 0) return;
    ensureSendChannelModal();
    var root = document.getElementById('fp-send-channel-modal');
    if (!root) return;

    var waBtn = root.querySelector('[data-send-channel="whatsapp"]');
    if (waBtn instanceof HTMLButtonElement) {
      var waUnavailable = isWhatsAppUnavailable();
      waBtn.disabled = waUnavailable;
      waBtn.classList.toggle('opacity-50', waUnavailable);
      waBtn.classList.toggle('cursor-not-allowed', waUnavailable);
    }

    sendModalLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sendModalOpen = true;
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    var first = root.querySelector('[data-send-channel="whatsapp"], [data-send-channel="instagram"]');
    if (first instanceof HTMLElement) {
      setTimeout(function () { first.focus(); }, 50);
    }
  }

  function closeSendChannelModal() {
    var root = document.getElementById('fp-send-channel-modal');
    if (root) {
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
    }
    sendModalOpen = false;
    if (sendModalLastFocus && document.contains(sendModalLastFocus)) {
      sendModalLastFocus.focus({ preventScroll: true });
    }
    sendModalLastFocus = null;
  }

  function showToast(message) {
    var existing = document.getElementById('fp-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'fp-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.className = 'fixed left-1/2 -translate-x-1/2 bottom-5 z-[80] rounded-xl bg-fp-ink text-white px-4 py-3 text-sm font-medium shadow-2xl';
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(function () {
      if (toast.parentNode) toast.remove();
    }, 2600);
  }

  function openInstagramChat(handle) {
    var text = buildMessage();
    var url = 'https://ig.me/m/' + encodeURIComponent(handle);
    closeInstagramModal();

    function go() {
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () {
        showToast('Pedido copiado para a área de transferência.');
        go();
      }).catch(go);
    } else {
      go();
    }
  }

  function openInstagramPicker() {
    if (!validateCartForSend()) return;
    openInstagramModal();
  }

  var drawerOpen = false;

  function setDrawer(open) {
    drawerOpen = open;
    var panel = document.getElementById('cart-panel');
    var backdrop = document.getElementById('cart-backdrop');
    var fab = document.getElementById('cart-fab');
    if (panel) {
      panel.classList.toggle('hidden', !open);
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    if (backdrop) {
      backdrop.classList.toggle('hidden', !open);
      backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    if (fab) {
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      fab.classList.toggle('max-md:hidden', open);
    }
    document.body.classList.toggle('overflow-hidden', open);
  }

  function toggleDrawer() {
    setDrawer(!drawerOpen);
  }

  function openDrawer() {
    setDrawer(true);
  }

  function closeDrawer() {
    setDrawer(false);
  }

  function render() {
    var fabBadge = document.getElementById('cart-fab-count');
    if (fabBadge) {
      var n = totalItems();
      fabBadge.textContent = n > 99 ? '99+' : String(n);
      fabBadge.classList.toggle('hidden', n === 0);
    }

    var linesEl = document.getElementById('cart-lines');
    if (!linesEl) return;

    if (lines.length === 0) {
      linesEl.innerHTML = '<p class="text-sm text-black/60 text-center py-6">Seu pedido está vazio.</p>';
    } else {
      linesEl.innerHTML = lines.map(function (l) {
        var lk = lineKey(l);
        return (
          '<div class="flex flex-wrap items-center gap-2 py-3 border-b border-black/5 last:border-0">' +
            '<div class="min-w-0 flex-1 basis-[40%]">' +
              '<p class="font-medium text-sm">' + escapeHtml(l.name) + '</p>' +
              '<p class="text-xs text-black/50">' + currency(l.price) + ' un.</p>' +
            '</div>' +
            '<div class="flex items-center gap-1 shrink-0">' +
              '<button type="button" class="cart-qty-minus h-9 w-9 rounded-lg border border-black/10 bg-white text-fp-ink font-semibold leading-none" data-cart-key="' + escapeAttr(lk) + '" aria-label="Diminuir quantidade">−</button>' +
              '<span class="w-8 text-center text-sm font-semibold">' + l.qty + '</span>' +
              '<button type="button" class="cart-qty-plus h-9 w-9 rounded-lg border border-black/10 bg-white text-fp-ink font-semibold leading-none" data-cart-key="' + escapeAttr(lk) + '" aria-label="Aumentar quantidade">+</button>' +
            '</div>' +
            '<p class="text-sm font-semibold text-fp-green shrink-0 ml-auto">' + currency(l.price * l.qty) + '</p>' +
          '</div>'
        );
      }).join('');
    }

    var totalEl = document.getElementById('cart-total-value');
    if (totalEl) totalEl.textContent = currency(totalMoney());

    var waBtn = document.getElementById('cart-whatsapp');
    var disabled = lines.length === 0;
    if (waBtn) {
      waBtn.disabled = disabled;
    }
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    if (sendModalOpen) {
      e.preventDefault();
      closeSendChannelModal();
      return;
    }
    if (igModalOpen) {
      e.preventDefault();
      closeInstagramModal();
      return;
    }
    if (drawerOpen) {
      e.preventDefault();
      closeDrawer();
    }
  }

  function bind() {
    var fab = document.getElementById('cart-fab');
    var backdrop = document.getElementById('cart-backdrop');
    var closeBtn = document.getElementById('cart-close');
    var clearBtn = document.getElementById('cart-clear');
    var waBtn = document.getElementById('cart-whatsapp');
    var linesEl = document.getElementById('cart-lines');

    if (!linesEl) return;

    if (fab) fab.addEventListener('click', function () { toggleDrawer(); });
    if (backdrop) backdrop.addEventListener('click', function () { closeDrawer(); });
    if (closeBtn) closeBtn.addEventListener('click', function () { closeDrawer(); });
    if (clearBtn) clearBtn.addEventListener('click', function () { clear(); });
    if (waBtn) {
      waBtn.textContent = 'Enviar pedido';
      waBtn.addEventListener('click', function () { openSendChannelModal(); });
    }

    if (linesEl) {
      linesEl.addEventListener('click', function (e) {
        var t = e.target;
        if (!(t instanceof HTMLElement)) return;
        var minus = t.closest('.cart-qty-minus');
        var plus = t.closest('.cart-qty-plus');
        var key = (minus && minus.getAttribute('data-cart-key')) || (plus && plus.getAttribute('data-cart-key'));
        if (!key) return;
        var line = null;
        for (var i = 0; i < lines.length; i++) {
          if (lineKey(lines[i]) === String(key)) { line = lines[i]; break; }
        }
        if (!line) return;
        if (minus) setQty(key, line.qty - 1);
        if (plus) setQty(key, line.qty + 1);
      });
    }

    document.addEventListener('keydown', onKeydown);
  }

  function init() {
    lines = readStorage();
    if (!document.getElementById('cart-lines')) return;
    bind();
    render();
  }

  window.FitPointCart = {
    setCatalog: setCatalog,
    addById: addById,
    setQty: setQty,
    clear: clear,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    toggleDrawer: toggleDrawer,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
