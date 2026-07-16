const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { query, table, getClient } = require('../config/database');
const { authenticateToken, JWT_SECRET } = require('../config/auth');
const { validatePromoConfig } = require('../services/ticketPricing');
const jwt = require('jsonwebtoken');

const eventsUploadDir = path.join(__dirname, '..', 'uploads', 'events');
fs.mkdirSync(eventsUploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, eventsUploadDir),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase();
      const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const safeExt = allowed.includes(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Use uma imagem JPG, PNG, WebP ou GIF.'));
    }
  }
});

function uploadEventImageMiddleware(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Erro no upload' });
    }
    next();
  });
}

function mapEventRow(row) {
  const logo_url = row.logo_url || null;
  const cover_url = row.cover_url || row.image_url || null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    venue: row.venue || '',
    starts_at: row.starts_at,
    image_url: cover_url || logo_url || row.image_url || null,
    logo_url,
    cover_url,
    active: row.active !== false,
    sponsors: Array.isArray(row.sponsors) ? row.sponsors : [],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapSponsorRow(row) {
  return {
    id: row.id,
    event_id: row.event_id,
    fantasy_name: row.fantasy_name || '',
    instagram: row.instagram || '',
    sort_order: Number(row.sort_order) || 0
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
    promo_enabled: row.promo_enabled === true,
    promo_qty: row.promo_qty != null ? Number(row.promo_qty) : null,
    promo_price: row.promo_price != null ? Number(row.promo_price) : null,
    promo_mode: row.promo_mode || 'repeat',
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

function normalizeImageUrl(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function resolveEventImages(body, current = {}) {
  const logo_url =
    body.logo_url !== undefined ? normalizeImageUrl(body.logo_url) : (current.logo_url || null);
  let cover_url =
    body.cover_url !== undefined ? normalizeImageUrl(body.cover_url) : (current.cover_url || null);

  // Compat: se só vier image_url legado, usar como capa
  if (body.cover_url === undefined && body.image_url !== undefined && body.logo_url === undefined) {
    cover_url = normalizeImageUrl(body.image_url);
  }
  if (!cover_url && current.cover_url == null && current.image_url) {
    cover_url = current.image_url;
  }

  const image_url = cover_url || logo_url || null;
  return { logo_url, cover_url, image_url };
}

function normalizeSponsorsInput(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s, index) => {
      const fantasy_name = s && s.fantasy_name != null ? String(s.fantasy_name).trim() : '';
      const instagram = s && s.instagram != null ? String(s.instagram).trim() : '';
      if (!fantasy_name && !instagram) return null;
      return {
        fantasy_name: fantasy_name || instagram,
        instagram: instagram || fantasy_name,
        sort_order: index
      };
    })
    .filter(Boolean);
}

async function getSponsorsForEvent(eventId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const result = await run(
    `SELECT * FROM ${table('event_sponsors')}
     WHERE event_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [eventId]
  );
  return result.rows.map(mapSponsorRow);
}

async function replaceSponsors(client, eventId, sponsors) {
  await client.query(`DELETE FROM ${table('event_sponsors')} WHERE event_id = $1`, [eventId]);
  for (const sponsor of sponsors) {
    await client.query(
      `INSERT INTO ${table('event_sponsors')}
        (event_id, fantasy_name, instagram, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [eventId, sponsor.fantasy_name, sponsor.instagram, sponsor.sort_order]
    );
  }
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

function tryAdminFromAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  try {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch (_) {
    return false;
  }
}

// POST /api/events/upload-image — enviar imagem (autenticado)
router.post('/upload-image', authenticateToken, uploadEventImageMiddleware, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  const url = `/uploads/events/${req.file.filename}`;
  res.status(201).json({ url });
});

// GET /api/events — público: só ativos; admin com ?all=1 vê todos
router.get('/', async (req, res) => {
  try {
    const wantAll = req.query.all === '1' || req.query.all === 'true';
    let isAdmin = false;

    if (wantAll && req.headers.authorization) {
      isAdmin = tryAdminFromAuth(req);
    }

    const sql = isAdmin
      ? `SELECT * FROM ${table('events')} ORDER BY starts_at DESC, id DESC`
      : `SELECT * FROM ${table('events')} WHERE active = true ORDER BY starts_at ASC, id ASC`;

    const result = await query(sql);
    const events = result.rows.map(mapEventRow);

    for (const event of events) {
      event.sponsors = await getSponsorsForEvent(event.id);
      if (!isAdmin) {
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
    const isAdmin = tryAdminFromAuth(req);

    if (!isAdmin && !event.active) {
      return res.status(404).json({ error: 'Evento não encontrado' });
    }

    event.sponsors = await getSponsorsForEvent(event.id);
    event.lots = await getLotsForEvent(event.id, { onlyAvailable: !isAdmin });
    res.json(event);
  } catch (error) {
    console.error('Erro ao buscar evento:', error);
    res.status(500).json({ error: 'Erro ao buscar evento' });
  }
});

// POST /api/events
router.post('/', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const { title, description, venue, starts_at, active = true } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Título é obrigatório' });
    }
    if (!starts_at) {
      return res.status(400).json({ error: 'Data/hora do evento é obrigatória' });
    }

    const images = resolveEventImages(req.body);
    const sponsors = normalizeSponsorsInput(req.body.sponsors);

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO ${table('events')}
        (title, description, venue, starts_at, image_url, logo_url, cover_url, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [
        String(title).trim(),
        description ? String(description).trim() : null,
        venue ? String(venue).trim() : null,
        starts_at,
        images.image_url,
        images.logo_url,
        images.cover_url,
        active !== false
      ]
    );

    const eventId = result.rows[0].id;
    await replaceSponsors(client, eventId, sponsors);
    await client.query('COMMIT');

    const event = mapEventRow(result.rows[0]);
    event.sponsors = await getSponsorsForEvent(eventId);
    res.status(201).json(event);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) { /* ignore */ }
    console.error('Erro ao criar evento:', error);
    res.status(500).json({ error: 'Erro ao criar evento' });
  } finally {
    client.release();
  }
});

// PUT /api/events/:id
router.put('/:id', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const existing = await client.query(
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
    const active = req.body.active !== undefined ? req.body.active !== false : current.active;
    const images = resolveEventImages(req.body, current);

    if (!title) {
      return res.status(400).json({ error: 'Título é obrigatório' });
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE ${table('events')}
       SET title = $1, description = $2, venue = $3, starts_at = $4,
           image_url = $5, logo_url = $6, cover_url = $7, active = $8, updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        title,
        description,
        venue,
        starts_at,
        images.image_url,
        images.logo_url,
        images.cover_url,
        active,
        req.params.id
      ]
    );

    if (req.body.sponsors !== undefined) {
      await replaceSponsors(client, req.params.id, normalizeSponsorsInput(req.body.sponsors));
    }

    await client.query('COMMIT');

    const event = mapEventRow(result.rows[0]);
    event.sponsors = await getSponsorsForEvent(req.params.id);
    res.json(event);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) { /* ignore */ }
    console.error('Erro ao atualizar evento:', error);
    res.status(500).json({ error: 'Erro ao atualizar evento' });
  } finally {
    client.release();
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
      active = true,
      promo_enabled = false,
      promo_qty = null,
      promo_price = null,
      promo_mode = 'repeat'
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

    const promo = validatePromoConfig(
      { promo_enabled, promo_qty, promo_price, promo_mode },
      priceNum
    );
    if (!promo.ok) {
      return res.status(400).json({ error: promo.error });
    }

    const result = await query(
      `INSERT INTO ${table('ticket_lots')}
        (event_id, name, price, quantity_total, quantity_sold, sales_start, sales_end, active,
         promo_enabled, promo_qty, promo_price, promo_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [
        req.params.id,
        String(name).trim(),
        priceNum,
        qty,
        sales_start || null,
        sales_end || null,
        active !== false,
        promo.value.promo_enabled,
        promo.value.promo_qty,
        promo.value.promo_price,
        promo.value.promo_mode
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
    const promo_enabled =
      req.body.promo_enabled !== undefined
        ? req.body.promo_enabled === true
        : current.promo_enabled === true;
    const promo_qty =
      req.body.promo_qty !== undefined ? req.body.promo_qty : current.promo_qty;
    const promo_price =
      req.body.promo_price !== undefined ? req.body.promo_price : current.promo_price;
    const promo_mode =
      req.body.promo_mode !== undefined ? req.body.promo_mode : current.promo_mode || 'repeat';

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

    const promo = validatePromoConfig(
      { promo_enabled, promo_qty, promo_price, promo_mode },
      price
    );
    if (!promo.ok) {
      return res.status(400).json({ error: promo.error });
    }

    const result = await query(
      `UPDATE ${table('ticket_lots')}
       SET name = $1, price = $2, quantity_total = $3, sales_start = $4,
           sales_end = $5, active = $6, promo_enabled = $7, promo_qty = $8,
           promo_price = $9, promo_mode = $10, updated_at = NOW()
       WHERE id = $11 AND event_id = $12
       RETURNING *`,
      [
        name,
        price,
        quantity_total,
        sales_start,
        sales_end,
        active,
        promo.value.promo_enabled,
        promo.value.promo_qty,
        promo.value.promo_price,
        promo.value.promo_mode,
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
