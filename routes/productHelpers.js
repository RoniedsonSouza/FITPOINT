function normalizeNutrition(nutrition) {
  if (!nutrition || typeof nutrition !== 'object') return {};
  const out = {};
  const fields = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];
  for (const f of fields) {
    if (nutrition[f] != null && nutrition[f] !== '') {
      const n = Number(nutrition[f]);
      if (!Number.isNaN(n) && n >= 0) out[f] = n;
    }
  }
  return out;
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  const normalized = options
    .filter(o => o && String(o.name || '').trim())
    .map((o, i) => ({
      id: String(o.id || `opt-${i}-${Date.now().toString(36)}`),
      name: String(o.name).trim(),
      price_adjustment: Math.max(0, Number(o.price_adjustment) || 0),
      default: o.default === true
    }));

  if (normalized.length === 0) return [];

  const defaultCount = normalized.filter(o => o.default).length;
  if (defaultCount === 0) {
    normalized[0].default = true;
  } else if (defaultCount > 1) {
    let found = false;
    for (const o of normalized) {
      if (o.default && !found) found = true;
      else o.default = false;
    }
  }

  return normalized;
}

function validateOptions(options) {
  if (!Array.isArray(options)) {
    return { ok: false, error: 'options deve ser um array' };
  }
  for (const o of options) {
    if (!o.id || !String(o.name || '').trim()) {
      return { ok: false, error: 'Cada opção precisa de id e name' };
    }
    const adj = Number(o.price_adjustment);
    if (Number.isNaN(adj) || adj < 0) {
      return { ok: false, error: 'price_adjustment deve ser >= 0' };
    }
  }
  if (options.length > 0) {
    const defaults = options.filter(o => o.default === true);
    if (defaults.length !== 1) {
      return { ok: false, error: 'Deve haver exatamente uma opção padrão' };
    }
  }
  return { ok: true };
}

function mapProductRow(row) {
  return {
    id: row.id,
    name: row.name,
    price: parseFloat(row.price),
    promo_price: row.promo_price != null ? parseFloat(row.promo_price) : null,
    is_kit: row.is_kit === true,
    category: row.category,
    tags: row.tags || [],
    image: row.image,
    active: row.active,
    description: row.description || null,
    nutrition: row.nutrition || {},
    options: row.options || []
  };
}

module.exports = {
  normalizeNutrition,
  normalizeOptions,
  validateOptions,
  mapProductRow
};
