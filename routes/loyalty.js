const express = require('express');
const router = express.Router();
const { query, table, getClient } = require('../config/database');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../config/auth');
const {
  DEFAULT_VISITS_PER_REWARD,
  DEFAULT_ACCESS_VALUE,
  normalizePhone,
  mapCustomerRow,
  applyVisitDelta,
  insertVisitEvents,
  mapVisitEventRow,
  parseNonNegativeInt,
  parseVisitsPerReward,
  parseAccessValue,
  parsePaginationQuery,
  parseSearchQuery,
  buildNamePhoneSearchClause,
  participantOrderSql,
  computeTotalPages
} = require('./loyaltyHelpers');
const { createImageUploadMiddleware } = require('../middleware/imageUpload');

const WINNERS_HALL_LIMIT = 5;

const uploadAvatarMiddleware = createImageUploadMiddleware('loyalty');

async function getVisitsPerReward() {
  const settings = await getLoyaltySettings();
  return settings.visits_per_reward;
}

async function getLoyaltySettings() {
  const result = await query(
    `SELECT visits_per_reward, access_value FROM ${table('loyalty_settings')} WHERE id = 1`
  );
  if (result.rows.length === 0) {
    return {
      visits_per_reward: DEFAULT_VISITS_PER_REWARD,
      access_value: DEFAULT_ACCESS_VALUE
    };
  }
  const row = result.rows[0];
  const visits = Number(row.visits_per_reward);
  const access = Number(row.access_value);
  return {
    visits_per_reward: Number.isFinite(visits) && visits >= 2 ? visits : DEFAULT_VISITS_PER_REWARD,
    access_value: Number.isFinite(access) && access > 0 ? access : DEFAULT_ACCESS_VALUE
  };
}

function mapPublicRankingItem(item) {
  return {
    display_name: item.display_name,
    avatar: item.avatar,
    progress: item.display_progress,
    cycle_complete: item.cycle_complete,
    visits_to_reward: item.visits_to_reward,
    total_rewards: item.total_rewards,
    total_visits: item.total_visits
  };
}

function mapPublicWinnerItem(item) {
  return {
    display_name: item.display_name,
    avatar: item.avatar,
    total_rewards: item.total_rewards,
    total_visits: item.total_visits
  };
}

// GET /api/loyalty/settings — público
router.get('/settings', async (req, res) => {
  try {
    const settings = await getLoyaltySettings();
    res.json(settings);
  } catch (error) {
    console.error('Erro ao buscar configurações de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações de fidelidade' });
  }
});

// PUT /api/loyalty/settings — admin
router.put('/settings', authenticateToken, requirePermission('fidelidade'), async (req, res) => {
  try {
    const parsedVisits = parseVisitsPerReward(req.body?.visits_per_reward);
    if (parsedVisits.error) {
      return res.status(400).json({ error: parsedVisits.error });
    }

    const parsedAccess = parseAccessValue(req.body?.access_value);
    if (parsedAccess.error) {
      return res.status(400).json({ error: parsedAccess.error });
    }

    await query(
      `INSERT INTO ${table('loyalty_settings')} (id, visits_per_reward, access_value)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET
         visits_per_reward = EXCLUDED.visits_per_reward,
         access_value = EXCLUDED.access_value`,
      [parsedVisits.value, parsedAccess.value]
    );

    res.json({
      visits_per_reward: parsedVisits.value,
      access_value: parsedAccess.value
    });
  } catch (error) {
    console.error('Erro ao atualizar configurações de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações de fidelidade' });
  }
});

// POST /api/loyalty/upload-avatar — admin; salva no banco
router.post('/upload-avatar', authenticateToken, requirePermission('fidelidade'), uploadAvatarMiddleware, (req, res) => {
  res.status(201).json({ url: req.savedMedia.url, id: req.savedMedia.id });
});

// GET /api/loyalty/rankings — público
router.get('/rankings', async (req, res) => {
  try {
    const visitsPerReward = await getVisitsPerReward();
    const { page, limit, offset } = parsePaginationQuery(req.query);
    const search = parseSearchQuery(req.query);
    const searchPart = buildNamePhoneSearchClause(search, 1);
    const baseWhere = `WHERE active = true${searchPart.clause}`;

    const countResult = await query(
      `SELECT COUNT(*)::int AS cnt FROM ${table('loyalty_customers')} ${baseWhere}`,
      searchPart.values
    );
    const participantsTotal = countResult.rows[0]?.cnt ?? 0;
    const totalPages = computeTotalPages(participantsTotal, limit);

    const orderSql = participantOrderSql(visitsPerReward);
    const listValues = [...searchPart.values, limit, offset];
    const limitIdx = searchPart.values.length + 1;
    const offsetIdx = searchPart.values.length + 2;

    const participantsResult = await query(
      `SELECT * FROM ${table('loyalty_customers')}
       ${baseWhere}
       ORDER BY ${orderSql}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listValues
    );

    const inProgress = participantsResult.rows.map(row =>
      mapPublicRankingItem(mapCustomerRow(row, { visitsPerReward }))
    );

    const winnersCountResult = await query(
      `SELECT COUNT(*)::int AS cnt FROM ${table('loyalty_customers')}
       WHERE active = true AND total_rewards >= 1`
    );
    const winnersTotal = winnersCountResult.rows[0]?.cnt ?? 0;

    const winnersResult = await query(
      `SELECT * FROM ${table('loyalty_customers')}
       WHERE active = true AND total_rewards >= 1
       ORDER BY total_rewards DESC, total_visits DESC, name ASC
       LIMIT ${WINNERS_HALL_LIMIT}`
    );

    const winners = winnersResult.rows.map(row =>
      mapPublicWinnerItem(mapCustomerRow(row, { visitsPerReward }))
    );

    res.json({
      in_progress: inProgress,
      winners,
      visits_per_reward: visitsPerReward,
      participants_total: participantsTotal,
      winners_total: winnersTotal,
      page,
      limit,
      total_pages: totalPages
    });
  } catch (error) {
    console.error('Erro ao buscar rankings de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao buscar rankings de fidelidade' });
  }
});

// GET /api/loyalty/customers — admin (fidelidade ou vendas/diário)
router.get('/customers', authenticateToken, requireAnyPermission('fidelidade', 'vendas'), async (req, res) => {
  try {
    const visitsPerReward = await getVisitsPerReward();
    const { page, limit, offset } = parsePaginationQuery(req.query);
    const search = parseSearchQuery(req.query);
    const searchPart = buildNamePhoneSearchClause(search, 1);
    const activeOnly = ['1', 'true', 'yes'].includes(String(req.query.active || '').toLowerCase());
    const activeClause = activeOnly ? ' AND active IS DISTINCT FROM false' : '';
    const baseWhere = `WHERE 1=1${searchPart.clause}${activeClause}`;

    const countResult = await query(
      `SELECT COUNT(*)::int AS cnt FROM ${table('loyalty_customers')} ${baseWhere}`,
      searchPart.values
    );
    const total = countResult.rows[0]?.cnt ?? 0;
    const totalPages = computeTotalPages(total, limit);

    const listValues = [...searchPart.values, limit, offset];
    const limitIdx = searchPart.values.length + 1;
    const offsetIdx = searchPart.values.length + 2;

    const result = await query(
      `SELECT * FROM ${table('loyalty_customers')}
       ${baseWhere}
       ORDER BY name ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listValues
    );

    res.json({
      items: result.rows.map(row =>
        mapCustomerRow(row, { includePhone: true, visitsPerReward })
      ),
      total,
      page,
      limit,
      total_pages: totalPages
    });
  } catch (error) {
    console.error('Erro ao buscar clientes de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes de fidelidade' });
  }
});

// GET /api/loyalty/customers/:id — admin
router.get('/customers/:id', authenticateToken, requirePermission('fidelidade'), async (req, res) => {
  try {
    const visitsPerReward = await getVisitsPerReward();
    const result = await query(
      `SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }
    res.json(mapCustomerRow(result.rows[0], { includePhone: true, visitsPerReward }));
  } catch (error) {
    console.error('Erro ao buscar cliente de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao buscar cliente de fidelidade' });
  }
});

// POST /api/loyalty/customers — admin (fidelidade ou cadastro rápido no diário)
router.post('/customers', authenticateToken, requireAnyPermission('fidelidade', 'vendas'), async (req, res) => {
  try {
    const visitsPerReward = await getVisitsPerReward();
    const { name, phone, avatar, total_visits, total_rewards } = req.body;
    const trimmedName = String(name || '').trim();
    const normalizedPhone = normalizePhone(phone);

    if (!trimmedName) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    if (!normalizedPhone || normalizedPhone.length < 10) {
      return res.status(400).json({ error: 'Telefone inválido (mínimo 10 dígitos)' });
    }

    const visitsParsed = parseNonNegativeInt(total_visits, 'total_visits');
    if (visitsParsed?.error) return res.status(400).json({ error: visitsParsed.error });
    const rewardsParsed = parseNonNegativeInt(total_rewards, 'total_rewards');
    if (rewardsParsed?.error) return res.status(400).json({ error: rewardsParsed.error });

    const existing = await query(
      `SELECT id FROM ${table('loyalty_customers')} WHERE phone = $1`,
      [normalizedPhone]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um cliente com este telefone' });
    }

    const result = await query(
      `INSERT INTO ${table('loyalty_customers')}
       (name, phone, avatar, total_visits, total_rewards, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
      [
        trimmedName,
        normalizedPhone,
        avatar || null,
        visitsParsed?.value ?? 0,
        rewardsParsed?.value ?? 0
      ]
    );

    res.status(201).json(mapCustomerRow(result.rows[0], { includePhone: true, visitsPerReward }));
  } catch (error) {
    console.error('Erro ao criar cliente de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao criar cliente de fidelidade' });
  }
});

// PUT /api/loyalty/customers/:id — admin
router.put('/customers/:id', authenticateToken, requirePermission('fidelidade'), async (req, res) => {
  try {
    const visitsPerReward = await getVisitsPerReward();
    const { name, phone, active, avatar, total_visits, total_rewards } = req.body;

    const existing = await query(
      `SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'Nome é obrigatório' });
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(trimmedName);
    }
    if (phone !== undefined) {
      const normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone || normalizedPhone.length < 10) {
        return res.status(400).json({ error: 'Telefone inválido (mínimo 10 dígitos)' });
      }
      const dup = await query(
        `SELECT id FROM ${table('loyalty_customers')} WHERE phone = $1 AND id != $2`,
        [normalizedPhone, req.params.id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Já existe outro cliente com este telefone' });
      }
      updates.push(`phone = $${paramIndex++}`);
      values.push(normalizedPhone);
    }
    if (avatar !== undefined) {
      updates.push(`avatar = $${paramIndex++}`);
      values.push(avatar || null);
    }
    if (total_visits !== undefined) {
      const parsed = parseNonNegativeInt(total_visits, 'total_visits');
      if (parsed?.error) return res.status(400).json({ error: parsed.error });
      updates.push(`total_visits = $${paramIndex++}`);
      values.push(parsed.value);
    }
    if (total_rewards !== undefined) {
      const parsed = parseNonNegativeInt(total_rewards, 'total_rewards');
      if (parsed?.error) return res.status(400).json({ error: parsed.error });
      updates.push(`total_rewards = $${paramIndex++}`);
      values.push(parsed.value);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(active !== false);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    const result = await query(
      `UPDATE ${table('loyalty_customers')} SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json(mapCustomerRow(result.rows[0], { includePhone: true, visitsPerReward }));
  } catch (error) {
    console.error('Erro ao atualizar cliente de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao atualizar cliente de fidelidade' });
  }
});

// DELETE /api/loyalty/customers/:id — admin
router.delete('/customers/:id', authenticateToken, requirePermission('fidelidade'), async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM ${table('loyalty_customers')} WHERE id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }
    res.json({ message: 'Cliente removido com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir cliente de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao excluir cliente de fidelidade' });
  }
});

// GET /api/loyalty/customers/:id/visits — histórico de visitas (admin)
router.get('/customers/:id/visits', authenticateToken, requirePermission('fidelidade'), async (req, res) => {
  try {
    const visitsPerReward = await getVisitsPerReward();
    let limit = parseInt(String(req.query?.limit), 10);
    if (Number.isNaN(limit) || limit < 1) limit = 30;
    if (limit > 50) limit = 50;

    const existing = await query(
      `SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const customer = existing.rows[0];
    const summaryResult = await query(
      `SELECT
         COUNT(*)::int AS total_events,
         COALESCE(SUM(CASE WHEN delta > 0 THEN 1 ELSE 0 END), 0)::int AS added,
         COALESCE(SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END), 0)::int AS removed
       FROM ${table('loyalty_visit_events')}
       WHERE customer_id = $1`,
      [req.params.id]
    );
    const eventsResult = await query(
      `SELECT id, delta, source, created_at
       FROM ${table('loyalty_visit_events')}
       WHERE customer_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [req.params.id, limit]
    );

    const summaryRow = summaryResult.rows[0] || {};
    res.json({
      customer: mapCustomerRow(customer, { includePhone: true, visitsPerReward }),
      summary: {
        total_events: summaryRow.total_events || 0,
        added: summaryRow.added || 0,
        removed: summaryRow.removed || 0,
        last_positive_visit_at: customer.last_positive_visit_at
          ? new Date(customer.last_positive_visit_at).toISOString()
          : null
      },
      events: eventsResult.rows.map(mapVisitEventRow)
    });
  } catch (error) {
    console.error('Erro ao buscar histórico de visitas:', error);
    res.status(500).json({ error: 'Erro ao buscar histórico de visitas' });
  }
});

// POST /api/loyalty/customers/:id/visit — admin (delta de visitas, default +1)
router.post('/customers/:id/visit', authenticateToken, requirePermission('fidelidade'), async (req, res) => {
  const client = await getClient();
  try {
    const visitsPerReward = await getVisitsPerReward();
    const delta = req.body?.delta !== undefined ? Number(req.body.delta) : 1;
    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'Informe um delta válido (número inteiro diferente de zero)' });
    }

    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM ${table('loyalty_customers')} WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const row = existing.rows[0];
    const { visits, rewards, rewards_earned, delta_applied } = applyVisitDelta(
      row.total_visits,
      row.total_rewards,
      delta,
      visitsPerReward
    );

    const visitsChanged = delta_applied !== 0;
    const positiveVisit = delta_applied > 0;
    const result = await client.query(
      `UPDATE ${table('loyalty_customers')}
       SET total_visits = $1,
           total_rewards = $2,
           updated_at = NOW()
           ${visitsChanged ? ', last_visit_at = NOW()' : ''}
           ${positiveVisit ? ', last_positive_visit_at = NOW()' : ''}
       WHERE id = $3
       RETURNING *`,
      [visits, rewards, req.params.id]
    );

    if (visitsChanged) {
      await insertVisitEvents(client, req.params.id, delta_applied, 'admin');
    }

    await client.query('COMMIT');

    res.json({
      customer: mapCustomerRow(result.rows[0], { includePhone: true, visitsPerReward }),
      rewards_earned,
      reward_earned: rewards_earned > 0,
      delta_applied,
      visits_per_reward: visitsPerReward
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao registrar visita:', error);
    res.status(500).json({ error: 'Erro ao registrar visita' });
  } finally {
    client.release();
  }
});

module.exports = router;
