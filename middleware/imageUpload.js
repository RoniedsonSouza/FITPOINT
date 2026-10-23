const multer = require('multer');
const { saveImageBuffer, ALLOWED_MIME } = require('../services/mediaStore');
const { normalizeOcrImage } = require('../services/ocrImage');
const { createOcrLog } = require('../services/ocrLog');

// OCR: aceita fotos grandes (RAW do iPhone chega a ~75 MB); o tipo é validado pelos bytes depois
const OCR_MAX_UPLOAD_MB = 100;
const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: OCR_MAX_UPLOAD_MB * 1024 * 1024, files: 1 }
});

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

/**
 * Upload multipart (campo "image") só em memória — não grava em media.
 * Deixa req.file com buffer/mimetype/originalname.
 */
function memoryImageUpload(req, res, next) {
  memoryUpload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Erro no upload' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    next();
  });
}

function parseClientMeta(raw) {
  if (!raw) return undefined;
  try {
    const meta = JSON.parse(String(raw).slice(0, 2000));
    return meta && typeof meta === 'object' ? meta : undefined;
  } catch {
    return { raw: String(raw).slice(0, 200) };
  }
}

/**
 * Upload para análise de imagem (OCR). Só em memória, com log de cada etapa.
 * Aceita JPG/PNG/WebP/GIF/HEIC/HEIF e RAW (DNG) — o RAW vira o JPEG de prévia embutido.
 * Deixa req.file (já normalizado), req.ocrImage (detalhes) e req.ocrLog (logger da requisição).
 * @param {string} flow - nome do fluxo nos logs ('diario', 'cliente')
 */
function ocrImageUpload(flow) {
  return function ocrImageUploadMiddleware(req, res, next) {
    const log = createOcrLog(flow, req);
    req.ocrLog = log;
    log.info('request.start', {
      route: req.originalUrl,
      contentLength: Number(req.headers['content-length']) || undefined,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 160)
    });

    ocrUpload.single('image')(req, res, (err) => {
      if (err) {
        const tooLarge = err.code === 'LIMIT_FILE_SIZE';
        log.warn('upload.rejected', { code: err.code, message: err.message, field: err.field });
        return res.status(tooLarge ? 413 : 400).json({
          error: tooLarge
            ? `Imagem muito grande (máx. ${OCR_MAX_UPLOAD_MB} MB).`
            : (err.message || 'Erro no upload')
        });
      }
      if (!req.file) {
        log.warn('upload.rejected', { code: 'NO_FILE', bodyFields: Object.keys(req.body || {}) });
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }

      log.info('upload.received', {
        name: req.file.originalname,
        mime: req.file.mimetype,
        bytes: req.file.size,
        client: parseClientMeta(req.body?.client_meta)
      });

      try {
        const t0 = Date.now();
        const normalized = normalizeOcrImage({
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          originalname: req.file.originalname
        });
        req.file.buffer = normalized.buffer;
        req.file.mimetype = normalized.mimeType;
        req.file.size = normalized.buffer.length;
        req.ocrImage = normalized;
        log.info('image.normalized', {
          detected: normalized.detected,
          mime: normalized.mimeType,
          converted: normalized.converted,
          convertMs: Date.now() - t0,
          ...normalized.details
        });
        next();
      } catch (e) {
        log.warn('image.rejected', {
          code: e.code,
          message: e.message,
          clientMime: req.file.mimetype,
          bytes: req.file.size,
          firstBytes: req.file.buffer.subarray(0, 16).toString('hex')
        });
        return res.status(e.statusCode || 400).json({ error: e.message || 'Imagem inválida' });
      }
    });
  };
}

module.exports = {
  createImageUploadMiddleware,
  memoryImageUpload,
  ocrImageUpload
};
