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

  function syncCatalogPrices() {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var p = catalogById.get(String(line.id));
      if (p) line.price = unitPriceFromProduct(p);
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

  function addById(id) {
    var p = catalogById.get(String(id));
    if (!p) return;
    var price = unitPriceFromProduct(p);
    var sid = String(p.id);
    var existing = null;
    for (var i = 0; i < lines.length; i++) {
      if (String(lines[i].id) === sid) { existing = lines[i]; break; }
    }
    if (existing) existing.qty += 1;
    else lines.push({ id: String(p.id), name: p.name, price: price, qty: 1 });
    writeStorage();
    render();
  }

  function setQty(id, qty) {
    var n = Math.max(0, parseInt(String(qty), 10) || 0);
    var sid = String(id);
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (String(lines[i].id) === sid) { idx = i; break; }
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
    var meta = getCartFormValues();
    if (!meta.paymentVal) {
      window.alert('Selecione a forma de pagamento antes de enviar o pedido.');
      return;
    }
    if (meta.fulfillmentVal === 'entrega' && !meta.notes) {
      window.alert('Para entrega, preencha o endereço completo em "Endereço e observações".');
      return;
    }
    var text = buildMessage();
    var url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener,noreferrer');
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
    if (fab) fab.setAttribute('aria-expanded', open ? 'true' : 'false');
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
        return (
          '<div class="flex flex-wrap items-start gap-2 py-3 border-b border-black/5 last:border-0">' +
            '<div class="min-w-0 flex-1 basis-[40%]">' +
              '<p class="font-medium text-sm">' + escapeHtml(l.name) + '</p>' +
              '<p class="text-xs text-black/50">' + currency(l.price) + ' un.</p>' +
            '</div>' +
            '<div class="flex items-center gap-1 shrink-0">' +
              '<button type="button" class="cart-qty-minus h-9 w-9 rounded-lg border border-black/10 bg-white text-fp-ink font-semibold leading-none" data-cart-id="' + escapeAttr(l.id) + '" aria-label="Diminuir quantidade">−</button>' +
              '<span class="w-8 text-center text-sm font-semibold">' + l.qty + '</span>' +
              '<button type="button" class="cart-qty-plus h-9 w-9 rounded-lg border border-black/10 bg-white text-fp-ink font-semibold leading-none" data-cart-id="' + escapeAttr(l.id) + '" aria-label="Aumentar quantidade">+</button>' +
            '</div>' +
            '<p class="text-sm font-semibold text-fp-green shrink-0 ml-auto">' + currency(l.price * l.qty) + '</p>' +
          '</div>'
        );
      }).join('');
    }

    var totalEl = document.getElementById('cart-total-value');
    if (totalEl) totalEl.textContent = currency(totalMoney());

    var waBtn = document.getElementById('cart-whatsapp');
    if (waBtn) waBtn.disabled = lines.length === 0;
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && drawerOpen) {
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
    if (waBtn) waBtn.addEventListener('click', function () { openWhatsApp(); });

    if (linesEl) {
      linesEl.addEventListener('click', function (e) {
        var t = e.target;
        if (!(t instanceof HTMLElement)) return;
        var minus = t.closest('.cart-qty-minus');
        var plus = t.closest('.cart-qty-plus');
        var id = (minus && minus.getAttribute('data-cart-id')) || (plus && plus.getAttribute('data-cart-id'));
        if (!id) return;
        var line = null;
        for (var i = 0; i < lines.length; i++) {
          if (String(lines[i].id) === String(id)) { line = lines[i]; break; }
        }
        if (!line) return;
        if (minus) setQty(line.id, line.qty - 1);
        if (plus) setQty(line.id, line.qty + 1);
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
