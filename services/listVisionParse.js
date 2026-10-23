const { noopLog } = require('./ocrLog');

// Modelos atuais (out/2026): a família 2.x foi desligada ou restrita a projetos antigos.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
// Tentados em ordem se o modelo principal estiver indisponível (aposentado/restrito)
const DEFAULT_FALLBACK_MODELS = ['gemini-3.8-flash'];

const EXTRACTION_PROMPT = `Você analisa a foto de uma lista manuscrita de vendas (português do Brasil).
Colunas típicas: quantidade, produto, nome do cliente e valor (R$).
Geralmente há uma data (ex.: "21/10", "Seg 21/10", "21 de outubro") ACIMA de um bloco de itens;
a foto pode ter mais de uma data, cada uma seguida dos seus itens.

Extraia TODAS as linhas de itens, agrupadas pela data escrita acima delas, no JSON:
{"sections":[{"date":"21/10","day":21,"month":10,"year":null,"items":[{"q":1,"p":"produto","c":"cliente","v":18.5}]}]}

Regras:
- Datas no formato brasileiro (dia antes do mês). date: como escrita; day/month inteiros; year só se escrito, senão null
- Itens sem data acima: seção com date "", day null, month null
- q: quantidade inteira >= 1 (ilegível = 1); p: produto como aparece; c: cliente ou ""; v: valor em reais (número)
- Ignore cabeçalhos, totais e anotações; não invente linhas; não repita itens`;

const MONTHS_PT = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4,
  mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8,
  set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12
};

function todayYmdBrazil() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function toInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
  return Number.isInteger(n) ? n : null;
}

/** Lê dia/mês/ano de um texto como "21/10", "Seg 21-10-26" ou "21 de outubro". */
function parseDateText(text) {
  const raw = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!raw.trim()) return null;
  let m = raw.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?/);
  if (m) return { day: toInt(m[1]), month: toInt(m[2]), year: m[3] ? toInt(m[3]) : null };
  m = raw.match(/(\d{1,2})\s*(?:de\s+)?([a-z]{3,9})\.?(?:\s*(?:de\s+)?(\d{2,4}))?/);
  if (m && MONTHS_PT[m[2]]) return { day: toInt(m[1]), month: MONTHS_PT[m[2]], year: m[3] ? toInt(m[3]) : null };
  return null;
}

/**
 * Converte dia/mês (ano opcional) em YYYY-MM-DD.
 * Sem ano: usa o ano de `today`; se a data cair no futuro, usa o ano anterior.
 */
function resolveListDate(day, month, year, today = todayYmdBrazil()) {
  const d = toInt(day);
  const mo = toInt(month);
  if (!d || !mo || d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const todayYear = Number(String(today).slice(0, 4));
  let y = toInt(year);
  if (y != null && y < 100) y += 2000;
  const explicitYear = y != null && y >= 2000 && y <= todayYear + 1;
  if (!explicitYear) y = todayYear;

  const build = (yy) => {
    const dt = new Date(Date.UTC(yy, mo - 1, d));
    if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  let ymd = build(y);
  if (!ymd) return null;
  if (!explicitYear && ymd > today) ymd = build(y - 1);
  return ymd;
}

class ListVisionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'ListVisionError';
    this.statusCode = statusCode;
  }
}

function getGeminiConfig() {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const model = String(process.env.GEMINI_MODEL || '').trim() || DEFAULT_MODEL;
  const rawFallback = String(process.env.GEMINI_FALLBACK_MODELS || '').trim();
  const fallbacks = rawFallback.toLowerCase() === 'none'
    ? []
    : (rawFallback ? rawFallback.split(',').map((m) => m.trim()).filter(Boolean) : DEFAULT_FALLBACK_MODELS);
  const models = [model, ...fallbacks].filter((m, i, arr) => arr.indexOf(m) === i);
  return { apiKey, model, models };
}

// Modelos que responderam "indisponível" neste processo — pulados nas próximas chamadas
const unavailableModels = new Set();

function isModelUnavailableError(status, data) {
  const msg = String(data?.error?.message || '');
  if (status === 404) return true;
  if (![400, 403].includes(status)) return false;
  return /no longer available|not found|is not supported|deprecated|not available to new users|update your code to use/i.test(msg);
}

function isGeminiConfigured() {
  return Boolean(getGeminiConfig().apiKey);
}

function parseMoneyValue(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : null;
  }
  let str = String(raw).trim();
  if (!str) return null;
  str = str.replace(/[R$\s]/gi, '');
  if (str.includes(',') && str.includes('.')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else {
    str = str.replace(',', '.');
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

function parseQuantity(raw) {
  if (raw === undefined || raw === null || raw === '') return 1;
  const n = parseInt(String(raw).replace(/[^\d-]/g, ''), 10);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

function extractJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (raw.startsWith('{')) return raw;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return null;
}

function normalizeExtractedLines(payload) {
  const source = Array.isArray(payload?.lines) ? payload.lines
    : (Array.isArray(payload?.items) ? payload.items : []);
  const lines = [];
  for (const row of source) {
    if (!row || typeof row !== 'object') continue;
    const productText = String(row.p ?? row.product ?? row.product_text ?? '').trim();
    const customerText = String(row.c ?? row.customer_name ?? row.customer_text ?? row.nome ?? '').trim();
    const quantity = parseQuantity(row.q ?? row.quantity ?? row.qty ?? row.quantidade);
    const value = parseMoneyValue(row.v ?? row.value ?? row.valor ?? row.price ?? row.unit_price);
    if (!productText && !customerText && value == null) continue;
    lines.push({
      quantity,
      product_text: productText,
      customer_text: customerText,
      value: value != null ? value : 0
    });
  }
  return lines;
}

/**
 * Normaliza o JSON da visão em seções por data. Aceita o formato antigo ({ lines }).
 * Seções com a mesma data (ou sem data) são unidas, mantendo a ordem de aparição.
 */
function normalizeExtractedSections(payload, { today = todayYmdBrazil() } = {}) {
  const rawSections = Array.isArray(payload?.sections)
    ? payload.sections
    : [{ date_text: '', day: null, month: null, year: null, lines: payload?.lines ?? payload?.items }];

  const byKey = new Map();
  for (const section of rawSections) {
    if (!section || typeof section !== 'object') continue;
    const lines = normalizeExtractedLines({ lines: section.lines ?? section.items });
    if (!lines.length) continue;

    const dateText = String(section.date_text ?? section.date ?? '').trim();
    let date = resolveListDate(section.day, section.month, section.year, today);
    if (!date && dateText) {
      const parsed = parseDateText(dateText);
      if (parsed) date = resolveListDate(parsed.day, parsed.month, parsed.year, today);
    }

    const key = date || '__sem_data__';
    if (!byKey.has(key)) {
      byKey.set(key, { date, date_text: dateText, lines: [] });
    }
    const target = byKey.get(key);
    if (!target.date_text && dateText) target.date_text = dateText;
    target.lines.push(...lines);
  }
  return Array.from(byKey.values());
}

// Formato fixo da resposta (chaves curtas = menos texto gerado = resposta mais rápida)
const LIST_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          day: { type: 'INTEGER', nullable: true },
          month: { type: 'INTEGER', nullable: true },
          year: { type: 'INTEGER', nullable: true },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                q: { type: 'INTEGER' },
                p: { type: 'STRING' },
                c: { type: 'STRING' },
                v: { type: 'NUMBER' }
              },
              required: ['q', 'p', 'c', 'v']
            }
          }
        },
        required: ['date', 'items']
      }
    }
  },
  required: ['sections']
};

/** Nível de raciocínio: o mínimo que cada modelo aceita (Flash-Lite/3.6: minimal; 3.8 Flash: low). */
function thinkingLevelFor(model) {
  const env = String(process.env.GEMINI_THINKING_LEVEL || '').trim().toLowerCase();
  if (env === 'off' || env === 'none') return null;
  if (env) return env;
  return /flash-lite|3\.6-flash|3-flash-preview/.test(model) ? 'minimal' : 'low';
}

/** Resolução da imagem na análise: low | medium | high (padrão medium = 560 tokens). */
function mediaResolutionFor() {
  const env = String(process.env.GEMINI_MEDIA_RESOLUTION || 'medium').trim().toLowerCase();
  if (env === 'off' || env === 'none' || env === 'default') return null;
  return `MEDIA_RESOLUTION_${env.toUpperCase()}`;
}

/** Acrescenta raciocínio mínimo e resolução de imagem ao corpo da requisição. */
function withPerformanceConfig(body, model) {
  const generationConfig = { ...(body.generationConfig || {}) };
  const level = thinkingLevelFor(model);
  if (level) generationConfig.thinkingConfig = { thinkingLevel: level };
  const media = mediaResolutionFor();
  if (media) generationConfig.mediaResolution = media;
  return { ...body, generationConfig };
}

// Modelos que recusaram os parâmetros de desempenho — chamados sem eles nas próximas vezes
const perfConfigRejected = new Set();

/**
 * Chama o Gemini com log de requisição/resposta. Devolve { data, textPart, model }.
 * Se o modelo estiver indisponível (aposentado ou restrito ao projeto), tenta o próximo da lista.
 * Lança ListVisionError com mensagem amigável em falhas.
 */
async function callGeminiVision({ apiKey, models, body, mime, bytes, log = noopLog }) {
  const list = (Array.isArray(models) ? models : [models]).filter(Boolean);
  const candidates = list.filter((m) => !unavailableModels.has(m));
  if (!candidates.length) candidates.push(list[list.length - 1]);
  if (candidates.length < list.length) {
    log.info('gemini.skip_unavailable', { skipped: list.filter((m) => !candidates.includes(m)) });
  }

  let lastUnavailable = null;
  for (let attempt = 0; attempt < candidates.length; attempt++) {
    const model = candidates[attempt];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const usePerf = !perfConfigRejected.has(model);
    const requestBody = usePerf ? withPerformanceConfig(body, model) : body;
    const gc = requestBody.generationConfig || {};
    log.info('gemini.request', {
      model,
      attempt: attempt + 1,
      mime,
      bytes,
      thinkingLevel: gc.thinkingConfig?.thinkingLevel,
      mediaResolution: gc.mediaResolution,
      schema: Boolean(gc.responseSchema)
    });
    const t0 = Date.now();
    const post = (payload) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let response;
    let data;
    try {
      response = await post(requestBody);
      data = await response.json().catch(() => ({}));
      // Parâmetro de desempenho não aceito por este modelo/API: repete sem eles
      if (usePerf && response.status === 400
        && /thinking|media_?resolution|mediaResolution|Unknown name|Invalid value|not supported/i.test(String(data?.error?.message || ''))) {
        perfConfigRejected.add(model);
        log.warn('gemini.config_rejected', { model, apiMessage: String(data?.error?.message || '').slice(0, 300) });
        response = await post(body);
        data = await response.json().catch(() => ({}));
      }
    } catch (err) {
      log.error('gemini.network_error', err, { model, gemMs: Date.now() - t0 });
      throw new ListVisionError('Falha ao conectar ao serviço de visão.', 502);
    }

    const candidate = data?.candidates?.[0];
    const textPart = candidate?.content?.parts?.find((p) => p.text)?.text;
    const info = {
      model,
      status: response.status,
      gemMs: Date.now() - t0,
      finishReason: candidate?.finishReason,
      blockReason: data?.promptFeedback?.blockReason,
      usage: data?.usageMetadata,
      textChars: textPart ? textPart.length : 0
    };

    if (!response.ok) {
      const apiMsg = data?.error?.message || data?.error?.status || `HTTP ${response.status}`;
      const failInfo = { ...info, apiStatus: data?.error?.status, apiMessage: String(apiMsg).slice(0, 500) };

      if (isModelUnavailableError(response.status, data)) {
        unavailableModels.add(model);
        lastUnavailable = { model, apiMsg };
        const next = candidates[attempt + 1];
        log.warn('gemini.model_unavailable', { ...failInfo, nextModel: next || null });
        if (next) continue;
        throw new ListVisionError(
          `O modelo do Gemini "${model}" não está disponível para esta chave. `
          + `Configure GEMINI_MODEL com um modelo atual (ex.: ${DEFAULT_MODEL}).`,
          503
        );
      }

      log.error('gemini.failed', null, failInfo);
      throw new ListVisionError(
        response.status === 429
          ? 'Limite do serviço de visão atingido. Tente novamente em instantes.'
          : `Falha ao analisar a imagem: ${apiMsg}`,
        response.status === 401 || response.status === 403 ? 503 : 502
      );
    }

    log.info('gemini.response', { ...info, fallbackFrom: lastUnavailable ? lastUnavailable.model : undefined });
    if (!textPart) {
      log.warn('gemini.empty_text', { finishReason: info.finishReason, blockReason: info.blockReason });
    }
    return { data, textPart, model };
  }
  throw new ListVisionError('Nenhum modelo do Gemini configurado.', 503);
}

async function extractListFromImage({ buffer, mimeType, today, log = noopLog }) {
  const { apiKey, models } = getGeminiConfig();
  if (!apiKey) {
    throw new ListVisionError(
      'GEMINI_API_KEY não configurada. Defina a chave no .env para importar listas.',
      503
    );
  }
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ListVisionError('Arquivo de imagem vazio', 400);
  }
  const mime = String(mimeType || '').toLowerCase();
  if (!mime.startsWith('image/')) {
    throw new ListVisionError('Envie uma imagem válida (JPG, PNG, WebP, HEIC ou RAW).', 400);
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: EXTRACTION_PROMPT },
          {
            inline_data: {
              mime_type: mime,
              data: buffer.toString('base64')
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: LIST_RESPONSE_SCHEMA,
      maxOutputTokens: 4096
    }
  };

  const { data, textPart, model } = await callGeminiVision({ apiKey, models, body, mime, bytes: buffer.length, log });
  const jsonText = extractJsonText(textPart);
  if (!jsonText) {
    log.warn('vision.invalid_json', { snippet: String(textPart || '').slice(0, 300) });
    throw new ListVisionError('A visão não retornou um JSON válido. Tente outra foto.', 422);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    log.warn('vision.invalid_json', { snippet: jsonText.slice(0, 300), parseError: err.message });
    throw new ListVisionError('Não foi possível interpretar o resultado da visão.', 422);
  }

  const rawSections = Array.isArray(parsed?.sections) ? parsed.sections : null;
  const sections = normalizeExtractedSections(parsed, { today: today || todayYmdBrazil() });
  const lines = sections.flatMap((section) => section.lines);
  log.info('vision.parsed', {
    format: rawSections ? 'sections' : 'lines',
    rawSections: rawSections ? rawSections.map((sec) => ({
      date_text: sec?.date_text ?? sec?.date, day: sec?.day, month: sec?.month, year: sec?.year,
      lines: Array.isArray(sec?.lines ?? sec?.items) ? (sec.lines ?? sec.items).length : 0
    })) : undefined,
    sections: sections.map((sec) => ({ date: sec.date, date_text: sec.date_text, lines: sec.lines.length })),
    totalLines: lines.length
  });
  if (lines.length === 0) {
    throw new ListVisionError('Nenhuma linha de item encontrada na imagem.', 422);
  }

  return { sections, lines, model, usage: data?.usageMetadata };
}

module.exports = {
  ListVisionError,
  extractListFromImage,
  isGeminiConfigured,
  getGeminiConfig,
  isModelUnavailableError,
  DEFAULT_MODEL,
  parseMoneyValue,
  parseQuantity,
  normalizeExtractedLines,
  normalizeExtractedSections,
  callGeminiVision,
  withPerformanceConfig,
  thinkingLevelFor,
  resolveListDate,
  parseDateText,
  extractJsonText
};
