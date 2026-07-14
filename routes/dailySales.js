const express = require('express');
const router = express.Router();
const { query, getClient, table } = require('../config/database');
const { authenticateToken } = require('../config/auth');
const { applyVisitDelta, insertVisitEvents } = require('./loyaltyHelpers');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseSaleDate(value) {
  if (value === undefined || value === null || value === '') {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return { value: `${y}-${m}-${d}` };
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

function resolveUnitPrice(productRow) {
  const promo = productRow.promo_price != null ? Number(productRow.promo_price) : null;
  if (promo != null && !Number.isNaN(promo) && promo > 0) return promo;
  return Number(productRow.price);
}

function mapSaleRow(row) {
  const quantity = Number(row.quantity) || 1;
  const unitPrice = Number(row.unit_price);
  return {
    id: row.id,
    sale_date: row.sale_date,
    product_id: row.product_id,
    product_name: row.product_name,
    quantity,
    unit_price: unitPrice,
    line_total: Math.round(quantity * unitPrice * 100) / 100,
    loyalty_customer_id: row.loyalty_customer_id != null ? Number(row.loyalty_customer_id) : null,
    customer_name: row.customer_name || null,
    created_at: row.created_at
  };
}

async function fetchDaySummary(saleDate) {
  const totalsResult = await query(
    `SELECT
       COALESCE(SUM(quantity), 0)::int AS total_items,
       COALESCE(SUM(quantity * unit_price), 0)::numeric AS total_revenue
     FROM ${table('daily_sales')}
     WHERE sale_date = $1::date`,
    [saleDate]
  );

  const topResult = await query(
    `SELECT p.name, SUM(ds.quantity)::int AS qty
     FROM ${table('daily_sales')} ds
     JOIN ${table('products')} p ON p.id = ds.product_id
     WHERE ds.sale_date = $1::date
     GROUP BY p.name
     ORDER BY qty DESC, p.name ASC
     LIMIT 1`,
    [saleDate]
  );

  const row = totalsResult.rows[0] || {};
  return {
    total_items: Number(row.total_items) || 0,
    total_revenue: Number(row.total_revenue) || 0,
    top_product: topResult.rows[0]?.name || null
  };
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

// GET /api/daily-sales/summary/today — admin
router.get('/summary/today', authenticateToken, async (req, res) => {
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
router.get('/summary', authenticateToken, async (req, res) => {
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

// GET /api/daily-sales?date= — admin
router.get('/', authenticateToken, async (req, res) => {
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

// POST /api/daily-sales/batch — admin (vários itens, 1 visita de fidelidade opcional)
router.post('/batch', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const { loyalty_customer_id, sale_date, apply_loyalty_visit, items } = req.body || {};

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
        `SELECT id, name, price, promo_price, active FROM ${table('products')} WHERE id = $1`,
        [productId]
      );
      if (productResult.rows.length === 0) {
        return res.status(404).json({ error: `Produto não encontrado: ${productId}` });
      }
      const product = productResult.rows[0];
      if (product.active === false) {
        return res.status(400).json({ error: `Produto inativo: ${product.name}` });
      }

      const basePrice = resolveUnitPrice(product);
      let unitPrice = raw.unit_price !== undefined && raw.unit_price !== null && raw.unit_price !== ''
        ? Number(raw.unit_price)
        : basePrice;

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({ error: `Item ${i + 1}: preço inválido` });
      }
      if (unitPrice > basePrice + 0.001) {
        return res.status(400).json({ error: `Item ${i + 1}: preço não pode exceder o preço base` });
      }

      unitPrice = Math.round(unitPrice * 100) / 100;
      validatedItems.push({ product, qty, unitPrice });
    }

    const shouldApplyLoyalty = Boolean(apply_loyalty_visit) && customerId;

    await client.query('BEGIN');

    const insertedItems = [];
    for (const { product, qty, unitPrice } of validatedItems) {
      const insertResult = await client.query(
        `INSERT INTO ${table('daily_sales')}
           (sale_date, product_id, loyalty_customer_id, quantity, unit_price, created_at)
         VALUES ($1::date, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [dateParsed.value, product.id, customerId, qty, unitPrice]
      );
      insertedItems.push(mapSaleRow({
        ...insertResult.rows[0],
        product_name: product.name,
        customer_name: customerName
      }));
    }

    let loyaltyApplied = false;
    let rewardsEarned = 0;

    if (shouldApplyLoyalty) {
      const settingsResult = await client.query(
        `SELECT visits_per_reward FROM ${table('loyalty_settings')} WHERE id = 1`
      );
      let visitsPerReward = 10;
      if (settingsResult.rows.length > 0) {
        const n = Number(settingsResult.rows[0].visits_per_reward);
        if (Number.isFinite(n) && n >= 2) visitsPerReward = n;
      }

      const customerRow = (
        await client.query(`SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`, [customerId])
      ).rows[0];

      const { visits, rewards, rewards_earned, delta_applied } = applyVisitDelta(
        customerRow.total_visits,
        customerRow.total_rewards,
        1,
        visitsPerReward
      );

      await client.query(
        `UPDATE ${table('loyalty_customers')}
         SET total_visits = $1,
             total_rewards = $2,
             updated_at = NOW(),
             last_visit_at = NOW(),
             last_positive_visit_at = NOW()
         WHERE id = $3`,
        [visits, rewards, customerId]
      );

      if (delta_applied !== 0) {
        await insertVisitEvents(client, customerId, delta_applied, 'daily_sales');
      }

      loyaltyApplied = true;
      rewardsEarned = rewards_earned;
    }

    await client.query('COMMIT');

    const summary = await fetchDaySummary(dateParsed.value);

    res.status(201).json({
      items: insertedItems,
      summary,
      loyalty_applied: loyaltyApplied,
      rewards_earned: rewardsEarned
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
router.post('/', authenticateToken, async (req, res) => {
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
         (sale_date, product_id, loyalty_customer_id, quantity, unit_price, created_at)
       VALUES ($1::date, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [dateParsed.value, product.id, customerId, qty, unitPrice]
    );

    let loyaltyApplied = false;
    let rewardsEarned = 0;

    if (customerId) {
      const settingsResult = await client.query(
        `SELECT visits_per_reward FROM ${table('loyalty_settings')} WHERE id = 1`
      );
      let visitsPerReward = 10;
      if (settingsResult.rows.length > 0) {
        const n = Number(settingsResult.rows[0].visits_per_reward);
        if (Number.isFinite(n) && n >= 2) visitsPerReward = n;
      }

      const customerRow = (
        await client.query(`SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`, [customerId])
      ).rows[0];

      const { visits, rewards, rewards_earned, delta_applied } = applyVisitDelta(
        customerRow.total_visits,
        customerRow.total_rewards,
        1,
        visitsPerReward
      );

      await client.query(
        `UPDATE ${table('loyalty_customers')}
         SET total_visits = $1,
             total_rewards = $2,
             updated_at = NOW(),
             last_visit_at = NOW(),
             last_positive_visit_at = NOW()
         WHERE id = $3`,
        [visits, rewards, customerId]
      );

      if (delta_applied !== 0) {
        await insertVisitEvents(client, customerId, delta_applied, 'daily_sales');
      }

      loyaltyApplied = true;
      rewardsEarned = rewards_earned;
    }

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
      loyalty_applied: loyaltyApplied,
      rewards_earned: rewardsEarned
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
router.delete('/:id', authenticateToken, async (req, res) => {
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
