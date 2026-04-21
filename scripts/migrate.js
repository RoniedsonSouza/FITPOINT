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
        created_at TIMESTAMP DEFAULT NOW()
      )
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
      await client.query(
        `INSERT INTO ${SCHEMA}.admin_users (username, password_hash) VALUES ($1, $2)`,
        [adminUsername, passwordHash]
      );
      console.log(`👤 Usuário admin criado: ${adminUsername} / ${adminPassword}`);
      console.log('⚠️  ALTERE A SENHA PADRÃO EM PRODUÇÃO!\n');
    } else {
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
