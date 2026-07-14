/**
 * Migra apenas dados de fidelidade (loyalty_settings + loyalty_customers)
 * do banco local (dev) para produção.
 *
 * Uso: node scripts/migrate-loyalty-to-prod.js
 *
 * Requer no .env:
 *   DB_* — origem (dev/local)
 *   PROD_DB_HOST, PROD_DB_PORT, PROD_DB_NAME, PROD_DB_USER, PROD_DB_PASSWORD
 *   DB_SCHEMA (opcional, default fitpoint)
 */
require('dotenv').config();
const { Pool } = require('pg');

const SCHEMA = process.env.DB_SCHEMA || 'fitpoint';

function createPool(config, label) {
  const password = config.password != null ? String(config.password) : '';
  return new Pool({
    host: config.host,
    port: Number(config.port) || 5432,
    database: config.database,
    user: config.user,
    password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000
  });
}

const sourcePool = createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
}, 'dev');

const prodHost = process.env.PROD_DB_HOST;
const prodPassword = process.env.PROD_DB_PASSWORD;

if (!prodHost || !prodPassword) {
  console.error('❌ Defina PROD_DB_HOST e PROD_DB_PASSWORD no .env (ou descomente credenciais de produção).');
  process.exit(1);
}

const targetPool = createPool({
  host: prodHost,
  port: process.env.PROD_DB_PORT || 5432,
  database: process.env.PROD_DB_NAME || process.env.DB_NAME,
  user: process.env.PROD_DB_USER || process.env.DB_USER,
  password: prodPassword,
  ssl: process.env.PROD_DB_SSL === 'true' || prodHost.includes('render.com')
}, 'prod');

async function ensureLoyaltySchema(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}, public`);

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
    INSERT INTO ${SCHEMA}.loyalty_settings (id, visits_per_reward)
    VALUES (1, 10)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function migrate() {
  const source = await sourcePool.connect();
  const target = await targetPool.connect();

  try {
    console.log('🔄 Migrando fidelidade: dev → produção\n');
    console.log(`   Origem:  ${process.env.DB_HOST}/${process.env.DB_NAME}`);
    console.log(`   Destino: ${prodHost}/${process.env.PROD_DB_NAME || process.env.DB_NAME}`);
    console.log(`   Schema:  ${SCHEMA}\n`);

    await source.query(`SET search_path TO ${SCHEMA}, public`);
    await ensureLoyaltySchema(target);

    const settingsRes = await source.query('SELECT * FROM loyalty_settings WHERE id = 1');
    const settings = settingsRes.rows[0] || { visits_per_reward: 10 };

    await target.query(
      `INSERT INTO ${SCHEMA}.loyalty_settings (id, visits_per_reward)
       VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET visits_per_reward = EXCLUDED.visits_per_reward`,
      [settings.visits_per_reward]
    );
    console.log(`✅ Configuração: ${settings.visits_per_reward} visitas por prêmio`);

    const customersRes = await source.query(
      'SELECT * FROM loyalty_customers ORDER BY id ASC'
    );
    const customers = customersRes.rows;
    console.log(`📋 Clientes na origem: ${customers.length}\n`);

    let inserted = 0;
    let updated = 0;

    for (const c of customers) {
      const existing = await target.query(
        `SELECT id FROM ${SCHEMA}.loyalty_customers WHERE phone = $1`,
        [c.phone]
      );

      if (existing.rows.length > 0) {
        await target.query(
          `UPDATE ${SCHEMA}.loyalty_customers SET
            name = $1, avatar = $2, total_visits = $3, total_rewards = $4,
            active = $5, updated_at = COALESCE($6::timestamp, NOW())
           WHERE phone = $7`,
          [c.name, c.avatar, c.total_visits, c.total_rewards, c.active !== false, c.updated_at, c.phone]
        );
        updated += 1;
      } else {
        await target.query(
          `INSERT INTO ${SCHEMA}.loyalty_customers
            (id, name, phone, avatar, total_visits, total_rewards, active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamp, NOW()), COALESCE($9::timestamp, NOW()))`,
          [
            c.id, c.name, c.phone, c.avatar,
            c.total_visits, c.total_rewards, c.active !== false,
            c.created_at, c.updated_at
          ]
        );
        inserted += 1;
      }
    }

    const maxIdRes = await target.query(
      `SELECT COALESCE(MAX(id), 0)::int AS max_id FROM ${SCHEMA}.loyalty_customers`
    );
    const maxId = maxIdRes.rows[0].max_id;
    await target.query(
      `SELECT setval(pg_get_serial_sequence('${SCHEMA}.loyalty_customers', 'id'), $1, true)`,
      [maxId]
    );

    const prodCount = await target.query(
      `SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.loyalty_customers`
    );

    console.log(`✅ Inseridos: ${inserted} | Atualizados: ${updated}`);
    console.log(`✅ Total em produção: ${prodCount.rows[0].cnt} clientes`);
    console.log('\n✨ Migração de fidelidade concluída!');
  } finally {
    source.release();
    target.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

migrate().catch((err) => {
  console.error('❌ Erro na migração:', err.message);
  process.exit(1);
});
