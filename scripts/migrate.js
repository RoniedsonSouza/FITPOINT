require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'nimu_pwa_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD != null ? String(process.env.DB_PASSWORD) : '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const SCHEMA = process.env.DB_SCHEMA || 'fitpoint';
const PRODUCTS_JSON = path.join(__dirname, '../data/products.json');
const RECIPES_JSON = path.join(__dirname, '../data/recipes.json');

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Iniciando migração do banco de dados...\n');
    console.log(`📊 Banco: ${process.env.DB_NAME}`);
    console.log(`📦 Schema: ${SCHEMA}\n`);

    // Criar schema
    console.log(`📋 Criando schema "${SCHEMA}"...`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    console.log(`✅ Schema "${SCHEMA}" criado/configurado\n`);

    // Criar tabelas dentro do schema
    console.log('📋 Criando tabelas no schema...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.products (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        category VARCHAR(100) NOT NULL,
        tags JSONB DEFAULT '[]'::jsonb,
        image TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

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

    await client.query(`
      INSERT INTO ${SCHEMA}.categories (name, slug, sort_order, active)
      VALUES ('Bebida', 'bebida', 0, true), ('Lanche', 'lanche', 1, true)
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.recipes (
        slug VARCHAR(255) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        image TEXT,
        time INTEGER,
        servings INTEGER DEFAULT 1,
        kcal INTEGER,
        protein_g INTEGER DEFAULT 0,
        steps JSONB DEFAULT '[]'::jsonb,
        tips JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        is_super_admin BOOLEAN NOT NULL DEFAULT false,
        must_change_password BOOLEAN NOT NULL DEFAULT false,
        active BOOLEAN NOT NULL DEFAULT true,
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
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
    await client.query(`
      UPDATE ${SCHEMA}.admin_users
      SET email = username
      WHERE email IS NULL OR email = ''
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email
      ON ${SCHEMA}.admin_users (LOWER(email))
      WHERE email IS NOT NULL AND email <> ''
    `);

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
      ALTER TABLE ${SCHEMA}.daily_sales
      ADD COLUMN IF NOT EXISTS option_id VARCHAR(255)
    `);

    await client.query(`
      ALTER TABLE ${SCHEMA}.daily_sales
      ADD COLUMN IF NOT EXISTS option_name VARCHAR(255)
    `);

    await client.query(`
      ALTER TABLE ${SCHEMA}.daily_sales
      ADD COLUMN IF NOT EXISTS selected_options JSONB NOT NULL DEFAULT '[]'::jsonb
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

    // Promoção por quantidade em lotes existentes (idempotente)
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

    console.log('✅ Tabelas criadas no schema\n');

    // Criar usuário admin padrão
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    const existingAdmin = await client.query(
      `SELECT id FROM ${SCHEMA}.admin_users WHERE username = $1`,
      [adminUsername]
    );

    if (existingAdmin.rows.length === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      const adminEmail = adminUsername.includes('@') ? adminUsername : `${adminUsername}@fitpoint.local`;
      await client.query(
        `INSERT INTO ${SCHEMA}.admin_users
          (username, email, password_hash, is_super_admin, must_change_password, active, permissions)
         VALUES ($1, $2, $3, true, false, true, '{}'::jsonb)`,
        [adminUsername, adminEmail, passwordHash]
      );
      console.log(`👤 Usuário admin criado: ${adminEmail} / ${adminPassword}`);
      console.log('⚠️  ALTERE A SENHA PADRÃO EM PRODUÇÃO!\n');
    } else {
      await client.query(`
        UPDATE ${SCHEMA}.admin_users
        SET is_super_admin = true,
            email = COALESCE(NULLIF(email, ''), username)
        WHERE id = (SELECT MIN(id) FROM ${SCHEMA}.admin_users)
          AND NOT EXISTS (
            SELECT 1 FROM ${SCHEMA}.admin_users WHERE is_super_admin = true
          )
      `);
      console.log(`👤 Usuário admin já existe: ${adminUsername}\n`);
    }

    // Migrar produtos
    if (fs.existsSync(PRODUCTS_JSON)) {
      const products = JSON.parse(fs.readFileSync(PRODUCTS_JSON, 'utf8'));
      console.log(`📦 Migrando ${products.length} produtos...`);

      for (const product of products) {
        const existing = await client.query(
          `SELECT id FROM ${SCHEMA}.products WHERE id = $1`,
          [product.id]
        );

        if (existing.rows.length === 0) {
          const promo =
            product.promo_price != null && product.promo_price !== ''
              ? Number(product.promo_price)
              : null;
          const isKit = product.is_kit === true;
          await client.query(
            `INSERT INTO ${SCHEMA}.products (id, name, price, category, tags, image, active, promo_price, is_kit, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
            [
              product.id,
              product.name,
              product.price,
              product.category,
              JSON.stringify(product.tags || []),
              product.image || null,
              product.active !== false,
              promo != null && !Number.isNaN(promo) ? promo : null,
              isKit
            ]
          );
          console.log(`  ✅ ${product.name}`);
        } else {
          console.log(`  ⏭️  ${product.name} (já existe)`);
        }
      }
    } else {
      console.log('⚠️  Arquivo products.json não encontrado');
    }

    // Migrar receitas
    if (fs.existsSync(RECIPES_JSON)) {
      const recipes = JSON.parse(fs.readFileSync(RECIPES_JSON, 'utf8'));
      console.log(`\n🍳 Migrando ${recipes.length} receitas...`);

      for (const recipe of recipes) {
        const existing = await client.query(
          `SELECT slug FROM ${SCHEMA}.recipes WHERE slug = $1`,
          [recipe.slug]
        );

        if (existing.rows.length === 0) {
          await client.query(
            `INSERT INTO ${SCHEMA}.recipes (slug, title, image, time, servings, kcal, protein_g, steps, tips, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
            [
              recipe.slug,
              recipe.title,
              recipe.image || null,
              recipe.time || null,
              recipe.servings || 1,
              recipe.kcal || null,
              recipe.protein_g || 0,
              JSON.stringify(recipe.steps || []),
              JSON.stringify(recipe.tips || [])
            ]
          );
          console.log(`  ✅ ${recipe.title}`);
        } else {
          console.log(`  ⏭️  ${recipe.title} (já existe)`);
        }
      }
    } else {
      console.log('⚠️  Arquivo recipes.json não encontrado');
    }

    console.log('\n✨ Migração concluída com sucesso!');
    console.log(`\n📊 Resumo:`);
    console.log(`   - Schema: ${SCHEMA}`);
    console.log(`   - Banco: ${process.env.DB_NAME}`);
    console.log(`   - Host: ${process.env.DB_HOST}`);
  } catch (error) {
    console.error('❌ Erro na migração:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
