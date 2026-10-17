const { ListVisionError, getGeminiConfig, extractJsonText } = require('./listVisionParse');

const CLIENT_PROMPT = `Você analisa a foto de uma ficha/formulário de cadastro de cliente (português do Brasil),
geralmente manuscrita, no formato "rótulo: valor", por exemplo:
Nome: ...
Telefone: ...
Instagram: ...
Data: ...

Responda APENAS com JSON válido neste formato:
{ "name": "", "phone": "", "instagram": "", "date": "" }

Regras:
- name: nome completo como escrito
- phone: apenas dígitos, com DDD se houver (ex.: 27999998888)
- instagram: usuário sem "@" e sem URL
- date: data no formato AAAA-MM-DD; se só houver dia/mês, use o ano atual; string vazia se ausente
- Campo ilegível ou ausente: string vazia. Não invente dados.`;

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}

function normalizePhone(raw) {
  let d = digitsOnly(raw);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith('0') && d.length >= 11) d = d.slice(1);
  return d;
}

function normalizeInstagram(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@+/, '');
  s = s.split(/[/?\s]/)[0];
  return s.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30);
}

function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y; let mo; let d;
  if (m) { [, y, mo, d] = m; } else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
    if (!m) return '';
    [, d, mo, y] = m;
    if (!y) y = String(new Date().getFullYear());
    if (y.length === 2) y = `20${y}`;
  }
  const out = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${out}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? '' : out;
}

async function extractClientFromImage({ buffer, mimeType }) {
  const { apiKey, model } = getGeminiConfig();
  if (!apiKey) {
    throw new ListVisionError('GEMINI_API_KEY não configurada. Defina a chave no .env.', 503);
  }
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ListVisionError('Arquivo de imagem vazio', 400);
  }
  const mime = String(mimeType || '').toLowerCase();
  if (!mime.startsWith('image/')) {
    throw new ListVisionError('Envie uma imagem válida (JPG, PNG, WebP ou GIF).', 400);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: CLIENT_PROMPT },
            { inline_data: { mime_type: mime, data: buffer.toString('base64') } }
          ]
        }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      })
    });
  } catch (err) {
    console.error('Erro de rede ao chamar Gemini:', err);
    throw new ListVisionError('Falha ao conectar ao serviço de visão.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMsg = data?.error?.message || data?.error?.status || `HTTP ${response.status}`;
    console.error('Erro Gemini Vision (cliente):', apiMsg);
    throw new ListVisionError(
      response.status === 429
        ? 'Limite do serviço de visão atingido. Tente novamente em instantes.'
        : `Falha ao analisar a imagem: ${apiMsg}`,
      response.status === 401 || response.status === 403 ? 503 : 502
    );
  }

  const textPart = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  const jsonText = extractJsonText(textPart);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ListVisionError('Não foi possível interpretar a ficha. Tente outra foto.', 422);
  }
  const src = Array.isArray(parsed) ? parsed[0] || {} : parsed || {};

  const client = {
    name: String(src.name ?? src.nome ?? '').trim(),
    phone: normalizePhone(src.phone ?? src.telefone),
    instagram: normalizeInstagram(src.instagram),
    date: normalizeDate(src.date ?? src.data)
  };
  if (!client.name && !client.phone && !client.instagram) {
    throw new ListVisionError('Nenhum dado de cliente encontrado na imagem.', 422);
  }
  return { client, model };
}

module.exports = { extractClientFromImage, normalizeInstagram, normalizeDate };
