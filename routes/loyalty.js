const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const { query, table } = require('../config/database');
const { authenticateToken } = require('../config/auth');
const {
  DEFAULT_VISITS_PER_REWARD,
  normalizePhone,
  mapCustomerRow,
  applyVisitDelta,
  parseNonNegativeInt,
  parseVisitsPerReward,
  parsePaginationQuery,
  parseSearchQuery,
  buildNamePhoneSearchClause,
  participantOrderSql,
  computeTotalPages
} = require('./loyaltyHelpers');

const WINNERS_HALL_LIMIT = 5;

const loyaltyUploadDir = path.join(__dirname, '..', 'uploads', 'loyalty');
fs.mkdirSync(loyaltyUploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, loyaltyUploadDir),
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

function uploadAvatarMiddleware(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Erro no upload' });
    }
    next();
  });
}

async function getVisitsPerReward() {
  const result = await query(
    `SELECT visits_per_reward FROM ${table('loyalty_settings')} WHERE id = 1`
  );
  if (result.rows.length === 0) {
    return DEFAULT_VISITS_PER_REWARD;
  }
  const n = Number(result.rows[0].visits_per_reward);
  return Number.isFinite(n) && n >= 2 ? n : DEFAULT_VISITS_PER_REWARD;
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
    const visits_per_reward = await getVisitsPerReward();
    res.json({ visits_per_reward });
  } catch (error) {
    console.error('Erro ao buscar configurações de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações de fidelidade' });
  }
});

// PUT /api/loyalty/settings — admin
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const parsed = parseVisitsPerReward(req.body?.visits_per_reward);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    await query(
      `INSERT INTO ${table('loyalty_settings')} (id, visits_per_reward)
       VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET visits_per_reward = EXCLUDED.visits_per_reward`,
      [parsed.value]
    );

    res.json({ visits_per_reward: parsed.value });
  } catch (error) {
    console.error('Erro ao atualizar configurações de fidelidade:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações de fidelidade' });
  }
});

// POST /api/loyalty/upload-avatar — admin
router.post('/upload-avatar', authenticateToken, uploadAvatarMiddleware, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  res.status(201).json({ url: `/uploads/loyalty/${req.file.filename}` });
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

// GET /api/loyalty/customers — admin
router.get('/customers', authenticateToken, async (req, res) => {
  try {
    const visitsPerReward = await getVisitsPerReward();
    const { page, limit, offset } = parsePaginationQuery(req.query);
    const search = parseSearchQuery(req.query);
    const searchPart = buildNamePhoneSearchClause(search, 1);
    const baseWhere = `WHERE 1=1${searchPart.clause}`;

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
router.get('/customers/:id', authenticateToken, async (req, res) => {
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

// POST /api/loyalty/customers — admin
router.post('/customers', authenticateToken, async (req, res) => {
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
router.put('/customers/:id', authenticateToken, async (req, res) => {
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
router.delete('/customers/:id', authenticateToken, async (req, res) => {
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

// POST /api/loyalty/customers/:id/visit — admin (delta de visitas, default +1)
router.post('/customers/:id/visit', authenticateToken, async (req, res) => {
  try {
    const visitsPerReward = await getVisitsPerReward();
    const delta = req.body?.delta !== undefined ? Number(req.body.delta) : 1;
    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'Informe um delta válido (número inteiro diferente de zero)' });
    }

    const existing = await query(
      `SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const row = existing.rows[0];
    const { visits, rewards, rewards_earned } = applyVisitDelta(
      row.total_visits,
      row.total_rewards,
      delta,
      visitsPerReward
    );

    const result = await query(
      `UPDATE ${table('loyalty_customers')}
       SET total_visits = $1, total_rewards = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [visits, rewards, req.params.id]
    );

    res.json({
      customer: mapCustomerRow(result.rows[0], { includePhone: true, visitsPerReward }),
      rewards_earned,
      reward_earned: rewards_earned > 0,
      delta_applied: delta,
      visits_per_reward: visitsPerReward
    });
  } catch (error) {
    console.error('Erro ao registrar visita:', error);
    res.status(500).json({ error: 'Erro ao registrar visita' });
  }
});

module.exports = router;
