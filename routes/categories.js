const express = require('express');
const router = express.Router();
const { query, table } = require('../config/database');
const { authenticateToken, requireSuperAdmin } = require('../config/auth');

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'categoria';
}

function mapCategoryRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sort_order: row.sort_order != null ? Number(row.sort_order) : 0,
    active: row.active !== false
  };
}

// GET /api/categories — listar (público)
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM ${table('categories')} ORDER BY sort_order ASC, name ASC`
    );
    res.json(result.rows.map(mapCategoryRow));
  } catch (error) {
    console.error('Erro ao buscar categorias:', error);
    res.status(500).json({ error: 'Erro ao buscar categorias' });
  }
});

// POST /api/categories — criar (autenticado)
router.post('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, sort_order = 0, active = true } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
    }
    const trimmedName = String(name).trim();
    const slug = slugify(trimmedName);

    const existing = await query(
      `SELECT id FROM ${table('categories')} WHERE name = $1 OR slug = $2`,
      [trimmedName, slug]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Categoria já existe' });
    }

    const result = await query(
      `INSERT INTO ${table('categories')} (name, slug, sort_order, active, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [trimmedName, slug, Number(sort_order) || 0, active !== false]
    );

    res.status(201).json(mapCategoryRow(result.rows[0]));
  } catch (error) {
    console.error('Erro ao criar categoria:', error);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

// PUT /api/categories/:id — atualizar (autenticado)
router.put('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, sort_order, active } = req.body;

    const existing = await query(
      `SELECT * FROM ${table('categories')} WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
      }
      const slug = slugify(trimmedName);
      const dup = await query(
        `SELECT id FROM ${table('categories')} WHERE (name = $1 OR slug = $2) AND id != $3`,
        [trimmedName, slug, req.params.id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Já existe outra categoria com este nome' });
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(trimmedName);
      updates.push(`slug = $${paramIndex++}`);
      values.push(slug);
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = $${paramIndex++}`);
      values.push(Number(sort_order) || 0);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(active !== false);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    values.push(req.params.id);
    const result = await query(
      `UPDATE ${table('categories')} SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json(mapCategoryRow(result.rows[0]));
  } catch (error) {
    console.error('Erro ao atualizar categoria:', error);
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

// DELETE /api/categories/:id — excluir (autenticado)
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const cat = await query(
      `SELECT name FROM ${table('categories')} WHERE id = $1`,
      [req.params.id]
    );
    if (cat.rows.length === 0) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    const products = await query(
      `SELECT COUNT(*)::int AS cnt FROM ${table('products')} WHERE category = $1`,
      [cat.rows[0].name]
    );
    if (products.rows[0].cnt > 0) {
      return res.status(409).json({
        error: `Não é possível excluir: ${products.rows[0].cnt} produto(s) usam esta categoria`
      });
    }

    await query(`DELETE FROM ${table('categories')} WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Categoria excluída com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir categoria:', error);
    res.status(500).json({ error: 'Erro ao excluir categoria' });
  }
});

module.exports = router;
