const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, table } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';
const DEFAULT_PASSWORD = 'fit@123';

const EMPTY_PERMISSIONS = {
  produtos: false,
  fidelidade: false,
  vendas: false,
  distribuidores: false,
  eventos: {
    enabled: false,
    lotes: false,
    validar: false
  }
};

function normalizePermissions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const eventosSrc = src.eventos && typeof src.eventos === 'object' ? src.eventos : {};
  const enabled = !!eventosSrc.enabled || src.eventos === true;
  return {
    produtos: !!src.produtos,
    fidelidade: !!src.fidelidade,
    vendas: !!src.vendas,
    distribuidores: !!src.distribuidores,
    eventos: {
      enabled: !!enabled || !!eventosSrc.lotes || !!eventosSrc.validar,
      lotes: !!eventosSrc.lotes,
      validar: !!eventosSrc.validar
    }
  };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || row.username,
    username: row.username,
    isSuperAdmin: !!row.is_super_admin,
    mustChangePassword: !!row.must_change_password,
    active: row.active !== false,
    permissions: row.is_super_admin ? null : normalizePermissions(row.permissions),
    createdAt: row.created_at || null
  };
}

function userHasPermission(user, module, action) {
  if (!user) return false;
  if (user.isSuperAdmin || user.is_super_admin) return true;

  const perms = normalizePermissions(user.permissions);

  if (module === 'categorias' || module === 'usuarios') {
    return false;
  }

  if (module === 'produtos') return !!perms.produtos;
  if (module === 'fidelidade') return !!perms.fidelidade;
  if (module === 'vendas') return !!perms.vendas;
  if (module === 'distribuidores') return !!perms.distribuidores;

  if (module === 'eventos') {
    if (!perms.eventos.enabled) return false;
    if (!action || action === 'enabled' || action === 'ingressos') return true;
    if (action === 'lotes') return !!perms.eventos.lotes;
    if (action === 'validar') return !!perms.eventos.validar;
    return false;
  }

  return false;
}

async function loadUserById(id) {
  const result = await query(
    `SELECT id, username, email, password_hash, is_super_admin, must_change_password,
            active, permissions, created_at
     FROM ${table('admin_users')}
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function loadUserByLogin(login) {
  const result = await query(
    `SELECT id, username, email, password_hash, is_super_admin, must_change_password,
            active, permissions, created_at
     FROM ${table('admin_users')}
     WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)`,
    [login]
  );
  return result.rows[0] || null;
}

// Middleware para verificar token JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso requerido' });
  }

  jwt.verify(token, JWT_SECRET, async (err, payload) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }

    try {
      const row = await loadUserById(payload.id);
      if (!row || row.active === false) {
        return res.status(403).json({ error: 'Usuário inativo ou não encontrado' });
      }
      req.user = {
        id: row.id,
        username: row.username,
        email: row.email || row.username,
        isSuperAdmin: !!row.is_super_admin,
        mustChangePassword: !!row.must_change_password,
        permissions: normalizePermissions(row.permissions),
        active: row.active !== false
      };
      next();
    } catch (error) {
      console.error('Erro ao carregar usuário do token:', error);
      return res.status(500).json({ error: 'Erro ao validar sessão' });
    }
  });
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ error: 'Sem permissão para este recurso' });
  }
  next();
};

/**
 * requirePermission('produtos')
 * requirePermission('eventos', 'lotes')
 * requirePermission('eventos', 'validar')
 * requirePermission('eventos') // enabled / ingressos
 */
const requirePermission = (module, action) => (req, res, next) => {
  if (userHasPermission(req.user, module, action)) {
    return next();
  }
  return res.status(403).json({ error: 'Sem permissão para este recurso' });
};

// Gerar hash de senha
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

// Comparar senha
const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// Gerar token JWT
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email || user.username,
      isSuperAdmin: !!(user.isSuperAdmin ?? user.is_super_admin)
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

module.exports = {
  authenticateToken,
  requireSuperAdmin,
  requirePermission,
  hashPassword,
  comparePassword,
  generateToken,
  JWT_SECRET,
  DEFAULT_PASSWORD,
  EMPTY_PERMISSIONS,
  normalizePermissions,
  publicUser,
  userHasPermission,
  loadUserById,
  loadUserByLogin,
  isValidEmail
};
