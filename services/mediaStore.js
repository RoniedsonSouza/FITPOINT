const { query, table } = require('../config/database');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function mediaUrl(id) {
  return `/api/media/${id}`;
}

function parseMediaIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = /^\/api\/media\/(\d+)\/?$/.exec(url.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Persiste bytes de imagem no Postgres e retorna { id, url, mime_type }.
 */
async function saveImageBuffer({ buffer, mimeType, originalName = null, kind = 'generic' }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Arquivo de imagem vazio');
  }
  const mime = String(mimeType || '').toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error('Use uma imagem JPG, PNG, WebP ou GIF.');
  }

  const result = await query(
    `INSERT INTO ${table('media')}
      (kind, mime_type, original_name, byte_size, data, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, mime_type, byte_size`,
    [
      String(kind || 'generic').slice(0, 40),
      mime,
      originalName ? String(originalName).slice(0, 255) : null,
      buffer.length,
      buffer
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    url: mediaUrl(row.id),
    mime_type: row.mime_type,
    byte_size: Number(row.byte_size)
  };
}

async function getMediaById(id) {
  const mediaId = parseInt(id, 10);
  if (!mediaId || mediaId < 1) return null;
  const result = await query(
    `SELECT id, kind, mime_type, original_name, byte_size, data, created_at
     FROM ${table('media')}
     WHERE id = $1`,
    [mediaId]
  );
  return result.rows[0] || null;
}

module.exports = {
  ALLOWED_MIME,
  mediaUrl,
  parseMediaIdFromUrl,
  saveImageBuffer,
  getMediaById
};
