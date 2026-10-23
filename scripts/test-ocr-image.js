// scripts/test-ocr-image.js — detecção de formato e extração de JPEG de RAW (DNG)
const {
  detectImageType,
  readJpegHeader,
  findJpegEnd,
  extractEmbeddedJpeg,
  normalizeOcrImage
} = require('../services/ocrImage');

let failures = 0;
function eq(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${desc}: esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${desc}`);
  }
}
function throws(desc, fn, code) {
  try {
    fn();
    failures++;
    console.log(`FAIL ${desc}: não lançou erro`);
  } catch (e) {
    eq(desc, e.code, code);
  }
}

/** JPEG mínimo (cabeçalho válido, dados fictícios). sof: 0xC0 baseline, 0xC3 lossless (RAW). */
function makeJpeg(width, height, sof = 0xc0, dataLen = 64) {
  const sofSeg = Buffer.from([
    0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const data = Buffer.alloc(dataLen, 0x12);
  data[10] = 0xff; data[11] = 0x00; // byte stuffing
  data[20] = 0xff; data[21] = 0xd3; // marcador RST
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sofSeg, sos, data, Buffer.from([0xff, 0xd9])]);
}

/** DNG sintético (little endian) como o ProRAW: IFD0 com miniatura + SubIFDs (RAW lossless e prévia). */
function makeDng({ withPreview = true } = {}) {
  const thumb = makeJpeg(256, 192);
  const raw = makeJpeg(8064, 6048, 0xc3, 400);
  const preview = makeJpeg(4032, 3024, 0xc0, 200);

  const ifd0Entries = 5;
  const subEntries = 4;
  const ifdSize = (n) => 2 + n * 12 + 4;
  let off = 8;
  const ifd0 = off; off += ifdSize(ifd0Entries);
  const subArr = off; off += 8;
  const sub1 = off; off += ifdSize(subEntries);
  const sub2 = off; off += ifdSize(subEntries);
  const thumbOff = off; off += thumb.length;
  const rawOff = off; off += raw.length;
  const prevOff = off; off += preview.length;

  const buf = Buffer.alloc(off);
  buf.write('II', 0, 'latin1');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifd0, 4);

  const writeIfd = (at, entries, next = 0) => {
    buf.writeUInt16LE(entries.length, at);
    entries.forEach(([tag, type, count, value], i) => {
      const e = at + 2 + i * 12;
      buf.writeUInt16LE(tag, e);
      buf.writeUInt16LE(type, e + 2);
      buf.writeUInt32LE(count, e + 4);
      if (type === 1 && count <= 4) Buffer.from(value).copy(buf, e + 8);
      else buf.writeUInt32LE(value, e + 8);
    });
    buf.writeUInt32LE(next, at + 2 + entries.length * 12);
  };

  writeIfd(ifd0, [
    [254, 4, 1, 1], // NewSubFileType: reduzida
    [330, 4, 2, subArr], // SubIFDs
    [513, 4, 1, thumbOff], // JPEGInterchangeFormat
    [514, 4, 1, thumb.length],
    [50706, 1, 4, [1, 6, 0, 0]] // DNGVersion
  ]);
  buf.writeUInt32LE(sub1, subArr);
  buf.writeUInt32LE(sub2, subArr + 4);
  writeIfd(sub1, [[254, 4, 1, 0], [259, 3, 1, 7], [273, 4, 1, rawOff], [279, 4, 1, raw.length]]);
  writeIfd(sub2, withPreview
    ? [[254, 4, 1, 1], [259, 3, 1, 7], [273, 4, 1, prevOff], [279, 4, 1, preview.length]]
    : [[254, 4, 1, 1], [259, 3, 1, 1], [273, 4, 1, prevOff], [279, 4, 1, preview.length]]);
  thumb.copy(buf, thumbOff);
  raw.copy(buf, rawOff);
  preview.copy(buf, prevOff);
  return { buf, preview, thumb };
}

// --- Detecção ---
const jpeg = makeJpeg(1200, 900);
eq('detecta JPEG', detectImageType(jpeg), 'jpeg');
eq('detecta PNG', detectImageType(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), 'png');
eq('detecta WebP', detectImageType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1')), 'webp');
eq('detecta HEIC', detectImageType(Buffer.from('\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000mif1heic', 'latin1')), 'heic');
eq('detecta HEIF (mif1)', detectImageType(Buffer.from('\u0000\u0000\u0000\u0018ftypmif1\u0000\u0000\u0000\u0000mif1miaf', 'latin1')), 'heif');
eq('detecta AVIF', detectImageType(Buffer.from('\u0000\u0000\u0000\u001cftypavif\u0000\u0000\u0000\u0000avifmif1miaf', 'latin1')), 'avif');
eq('detecta TIFF/DNG', detectImageType(makeDng().buf), 'tiff');
eq('bytes aleatórios', detectImageType(Buffer.from('não é imagem nenhuma', 'utf8')), null);

// --- JPEG ---
eq('lê dimensões do JPEG baseline', readJpegHeader(jpeg, 0), { width: 1200, height: 900 });
eq('JPEG lossless (RAW) é ignorado', readJpegHeader(makeJpeg(100, 100, 0xc3), 0), null);
eq('acha o fim do JPEG (com stuffing e RST)', findJpegEnd(jpeg, 0), jpeg.length);

// --- DNG ---
const dng = makeDng();
const extracted = extractEmbeddedJpeg(dng.buf);
eq('DNG: escolhe a maior prévia JPEG (não o RAW lossless)', extracted && [extracted.width, extracted.height, extracted.isDng], [4032, 3024, true]);
eq('DNG: bytes extraídos = prévia', extracted && extracted.buffer.equals(dng.preview), true);

const dngThumbOnly = makeDng({ withPreview: false });
const thumbOnly = extractEmbeddedJpeg(dngThumbOnly.buf);
eq('DNG sem prévia grande usa a miniatura', thumbOnly && [thumbOnly.width, thumbOnly.height], [256, 192]);

// Fallback por varredura: TIFF com IFD quebrado mas JPEG solto no arquivo
const broken = Buffer.concat([Buffer.from('II*\u0000ÿÿÿ\u0000', 'latin1'), Buffer.alloc(32), makeJpeg(2000, 1500), Buffer.alloc(16)]);
const scanned = extractEmbeddedJpeg(broken);
eq('fallback por varredura encontra JPEG', scanned && [scanned.width, scanned.height, scanned.source], [2000, 1500, 'scan']);

// --- normalizeOcrImage ---
const n1 = normalizeOcrImage({ buffer: jpeg, mimetype: 'application/octet-stream', originalname: 'x' });
eq('JPEG com mimetype errado vira image/jpeg', [n1.mimeType, n1.converted], ['image/jpeg', false]);
const n2 = normalizeOcrImage({ buffer: dng.buf, mimetype: 'image/x-adobe-dng', originalname: 'IMG_0001.DNG' });
eq('DNG vira JPEG de prévia', [n2.mimeType, n2.detected, n2.converted, n2.details.width], ['image/jpeg', 'dng', true, 4032]);
const heic = Buffer.concat([Buffer.from('\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000mif1heic', 'latin1'), Buffer.alloc(100)]);
eq('HEIC segue como image/heic', normalizeOcrImage({ buffer: heic, mimetype: '' }).mimeType, 'image/heic');
throws('formato desconhecido', () => normalizeOcrImage({ buffer: Buffer.alloc(100, 1) }), 'unknown_format');
throws('arquivo vazio', () => normalizeOcrImage({ buffer: Buffer.alloc(0) }), 'empty');
const tiffNoJpeg = Buffer.concat([Buffer.from('II*\u0000\u0000\u0000\u0000\u0000', 'latin1'), Buffer.alloc(64)]);
throws('RAW sem prévia', () => normalizeOcrImage({ buffer: tiffNoJpeg }), 'raw_without_preview');

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log('\nTodos ok');
