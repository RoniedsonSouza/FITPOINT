const multer = require('multer');
const { saveImageBuffer, ALLOWED_MIME } = require('../services/mediaStore');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(String(file.mimetype || '').toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Use uma imagem JPG, PNG, WebP ou GIF.'));
    }
  }
});

/**
 * Middleware multipart (campo "image") + gravação no banco.
 * Deixa em req.savedMedia = { id, url, mime_type, byte_size }.
 */
function createImageUploadMiddleware(kind) {
  return function imageUploadMiddleware(req, res, next) {
    memoryUpload.single('image')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Erro no upload' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }
      try {
        req.savedMedia = await saveImageBuffer({
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          originalName: req.file.originalname,
          kind
        });
        next();
      } catch (e) {
        console.error('Erro ao salvar imagem no banco:', e);
        return res.status(400).json({ error: e.message || 'Erro ao salvar imagem' });
      }
    });
  };
}

module.exports = {
  createImageUploadMiddleware
};
