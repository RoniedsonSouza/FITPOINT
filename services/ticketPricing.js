// Cálculo de preço de pedidos de ingresso, incluindo promoção por quantidade.
// Fonte da verdade: o checkout SEMPRE recalcula aqui, nunca confia no frontend.

const PROMO_MODES = ['repeat', 'once', 'proportional'];

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function hasActivePromo(lot) {
  return Boolean(
    lot &&
    lot.promo_enabled &&
    Number(lot.promo_qty) >= 2 &&
    Number(lot.promo_price) > 0
  );
}

/**
 * Calcula o total do pedido para um lote e quantidade.
 * Modos de escala (promo "N por R$ X", unitário R$ P):
 *  - repeat:       floor(qty/N)*X + (qty%N)*P  → cada pacote completo sai a X
 *  - once:         X + (qty-N)*P               → só o primeiro pacote tem desconto
 *  - proportional: qty*(X/N)                   → a partir de N, unitário vira X/N
 *
 * @returns {{ total: number, baseTotal: number, savings: number, promoApplied: boolean }}
 */
function computeOrderTotal(lot, quantity) {
  const qty = parseInt(quantity, 10);
  const unitPrice = Number(lot.price);
  const baseTotal = round2(unitPrice * qty);

  if (!hasActivePromo(lot) || qty < Number(lot.promo_qty)) {
    return { total: baseTotal, baseTotal, savings: 0, promoApplied: false };
  }

  const promoQty = Number(lot.promo_qty);
  const promoPrice = Number(lot.promo_price);
  const mode = PROMO_MODES.includes(lot.promo_mode) ? lot.promo_mode : 'repeat';

  let total;
  if (mode === 'once') {
    total = promoPrice + (qty - promoQty) * unitPrice;
  } else if (mode === 'proportional') {
    total = (promoPrice / promoQty) * qty;
  } else {
    const packs = Math.floor(qty / promoQty);
    const rest = qty % promoQty;
    total = packs * promoPrice + rest * unitPrice;
  }

  total = round2(total);
  // Promoção nunca pode encarecer o pedido (config inválida cai no preço base)
  if (total >= baseTotal) {
    return { total: baseTotal, baseTotal, savings: 0, promoApplied: false };
  }

  return { total, baseTotal, savings: round2(baseTotal - total), promoApplied: true };
}

/**
 * Valida a configuração de promoção vinda do admin.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validatePromoConfig({ promo_enabled, promo_qty, promo_price, promo_mode }, unitPrice) {
  if (!promo_enabled) {
    return {
      ok: true,
      value: {
        promo_enabled: false,
        promo_qty: promo_qty != null && promo_qty !== '' ? parseInt(promo_qty, 10) || null : null,
        promo_price: promo_price != null && promo_price !== '' ? Number(promo_price) || null : null,
        promo_mode: PROMO_MODES.includes(promo_mode) ? promo_mode : 'repeat'
      }
    };
  }

  const qty = parseInt(promo_qty, 10);
  const price = Number(promo_price);
  const mode = promo_mode || 'repeat';

  if (!qty || qty < 2) {
    return { ok: false, error: 'Quantidade da promoção deve ser pelo menos 2' };
  }
  if (Number.isNaN(price) || price <= 0) {
    return { ok: false, error: 'Preço promocional inválido' };
  }
  if (!PROMO_MODES.includes(mode)) {
    return { ok: false, error: 'Modo de promoção inválido' };
  }
  const fullPrice = Number(unitPrice) * qty;
  if (price >= fullPrice) {
    return {
      ok: false,
      error: `Preço promocional (${price.toFixed(2)}) deve ser menor que ${qty}x o preço unitário (${fullPrice.toFixed(2)})`
    };
  }

  return {
    ok: true,
    value: { promo_enabled: true, promo_qty: qty, promo_price: price, promo_mode: mode }
  };
}

module.exports = { computeOrderTotal, validatePromoConfig, hasActivePromo, PROMO_MODES, round2 };
