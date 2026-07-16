const express = require('express');
const router = express.Router();
const { query, table } = require('../config/database');
const {
  comparePassword,
  generateToken,
  hashPassword,
  authenticateToken,
  requireSuperAdmin,
  DEFAULT_PASSWORD,
  normalizePermissions,
  publicUser,
  loadUserByLogin,
  loadUserById,
  isValidEmail
} = require('../config/auth');

function userResponse(row) {
  return publicUser(row);
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const login = (req.body.email || req.body.username || '').trim();
    const { password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const user = await loadUserByLogin(login);

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    if (user.active === false) {
      return res.status(403).json({ error: 'Usuário desativado' });
    }

    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = generateToken(user);
    const pub = userResponse(user);

    res.json({
      message: 'Login realizado com sucesso',
      token,
      user: pub,
      mustChangePassword: pub.mustChangePassword
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao realizar login' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const row = await loadUserById(req.user.id);
    if (!row || row.active === false) {
      return res.status(403).json({ error: 'Usuário inativo ou não encontrado' });
    }
    const pub = userResponse(row);
    res.json({
      user: pub,
      mustChangePassword: pub.mustChangePassword
    });
  } catch (error) {
    console.error('Erro em /me:', error);
    res.status(500).json({ error: 'Erro ao validar sessão' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres' });
    }

    const row = await loadUserById(req.user.id);
    if (!row) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // No primeiro acesso (must_change_password), currentPassword é opcional se for a senha atual
    if (currentPassword) {
      const ok = await comparePassword(currentPassword, row.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Senha atual incorreta' });
      }
    } else if (!row.must_change_password) {
      return res.status(400).json({ error: 'Senha atual é obrigatória' });
    }

    const passwordHash = await hashPassword(String(newPassword));
    await query(
      `UPDATE ${table('admin_users')}
       SET password_hash = $1, must_change_password = false
       WHERE id = $2`,
      [passwordHash, req.user.id]
    );

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
});

// GET /api/auth/users — lista (super-admin)
router.get('/users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, email, is_super_admin, must_change_password,
              active, permissions, created_at
       FROM ${table('admin_users')}
       ORDER BY created_at ASC, id ASC`
    );
    res.json(result.rows.map(userResponse));
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// POST /api/auth/users — criar (super-admin)
router.post('/users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const useDefaultPassword = req.body.useDefaultPassword !== false;
    const customPassword = req.body.password;
    const permissions = normalizePermissions(req.body.permissions);
    const active = req.body.active !== false;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }

    let password;
    if (useDefaultPassword) {
      password = DEFAULT_PASSWORD;
    } else {
      if (!customPassword || String(customPassword).length < 6) {
        return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
      }
      password = String(customPassword);
    }

    const existing = await query(
      `SELECT id FROM ${table('admin_users')}
       WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)`,
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um usuário com este e-mail' });
    }

    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO ${table('admin_users')}
        (username, email, password_hash, is_super_admin, must_change_password, active, permissions)
       VALUES ($1, $2, $3, false, true, $4, $5::jsonb)
       RETURNING id, username, email, is_super_admin, must_change_password, active, permissions, created_at`,
      [email, email, passwordHash, active, JSON.stringify(permissions)]
    );

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: userResponse(result.rows[0]),
      initialPasswordHint: useDefaultPassword ? DEFAULT_PASSWORD : '(senha personalizada)'
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe um usuário com este e-mail' });
    }
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// PUT /api/auth/users/:id — editar (super-admin)
router.put('/users/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const row = await loadUserById(id);
    if (!row) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const setParts = [];
    const values = [];
    let p = 1;

    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'E-mail inválido' });
      }
      const dup = await query(
        `SELECT id FROM ${table('admin_users')}
         WHERE (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)) AND id <> $2`,
        [email, id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Já existe um usuário com este e-mail' });
      }
      setParts.push(`email = $${p}`);
      values.push(email);
      p += 1;
      setParts.push(`username = $${p}`);
      values.push(email);
      p += 1;
    }

    if (req.body.permissions !== undefined && !row.is_super_admin) {
      setParts.push(`permissions = $${p}::jsonb`);
      values.push(JSON.stringify(normalizePermissions(req.body.permissions)));
      p += 1;
    }

    if (req.body.active !== undefined) {
      const active = !!req.body.active;
      if (!active && row.is_super_admin) {
        if (row.id === req.user.id) {
          return res.status(400).json({ error: 'Você não pode desativar a si mesmo' });
        }
        const superCount = await query(
          `SELECT COUNT(*)::int AS cnt FROM ${table('admin_users')}
           WHERE is_super_admin = true AND active = true AND id <> $1`,
          [id]
        );
        if (superCount.rows[0].cnt < 1) {
          return res.status(400).json({ error: 'Não é possível desativar o último super-admin' });
        }
      }
      setParts.push(`active = $${p}`);
      values.push(active);
      p += 1;
    }

    // Reset de senha
    if (req.body.resetPassword) {
      const useDefault = req.body.useDefaultPassword !== false;
      let newPass;
      if (useDefault) {
        newPass = DEFAULT_PASSWORD;
      } else {
        if (!req.body.password || String(req.body.password).length < 6) {
          return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
        }
        newPass = String(req.body.password);
      }
      const passwordHash = await hashPassword(newPass);
      setParts.push(`password_hash = $${p}`);
      values.push(passwordHash);
      p += 1;
      setParts.push('must_change_password = true');
    }

    if (setParts.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    values.push(id);
    const result = await query(
      `UPDATE ${table('admin_users')}
       SET ${setParts.join(', ')}
       WHERE id = $${p}
       RETURNING id, username, email, is_super_admin, must_change_password, active, permissions, created_at`,
      values
    );

    res.json({
      message: 'Usuário atualizado com sucesso',
      user: userResponse(result.rows[0])
    });
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe um usuário com este e-mail' });
    }
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// DELETE /api/auth/users/:id — soft-delete (super-admin)
router.delete('/users/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    if (id === req.user.id) {
      return res.status(400).json({ error: 'Você não pode desativar a si mesmo' });
    }

    const row = await loadUserById(id);
    if (!row) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (row.is_super_admin) {
      const superCount = await query(
        `SELECT COUNT(*)::int AS cnt FROM ${table('admin_users')}
         WHERE is_super_admin = true AND active = true AND id <> $1`,
        [id]
      );
      if (superCount.rows[0].cnt < 1) {
        return res.status(400).json({ error: 'Não é possível desativar o último super-admin' });
      }
    }

    await query(
      `UPDATE ${table('admin_users')} SET active = false WHERE id = $1`,
      [id]
    );

    res.json({ message: 'Usuário desativado com sucesso' });
  } catch (error) {
    console.error('Erro ao desativar usuário:', error);
    res.status(500).json({ error: 'Erro ao desativar usuário' });
  }
});

// Register público removido — criação apenas via super-admin em POST /users

module.exports = router;
