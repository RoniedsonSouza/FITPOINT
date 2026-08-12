const express = require('express');
const router = express.Router();
const { getMediaById } = require('../services/mediaStore');

// GET /api/media/:id — público (mesmo padrão das URLs /uploads antigas)
router.get('/:id', async (req, res) => {
  try {
    const row = await getMediaById(req.params.id);
    if (!row || !row.data) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }

    const body = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (row.original_name) {
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${String(row.original_name).replace(/"/g, '')}"`
      );
    }
    return res.send(body);
  } catch (error) {
    console.error('Erro ao servir mídia:', error);
    return res.status(500).json({ error: 'Erro ao carregar imagem' });
  }
});

module.exports = router;
