// Logs do fluxo de análise de imagem (OCR via Gemini).
// Uma linha por evento, sempre com o prefixo [OCR] e JSON — fácil de filtrar nos logs do Render:
//   [OCR] {"ts":"…","flow":"diario","req":"k3f9a2","step":"upload.received",…}
// Filtre por "[OCR]" para ver tudo, ou pelo "req" para seguir uma análise do início ao fim.

const { randomBytes } = require('crypto');

function serializeError(err) {
  if (!err) return undefined;
  return {
    name: err.name,
    message: err.message,
    status: err.statusCode || err.status,
    code: err.code,
    stack: err.stack ? String(err.stack).split('\n').slice(0, 6).join(' | ') : undefined
  };
}

function write(level, payload) {
  let line;
  try {
    line = JSON.stringify(payload);
  } catch {
    line = JSON.stringify({ ...payload, data: '[não serializável]' });
  }
  const out = `[OCR] ${line}`;
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

/**
 * Cria um logger para uma requisição de análise.
 * @param {string} flow - 'diario' | 'cliente'
 * @param {import('express').Request} [req]
 */
function createOcrLog(flow, req) {
  const id = randomBytes(4).toString('hex');
  const startedAt = Date.now();
  const user = req?.user ? (req.user.username || req.user.email || req.user.id) : undefined;

  const base = (level, step, data) => {
    write(level, {
      ts: new Date().toISOString(),
      flow,
      req: id,
      step,
      ms: Date.now() - startedAt,
      ...(user !== undefined && step === 'request.start' ? { user } : {}),
      ...(data || {})
    });
  };

  return {
    id,
    info: (step, data) => base('info', step, data),
    warn: (step, data) => base('warn', step, data),
    error: (step, err, data) => base('error', step, { ...(data || {}), error: serializeError(err) }),
    elapsed: () => Date.now() - startedAt
  };
}

/** Logger que não escreve nada (quando o chamador não passa um). */
const noopLog = { id: '-', info() {}, warn() {}, error() {}, elapsed: () => 0 };

module.exports = { createOcrLog, noopLog, serializeError };
