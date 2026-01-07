require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'nimu_pwa_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Schema padrão
const SCHEMA = process.env.DB_SCHEMA || 'fitpoint';

// Garantir que o schema existe na inicialização
(async () => {
  try {
    const client = await pool.connect();
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    client.release();
    console.log(`✅ Schema "${SCHEMA}" garantido no banco ${process.env.DB_NAME}`);
  } catch (error) {
    console.error('Erro ao garantir schema:', error);
  }
})();

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
  table
};
