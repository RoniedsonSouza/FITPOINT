// Normaliza a imagem enviada para análise (OCR via Gemini).
// - Detecta o formato real pelos bytes (não confia no mimetype do navegador)
// - JPG/PNG/WebP/GIF/HEIC/HEIF: segue como está (Gemini aceita HEIC/HEIF)
// - RAW (DNG do iPhone ProRAW e outros RAW baseados em TIFF): extrai o JPEG de prévia embutido,
//   já que o Gemini não lê RAW

const GEMINI_MAX_IMAGE_BYTES = 14 * 1024 * 1024; // ~20 MB de requisição após base64

class OcrImageError extends Error {
  constructor(message, statusCode = 400, code = 'invalid_image') {
    super(message);
    this.name = 'OcrImageError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const MIME_BY_TYPE = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif'
};

function ascii(buf, start, len) {
  return buf.length >= start + len ? buf.toString('latin1', start, start + len) : '';
}

/** Detecta o formato pelos primeiros bytes. */
function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  const head6 = ascii(buf, 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return 'webp';
  if (ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4);
    if (['avif', 'avis'].includes(brand)) return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'].includes(brand)) return 'heic';
    if (['mif1', 'msf1'].includes(brand)) {
      const boxSize = Math.min(buf.readUInt32BE(0), buf.length);
      const compat = ascii(buf, 16, Math.max(0, boxSize - 16));
      if (compat.includes('avif')) return 'avif';
      return compat.includes('heic') || compat.includes('heix') ? 'heic' : 'heif';
    }
    if (brand === 'crx ') return 'raw-cr3';
    return null;
  }
  const tiff = ascii(buf, 0, 4);
  if (tiff === 'II*\u0000' || tiff === 'MM\u0000*') return 'tiff';
  return null;
}

// ---------- JPEG ----------

const SOF_SUPPORTED = new Set([0xc0, 0xc1, 0xc2]); // baseline, extended, progressive
const SOF_UNSUPPORTED = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]); // lossless/arith

/**
 * Lê o cabeçalho de um JPEG em `start` e devolve { width, height } se for um JPEG comum
 * (não o JPEG lossless usado nos dados RAW). Não decodifica a imagem.
 */
function readJpegHeader(buf, start, end = buf.length) {
  if (start < 0 || start + 4 > end || buf[start] !== 0xff || buf[start + 1] !== 0xd8) return null;
  let i = start + 2;
  for (let guard = 0; guard < 500 && i + 4 <= end; guard++) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < end) { i++; marker = buf[i + 1]; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // fim/scan antes do SOF
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (SOF_SUPPORTED.has(marker)) {
      if (i + 9 > end) return null;
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (SOF_UNSUPPORTED.has(marker)) return null;
    i += 2 + len;
  }
  return null;
}

/** Percorre um JPEG inteiro e devolve o índice logo após o EOI (FFD9), ou -1. */
function findJpegEnd(buf, start, limit = buf.length) {
  let i = start + 2;
  while (i + 2 <= limit) {
    if (buf[i] !== 0xff) return -1;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd9) return i + 2;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (i + 4 > limit) return -1;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return -1;
    i += 2 + len;
    if (marker === 0xda) {
      // dados comprimidos: avança até um marcador real (FF seguido de algo que não é 00 nem RSTn)
      while (i + 1 < limit) {
        if (buf[i] === 0xff) {
          const next = buf[i + 1];
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        }
        i++;
      }
    }
  }
  return -1;
}

// ---------- TIFF / DNG ----------

function createTiffReader(buf) {
  const le = buf[0] === 0x49;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const TYPE_SIZE = { 1: 1, 3: 2, 4: 4, 13: 4, 16: 8 };

  function values(entryOffset) {
    const type = u16(entryOffset + 2);
    const count = u32(entryOffset + 4);
    const size = TYPE_SIZE[type];
    if (!size || count === 0 || count > 10000) return [];
    const total = size * count;
    const dataOffset = total <= 4 ? entryOffset + 8 : u32(entryOffset + 8);
    if (dataOffset + total > buf.length) return [];
    const out = [];
    for (let k = 0; k < count; k++) {
      const o = dataOffset + k * size;
      if (type === 1) out.push(buf[o]);
      else if (type === 3) out.push(u16(o));
      else out.push(u32(o)); // LONG / IFD (8 bytes de IFD8 não ocorrem em TIFF clássico)
    }
    return out;
  }

  function readIfd(offset) {
    if (offset < 8 || offset + 2 > buf.length) return null;
    const count = u16(offset);
    if (count === 0 || count > 1000 || offset + 2 + count * 12 + 4 > buf.length) return null;
    const tags = new Map();
    for (let k = 0; k < count; k++) {
      const e = offset + 2 + k * 12;
      tags.set(u16(e), e);
    }
    const next = u32(offset + 2 + count * 12);
    return { tags, next, get: (tag) => (tags.has(tag) ? values(tags.get(tag)) : []) };
  }

  return { u32, readIfd };
}

/**
 * Procura JPEGs de prévia embutidos em um arquivo TIFF/DNG.
 * Devolve o maior JPEG comum encontrado: { buffer, width, height, source, isDng } ou null.
 */
function extractEmbeddedJpeg(buf) {
  if (detectImageType(buf) !== 'tiff') return null;
  const tiff = createTiffReader(buf);
  const queue = [tiff.u32(4)];
  const seen = new Set();
  const candidates = [];
  let isDng = false;

  while (queue.length && seen.size < 64) {
    const offset = queue.shift();
    if (!offset || seen.has(offset)) continue;
    seen.add(offset);
    const ifd = tiff.readIfd(offset);
    if (!ifd) continue;
    if (ifd.tags.has(50706)) isDng = true; // DNGVersion
    ifd.get(330).forEach((sub) => queue.push(sub)); // SubIFDs
    if (ifd.next) queue.push(ifd.next);

    const jpegOffset = ifd.get(513)[0];
    const jpegLength = ifd.get(514)[0];
    if (jpegOffset && jpegLength) candidates.push({ offset: jpegOffset, length: jpegLength, source: 'ifd-jpeg' });

    const compression = ifd.get(259)[0];
    const strips = ifd.get(273);
    const stripCounts = ifd.get(279);
    if ((compression === 6 || compression === 7) && strips.length === 1 && stripCounts.length === 1) {
      candidates.push({ offset: strips[0], length: stripCounts[0], source: 'ifd-strip' });
    }
  }

  let best = null;
  for (const c of candidates) {
    const end = c.offset + c.length;
    if (c.offset <= 0 || end > buf.length) continue;
    const header = readJpegHeader(buf, c.offset, end);
    if (!header) continue;
    if (!best || header.width * header.height > best.width * best.height) {
      best = { ...c, ...header };
    }
  }

  // Fallback: varre o arquivo atrás de JPEGs comuns
  if (!best) {
    const soi = Buffer.from([0xff, 0xd8, 0xff]);
    let pos = 8;
    for (let guard = 0; guard < 200; guard++) {
      const at = buf.indexOf(soi, pos);
      if (at < 0) break;
      pos = at + 3;
      const header = readJpegHeader(buf, at);
      if (!header) continue;
      const end = findJpegEnd(buf, at);
      if (end < 0) continue;
      if (!best || header.width * header.height > best.width * best.height) {
        best = { offset: at, length: end - at, source: 'scan', ...header };
      }
      pos = end;
    }
  }

  if (!best) return null;
  return {
    buffer: buf.subarray(best.offset, best.offset + best.length),
    width: best.width,
    height: best.height,
    source: best.source,
    isDng
  };
}

const MB = (n) => Math.round((n / (1024 * 1024)) * 10) / 10;

/**
 * Converte o upload em algo que o Gemini entende.
 * @returns {{ buffer: Buffer, mimeType: string, detected: string, converted: boolean, details: object }}
 */
function normalizeOcrImage({ buffer, mimetype, originalname } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new OcrImageError('Arquivo de imagem vazio.', 400, 'empty');
  }
  const detected = detectImageType(buffer);
  const details = { clientMime: mimetype || null, name: originalname || null, bytesIn: buffer.length };
  let out;

  if (detected && MIME_BY_TYPE[detected]) {
    out = { buffer, mimeType: MIME_BY_TYPE[detected], detected, converted: false };
  } else if (detected === 'tiff') {
    const preview = extractEmbeddedJpeg(buffer);
    if (!preview) {
      throw new OcrImageError(
        'Não foi possível ler esta foto RAW. Desative o RAW na câmera do iPhone ou exporte a foto como JPEG.',
        415,
        'raw_without_preview'
      );
    }
    out = { buffer: preview.buffer, mimeType: 'image/jpeg', detected: preview.isDng ? 'dng' : 'tiff', converted: true };
    Object.assign(details, { previewSource: preview.source, width: preview.width, height: preview.height });
  } else if (detected === 'avif') {
    throw new OcrImageError('Formato AVIF não é suportado na análise. Envie JPG, PNG, HEIC ou RAW (DNG).', 415, 'avif');
  } else if (detected === 'raw-cr3') {
    throw new OcrImageError('Formato RAW CR3 não é suportado. Envie JPG, PNG, HEIC ou RAW (DNG).', 415, 'cr3');
  } else {
    throw new OcrImageError(
      'Formato de imagem não reconhecido. Envie JPG, PNG, WebP, HEIC ou RAW (DNG).',
      415,
      'unknown_format'
    );
  }

  details.bytesOut = out.buffer.length;
  if (out.buffer.length > GEMINI_MAX_IMAGE_BYTES) {
    throw new OcrImageError(
      `Imagem muito grande para análise (${MB(out.buffer.length)} MB). Tire a foto pela câmera do sistema ou reduza a resolução.`,
      413,
      'too_large_for_vision'
    );
  }
  return { ...out, details };
}

module.exports = {
  OcrImageError,
  detectImageType,
  readJpegHeader,
  findJpegEnd,
  extractEmbeddedJpeg,
  normalizeOcrImage,
  GEMINI_MAX_IMAGE_BYTES
};
