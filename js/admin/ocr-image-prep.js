// Prepara a foto antes de enviar para análise (OCR).
// - Reduz fotos grandes para no máx. 2560 px no lado maior e converte para JPEG
//   (HEIC do iPhone, PNG gigante etc.) — envio mais rápido e dentro do limite do Gemini
// - Se o navegador não conseguir abrir o arquivo (ex.: RAW/DNG), envia o original:
//   o servidor extrai o JPEG de prévia embutido
// Uso: const { file, meta } = await OcrImagePrep.prepare(original)

const OcrImagePrep = (() => {
  const MAX_SIDE = 2560;
  const JPEG_QUALITY = 0.85;
  const PASS_THROUGH_MAX_BYTES = 2.5 * 1024 * 1024;
  const PASS_THROUGH_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const DECODE_TIMEOUT_MS = 20000;

  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: tempo esgotado`)), ms); })
    ]).finally(() => clearTimeout(timer));
  }

  async function decodeWithImageBitmap(file) {
    if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap indisponível');
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      via: 'bitmap',
      cleanup: () => bitmap.close?.()
    };
  }

  async function decodeWithImg(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      if (img.decode) await img.decode();
      else await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('img onerror')); });
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('imagem sem dimensões');
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        via: 'img',
        cleanup: () => URL.revokeObjectURL(url)
      };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  async function decode(file) {
    const errors = [];
    for (const fn of [decodeWithImageBitmap, decodeWithImg]) {
      try {
        return await withTimeout(fn(file), DECODE_TIMEOUT_MS, fn.name);
      } catch (err) {
        errors.push(`${fn.name}: ${err?.message || err}`);
      }
    }
    const e = new Error(errors.join(' | '));
    e.name = 'DecodeError';
    throw e;
  }

  function canvasToJpeg(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob vazio'))), 'image/jpeg', JPEG_QUALITY);
    });
  }

  function jpegName(name) {
    const base = String(name || 'foto').replace(/\.[^.]+$/, '');
    return `${base || 'foto'}.jpg`;
  }

  async function prepare(file) {
    const t0 = performance.now();
    const meta = {
      name: file?.name,
      type: file?.type || '(vazio)',
      bytes: file?.size,
      ua: navigator.userAgent.slice(0, 120)
    };
    const done = (outFile, extra) => {
      Object.assign(meta, extra, { ms: Math.round(performance.now() - t0), bytesOut: outFile.size });
      console.info('[OCR prep]', meta);
      return { file: outFile, meta };
    };

    if (!file) return { file, meta };

    if (PASS_THROUGH_TYPES.has(file.type) && file.size <= PASS_THROUGH_MAX_BYTES) {
      return done(file, { action: 'original' });
    }

    let decoded;
    try {
      decoded = await decode(file);
    } catch (err) {
      // RAW/DNG e formatos que o navegador não abre: o servidor trata
      return done(file, { action: 'original-undecodable', decodeError: String(err.message || err).slice(0, 300) });
    }

    try {
      const { width, height } = decoded;
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      const outW = Math.max(1, Math.round(width * scale));
      const outH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(decoded.source, 0, 0, outW, outH);
      const blob = await canvasToJpeg(canvas);
      canvas.width = 0;
      canvas.height = 0;

      const extra = { action: 'converted', via: decoded.via, width, height, outW, outH };
      if (PASS_THROUGH_TYPES.has(file.type) && blob.size >= file.size) {
        return done(file, { ...extra, action: 'original-smaller' });
      }
      return done(new File([blob], jpegName(file.name), { type: 'image/jpeg' }), extra);
    } catch (err) {
      return done(file, { action: 'original-convert-failed', convertError: String(err.message || err).slice(0, 300) });
    } finally {
      decoded.cleanup?.();
    }
  }

  return { prepare, MAX_SIDE };
})();
