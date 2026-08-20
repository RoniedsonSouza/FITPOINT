const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const { query, getClient, table } = require('../config/database');
const { authenticateToken, requirePermission } = require('../config/auth');
const { applyVisitDelta, insertVisitEvents, insertRewardEvents, countPendingRewards, computeLoyaltyVisitsFromAmount, DEFAULT_ACCESS_VALUE, DEFAULT_VISITS_PER_REWARD } = require('./loyaltyHelpers');
const { normalizeOptions } = require('./productHelpers');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayYmdBrazil() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function parseSaleDate(value) {
  if (value === undefined || value === null || value === '') {
    return { value: todayYmdBrazil() };
  }
  const str = String(value).trim();
  if (!DATE_RE.test(str)) {
    return { error: 'Data inválida. Use o formato YYYY-MM-DD' };
  }
  const parsed = new Date(`${str}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return { error: 'Data inválida' };
  }
  return { value: str };
}

function computeMonthAccessAverage(monthAccesses, daysWithData) {
  const days = Number(daysWithData) || 0;
  if (days <= 0) return 0;
  return Math.round((Number(monthAccesses) || 0) / days * 10) / 10;
}

function resolveUnitPrice(productRow) {
  const promo = productRow.promo_price != null ? Number(productRow.promo_price) : null;
  if (promo != null && !Number.isNaN(promo) && promo > 0) return promo;
  return Number(productRow.price);
}

function formatSelectedOptionLabel(selected) {
  if (!Array.isArray(selected) || selected.length === 0) return null;
  return selected
    .map((s) => {
      const qty = Math.max(1, Number(s.quantity) || 1);
      return qty > 1 ? `${s.name} ×${qty}` : s.name;
    })
    .join(' · ');
}

/**
 * Resolve selected_options (multi) ou legado option_id (single).
 * Seleção vazia = só preço base (permitido).
 */
function resolveSelectedOptions(productRow, rawSelected, legacyOptionId) {
  const options = normalizeOptions(productRow.options);
  let raw = Array.isArray(rawSelected) ? rawSelected : null;

  if ((!raw || raw.length === 0) && legacyOptionId !== undefined && legacyOptionId !== null && legacyOptionId !== '') {
    raw = [{ id: legacyOptionId, quantity: 1 }];
  }

  if (!options.length) {
    if (raw && raw.length) return { error: 'Produto sem opções disponíveis' };
    return { selected: [], adjustment: 0, optionId: null, optionName: null };
  }

  if (!raw || raw.length === 0) {
    return { selected: [], adjustment: 0, optionId: null, optionName: null };
  }

  const selected = [];
  let adjustment = 0;
  const seen = new Set();

  for (const item of raw) {
    const id = String(item?.id || item?.option_id || '').trim();
    if (!id) continue;
    if (seen.has(id)) return { error: 'Opção duplicada na seleção' };
    seen.add(id);

    const opt = options.find((o) => String(o.id) === id);
    if (!opt) return { error: 'Opção inválida para este produto' };

    const isUnique = opt.unique !== false;
    let qty = 1;
    if (!isUnique) {
      qty = parseInt(String(item.quantity ?? 1), 10);
      if (!Number.isInteger(qty) || qty < 1) {
        return { error: `Quantidade inválida para "${opt.name}"` };
      }
    }

    const adj = Math.max(0, Number(opt.price_adjustment) || 0);
    adjustment += adj * qty;
    selected.push({
      id: opt.id,
      name: opt.name,
      price_adjustment: adj,
      quantity: qty,
      unique: isUnique
    });
  }

  adjustment = Math.round(adjustment * 100) / 100;
  const optionName = formatSelectedOptionLabel(selected);
  const optionId = selected[0]?.id || null;

  return { selected, adjustment, optionId, optionName };
}

function displayProductName(productName, optionName) {
  if (!optionName) return productName;
  return `${productName} (${optionName})`;
}

function mapSaleRow(row) {
  const quantity = Number(row.quantity) || 1;
  const unitPrice = Number(row.unit_price);
  const selectedOptions = Array.isArray(row.selected_options) ? row.selected_options : [];
  const optionName = row.option_name || formatSelectedOptionLabel(selectedOptions) || null;
  return {
    id: row.id,
    sale_date: row.sale_date,
    product_id: row.product_id,
    product_name: displayProductName(row.product_name, optionName),
    option_id: row.option_id || null,
    option_name: optionName,
    selected_options: selectedOptions,
    quantity,
    unit_price: unitPrice,
    line_total: Math.round(quantity * unitPrice * 100) / 100,
    loyalty_customer_id: row.loyalty_customer_id != null ? Number(row.loyalty_customer_id) : null,
    customer_name: row.customer_name || null,
    created_at: row.created_at
  };
}

async function fetchDaySummary(saleDate) {
  const today = todayYmdBrazil();
  const [dayResult, monthResult, topResult, avgResult] = await Promise.all([
    query(
      `SELECT
         COALESCE(SUM(quantity), 0)::int AS total_items,
         COUNT(DISTINCT access_id)::int AS total_accesses,
         COALESCE(SUM(quantity * unit_price), 0)::numeric AS total_revenue
       FROM ${table('daily_sales')}
       WHERE sale_date = $1::date`,
      [saleDate]
    ),
    query(
      `SELECT
         COALESCE(SUM(quantity), 0)::int AS month_items,
         COUNT(DISTINCT access_id)::int AS month_accesses,
         COALESCE(SUM(quantity * unit_price), 0)::numeric AS month_revenue
       FROM ${table('daily_sales')}
       WHERE sale_date >= date_trunc('month', $1::date)
         AND sale_date < date_trunc('month', $1::date) + interval '1 month'`,
      [saleDate]
    ),
    query(
      `SELECT p.name, SUM(ds.quantity)::int AS qty
       FROM ${table('daily_sales')} ds
       JOIN ${table('products')} p ON p.id = ds.product_id
       WHERE ds.sale_date = $1::date
       GROUP BY p.name
       ORDER BY qty DESC, p.name ASC
       LIMIT 1`,
      [saleDate]
    ),
    query(
      `SELECT
         COUNT(DISTINCT access_id)::int AS month_accesses,
         COUNT(DISTINCT sale_date)::int AS month_days
       FROM ${table('daily_sales')}
       WHERE sale_date >= date_trunc('month', $1::date)
         AND sale_date < date_trunc('month', $1::date) + interval '1 month'`,
      [today]
    )
  ]);

  const day = dayResult.rows[0] || {};
  const month = monthResult.rows[0] || {};
  const avgRow = avgResult.rows[0] || {};
  return {
    total_items: Number(day.total_items) || 0,
    total_accesses: Number(day.total_accesses) || 0,
    total_revenue: Number(day.total_revenue) || 0,
    top_product: topResult.rows[0]?.name || null,
    month_items: Number(month.month_items) || 0,
    month_accesses: Number(month.month_accesses) || 0,
    month_access_avg: computeMonthAccessAverage(avgRow.month_accesses, avgRow.month_days),
    month_revenue: Number(month.month_revenue) || 0
  };
}

async function fetchSalesCharts(saleDate) {
  const [daysResult, productsResult] = await Promise.all([
    query(
      `SELECT
         d::date::text AS day,
         COALESCE(SUM(ds.quantity), 0)::int AS items,
         COUNT(DISTINCT ds.access_id)::int AS accesses,
         COALESCE(SUM(ds.quantity * ds.unit_price), 0)::numeric AS revenue
       FROM generate_series(
         date_trunc('month', $1::date)::date,
         (date_trunc('month', $1::date) + interval '1 month - 1 day')::date,
         interval '1 day'
       ) AS d
       LEFT JOIN ${table('daily_sales')} ds ON ds.sale_date = d::date
       GROUP BY d
       ORDER BY d`,
      [saleDate]
    ),
    query(
      `SELECT
         p.name,
         SUM(ds.quantity)::int AS qty,
         COALESCE(SUM(ds.quantity * ds.unit_price), 0)::numeric AS revenue
       FROM ${table('daily_sales')} ds
       JOIN ${table('products')} p ON p.id = ds.product_id
       WHERE ds.sale_date = $1::date
       GROUP BY p.name
       ORDER BY qty DESC, p.name ASC`,
      [saleDate]
    )
  ]);

  return {
    days: daysResult.rows.map((row) => ({
      date: String(row.day).slice(0, 10),
      items: Number(row.items) || 0,
      accesses: Number(row.accesses) || 0,
      revenue: Number(row.revenue) || 0
    })),
    products: productsResult.rows.map((row) => ({
      name: row.name,
      qty: Number(row.qty) || 0,
      revenue: Number(row.revenue) || 0
    }))
  };
}

async function fetchBestSellers(limit = 4) {
  const safeLimit = Math.min(Math.max(Number(limit) || 4, 1), 4);
  const result = await query(
    `SELECT
       p.id,
       p.name,
       SUM(ds.quantity)::int AS total_qty
     FROM ${table('daily_sales')} ds
     JOIN ${table('products')} p ON p.id = ds.product_id
     WHERE p.active IS DISTINCT FROM false
     GROUP BY p.id, p.name
     ORDER BY total_qty DESC, p.name ASC
     LIMIT $1`,
    [safeLimit]
  );
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    total_qty: Number(row.total_qty) || 0
  }));
}

async function fetchDayItems(saleDate) {
  const result = await query(
    `SELECT
       ds.id,
       ds.sale_date,
       ds.product_id,
       ds.quantity,
       ds.unit_price,
       ds.loyalty_customer_id,
       ds.option_id,
       ds.option_name,
       ds.selected_options,
       ds.created_at,
       p.name AS product_name,
       lc.name AS customer_name
     FROM ${table('daily_sales')} ds
     JOIN ${table('products')} p ON p.id = ds.product_id
     LEFT JOIN ${table('loyalty_customers')} lc ON lc.id = ds.loyalty_customer_id
     WHERE ds.sale_date = $1::date
     ORDER BY ds.created_at DESC, ds.id DESC`,
    [saleDate]
  );
  return result.rows.map(mapSaleRow);
}

async function getLoyaltySettingsFromDb(client) {
  const settingsResult = await client.query(
    `SELECT visits_per_reward, access_value FROM ${table('loyalty_settings')} WHERE id = 1`
  );
  let visitsPerReward = DEFAULT_VISITS_PER_REWARD;
  let accessValue = DEFAULT_ACCESS_VALUE;
  if (settingsResult.rows.length > 0) {
    const n = Number(settingsResult.rows[0].visits_per_reward);
    if (Number.isFinite(n) && n >= 2) visitsPerReward = n;
    const a = Number(settingsResult.rows[0].access_value);
    if (Number.isFinite(a) && a > 0) accessValue = a;
  }
  return { visitsPerReward, accessValue };
}

function computeSaleTotal(validatedItems) {
  return validatedItems.reduce(
    (sum, { qty, unitPrice }) => sum + Math.round(qty * unitPrice * 100) / 100,
    0
  );
}

async function applyLoyaltyForSale(client, customerId, validatedItems) {
  if (!customerId) {
    return { loyaltyApplied: false, rewardsEarned: 0, loyaltyVisitsApplied: 0, rewardsPendingTotal: 0 };
  }

  const saleTotal = computeSaleTotal(validatedItems);
  const { visitsPerReward, accessValue } = await getLoyaltySettingsFromDb(client);
  const visitDelta = computeLoyaltyVisitsFromAmount(saleTotal, accessValue);

  if (visitDelta <= 0) {
    return { loyaltyApplied: false, rewardsEarned: 0, loyaltyVisitsApplied: 0, rewardsPendingTotal: 0 };
  }

  const customerRow = (
    await client.query(`SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`, [customerId])
  ).rows[0];

  const { visits, rewards, rewards_earned, delta_applied } = applyVisitDelta(
    customerRow.total_visits,
    customerRow.total_rewards,
    visitDelta,
    visitsPerReward
  );

  const visitsChanged = delta_applied !== 0;
  const positiveVisit = delta_applied > 0;

  await client.query(
    `UPDATE ${table('loyalty_customers')}
     SET total_visits = $1,
         total_rewards = $2,
         updated_at = NOW()
         ${visitsChanged ? ', last_visit_at = NOW()' : ''}
         ${positiveVisit ? ', last_positive_visit_at = NOW()' : ''}
     WHERE id = $3`,
    [visits, rewards, customerId]
  );

  if (visitsChanged) {
    await insertVisitEvents(client, customerId, delta_applied, 'daily_sales');
  }

  if (rewards_earned > 0) {
    await insertRewardEvents(client, customerId, rewards_earned, 'daily_sales');
  }

  const rewardsPendingTotal = await countPendingRewards(client, customerId);

  return {
    loyaltyApplied: true,
    rewardsEarned: rewards_earned,
    loyaltyVisitsApplied: delta_applied > 0 ? delta_applied : visitDelta,
    rewardsPendingTotal
  };
}

// GET /api/daily-sales/day-status?date=
router.get('/day-status', authenticateToken, requirePermission('vendas'), async (req, res) => {
  try {
    const parsed = parseSaleDate(req.query.date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const result = await query(
      `SELECT sale_date, registered
       FROM ${table('daily_diary_days')}
       WHERE sale_date = $1::date`,
      [parsed.value]
    );

    const row = result.rows[0];
    res.json({
      sale_date: parsed.value,
      registered: row ? Boolean(row.registered) : false
    });
  } catch (error) {
    console.error('Erro ao buscar status do diário:', error);
    res.status(500).json({ error: 'Erro ao buscar status do diário' });
  }
});

// PUT /api/daily-sales/day-status
router.put('/day-status', authenticateToken, requirePermission('vendas'), async (req, res) => {
  try {
    const parsed = parseSaleDate(req.body?.sale_date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const registered = Boolean(req.body?.registered);

    const result = await query(
      `INSERT INTO ${table('daily_diary_days')} (sale_date, registered, updated_at)
       VALUES ($1::date, $2, NOW())
       ON CONFLICT (sale_date) DO UPDATE
       SET registered = EXCLUDED.registered, updated_at = NOW()
       RETURNING sale_date, registered`,
      [parsed.value, registered]
    );

    const row = result.rows[0];
    res.json({
      sale_date: parsed.value,
      registered: Boolean(row?.registered)
    });
  } catch (error) {
    console.error('Erro ao atualizar status do diário:', error);
    res.status(500).json({ error: 'Erro ao atualizar status do diário' });
  }
});

// GET /api/daily-sales/bestsellers?limit= — público (home)
router.get('/bestsellers', async (req, res) => {
  try {
    const limit = req.query.limit;
    const items = await fetchBestSellers(limit);
    res.json({ items });
  } catch (error) {
    console.error('Erro ao buscar mais vendidos:', error);
    res.status(500).json({ error: 'Erro ao buscar mais vendidos' });
  }
});

// GET /api/daily-sales/summary/today — admin
router.get('/summary/today', authenticateToken, requirePermission('vendas'), async (req, res) => {
  try {
    const parsed = parseSaleDate();
    const summary = await fetchDaySummary(parsed.value);
    res.json({ date: parsed.value, ...summary });
  } catch (error) {
    console.error('Erro ao buscar resumo de hoje:', error);
    res.status(500).json({ error: 'Erro ao buscar resumo de vendas' });
  }
});

// GET /api/daily-sales/summary?date= — admin
router.get('/summary', authenticateToken, requirePermission('vendas'), async (req, res) => {
  try {
    const parsed = parseSaleDate(req.query.date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const summary = await fetchDaySummary(parsed.value);
    res.json({ date: parsed.value, ...summary });
  } catch (error) {
    console.error('Erro ao buscar resumo:', error);
    res.status(500).json({ error: 'Erro ao buscar resumo de vendas' });
  }
});

// GET /api/daily-sales/charts?date= — admin
router.get('/charts', authenticateToken, requirePermission('vendas'), async (req, res) => {
  try {
    const parsed = parseSaleDate(req.query.date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const charts = await fetchSalesCharts(parsed.value);
    res.json({ date: parsed.value, ...charts });
  } catch (error) {
    console.error('Erro ao buscar gráficos de vendas:', error);
    res.status(500).json({ error: 'Erro ao buscar gráficos de vendas' });
  }
});

// GET /api/daily-sales?date= — admin
router.get('/', authenticateToken, requirePermission('vendas'), async (req, res) => {
  try {
    const parsed = parseSaleDate(req.query.date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const [items, summary] = await Promise.all([
      fetchDayItems(parsed.value),
      fetchDaySummary(parsed.value)
    ]);

    res.json({ date: parsed.value, items, summary });
  } catch (error) {
    console.error('Erro ao buscar vendas do dia:', error);
    res.status(500).json({ error: 'Erro ao buscar vendas do dia' });
  }
});

// POST /api/daily-sales/batch — admin (vários itens, fidelidade proporcional ao total)
router.post('/batch', authenticateToken, requirePermission('vendas'), async (req, res) => {
  const client = await getClient();
  try {
    const { loyalty_customer_id, sale_date, items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um item' });
    }

    const dateParsed = parseSaleDate(sale_date);
    if (dateParsed.error) return res.status(400).json({ error: dateParsed.error });

    let customerId = null;
    let customerName = null;

    if (loyalty_customer_id !== undefined && loyalty_customer_id !== null && loyalty_customer_id !== '') {
      customerId = parseInt(String(loyalty_customer_id), 10);
      if (!Number.isInteger(customerId) || customerId < 1) {
        return res.status(400).json({ error: 'Cliente inválido' });
      }
      const customerResult = await client.query(
        `SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`,
        [customerId]
      );
      if (customerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Cliente não encontrado' });
      }
      if (customerResult.rows[0].active === false) {
        return res.status(400).json({ error: 'Cliente inativo' });
      }
      customerName = customerResult.rows[0].name;
    }

    const validatedItems = [];
    for (let i = 0; i < items.length; i++) {
      const raw = items[i] || {};
      const productId = String(raw.product_id || '').trim();
      if (!productId) {
        return res.status(400).json({ error: `Item ${i + 1}: produto é obrigatório` });
      }

      const qty = raw.quantity !== undefined && raw.quantity !== null && raw.quantity !== ''
        ? parseInt(String(raw.quantity), 10)
        : 1;
      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ error: `Item ${i + 1}: quantidade inválida` });
      }

      const productResult = await client.query(
        `SELECT id, name, price, promo_price, active, options FROM ${table('products')} WHERE id = $1`,
        [productId]
      );
      if (productResult.rows.length === 0) {
        return res.status(404).json({ error: `Produto não encontrado: ${productId}` });
      }
      const product = productResult.rows[0];
      if (product.active === false) {
        return res.status(400).json({ error: `Produto inativo: ${product.name}` });
      }

      const optionResolved = resolveSelectedOptions(product, raw.selected_options, raw.option_id);
      if (optionResolved.error) {
        return res.status(400).json({ error: `Item ${i + 1}: ${optionResolved.error}` });
      }
      const optionAdj = optionResolved.adjustment;
      const maxPrice = resolveUnitPrice(product) + optionAdj;

      let unitPrice = raw.unit_price !== undefined && raw.unit_price !== null && raw.unit_price !== ''
        ? Number(raw.unit_price)
        : maxPrice;

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({ error: `Item ${i + 1}: preço inválido` });
      }
      if (unitPrice > maxPrice + 0.001) {
        return res.status(400).json({ error: `Item ${i + 1}: preço não pode exceder o preço do item` });
      }

      unitPrice = Math.round(unitPrice * 100) / 100;
      validatedItems.push({
        product,
        qty,
        unitPrice,
        optionId: optionResolved.optionId,
        optionName: optionResolved.optionName,
        selectedOptions: optionResolved.selected
      });
    }

    await client.query('BEGIN');

    const accessId = randomUUID();

    const insertedItems = [];
    for (const { product, qty, unitPrice, optionId, optionName, selectedOptions } of validatedItems) {
      const insertResult = await client.query(
        `INSERT INTO ${table('daily_sales')}
           (sale_date, product_id, loyalty_customer_id, quantity, unit_price, option_id, option_name, selected_options, created_at, access_id)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), $9::uuid)
         RETURNING *`,
        [
          dateParsed.value,
          product.id,
          customerId,
          qty,
          unitPrice,
          optionId,
          optionName,
          JSON.stringify(selectedOptions || []),
          accessId
        ]
      );
      insertedItems.push(mapSaleRow({
        ...insertResult.rows[0],
        product_name: product.name,
        customer_name: customerName
      }));
    }

    const loyaltyResult = await applyLoyaltyForSale(client, customerId, validatedItems);

    await client.query('COMMIT');

    const summary = await fetchDaySummary(dateParsed.value);

    res.status(201).json({
      items: insertedItems,
      summary,
      loyalty_applied: loyaltyResult.loyaltyApplied,
      loyalty_visits_applied: loyaltyResult.loyaltyVisitsApplied,
      rewards_earned: loyaltyResult.rewardsEarned,
      rewards_pending_total: loyaltyResult.rewardsPendingTotal
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao registrar vendas em lote:', error);
    res.status(500).json({ error: 'Erro ao registrar vendas' });
  } finally {
    client.release();
  }
});

// POST /api/daily-sales — admin
router.post('/', authenticateToken, requirePermission('vendas'), async (req, res) => {
  const client = await getClient();
  try {
    const { product_id, loyalty_customer_id, quantity, sale_date } = req.body || {};

    if (!product_id || !String(product_id).trim()) {
      return res.status(400).json({ error: 'Produto é obrigatório' });
    }

    const qty = quantity !== undefined && quantity !== null && quantity !== ''
      ? parseInt(String(quantity), 10)
      : 1;
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: 'Quantidade deve ser um inteiro >= 1' });
    }

    const dateParsed = parseSaleDate(sale_date);
    if (dateParsed.error) return res.status(400).json({ error: dateParsed.error });

    const productResult = await client.query(
      `SELECT id, name, price, promo_price, active FROM ${table('products')} WHERE id = $1`,
      [String(product_id).trim()]
    );
    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    const product = productResult.rows[0];
    if (product.active === false) {
      return res.status(400).json({ error: 'Produto inativo' });
    }

    const unitPrice = resolveUnitPrice(product);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ error: 'Preço do produto inválido' });
    }

    let customerId = null;
    let customerName = null;

    if (loyalty_customer_id !== undefined && loyalty_customer_id !== null && loyalty_customer_id !== '') {
      customerId = parseInt(String(loyalty_customer_id), 10);
      if (!Number.isInteger(customerId) || customerId < 1) {
        return res.status(400).json({ error: 'Cliente inválido' });
      }

      const customerResult = await client.query(
        `SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`,
        [customerId]
      );
      if (customerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Cliente não encontrado' });
      }
      if (customerResult.rows[0].active === false) {
        return res.status(400).json({ error: 'Cliente inativo' });
      }
      customerName = customerResult.rows[0].name;
    }

    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO ${table('daily_sales')}
         (sale_date, product_id, loyalty_customer_id, quantity, unit_price, created_at, access_id)
       VALUES ($1::date, $2, $3, $4, $5, NOW(), $6::uuid)
       RETURNING *`,
      [dateParsed.value, product.id, customerId, qty, unitPrice, randomUUID()]
    );

    const loyaltyResult = await applyLoyaltyForSale(client, customerId, [{ product, qty, unitPrice }]);

    await client.query('COMMIT');

    const saleRow = insertResult.rows[0];
    const item = mapSaleRow({
      ...saleRow,
      product_name: product.name,
      customer_name: customerName
    });

    const summary = await fetchDaySummary(dateParsed.value);

    res.status(201).json({
      item,
      summary,
      loyalty_applied: loyaltyResult.loyaltyApplied,
      loyalty_visits_applied: loyaltyResult.loyaltyVisitsApplied,
      rewards_earned: loyaltyResult.rewardsEarned
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao registrar venda:', error);
    res.status(500).json({ error: 'Erro ao registrar venda' });
  } finally {
    client.release();
  }
});

// DELETE /api/daily-sales/:id — admin
router.delete('/:id', authenticateToken, requirePermission('vendas'), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const existing = await query(`SELECT id FROM ${table('daily_sales')} WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    await query(`DELETE FROM ${table('daily_sales')} WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir venda:', error);
    res.status(500).json({ error: 'Erro ao excluir venda' });
  }
});

module.exports = router;
