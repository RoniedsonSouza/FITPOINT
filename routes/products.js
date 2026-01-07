const express = require('express');
const router = express.Router();
const { query, table } = require('../config/database');
const { authenticateToken } = require('../config/auth');

// GET /api/products - Listar todos os produtos (público)
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM ${table('products')} ORDER BY created_at DESC`
    );
    
    const products = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      category: row.category,
      tags: row.tags || [],
      image: row.image,
      active: row.active
    }));
    
    res.json(products);
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

// GET /api/products/:id - Buscar produto por ID (público)
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM ${table('products')} WHERE id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    const row = result.rows[0];
    const product = {
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      category: row.category,
      tags: row.tags || [],
      image: row.image,
      active: row.active
    };
    
    res.json(product);
  } catch (error) {
    console.error('Erro ao buscar produto:', error);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
});

// POST /api/products - Criar novo produto (requer autenticação)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { id, name, price, category, tags = [], image, active = true } = req.body;

    if (!id || !name || price === undefined || !category) {
      return res.status(400).json({ error: 'Campos obrigatórios: id, name, price, category' });
    }

    // Verificar se já existe
    const existing = await query(
      `SELECT id FROM ${table('products')} WHERE id = $1`,
      [id]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Produto com ID "${id}" já existe` });
    }

    await query(
      `INSERT INTO ${table('products')} (id, name, price, category, tags, image, active, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [id, name, price, category, JSON.stringify(tags), image || null, active]
    );

    res.status(201).json({ message: 'Produto criado com sucesso', id });
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro ao criar produto' });
  }
});

// PUT /api/products/:id - Atualizar produto (requer autenticação)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { name, price, category, tags, image, active } = req.body;

    // Verificar se existe
    const existing = await query(
      `SELECT id FROM ${table('products')} WHERE id = $1`,
      [req.params.id]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    // Montar query dinamicamente
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (price !== undefined) {
      updates.push(`price = $${paramIndex++}`);
      values.push(price);
    }
    if (category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(category);
    }
    if (tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(tags));
    }
    if (image !== undefined) {
      updates.push(`image = $${paramIndex++}`);
      values.push(image);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    await query(
      `UPDATE ${table('products')} SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    res.json({ message: 'Produto atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
});

// DELETE /api/products/:id - Deletar produto (requer autenticação)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM ${table('products')} WHERE id = $1`,
      [req.params.id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    res.json({ message: 'Produto deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar produto:', error);
    res.status(500).json({ error: 'Erro ao deletar produto' });
  }
});

module.exports = router;
