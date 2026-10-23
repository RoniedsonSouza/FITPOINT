// Busca cadastros de clientes possivelmente repetidos (ficha lida por imagem).
// Critérios: mesmo telefone, mesmo Instagram ou nome parecido (tolerante a acentos e erros de digitação).
const { normalizeMatchText, scoreTexts } = require('./listMatch');

const NAME_SIMILAR_THRESHOLD = 0.72;
const MAX_RESULTS = 8;

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function tokenSimilarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 0;
}

/**
 * Similaridade 0–1 entre dois nomes. Compara palavra a palavra (ignora "da", "de"…),
 * aceitando pequenos erros ("Mariana Slva" ~ "Mariana Silva") e nomes parciais ("Maria" ~ "Maria Souza").
 */
function nameSimilarity(a, b) {
  const base = scoreTexts(a, b);
  const stop = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  const ta = normalizeMatchText(a).split(' ').filter((t) => t && !stop.has(t));
  const tb = normalizeMatchText(b).split(' ').filter((t) => t && !stop.has(t));
  if (!ta.length || !tb.length) return base;
  // O primeiro nome precisa ser parecido; senão "Maria Silva" ~ "João Silva" passaria
  if (tokenSimilarity(ta[0], tb[0]) < 0.75) return Math.min(base, 0.5);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((u, i) => {
      if (used.has(i)) return;
      const s = tokenSimilarity(t, u);
      if (s > best) { best = s; bestIdx = i; }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  const coverage = short.length / long.length; // nome parcial pesa um pouco menos
  const fuzzy = (total / short.length) * (0.85 + 0.15 * coverage);
  return Math.max(base, Math.round(fuzzy * 100) / 100);
}

/**
 * @param {{ name?: string, phone?: string, instagram?: string }} client - dados lidos da ficha
 * @param {Array<{ id, name, phone, instagram, active }>} customers
 * @param {{ excludeId?: number }} [opts]
 */
function findSimilarCustomers(client, customers, { excludeId } = {}) {
  const phone = String(client?.phone || '').replace(/\D/g, '');
  const insta = String(client?.instagram || '').toLowerCase().replace(/^@+/, '');
  const name = String(client?.name || '').trim();
  const out = [];
  for (const c of Array.isArray(customers) ? customers : []) {
    if (excludeId != null && Number(c.id) === Number(excludeId)) continue;
    const reasons = [];
    const cPhone = String(c.phone || '').replace(/\D/g, '');
    if (phone.length >= 10 && cPhone && cPhone === phone) reasons.push('phone');
    const cInsta = String(c.instagram || '').toLowerCase().replace(/^@+/, '');
    if (insta && cInsta && cInsta === insta) reasons.push('instagram');
    const score = name && c.name ? nameSimilarity(name, c.name) : 0;
    if (score >= NAME_SIMILAR_THRESHOLD) reasons.push('name');
    if (!reasons.length) continue;
    out.push({
      id: c.id,
      name: c.name,
      phone: c.phone,
      instagram: c.instagram || null,
      active: c.active !== false,
      reasons,
      score
    });
  }
  const rank = (r) => (r.reasons.includes('phone') ? 2 : 0) + (r.reasons.includes('instagram') ? 1 : 0);
  out.sort((a, b) => rank(b) - rank(a) || b.score - a.score || String(a.name).localeCompare(String(b.name), 'pt-BR'));
  return out.slice(0, MAX_RESULTS);
}

module.exports = { findSimilarCustomers, nameSimilarity, NAME_SIMILAR_THRESHOLD };
