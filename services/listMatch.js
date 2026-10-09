const MATCH_THRESHOLD = 0.85;
const AMBIGUOUS_THRESHOLD = 0.5;
const UNIQUE_GAP = 0.1;
const MAX_CANDIDATES = 5;

function normalizeMatchText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const n = normalizeMatchText(text);
  if (!n) return [];
  return n.split(' ').filter(Boolean);
}

function scoreTexts(query, candidate) {
  const q = normalizeMatchText(query);
  const c = normalizeMatchText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  const qTokens = tokenize(q);
  const cTokens = tokenize(c);
  const cTokenSet = new Set(cTokens);
  if (qTokens.length > 0 && qTokens.every((t) => cTokenSet.has(t))) {
    return qTokens.length === cTokens.length ? 1 : 0.92;
  }
  if (c.includes(q) || q.includes(c)) {
    const shorter = Math.min(q.length, c.length);
    const longer = Math.max(q.length, c.length);
    return 0.75 + 0.2 * (shorter / longer);
  }
  if (qTokens.length === 0 || cTokenSet.size === 0) return 0;
  let overlap = 0;
  for (const t of qTokens) {
    if (cTokenSet.has(t)) overlap += 1;
  }
  const union = new Set([...qTokens, ...cTokens]).size;
  return union > 0 ? overlap / union : 0;
}

function rankCandidates(query, items, getLabel) {
  const q = String(query || '').trim();
  if (!q) return [];
  return items
    .map((item) => ({
      item,
      score: scoreTexts(q, getLabel(item))
    }))
    .filter((row) => row.score >= AMBIGUOUS_THRESHOLD)
    .sort((a, b) => b.score - a.score || getLabel(a.item).localeCompare(getLabel(b.item), 'pt-BR'));
}

function resolveMatch(query, items, getLabel) {
  const q = String(query || '').trim();
  if (!q) {
    return {
      status: 'empty',
      best: null,
      candidates: []
    };
  }
  const ranked = rankCandidates(q, items, getLabel);
  const candidates = ranked.slice(0, MAX_CANDIDATES).map((row) => ({
    id: row.item.id,
    name: getLabel(row.item),
    score: Math.round(row.score * 1000) / 1000
  }));
  if (ranked.length === 0) {
    return { status: 'missing', best: null, candidates: [] };
  }
  const best = ranked[0];
  const second = ranked[1];
  const uniqueEnough = !second || best.score - second.score >= UNIQUE_GAP;
  if (best.score >= MATCH_THRESHOLD && uniqueEnough) {
    return { status: 'matched', best: best.item, candidates };
  }
  if (best.score >= AMBIGUOUS_THRESHOLD) {
    return { status: 'ambiguous', best: null, candidates };
  }
  return { status: 'missing', best: null, candidates: [] };
}

function resolveProductUnitPrice(product, ocrValue) {
  if (ocrValue != null && Number.isFinite(Number(ocrValue)) && Number(ocrValue) >= 0) {
    return Math.round(Number(ocrValue) * 100) / 100;
  }
  if (!product) return 0;
  const promo = product.promo_price != null ? Number(product.promo_price) : null;
  if (promo != null && !Number.isNaN(promo) && promo > 0) {
    return Math.round(promo * 100) / 100;
  }
  return Math.round((Number(product.price) || 0) * 100) / 100;
}

/**
 * @param {Array<{ quantity: number, product_text: string, customer_text: string, value: number }>} lines
 * @param {{ products: Array, customers: Array }} catalog
 */
function matchListLines(lines, { products = [], customers = [] } = {}) {
  const productList = Array.isArray(products) ? products : [];
  const customerList = Array.isArray(customers) ? customers : [];

  const matchedLines = (Array.isArray(lines) ? lines : []).map((line) => {
    const productMatch = resolveMatch(line.product_text, productList, (p) => p.name || '');
    const customerMatch = resolveMatch(line.customer_text, customerList, (c) => c.name || '');
    const product = productMatch.best;
    const customer = customerMatch.best;
    const unitPrice = resolveProductUnitPrice(product, line.value);

    return {
      quantity: line.quantity,
      product_text: line.product_text || '',
      customer_text: line.customer_text || '',
      value: line.value != null ? Number(line.value) : 0,
      product_id: product ? product.id : null,
      product_name: product ? product.name : null,
      loyalty_customer_id: customer ? Number(customer.id) : null,
      customer_name: customer ? customer.name : null,
      unit_price: unitPrice,
      product_status: productMatch.status,
      customer_status: customerMatch.status,
      product_candidates: productMatch.candidates,
      customer_candidates: customerMatch.candidates
    };
  });

  return { lines: matchedLines };
}

module.exports = {
  matchListLines,
  normalizeMatchText,
  scoreTexts,
  resolveMatch,
  MATCH_THRESHOLD,
  AMBIGUOUS_THRESHOLD
};
