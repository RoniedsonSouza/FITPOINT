const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { query, table } = require('../config/database');
const {
  authenticateToken,
  requirePermission,
  JWT_SECRET,
  loadUserById,
  userHasPermission
} = require('../config/auth');
const { createImageUploadMiddleware } = require('../middleware/imageUpload');

const HERBALIFE_LEVELS = [
  'Distribuidor Independente',
  'Consultor Sênior',
  'Construtor de Sucesso',
  'Produtor Qualificado',
  'Supervisor',
  'Supervisor Equipe Mundial',
  'Equipe GET',
  'Equipe GET 2.500',
  'Equipe de Milionário',
  'Equipe de Milionário 7.500',
  'Equipe de Presidente',
  'Equipe de Presidente 15K',
  'Equipe de Presidente 20K',
  'Equipe de Presidente 30K',
  'Equipe de Presidente 40K',
  'Equipe de Presidente 50K',
  'Equipe de Presidente 60K',
  'Equipe de Presidente 70K',
  'Equipe de Presidente 80K',
  'Equipe de Presidente 90K'
];

const uploadPhotoMiddleware = createImageUploadMiddleware('distributors');

function mapDistributorRow(row) {
  return {
    id: row.id,
    name: row.name,
    photo_url: row.photo_url || null,
    herbalife_level: row.herbalife_level,
    region_label: row.region_label,
    lat: Number(row.lat),
    lng: Number(row.lng),
    whatsapp: row.whatsapp || null,
    phone: row.phone || null,
    instagram: row.instagram || null,
    description: row.description || null,
    active: row.active !== false,
    sort_order: row.sort_order != null ? Number(row.sort_order) : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function trimOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function parseCoord(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { error: `${label} inválida` };
  }
  return { value: n };
}

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || body.name !== undefined) {
    const name = trimOrNull(body.name);
    if (!name) errors.push('Nome é obrigatório');
    else data.name = name.slice(0, 120);
  }

  if (!partial || body.herbalife_level !== undefined) {
    const level = trimOrNull(body.herbalife_level);
    if (!level) errors.push('Nível Herbalife é obrigatório');
    else if (!HERBALIFE_LEVELS.includes(level)) errors.push('Nível Herbalife inválido');
    else data.herbalife_level = level;
  }

  if (!partial || body.region_label !== undefined) {
    const region = trimOrNull(body.region_label);
    if (!region) errors.push('Região / área de atuação é obrigatória');
    else data.region_label = region.slice(0, 200);
  }

  if (!partial || body.lat !== undefined) {
    const lat = parseCoord(body.lat, 'Latitude');
    if (lat.error) errors.push(lat.error);
    else data.lat = lat.value;
  }

  if (!partial || body.lng !== undefined) {
    const lng = parseCoord(body.lng, 'Longitude');
    if (lng.error) errors.push(lng.error);
    else data.lng = lng.value;
  }

  if (!partial || body.photo_url !== undefined) {
    data.photo_url = trimOrNull(body.photo_url);
  }
  if (!partial || body.whatsapp !== undefined) {
    data.whatsapp = trimOrNull(body.whatsapp);
    if (data.whatsapp) data.whatsapp = data.whatsapp.slice(0, 30);
  }
  if (!partial || body.phone !== undefined) {
    data.phone = trimOrNull(body.phone);
    if (data.phone) data.phone = data.phone.slice(0, 30);
  }
  if (!partial || body.instagram !== undefined) {
    data.instagram = trimOrNull(body.instagram);
    if (data.instagram) data.instagram = data.instagram.slice(0, 120);
  }
  if (!partial || body.description !== undefined) {
    data.description = trimOrNull(body.description);
  }
  if (!partial || body.active !== undefined) {
    data.active = body.active !== false && body.active !== 'false';
  }
  if (!partial || body.sort_order !== undefined) {
    data.sort_order = Number(body.sort_order) || 0;
  }

  if (errors.length) return { error: errors[0] };
  return { data };
}

async function tryAdminFromAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  try {
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const row = await loadUserById(payload.id);
    if (!row || row.active === false) return false;
    const user = {
      id: row.id,
      isSuperAdmin: !!row.is_super_admin,
      permissions: row.permissions
    };
    return userHasPermission(user, 'distribuidores');
  } catch (_) {
    return false;
  }
}

// GET /api/distributors/levels — lista de níveis Herbalife
router.get('/levels', (req, res) => {
  res.json(HERBALIFE_LEVELS);
});

// POST /api/distributors/upload-photo — admin; salva no banco
router.post(
  '/upload-photo',
  authenticateToken,
  requirePermission('distribuidores'),
  uploadPhotoMiddleware,
  (req, res) => {
    res.status(201).json({ url: req.savedMedia.url, id: req.savedMedia.id });
  }
);

// GET /api/distributors — público: só ativos; admin com ?all=1 vê todos
router.get('/', async (req, res) => {
  try {
    const wantAll = req.query.all === '1' || req.query.all === 'true';
    let isAdmin = false;
    if (wantAll && req.headers.authorization) {
      isAdmin = await tryAdminFromAuth(req);
    }

    const sql = isAdmin
      ? `SELECT * FROM ${table('distributors')} ORDER BY sort_order ASC, name ASC, id ASC`
      : `SELECT * FROM ${table('distributors')} WHERE active = true ORDER BY sort_order ASC, name ASC, id ASC`;

    const result = await query(sql);
    res.json(result.rows.map(mapDistributorRow));
  } catch (error) {
    console.error('Erro ao buscar distribuidores:', error);
    res.status(500).json({ error: 'Erro ao buscar distribuidores' });
  }
});

// POST /api/distributors — criar
router.post('/', authenticateToken, requirePermission('distribuidores'), async (req, res) => {
  try {
    const validated = validatePayload(req.body, { partial: false });
    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }
    const d = validated.data;

    const result = await query(
      `INSERT INTO ${table('distributors')}
        (name, photo_url, herbalife_level, region_label, lat, lng,
         whatsapp, phone, instagram, description, active, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW(), NOW())
       RETURNING *`,
      [
        d.name,
        d.photo_url || null,
        d.herbalife_level,
        d.region_label,
        d.lat,
        d.lng,
        d.whatsapp || null,
        d.phone || null,
        d.instagram || null,
        d.description || null,
        d.active !== false,
        d.sort_order || 0
      ]
    );

    res.status(201).json(mapDistributorRow(result.rows[0]));
  } catch (error) {
    console.error('Erro ao criar distribuidor:', error);
    res.status(500).json({ error: 'Erro ao criar distribuidor' });
  }
});

// PUT /api/distributors/:id — atualizar
router.put('/:id', authenticateToken, requirePermission('distribuidores'), async (req, res) => {
  try {
    const existing = await query(
      `SELECT * FROM ${table('distributors')} WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Distribuidor não encontrado' });
    }

    const validated = validatePayload(req.body, { partial: true });
    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }

    const d = validated.data;
    const updates = [];
    const values = [];
    let i = 1;

    const fields = [
      'name', 'photo_url', 'herbalife_level', 'region_label', 'lat', 'lng',
      'whatsapp', 'phone', 'instagram', 'description', 'active', 'sort_order'
    ];
    for (const field of fields) {
      if (d[field] !== undefined) {
        updates.push(`${field} = $${i++}`);
        values.push(d[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    const result = await query(
      `UPDATE ${table('distributors')} SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    res.json(mapDistributorRow(result.rows[0]));
  } catch (error) {
    console.error('Erro ao atualizar distribuidor:', error);
    res.status(500).json({ error: 'Erro ao atualizar distribuidor' });
  }
});

// DELETE /api/distributors/:id — excluir
router.delete('/:id', authenticateToken, requirePermission('distribuidores'), async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM ${table('distributors')} WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Distribuidor não encontrado' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir distribuidor:', error);
    res.status(500).json({ error: 'Erro ao excluir distribuidor' });
  }
});

module.exports = router;
module.exports.HERBALIFE_LEVELS = HERBALIFE_LEVELS;
