const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { query, table, getClient } = require('../config/database');
const { authenticateToken, requirePermission } = require('../config/auth');
const {
  createPixPayment,
  createCardPayment,
  getPaymentById,
  findApprovedPaymentByOrderId,
  getPublicKey
} = require('../services/mercadopago');
const { sendTicketEmail } = require('../services/email');
const { computeOrderTotal } = require('../services/ticketPricing');
const { normalizeAssignees, resolveHolders } = require('../services/ticketAssignees');

function generateTicketCode() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
}

function isLotOnSale(lot, now = new Date()) {
  if (lot.active === false) return false;
  if (lot.sales_start && new Date(lot.sales_start) > now) return false;
  if (lot.sales_end && new Date(lot.sales_end) < now) return false;
  return Number(lot.quantity_sold) + 1 <= Number(lot.quantity_total);
}

function parseOrderAssignees(assignees) {
  if (assignees == null) return [];
  if (typeof assignees === 'string') {
    try {
      const parsed = JSON.parse(assignees);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return Array.isArray(assignees) ? assignees : [];
}

/** VIP paid sem tickets: sync deve re-chamar fulfill (não só retornar paid). */
function shouldRefulfillPaidOrder(order, ticketCount) {
  return (
    !!order &&
    order.status === 'paid' &&
    Number(ticketCount) === 0 &&
    order.source === 'vip'
  );
}

/**
 * Gera tickets por titular, marca pedido como pago e envia e-mails agrupados.
 * Idempotente se o pedido já estiver paid e já tiver tickets.
 * VIP: permite emitir quando order já paid sem tickets (source=vip ou options.allowAlreadyPaid).
 */
async function fulfillPaidOrder(orderId, mpPaymentId, options = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT o.*, e.title AS event_title, e.starts_at AS event_starts_at,
              e.venue AS event_venue, l.name AS lot_name, l.price AS lot_price,
              l.is_vip AS lot_is_vip
       FROM ${table('ticket_orders')} o
       JOIN ${table('events')} e ON e.id = o.event_id
       JOIN ${table('ticket_lots')} l ON l.id = o.lot_id
       WHERE o.id = $1
       FOR UPDATE OF o`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'order_not_found' };
    }

    const order = orderRes.rows[0];
    order.assignees = parseOrderAssignees(order.assignees);

    const ticketCountRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${table('tickets')} WHERE order_id = $1`,
      [orderId]
    );
    const existingTicketCount = ticketCountRes.rows[0].count;

    const allowAlreadyPaid =
      options.allowAlreadyPaid === true || order.source === 'vip';

    if (order.status === 'paid') {
      // Idempotente se já há tickets; VIP (ou allowAlreadyPaid) emite se paid sem tickets
      if (existingTicketCount > 0 || !allowAlreadyPaid) {
        await client.query('COMMIT');
        return { ok: true, already: true };
      }
    } else if (order.status === 'pending') {
      await client.query(
        `UPDATE ${table('ticket_orders')}
         SET status = 'paid', mp_payment_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [mpPaymentId ? String(mpPaymentId) : order.mp_payment_id, orderId]
      );
    } else {
      await client.query('ROLLBACK');
      return { ok: false, reason: `order_status_${order.status}` };
    }

    const holders = resolveHolders(order);
    const tickets = [];
    for (let i = 0; i < holders.length; i++) {
      const holder = holders[i];
      let code = generateTicketCode();
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        try {
          const tRes = await client.query(
            `INSERT INTO ${table('tickets')}
              (order_id, event_id, lot_id, code, status, buyer_name, buyer_email, buyer_phone, created_at)
             VALUES ($1, $2, $3, $4, 'valid', $5, $6, $7, NOW())
             RETURNING *`,
            [
              order.id,
              order.event_id,
              order.lot_id,
              code,
              holder.name,
              holder.email,
              holder.phone
            ]
          );
          tickets.push(tRes.rows[0]);
          inserted = true;
        } catch (err) {
          if (err.code === '23505') {
            code = generateTicketCode();
          } else {
            throw err;
          }
        }
      }
      if (!inserted) {
        throw new Error('Não foi possível gerar código único do ingresso');
      }
    }

    await client.query('COMMIT');

    const byEmail = new Map();
    for (const t of tickets) {
      const key = String(t.buyer_email).trim().toLowerCase();
      if (!byEmail.has(key)) {
        byEmail.set(key, { name: t.buyer_name, tickets: [] });
      }
      byEmail.get(key).tickets.push({ code: t.code });
    }

    const complimentary = order.source === 'vip';
    const eventPayload = {
      title: order.event_title,
      starts_at: order.event_starts_at,
      venue: order.event_venue
    };
    const lotPayload = { name: order.lot_name };

    for (const [to, group] of byEmail) {
      try {
        await sendTicketEmail({
          to,
          buyerName: group.name,
          event: eventPayload,
          lot: lotPayload,
          tickets: group.tickets,
          complimentary
        });
      } catch (emailErr) {
        console.error('Pedido pago, mas falha no e-mail:', emailErr.message);
      }
    }

    return { ok: true, tickets };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function releaseOrderStock(orderId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      `SELECT * FROM ${table('ticket_orders')} WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }
    const order = orderRes.rows[0];
    if (order.status !== 'pending') {
      await client.query('ROLLBACK');
      return;
    }

    await client.query(
      `UPDATE ${table('ticket_lots')}
       SET quantity_sold = GREATEST(0, quantity_sold - $1), updated_at = NOW()
       WHERE id = $2`,
      [order.quantity, order.lot_id]
    );
    await client.query(
      `UPDATE ${table('ticket_orders')}
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw error;
  } finally {
    client.release();
  }
}

// Mensagens amigáveis para recusas de cartão (status_detail do MP)
function friendlyCardError(statusDetail) {
  const map = {
    cc_rejected_insufficient_amount: 'Cartão sem limite disponível para esta compra.',
    cc_rejected_bad_filled_card_number: 'Número do cartão incorreto. Confira e tente novamente.',
    cc_rejected_bad_filled_date: 'Data de validade incorreta. Confira e tente novamente.',
    cc_rejected_bad_filled_security_code: 'Código de segurança (CVV) incorreto.',
    cc_rejected_bad_filled_other: 'Algum dado do cartão está incorreto. Revise e tente novamente.',
    cc_rejected_call_for_authorize: 'O banco não autorizou. Ligue para o seu banco ou use outro cartão.',
    cc_rejected_card_disabled: 'Cartão desativado. Contate o banco emissor ou use outro cartão.',
    cc_rejected_duplicated_payment: 'Você já fez um pagamento com esse valor há pouco. Aguarde alguns minutos.',
    cc_rejected_high_risk: 'Pagamento não autorizado. Tente outro cartão ou pague com Pix.',
    cc_rejected_max_attempts: 'Limite de tentativas atingido. Aguarde ou use outro meio de pagamento.',
    cc_rejected_card_expired: 'Cartão vencido. Use outro cartão.'
  };
  return map[statusDetail] || 'Pagamento não aprovado. Tente outro cartão ou pague com Pix.';
}

// GET /api/tickets/payment-config — público (chave pública para tokenizar cartão no navegador)
router.get('/payment-config', (req, res) => {
  res.json({ public_key: getPublicKey() });
});

// POST /api/tickets/checkout — público
router.post('/checkout', async (req, res) => {
  const client = await getClient();
  try {
    const {
      lot_id,
      quantity = 1,
      buyer_name,
      buyer_email,
      buyer_phone,
      payment_method = 'pix',
      card = null
    } = req.body;

    if (!lot_id) {
      return res.status(400).json({ error: 'Lote é obrigatório' });
    }
    if (payment_method !== 'pix' && payment_method !== 'card') {
      return res.status(400).json({ error: 'Forma de pagamento inválida' });
    }
    if (payment_method === 'card') {
      if (!card || !card.token) {
        return res.status(400).json({ error: 'Dados do cartão não recebidos. Tente novamente.' });
      }
      if (!card.payment_method_id) {
        return res.status(400).json({ error: 'Bandeira do cartão não identificada.' });
      }
    }
    if (!buyer_name || !String(buyer_name).trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    if (!buyer_email || !String(buyer_email).trim()) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }
    const email = String(buyer_email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1 || qty > 10) {
      return res.status(400).json({ error: 'Quantidade deve ser entre 1 e 10' });
    }

    const normalized = normalizeAssignees(req.body.assignees, qty);
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error });
    }

    await client.query('BEGIN');

    const lotRes = await client.query(
      `SELECT l.*, e.id AS event_id, e.title AS event_title, e.active AS event_active
       FROM ${table('ticket_lots')} l
       JOIN ${table('events')} e ON e.id = l.event_id
       WHERE l.id = $1
       FOR UPDATE OF l`,
      [lot_id]
    );

    if (lotRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lote não encontrado' });
    }

    const lot = lotRes.rows[0];
    if (lot.is_vip === true) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este lote não está disponível para compra' });
    }
    if (!lot.event_active) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Evento indisponível' });
    }
    if (!isLotOnSale(lot)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Lote indisponível para venda' });
    }

    const available = Number(lot.quantity_total) - Number(lot.quantity_sold);
    if (qty > available) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Restam apenas ${available} ingresso(s)` });
    }

    const reserve = await client.query(
      `UPDATE ${table('ticket_lots')}
       SET quantity_sold = quantity_sold + $1, updated_at = NOW()
       WHERE id = $2
         AND quantity_sold + $1 <= quantity_total
       RETURNING *`,
      [qty, lot_id]
    );

    if (reserve.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Estoque insuficiente' });
    }

    const pricing = computeOrderTotal(lot, qty);
    const amount = pricing.total;

    const orderRes = await client.query(
      `INSERT INTO ${table('ticket_orders')}
        (event_id, lot_id, buyer_name, buyer_email, buyer_phone, quantity, amount, status, source, assignees, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'checkout', $8::jsonb, NOW(), NOW())
       RETURNING *`,
      [
        lot.event_id,
        lot.id,
        String(buyer_name).trim(),
        email,
        buyer_phone ? String(buyer_phone).trim() : null,
        qty,
        amount,
        JSON.stringify(normalized.value)
      ]
    );

    const order = orderRes.rows[0];
    await client.query('COMMIT');

    const description = `${lot.event_title} — ${lot.name} (${qty} ingresso${qty > 1 ? 's' : ''})`;

    // ===== Pix: gera QR Code / copia-e-cola, pagamento dentro do site =====
    if (payment_method === 'pix') {
      let pix;
      try {
        pix = await createPixPayment({
          orderId: order.id,
          amount,
          description,
          buyerEmail: email,
          buyerName: String(buyer_name).trim()
        });
      } catch (mpErr) {
        console.error('Erro ao criar pagamento Pix:', mpErr);
        await releaseOrderStock(order.id);
        return res.status(502).json({
          error: 'Não foi possível gerar o Pix agora. Tente novamente em instantes.'
        });
      }

      await query(
        `UPDATE ${table('ticket_orders')}
         SET mp_payment_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [String(pix.id), order.id]
      );

      return res.status(201).json({
        order_id: order.id,
        payment_method: 'pix',
        status: 'pending',
        amount,
        savings: pricing.savings,
        promo_applied: pricing.promoApplied,
        pix: {
          qr_code: pix.qr_code,
          qr_code_base64: pix.qr_code_base64,
          expires_at: pix.expires_at
        }
      });
    }

    // ===== Cartão de crédito: token gerado no navegador, cobrança direta =====
    let payment;
    try {
      payment = await createCardPayment({
        orderId: order.id,
        amount,
        description,
        token: card.token,
        installments: card.installments,
        paymentMethodId: card.payment_method_id,
        issuerId: card.issuer_id,
        buyerEmail: email,
        identificationType: card.identification_type || (card.identification_number ? 'CPF' : null),
        identificationNumber: card.identification_number
      });
    } catch (mpErr) {
      console.error('Erro ao criar pagamento com cartão:', mpErr);
      await releaseOrderStock(order.id);
      return res.status(502).json({
        error: 'Não foi possível processar o cartão agora. Tente novamente ou pague com Pix.'
      });
    }

    if (payment.status === 'approved') {
      try {
        await fulfillPaidOrder(order.id, payment.id);
      } catch (fulfillErr) {
        // Pagamento aprovado; webhook/sync completam a emissão depois
        console.error('Pagamento aprovado, falha ao emitir ingressos agora:', fulfillErr);
      }
      return res.status(201).json({
        order_id: order.id,
        payment_method: 'card',
        status: 'approved',
        amount,
        savings: pricing.savings,
        promo_applied: pricing.promoApplied
      });
    }

    if (payment.status === 'in_process' || payment.status === 'pending') {
      await query(
        `UPDATE ${table('ticket_orders')}
         SET mp_payment_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [String(payment.id), order.id]
      );
      return res.status(201).json({
        order_id: order.id,
        payment_method: 'card',
        status: 'in_process',
        amount,
        savings: pricing.savings,
        promo_applied: pricing.promoApplied
      });
    }

    // Recusado
    await releaseOrderStock(order.id);
    return res.status(402).json({
      error: friendlyCardError(payment.status_detail),
      status: 'rejected'
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('Erro no checkout:', error);
    res.status(500).json({ error: 'Erro ao iniciar checkout' });
  } finally {
    client.release();
  }
});

// Webhook Mercado Pago
router.post('/webhooks/mercadopago', async (req, res) => {
  try {
    const topic = req.query.topic || req.query.type || req.body?.type || req.body?.action;
    const dataId =
      req.query['data.id'] ||
      req.query.id ||
      req.body?.data?.id ||
      req.body?.id;

    // Responde rápido; processa em seguida
    res.status(200).json({ received: true });

    const secret = process.env.MP_WEBHOOK_SECRET;
    if (secret) {
      const xSignature = req.headers['x-signature'];
      const xRequestId = req.headers['x-request-id'];
      if (xSignature && xRequestId && dataId) {
        const parts = Object.fromEntries(
          String(xSignature)
            .split(',')
            .map((p) => p.trim().split('='))
            .filter((p) => p.length === 2)
        );
        const ts = parts.ts;
        const hash = parts.v1;
        if (ts && hash) {
          const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
          const computed = crypto
            .createHmac('sha256', secret)
            .update(manifest)
            .digest('hex');
          if (computed !== hash) {
            console.warn('Webhook MP: assinatura inválida');
            return;
          }
        }
      }
    }

    const isPayment =
      String(topic || '').includes('payment') ||
      req.body?.action?.includes('payment') ||
      req.query.topic === 'payment';

    if (!isPayment || !dataId) {
      return;
    }

    const payment = await getPaymentById(dataId);
    const status = payment.status;
    const externalRef = payment.external_reference;
    const orderId = parseInt(externalRef, 10);

    if (!orderId) {
      console.warn('Webhook MP: external_reference inválido', externalRef);
      return;
    }

    if (status === 'approved') {
      await fulfillPaidOrder(orderId, payment.id);
    } else if (
      status === 'cancelled' ||
      status === 'rejected' ||
      status === 'refunded' ||
      status === 'charged_back'
    ) {
      await releaseOrderStock(orderId);
    }
  } catch (error) {
    console.error('Erro no webhook Mercado Pago:', error);
  }
});

// POST /api/tickets/issue-vip — admin (cortesia; sem Mercado Pago)
router.post('/issue-vip', authenticateToken, requirePermission('eventos', 'lotes'), async (req, res) => {
  const client = await getClient();
  try {
    const {
      event_id,
      lot_id,
      quantity = 1,
      buyer_name,
      buyer_email,
      buyer_phone
    } = req.body;

    if (!event_id) {
      return res.status(400).json({ error: 'Evento é obrigatório' });
    }
    if (!buyer_name || !String(buyer_name).trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    if (!buyer_email || !String(buyer_email).trim()) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }
    const email = String(buyer_email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1 || qty > 10) {
      return res.status(400).json({ error: 'Quantidade deve ser entre 1 e 10' });
    }

    const normalized = normalizeAssignees(req.body.assignees, qty);
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error });
    }

    await client.query('BEGIN');

    let lotRes;
    if (lot_id) {
      lotRes = await client.query(
        `SELECT l.*, e.id AS event_id, e.title AS event_title, e.active AS event_active
         FROM ${table('ticket_lots')} l
         JOIN ${table('events')} e ON e.id = l.event_id
         WHERE l.id = $1 AND l.is_vip = true AND l.event_id = $2
         FOR UPDATE OF l`,
        [lot_id, event_id]
      );
    } else {
      lotRes = await client.query(
        `SELECT l.*, e.id AS event_id, e.title AS event_title, e.active AS event_active
         FROM ${table('ticket_lots')} l
         JOIN ${table('events')} e ON e.id = l.event_id
         WHERE l.event_id = $1 AND l.is_vip = true
         FOR UPDATE OF l`,
        [event_id]
      );
    }

    if (lotRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lote VIP não encontrado' });
    }
    if (!lot_id && lotRes.rows.length > 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Há mais de um lote VIP neste evento; informe lot_id'
      });
    }

    const lot = lotRes.rows[0];
    if (!lot.event_active) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Evento indisponível' });
    }
    if (lot.active === false) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Lote VIP inativo' });
    }

    const available = Number(lot.quantity_total) - Number(lot.quantity_sold);
    if (qty > available) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Restam apenas ${available} ingresso(s) VIP` });
    }

    const reserve = await client.query(
      `UPDATE ${table('ticket_lots')}
       SET quantity_sold = quantity_sold + $1, updated_at = NOW()
       WHERE id = $2
         AND quantity_sold + $1 <= quantity_total
       RETURNING *`,
      [qty, lot.id]
    );

    if (reserve.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Estoque VIP insuficiente' });
    }

    const orderRes = await client.query(
      `INSERT INTO ${table('ticket_orders')}
        (event_id, lot_id, buyer_name, buyer_email, buyer_phone, quantity, amount, status, source, assignees, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 'paid', 'vip', $7::jsonb, NOW(), NOW())
       RETURNING *`,
      [
        lot.event_id,
        lot.id,
        String(buyer_name).trim(),
        email,
        buyer_phone ? String(buyer_phone).trim() : null,
        qty,
        JSON.stringify(normalized.value)
      ]
    );

    const order = orderRes.rows[0];
    await client.query('COMMIT');

    let fulfill;
    try {
      fulfill = await fulfillPaidOrder(order.id, null);
    } catch (fulfillErr) {
      console.error('Pedido VIP criado, falha ao emitir ingressos:', fulfillErr);
      return res.status(500).json({
        error: 'Pedido criado, mas falha ao emitir ingressos. Tente sincronizar depois.',
        order_id: order.id
      });
    }

    if (!fulfill.ok) {
      return res.status(500).json({
        error: 'Pedido criado, mas falha ao emitir ingressos',
        order_id: order.id
      });
    }

    const tickets = (fulfill.tickets || []).map((t) => ({
      id: t.id,
      code: t.code,
      buyer_name: t.buyer_name,
      buyer_email: t.buyer_email
    }));

    return res.status(201).json({
      order_id: order.id,
      tickets
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('Erro ao emitir VIP:', error);
    res.status(500).json({ error: 'Erro ao emitir ingresso VIP' });
  } finally {
    client.release();
  }
});

// GET /api/tickets — admin
router.get('/', authenticateToken, requirePermission('eventos'), async (req, res) => {
  try {
    const { event_id, status, q, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const where = [];
    const params = [];

    if (event_id) {
      params.push(event_id);
      where.push(`t.event_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${String(q).trim()}%`);
      where.push(
        `(t.code ILIKE $${params.length} OR t.buyer_name ILIKE $${params.length} OR t.buyer_email ILIKE $${params.length})`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM ${table('tickets')} t ${whereSql}`,
      params
    );

    params.push(limitNum, offset);
    const listRes = await query(
      `SELECT t.*, e.title AS event_title, l.name AS lot_name, o.amount AS order_amount
       FROM ${table('tickets')} t
       JOIN ${table('events')} e ON e.id = t.event_id
       JOIN ${table('ticket_lots')} l ON l.id = t.lot_id
       JOIN ${table('ticket_orders')} o ON o.id = t.order_id
       ${whereSql}
       ORDER BY t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      items: listRes.rows.map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        used_at: row.used_at,
        buyer_name: row.buyer_name,
        buyer_email: row.buyer_email,
        event_id: row.event_id,
        event_title: row.event_title,
        lot_id: row.lot_id,
        lot_name: row.lot_name,
        order_id: row.order_id,
        created_at: row.created_at
      })),
      total: countRes.rows[0].total,
      page: pageNum,
      limit: limitNum
    });
  } catch (error) {
    console.error('Erro ao listar ingressos:', error);
    res.status(500).json({ error: 'Erro ao listar ingressos' });
  }
});

// POST /api/tickets/validate — admin
router.post('/validate', authenticateToken, requirePermission('eventos', 'validar'), async (req, res) => {
  try {
    const code = req.body.code ? String(req.body.code).trim().toUpperCase() : '';
    if (!code) {
      return res.status(400).json({ error: 'Código do ingresso é obrigatório' });
    }

    const existing = await query(
      `SELECT t.*, e.title AS event_title, l.name AS lot_name
       FROM ${table('tickets')} t
       JOIN ${table('events')} e ON e.id = t.event_id
       JOIN ${table('ticket_lots')} l ON l.id = t.lot_id
       WHERE UPPER(t.code) = $1`,
      [code]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Ingresso não encontrado', valid: false });
    }

    const ticket = existing.rows[0];

    if (ticket.status === 'used') {
      return res.status(409).json({
        error: 'Ingresso já utilizado',
        valid: false,
        ticket: {
          code: ticket.code,
          status: ticket.status,
          used_at: ticket.used_at,
          buyer_name: ticket.buyer_name,
          event_title: ticket.event_title,
          lot_name: ticket.lot_name
        }
      });
    }

    if (ticket.status === 'cancelled') {
      return res.status(409).json({
        error: 'Ingresso cancelado',
        valid: false,
        ticket: {
          code: ticket.code,
          status: ticket.status,
          buyer_name: ticket.buyer_name,
          event_title: ticket.event_title
        }
      });
    }

    const updated = await query(
      `UPDATE ${table('tickets')}
       SET status = 'used', used_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [ticket.id]
    );

    res.json({
      valid: true,
      message: 'Ingresso validado com sucesso',
      ticket: {
        code: updated.rows[0].code,
        status: updated.rows[0].status,
        used_at: updated.rows[0].used_at,
        buyer_name: updated.rows[0].buyer_name,
        buyer_email: updated.rows[0].buyer_email,
        event_title: ticket.event_title,
        lot_name: ticket.lot_name
      }
    });
  } catch (error) {
    console.error('Erro ao validar ingresso:', error);
    res.status(500).json({ error: 'Erro ao validar ingresso' });
  }
});

// GET /api/tickets/orders/:id — status público simples (retorno do checkout)
router.get('/orders/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, status, quantity, amount, created_at
       FROM ${table('ticket_orders')}
       WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      status: row.status,
      quantity: row.quantity,
      amount: Number(row.amount),
      created_at: row.created_at
    });
  } catch (error) {
    console.error('Erro ao buscar pedido:', error);
    res.status(500).json({ error: 'Erro ao buscar pedido' });
  }
});

// POST /api/tickets/orders/:id/sync — confirma pagamento se webhook atrasou
router.post('/orders/:id/sync', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!orderId) {
      return res.status(400).json({ error: 'Pedido inválido' });
    }

    const orderRes = await query(
      `SELECT id, status, source FROM ${table('ticket_orders')} WHERE id = $1`,
      [orderId]
    );
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const order = orderRes.rows[0];

    if (order.status === 'paid') {
      const ticketCountRes = await query(
        `SELECT COUNT(*)::int AS count FROM ${table('tickets')} WHERE order_id = $1`,
        [orderId]
      );
      const ticketCount = ticketCountRes.rows[0].count;
      if (shouldRefulfillPaidOrder(order, ticketCount)) {
        await fulfillPaidOrder(orderId, null);
        return res.json({ status: 'paid', synced: true });
      }
      return res.json({ status: 'paid', synced: false });
    }

    if (order.status !== 'pending') {
      return res.json({ status: order.status, synced: false });
    }

    const approved = await findApprovedPaymentByOrderId(orderId);
    if (!approved) {
      return res.json({ status: 'pending', synced: false });
    }

    await fulfillPaidOrder(orderId, approved.id);
    return res.json({ status: 'paid', synced: true });
  } catch (error) {
    console.error('Erro ao sincronizar pedido:', error);
    res.status(500).json({ error: 'Erro ao sincronizar pedido' });
  }
});

module.exports = router;
module.exports.fulfillPaidOrder = fulfillPaidOrder;
module.exports.shouldRefulfillPaidOrder = shouldRefulfillPaidOrder;
