const DEFAULT_MODEL = 'gemini-2.0-flash';

const EXTRACTION_PROMPT = `Você analisa a foto de uma lista manuscrita de vendas (português do Brasil).
A lista tem colunas tipicamente: quantidade, produto, nome (cliente) e valor (R$).

Extraia TODAS as linhas de itens. Responda APENAS com JSON válido neste formato:
{
  "lines": [
    {
      "quantity": 1,
      "product": "nome do produto",
      "customer_name": "nome do cliente",
      "value": 18.5
    }
  ]
}

Regras:
- quantity: inteiro >= 1 (se ilegível, use 1)
- product: texto do produto como aparece
- customer_name: nome do cliente; string vazia se ausente
- value: número em reais (aceite vírgula como decimal na leitura e converta para ponto)
- Ignore cabeçalhos, totais e anotações que não sejam linhas de item
- Não invente linhas que não existam na imagem`;

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
  return { apiKey, model };
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
  const source = Array.isArray(payload?.lines) ? payload.lines : [];
  const lines = [];
  for (const row of source) {
    if (!row || typeof row !== 'object') continue;
    const productText = String(row.product ?? row.product_text ?? '').trim();
    const customerText = String(row.customer_name ?? row.customer_text ?? row.nome ?? '').trim();
    const quantity = parseQuantity(row.quantity ?? row.qty ?? row.quantidade);
    const value = parseMoneyValue(row.value ?? row.valor ?? row.price ?? row.unit_price);
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

async function extractListFromImage({ buffer, mimeType }) {
  const { apiKey, model } = getGeminiConfig();
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
    throw new ListVisionError('Envie uma imagem válida (JPG, PNG, WebP ou GIF).', 400);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
      responseMimeType: 'application/json'
    }
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('Erro de rede ao chamar Gemini:', err);
    throw new ListVisionError('Falha ao conectar ao serviço de visão.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMsg = data?.error?.message || data?.error?.status || `HTTP ${response.status}`;
    console.error('Erro Gemini Vision:', apiMsg);
    throw new ListVisionError(
      response.status === 429
        ? 'Limite do serviço de visão atingido. Tente novamente em instantes.'
        : `Falha ao analisar a imagem: ${apiMsg}`,
      response.status === 401 || response.status === 403 ? 503 : 502
    );
  }

  const textPart = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  const jsonText = extractJsonText(textPart);
  if (!jsonText) {
    throw new ListVisionError('A visão não retornou um JSON válido. Tente outra foto.', 422);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ListVisionError('Não foi possível interpretar o resultado da visão.', 422);
  }

  const lines = normalizeExtractedLines(parsed);
  if (lines.length === 0) {
    throw new ListVisionError('Nenhuma linha de item encontrada na imagem.', 422);
  }

  return { lines, model };
}

module.exports = {
  ListVisionError,
  extractListFromImage,
  isGeminiConfigured,
  getGeminiConfig,
  parseMoneyValue,
  parseQuantity,
  normalizeExtractedLines
};
