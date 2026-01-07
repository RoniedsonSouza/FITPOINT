const express = require('express');
const router = express.Router();
const { query, table } = require('../config/database');
const { comparePassword, generateToken, hashPassword } = require('../config/auth');

// POST /api/auth/login - Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username e senha são obrigatórios' });
    }

    // Buscar usuário
    const result = await query(
      `SELECT id, username, password_hash FROM ${table('admin_users')} WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];

    // Verificar senha
    const isValidPassword = await comparePassword(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Gerar token
    const token = generateToken({ id: user.id, username: user.username });

    res.json({
      message: 'Login realizado com sucesso',
      token,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao realizar login' });
  }
});

// POST /api/auth/register - Criar admin (apenas para setup inicial)
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username e senha são obrigatórios' });
    }

    // Verificar se já existe
    const existing = await query(
      `SELECT id FROM ${table('admin_users')} WHERE username = $1`,
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Usuário já existe' });
    }

    // Criar hash da senha
    const passwordHash = await hashPassword(password);

    // Inserir usuário
    const result = await query(
      `INSERT INTO ${table('admin_users')} (username, password_hash) VALUES ($1, $2) RETURNING id, username`,
      [username, passwordHash]
    );

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

module.exports = router;
