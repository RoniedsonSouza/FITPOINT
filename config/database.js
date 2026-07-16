require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'nimu_pwa_db',
  user: process.env.DB_USER || 'postgres',
  // pg + SCRAM exige string; undefined dispara "client password must be a string"
  password: process.env.DB_PASSWORD != null ? String(process.env.DB_PASSWORD) : '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Schema padrão
const SCHEMA = process.env.DB_SCHEMA || 'fitpoint';

/** Schema + coluna promo_price em bases antigas. Chamar antes de app.listen. */
async function ensureDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await client.query(`
      ALTER TABLE ${SCHEMA}.products
      ADD COLUMN IF NOT EXISTS promo_price DECIMAL(10,2)
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.products
      ADD COLUMN IF NOT EXISTS is_kit BOOLEAN DEFAULT false
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.products
      ADD COLUMN IF NOT EXISTS description TEXT
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.products
      ADD COLUMN IF NOT EXISTS nutrition JSONB DEFAULT '{}'::jsonb
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.products
      ADD COLUMN IF NOT EXISTS options JSONB DEFAULT '[]'::jsonb
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        sort_order INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    const catCheck = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.categories`
    );
    if (catCheck.rows[0].cnt === 0) {
      await client.query(`
        INSERT INTO ${SCHEMA}.categories (name, slug, sort_order, active)
        VALUES ('Bebida', 'bebida', 0, true), ('Lanche', 'lanche', 1, true)
        ON CONFLICT DO NOTHING
      `);
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.loyalty_customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL UNIQUE,
        total_visits INTEGER NOT NULL DEFAULT 0,
        total_rewards INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.loyalty_customers
      ADD COLUMN IF NOT EXISTS avatar TEXT
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.loyalty_customers
      ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMP
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.loyalty_customers
      ADD COLUMN IF NOT EXISTS last_positive_visit_at TIMESTAMP
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.loyalty_visit_events (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES ${SCHEMA}.loyalty_customers(id) ON DELETE CASCADE,
        delta SMALLINT NOT NULL CHECK (delta IN (-1, 1)),
        source VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_loyalty_visit_events_customer_created
      ON ${SCHEMA}.loyalty_visit_events (customer_id, created_at DESC)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.loyalty_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        visits_per_reward INTEGER NOT NULL DEFAULT 10
      )
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.loyalty_settings
      ADD COLUMN IF NOT EXISTS access_value NUMERIC(10,2) NOT NULL DEFAULT 27
    `);
    await client.query(`
      INSERT INTO ${SCHEMA}.loyalty_settings (id, visits_per_reward, access_value)
      VALUES (1, 10, 27)
      ON CONFLICT (id) DO NOTHING
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.daily_sales (
        id SERIAL PRIMARY KEY,
        sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
        product_id VARCHAR(255) NOT NULL REFERENCES ${SCHEMA}.products(id),
        loyalty_customer_id INTEGER REFERENCES ${SCHEMA}.loyalty_customers(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        unit_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_sales_date ON ${SCHEMA}.daily_sales(sale_date)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.events (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        venue VARCHAR(255),
        starts_at TIMESTAMP NOT NULL,
        image_url TEXT,
        logo_url TEXT,
        cover_url TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.events
      ADD COLUMN IF NOT EXISTS logo_url TEXT
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.events
      ADD COLUMN IF NOT EXISTS cover_url TEXT
    `);
    await client.query(`
      UPDATE ${SCHEMA}.events
      SET cover_url = image_url
      WHERE cover_url IS NULL AND image_url IS NOT NULL AND image_url <> ''
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.event_sponsors (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES ${SCHEMA}.events(id) ON DELETE CASCADE,
        fantasy_name VARCHAR(255) NOT NULL,
        instagram VARCHAR(255) NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_event_sponsors_event
      ON ${SCHEMA}.event_sponsors(event_id, sort_order, id)
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.event_sponsors
      ADD COLUMN IF NOT EXISTS image_url TEXT
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.ticket_lots (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES ${SCHEMA}.events(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
        quantity_total INTEGER NOT NULL CHECK (quantity_total > 0),
        quantity_sold INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
        sales_start TIMESTAMP,
        sales_end TIMESTAMP,
        active BOOLEAN DEFAULT true,
        promo_enabled BOOLEAN NOT NULL DEFAULT false,
        promo_qty INTEGER,
        promo_price DECIMAL(10,2),
        promo_mode VARCHAR(20) NOT NULL DEFAULT 'repeat',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.ticket_lots
      ADD COLUMN IF NOT EXISTS promo_enabled BOOLEAN NOT NULL DEFAULT false
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.ticket_lots
      ADD COLUMN IF NOT EXISTS promo_qty INTEGER
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.ticket_lots
      ADD COLUMN IF NOT EXISTS promo_price DECIMAL(10,2)
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.ticket_lots
      ADD COLUMN IF NOT EXISTS promo_mode VARCHAR(20) NOT NULL DEFAULT 'repeat'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ticket_lots_event ON ${SCHEMA}.ticket_lots(event_id)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.ticket_orders (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES ${SCHEMA}.events(id) ON DELETE RESTRICT,
        lot_id INTEGER NOT NULL REFERENCES ${SCHEMA}.ticket_lots(id) ON DELETE RESTRICT,
        buyer_name VARCHAR(255) NOT NULL,
        buyer_email VARCHAR(255) NOT NULL,
        buyer_phone VARCHAR(50),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'paid', 'cancelled', 'expired')),
        mp_preference_id VARCHAR(255),
        mp_payment_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ticket_orders_status ON ${SCHEMA}.ticket_orders(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ticket_orders_mp_payment ON ${SCHEMA}.ticket_orders(mp_payment_id)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.tickets (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES ${SCHEMA}.ticket_orders(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES ${SCHEMA}.events(id) ON DELETE RESTRICT,
        lot_id INTEGER NOT NULL REFERENCES ${SCHEMA}.ticket_lots(id) ON DELETE RESTRICT,
        code VARCHAR(64) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'valid'
          CHECK (status IN ('valid', 'used', 'cancelled')),
        used_at TIMESTAMP,
        buyer_name VARCHAR(255) NOT NULL,
        buyer_email VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_code ON ${SCHEMA}.tickets(code)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_event ON ${SCHEMA}.tickets(event_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.distributors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        photo_url TEXT,
        herbalife_level VARCHAR(80) NOT NULL,
        region_label VARCHAR(200) NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        whatsapp VARCHAR(30),
        phone VARCHAR(30),
        instagram VARCHAR(120),
        description TEXT,
        active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_distributors_active_sort
      ON ${SCHEMA}.distributors (active, sort_order, name)
    `);

    // admin_users: permissões granulares e login por e-mail
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.admin_users
      ADD COLUMN IF NOT EXISTS email VARCHAR(255)
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.admin_users
      ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.admin_users
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.admin_users
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true
    `);
    await client.query(`
      ALTER TABLE ${SCHEMA}.admin_users
      ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
    // Migrar username legado → email quando email estiver vazio
    await client.query(`
      UPDATE ${SCHEMA}.admin_users
      SET email = username
      WHERE email IS NULL OR email = ''
    `);
    // Índice único em email (ignora nulos se ainda houver)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email
      ON ${SCHEMA}.admin_users (LOWER(email))
      WHERE email IS NOT NULL AND email <> ''
    `);
    // Primeiro usuário existente vira super-admin
    await client.query(`
      UPDATE ${SCHEMA}.admin_users
      SET is_super_admin = true
      WHERE id = (SELECT MIN(id) FROM ${SCHEMA}.admin_users)
        AND NOT EXISTS (
          SELECT 1 FROM ${SCHEMA}.admin_users WHERE is_super_admin = true
        )
    `);

    console.log(`✅ Schema "${SCHEMA}" e tabelas/colunas verificadas`);
  } catch (error) {
    if (error.code === '42P01') {
      console.warn(
        `⚠️ Tabela ${SCHEMA}.products não existe. Execute: node scripts/migrate.js`
      );
    } else {
      throw error;
    }
  } finally {
    client.release();
  }
}

pool.on('error', (err) => {
  console.error('❌ Erro inesperado no cliente PostgreSQL:', err);
  process.exit(-1);
});

// Funções auxiliares para queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    // Garantir schema antes de cada query
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    
    // Obter cliente do pool
    const client = await pool.connect();
    try {
      // Configurar search_path para usar o schema
      await client.query(`SET search_path TO ${SCHEMA}, public`);
      // Executar query
      const res = await client.query(text, params);
      const duration = Date.now() - start;
      if (process.env.NODE_ENV !== 'production') {
        console.log('Executada query', { text: text.substring(0, 100), duration, rows: res.rowCount });
      }
      return res;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erro na query:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
};

// Helper para obter o nome da tabela com schema (preferido)
const table = (name) => `${SCHEMA}.${name}`;

const getClient = async () => {
  const client = await pool.connect();
  // Configurar search_path para o cliente
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}, public`);
  return client;
};

module.exports = {
  pool,
  query,
  getClient,
  SCHEMA,
  table,
  ensureDatabase
};
