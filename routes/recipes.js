const express = require('express');
const router = express.Router();
const { query, table } = require('../config/database');
const { authenticateToken } = require('../config/auth');

// GET /api/recipes - Listar todas as receitas (público)
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM ${table('recipes')} ORDER BY created_at DESC`
    );
    
    const recipes = result.rows.map(row => ({
      slug: row.slug,
      title: row.title,
      image: row.image,
      time: row.time,
      servings: row.servings,
      kcal: row.kcal,
      protein_g: row.protein_g,
      steps: row.steps || [],
      tips: row.tips || []
    }));
    
    res.json(recipes);
  } catch (error) {
    console.error('Erro ao buscar receitas:', error);
    res.status(500).json({ error: 'Erro ao buscar receitas' });
  }
});

// GET /api/recipes/:slug - Buscar receita por slug (público)
router.get('/:slug', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM ${table('recipes')} WHERE slug = $1`,
      [req.params.slug]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Receita não encontrada' });
    }
    
    const row = result.rows[0];
    const recipe = {
      slug: row.slug,
      title: row.title,
      image: row.image,
      time: row.time,
      servings: row.servings,
      kcal: row.kcal,
      protein_g: row.protein_g,
      steps: row.steps || [],
      tips: row.tips || []
    };
    
    res.json(recipe);
  } catch (error) {
    console.error('Erro ao buscar receita:', error);
    res.status(500).json({ error: 'Erro ao buscar receita' });
  }
});

// POST /api/recipes - Criar nova receita (requer autenticação)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { slug, title, image, time, servings = 1, kcal, protein_g = 0, steps = [], tips = [] } = req.body;

    if (!slug || !title) {
      return res.status(400).json({ error: 'Campos obrigatórios: slug, title' });
    }

    // Verificar se já existe
    const existing = await query(
      `SELECT slug FROM ${table('recipes')} WHERE slug = $1`,
      [slug]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Receita com slug "${slug}" já existe` });
    }

    await query(
      `INSERT INTO ${table('recipes')} (slug, title, image, time, servings, kcal, protein_g, steps, tips, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        slug,
        title,
        image || null,
        time || null,
        servings,
        kcal || null,
        protein_g,
        JSON.stringify(steps),
        JSON.stringify(tips)
      ]
    );

    res.status(201).json({ message: 'Receita criada com sucesso', slug });
  } catch (error) {
    console.error('Erro ao criar receita:', error);
    res.status(500).json({ error: 'Erro ao criar receita' });
  }
});

// PUT /api/recipes/:slug - Atualizar receita (requer autenticação)
router.put('/:slug', authenticateToken, async (req, res) => {
  try {
    const { title, image, time, servings, kcal, protein_g, steps, tips } = req.body;

    // Verificar se existe
    const existing = await query(
      `SELECT slug FROM ${table('recipes')} WHERE slug = $1`,
      [req.params.slug]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Receita não encontrada' });
    }

    // Montar query dinamicamente
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (image !== undefined) {
      updates.push(`image = $${paramIndex++}`);
      values.push(image);
    }
    if (time !== undefined) {
      updates.push(`time = $${paramIndex++}`);
      values.push(time);
    }
    if (servings !== undefined) {
      updates.push(`servings = $${paramIndex++}`);
      values.push(servings);
    }
    if (kcal !== undefined) {
      updates.push(`kcal = $${paramIndex++}`);
      values.push(kcal);
    }
    if (protein_g !== undefined) {
      updates.push(`protein_g = $${paramIndex++}`);
      values.push(protein_g);
    }
    if (steps !== undefined) {
      updates.push(`steps = $${paramIndex++}`);
      values.push(JSON.stringify(steps));
    }
    if (tips !== undefined) {
      updates.push(`tips = $${paramIndex++}`);
      values.push(JSON.stringify(tips));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.slug);

    await query(
      `UPDATE ${table('recipes')} SET ${updates.join(', ')} WHERE slug = $${paramIndex}`,
      values
    );

    res.json({ message: 'Receita atualizada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar receita:', error);
    res.status(500).json({ error: 'Erro ao atualizar receita' });
  }
});

// DELETE /api/recipes/:slug - Deletar receita (requer autenticação)
router.delete('/:slug', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM ${table('recipes')} WHERE slug = $1`,
      [req.params.slug]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Receita não encontrada' });
    }
    
    res.json({ message: 'Receita deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar receita:', error);
    res.status(500).json({ error: 'Erro ao deletar receita' });
  }
});

module.exports = router;
