const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const { query, table } = require('../config/database');
const { authenticateToken } = require('../config/auth');

const productsUploadDir = path.join(__dirname, '..', 'uploads', 'products');
fs.mkdirSync(productsUploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, productsUploadDir),
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

function uploadProductImageMiddleware(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.message || 'Erro no upload';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

// POST /api/products/upload-image — enviar imagem (autenticado)
router.post('/upload-image', authenticateToken, uploadProductImageMiddleware, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  const url = `/uploads/products/${req.file.filename}`;
  res.status(201).json({ url });
});

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
      promo_price: row.promo_price != null ? parseFloat(row.promo_price) : null,
      is_kit: row.is_kit === true,
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
      promo_price: row.promo_price != null ? parseFloat(row.promo_price) : null,
      is_kit: row.is_kit === true,
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
    const { id, name, price, category, tags = [], image, active = true, promo_price, is_kit = false } = req.body;

    if (!id || !name || price === undefined || !category) {
      return res.status(400).json({ error: 'Campos obrigatórios: id, name, price, category' });
    }

    let promoVal = null;
    if (promo_price !== undefined && promo_price !== null && promo_price !== '') {
      const p = parseFloat(promo_price);
      if (Number.isNaN(p) || p < 0) {
        return res.status(400).json({ error: 'preço promocional inválido' });
      }
      const base = parseFloat(price);
      if (!Number.isNaN(base) && p >= base) {
        return res.status(400).json({ error: 'O preço promocional deve ser menor que o preço normal' });
      }
      promoVal = p;
    }

    // Verificar se já existe
    const existing = await query(
      `SELECT id FROM ${table('products')} WHERE id = $1`,
      [id]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Produto com ID "${id}" já existe` });
    }

    const kitVal = is_kit === true || is_kit === 1 || is_kit === 'true';

    await query(
      `INSERT INTO ${table('products')} (id, name, price, category, tags, image, active, promo_price, is_kit, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [id, name, price, category, JSON.stringify(tags), image || null, active, promoVal, kitVal]
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
    const { name, price, category, tags, image, active, promo_price, is_kit } = req.body;

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
    if (is_kit !== undefined) {
      updates.push(`is_kit = $${paramIndex++}`);
      values.push(is_kit === true || is_kit === 1 || is_kit === 'true');
    }
    if (promo_price !== undefined) {
      if (promo_price === null || promo_price === '') {
        updates.push(`promo_price = $${paramIndex++}`);
        values.push(null);
      } else {
        const p = parseFloat(promo_price);
        if (Number.isNaN(p) || p < 0) {
          return res.status(400).json({ error: 'preço promocional inválido' });
        }
        const base = price !== undefined ? parseFloat(price) : null;
        if (base != null && !Number.isNaN(base) && p >= base) {
          return res.status(400).json({ error: 'O preço promocional deve ser menor que o preço normal' });
        }
        if (base == null && price === undefined) {
          const cur = await query(
            `SELECT price FROM ${table('products')} WHERE id = $1`,
            [req.params.id]
          );
          if (cur.rows.length && parseFloat(cur.rows[0].price) <= p) {
            return res.status(400).json({ error: 'O preço promocional deve ser menor que o preço normal' });
          }
        }
        updates.push(`promo_price = $${paramIndex++}`);
        values.push(p);
      }
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
