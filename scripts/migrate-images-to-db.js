/**
 * Migra referências /uploads/... e /assets/... para a tabela media (BYTEA).
 * Idempotente: só processa URLs que ainda não são /api/media/:id.
 *
 * CLI:  node scripts/migrate-images-to-db.js
 * Boot: ensureImagesMigrated() (chamado após ensureDatabase no server.js)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, table, pool } = require('../config/database');
const { saveImageBuffer } = require('../services/mediaStore');

const ROOT = path.join(__dirname, '..');

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const ENTITY_COLUMNS = [
  { tableName: 'products', column: 'image', kind: 'products', idColumn: 'id' },
  { tableName: 'recipes', column: 'image', kind: 'recipes', idColumn: 'slug' },
  { tableName: 'events', column: 'image_url', kind: 'events', idColumn: 'id' },
  { tableName: 'events', column: 'logo_url', kind: 'events', idColumn: 'id' },
  { tableName: 'events', column: 'cover_url', kind: 'events', idColumn: 'id' },
  { tableName: 'event_sponsors', column: 'image_url', kind: 'events', idColumn: 'id' },
  { tableName: 'distributors', column: 'photo_url', kind: 'distributors', idColumn: 'id' },
  { tableName: 'loyalty_customers', column: 'avatar', kind: 'loyalty', idColumn: 'id' }
];

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] || null;
}

function resolveDiskPath(urlPath) {
  const rel = String(urlPath || '')
    .replace(/^\//, '')
    .replace(/\//g, path.sep);
  return path.join(ROOT, rel);
}

async function ensureMediaTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${table('media')} (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(40) NOT NULL DEFAULT 'generic',
      mime_type VARCHAR(100) NOT NULL,
      original_name VARCHAR(255),
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_media_kind_created
    ON ${table('media')} (kind, created_at DESC)
  `);
}

/**
 * @returns {{ updated: number, missing: number, pending: number }}
 */
async function migrateImagesToDb(options = {}) {
  const { quiet = false } = options;
  const log = quiet ? () => {} : (...args) => console.log(...args);

  await ensureMediaTable();

  const urlMap = new Map();
  let pending = 0;
  let updated = 0;
  let missing = 0;

  for (const { tableName, column, kind, idColumn } of ENTITY_COLUMNS) {
    let rows;
    try {
      rows = await query(
        `SELECT ${idColumn} AS row_id, ${column} AS url FROM ${table(tableName)}
         WHERE ${column} IS NOT NULL AND ${column} <> ''
           AND (${column} LIKE '/uploads/%' OR ${column} LIKE '/assets/%')`
      );
    } catch (e) {
      if (e.code === '42P01') {
        log(`  tabela ${tableName} inexistente — skip`);
        continue;
      }
      throw e;
    }

    pending += rows.rows.length;

    for (const row of rows.rows) {
      const old = String(row.url).trim();
      if (old.startsWith('/api/media/')) continue;

      let next = urlMap.get(old);
      if (!next) {
        const disk = resolveDiskPath(old);
        if (!fs.existsSync(disk)) {
          missing++;
          log(`  missing ${tableName}#${row.row_id}.${column}: ${old}`);
          continue;
        }
        const mime = guessMime(disk);
        if (!mime) {
          log(`  skip mime ${tableName}#${row.row_id}: ${old}`);
          continue;
        }
        const saved = await saveImageBuffer({
          buffer: fs.readFileSync(disk),
          mimeType: mime,
          originalName: path.basename(disk),
          kind: old.startsWith('/assets/') ? 'assets' : kind
        });
        next = saved.url;
        urlMap.set(old, next);
      }

      await query(
        `UPDATE ${table(tableName)} SET ${column} = $1 WHERE ${idColumn} = $2`,
        [next, row.row_id]
      );
      updated++;
      log(`  update ${tableName}#${row.row_id}.${column}: ${old} → ${next}`);
    }
  }

  if (updated || missing) {
    log(`✅ Imagens: ${updated} coluna(s) atualizada(s), ${missing} arquivo(s) ausente(s)`);
  } else {
    log('✅ Imagens: nada pendente (já no banco)');
  }

  return { updated, missing, pending };
}

/** Hook de boot — mesmo papel do ensureDatabase para mídia. */
async function ensureImagesMigrated() {
  return migrateImagesToDb({ quiet: false });
}

module.exports = {
  migrateImagesToDb,
  ensureImagesMigrated,
  ensureMediaTable
};

if (require.main === module) {
  migrateImagesToDb()
    .then(async () => {
      await pool.end();
    })
    .catch(async (e) => {
      console.error(e);
      try {
        await pool.end();
      } catch (_) {
        /* ignore */
      }
      process.exit(1);
    });
}
