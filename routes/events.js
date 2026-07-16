const express = require('express');
const router = express.Router();
const { query, table } = require('../config/database');
const { authenticateToken, JWT_SECRET } = require('../config/auth');
const jwt = require('jsonwebtoken');

function mapEventRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    venue: row.venue || '',
    starts_at: row.starts_at,
    image_url: row.image_url || null,
    active: row.active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapLotRow(row) {
  const total = Number(row.quantity_total) || 0;
  const sold = Number(row.quantity_sold) || 0;
  return {
    id: row.id,
    event_id: row.event_id,
    name: row.name,
    price: Number(row.price),
    quantity_total: total,
    quantity_sold: sold,
    quantity_available: Math.max(0, total - sold),
    sales_start: row.sales_start,
    sales_end: row.sales_end,
    active: row.active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function isLotOnSale(lot, now = new Date()) {
  if (lot.active === false) return false;
  if (lot.sales_start && new Date(lot.sales_start) > now) return false;
  if (lot.sales_end && new Date(lot.sales_end) < now) return false;
  return (Number(lot.quantity_total) - Number(lot.quantity_sold)) > 0;
}

async function getLotsForEvent(eventId, { onlyAvailable = false } = {}) {
  const result = await query(
    `SELECT * FROM ${table('ticket_lots')}
     WHERE event_id = $1
     ORDER BY price ASC, id ASC`,
    [eventId]
  );
  let lots = result.rows.map(mapLotRow);
  if (onlyAvailable) {
    const now = new Date();
    lots = lots.filter((lot) => isLotOnSale(lot, now));
  }
  return lots;
}

// GET /api/events — público: só ativos; admin com ?all=1 vê todos
router.get('/', async (req, res) => {
  try {
    const wantAll = req.query.all === '1' || req.query.all === 'true';
    let isAdmin = false;

    if (wantAll && req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        jwt.verify(token, JWT_SECRET);
        isAdmin = true;
      } catch (_) {
        isAdmin = false;
      }
    }

    const sql = isAdmin
      ? `SELECT * FROM ${table('events')} ORDER BY starts_at DESC, id DESC`
      : `SELECT * FROM ${table('events')} WHERE active = true ORDER BY starts_at ASC, id ASC`;

    const result = await query(sql);
    const events = result.rows.map(mapEventRow);

    if (!isAdmin) {
      for (const event of events) {
        event.lots = await getLotsForEvent(event.id, { onlyAvailable: true });
      }
    }

    res.json(events);
  } catch (error) {
    console.error('Erro ao buscar eventos:', error);
    res.status(500).json({ error: 'Erro ao buscar eventos' });
  }
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM ${table('events')} WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    const event = mapEventRow(result.rows[0]);
    const authHeader = req.headers.authorization;
    let isAdmin = false;
    if (authHeader) {
      try {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET);
        isAdmin = true;
      } catch (_) {
        isAdmin = false;
      }
    }

    if (!isAdmin && !event.active) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    event.lots = await getLotsForEvent(event.id, { onlyAvailable: !isAdmin });
    res.json(event);
  } catch (error) {
    console.error('Erro ao buscar evento:', error);
    res.status(500).json({ error: 'Erro ao buscar evento' });
  }
});

// POST /api/events
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, description, venue, starts_at, image_url, active = true } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Título é obrigatório' });
    }
    if (!starts_at) {
      return res.status(400).json({ error: 'Data/hora do evento é obrigatória' });
    }

    const result = await query(
      `INSERT INTO ${table('events')}
        (title, description, venue, starts_at, image_url, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [
        String(title).trim(),
        description ? String(description).trim() : null,
        venue ? String(venue).trim() : null,
        starts_at,
        image_url || null,
        active !== false
      ]
    );

    res.status(201).json(mapEventRow(result.rows[0]));
  } catch (error) {
    console.error('Erro ao criar evento:', error);
    res.status(500).json({ error: 'Erro ao criar evento' });
  }
});

// PUT /api/events/:id
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const existing = await query(
      `SELECT * FROM ${table('events')} WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    const current = existing.rows[0];
    const title = req.body.title != null ? String(req.body.title).trim() : current.title;
    const description =
      req.body.description !== undefined
        ? (req.body.description ? String(req.body.description).trim() : null)
        : current.description;
    const venue =
      req.body.venue !== undefined
        ? (req.body.venue ? String(req.body.venue).trim() : null)
        : current.venue;
    const starts_at = req.body.starts_at != null ? req.body.starts_at : current.starts_at;
    const image_url =
      req.body.image_url !== undefined ? req.body.image_url || null : current.image_url;
    const active = req.body.active !== undefined ? req.body.active !== false : current.active;

    if (!title) {
      return res.status(400).json({ error: 'Título é obrigatório' });
    }

    const result = await query(
      `UPDATE ${table('events')}
       SET title = $1, description = $2, venue = $3, starts_at = $4,
           image_url = $5, active = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [title, description, venue, starts_at, image_url, active, req.params.id]
    );

    res.json(mapEventRow(result.rows[0]));
  } catch (error) {
    console.error('Erro ao atualizar evento:', error);
    res.status(500).json({ error: 'Erro ao atualizar evento' });
  }
});

// DELETE /api/events/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const paid = await query(
      `SELECT id FROM ${table('ticket_orders')}
       WHERE event_id = $1 AND status = 'paid' LIMIT 1`,
      [req.params.id]
    );
    if (paid.rows.length > 0) {
      return res.status(409).json({
        error: 'Não é possível excluir evento com ingressos pagos. Desative-o.'
      });
    }

    const result = await query(
      `DELETE FROM ${table('events')} WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir evento:', error);
    res.status(500).json({ error: 'Erro ao excluir evento' });
  }
});

// GET /api/events/:id/lots
router.get('/:id/lots', authenticateToken, async (req, res) => {
  try {
    const event = await query(
      `SELECT id FROM ${table('events')} WHERE id = $1`,
      [req.params.id]
    );
    if (event.rows.length === 0) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }
    const lots = await getLotsForEvent(req.params.id);
    res.json(lots);
  } catch (error) {
    console.error('Erro ao buscar lotes:', error);
    res.status(500).json({ error: 'Erro ao buscar lotes' });
  }
});

// POST /api/events/:id/lots
router.post('/:id/lots', authenticateToken, async (req, res) => {
  try {
    const event = await query(
      `SELECT id FROM ${table('events')} WHERE id = $1`,
      [req.params.id]
    );
    if (event.rows.length === 0) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    const {
      name,
      price,
      quantity_total,
      sales_start = null,
      sales_end = null,
      active = true
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome do lote é obrigatório' });
    }
    const priceNum = Number(price);
    const qty = parseInt(quantity_total, 10);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Preço inválido' });
    }
    if (!qty || qty < 1) {
      return res.status(400).json({ error: 'Quantidade deve ser pelo menos 1' });
    }

    const result = await query(
      `INSERT INTO ${table('ticket_lots')}
        (event_id, name, price, quantity_total, quantity_sold, sales_start, sales_end, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [
        req.params.id,
        String(name).trim(),
        priceNum,
        qty,
        sales_start || null,
        sales_end || null,
        active !== false
      ]
    );

    res.status(201).json(mapLotRow(result.rows[0]));
  } catch (error) {
    console.error('Erro ao criar lote:', error);
    res.status(500).json({ error: 'Erro ao criar lote' });
  }
});

// PUT /api/events/:eventId/lots/:lotId
router.put('/:eventId/lots/:lotId', authenticateToken, async (req, res) => {
  try {
    const existing = await query(
      `SELECT * FROM ${table('ticket_lots')} WHERE id = $1 AND event_id = $2`,
      [req.params.lotId, req.params.eventId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lote não encontrado' });
    }

    const current = existing.rows[0];
    const name = req.body.name != null ? String(req.body.name).trim() : current.name;
    const price =
      req.body.price !== undefined ? Number(req.body.price) : Number(current.price);
    const quantity_total =
      req.body.quantity_total !== undefined
        ? parseInt(req.body.quantity_total, 10)
        : Number(current.quantity_total);
    const sales_start =
      req.body.sales_start !== undefined ? req.body.sales_start || null : current.sales_start;
    const sales_end =
      req.body.sales_end !== undefined ? req.body.sales_end || null : current.sales_end;
    const active =
      req.body.active !== undefined ? req.body.active !== false : current.active;

    if (!name) {
      return res.status(400).json({ error: 'Nome do lote é obrigatório' });
    }
    if (Number.isNaN(price) || price < 0) {
      return res.status(400).json({ error: 'Preço inválido' });
    }
    if (!quantity_total || quantity_total < 1) {
      return res.status(400).json({ error: 'Quantidade inválida' });
    }
    if (quantity_total < Number(current.quantity_sold)) {
      return res.status(400).json({
        error: `Quantidade total não pode ser menor que já vendidos (${current.quantity_sold})`
      });
    }

    const result = await query(
      `UPDATE ${table('ticket_lots')}
       SET name = $1, price = $2, quantity_total = $3, sales_start = $4,
           sales_end = $5, active = $6, updated_at = NOW()
       WHERE id = $7 AND event_id = $8
       RETURNING *`,
      [
        name,
        price,
        quantity_total,
        sales_start,
        sales_end,
        active,
        req.params.lotId,
        req.params.eventId
      ]
    );

    res.json(mapLotRow(result.rows[0]));
  } catch (error) {
    console.error('Erro ao atualizar lote:', error);
    res.status(500).json({ error: 'Erro ao atualizar lote' });
  }
});

// DELETE /api/events/:eventId/lots/:lotId
router.delete('/:eventId/lots/:lotId', authenticateToken, async (req, res) => {
  try {
    const existing = await query(
      `SELECT * FROM ${table('ticket_lots')} WHERE id = $1 AND event_id = $2`,
      [req.params.lotId, req.params.eventId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lote não encontrado' });
    }
    if (Number(existing.rows[0].quantity_sold) > 0) {
      return res.status(409).json({
        error: 'Lote com vendas não pode ser excluído. Desative-o.'
      });
    }

    await query(
      `DELETE FROM ${table('ticket_lots')} WHERE id = $1 AND event_id = $2`,
      [req.params.lotId, req.params.eventId]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir lote:', error);
    res.status(500).json({ error: 'Erro ao excluir lote' });
  }
});

module.exports = router;
