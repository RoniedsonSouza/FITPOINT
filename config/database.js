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
