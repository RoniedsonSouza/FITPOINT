const crypto = require('crypto');
const { Resend } = require('resend');
const { generateTicketQrPng } = require('./qrcode');
const { formatTimestampPtBR } = require('./datetime');

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY não configurada');
  }
  return new Resend(apiKey);
}

function getFromAddress() {
  return process.env.RESEND_FROM || 'FitPoint <onboarding@resend.dev>';
}

/** Extrai só o endereço de "Nome <email@x.com>" ou "email@x.com". */
function extractEmailAddress(value) {
  const raw = String(value || '').trim();
  const angle = raw.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  return raw.toLowerCase();
}

function getReplyToAddress() {
  const explicit = String(process.env.RESEND_REPLY_TO || '').trim();
  if (explicit) return extractEmailAddress(explicit) || explicit;
  const fromEmail = extractEmailAddress(getFromAddress());
  if (fromEmail && !fromEmail.endsWith('@resend.dev')) return fromEmail;
  return undefined;
}

function getAppBaseUrl() {
  return String(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function getUnsubscribeSecret() {
  return (
    process.env.RESEND_UNSUBSCRIBE_SECRET ||
    process.env.JWT_SECRET ||
    'fitpoint-unsubscribe-dev-secret'
  );
}

function createUnsubscribeToken(email) {
  const e = String(email || '').trim().toLowerCase();
  const sig = crypto
    .createHmac('sha256', getUnsubscribeSecret())
    .update(`unsub:${e}`)
    .digest('base64url');
  return `${Buffer.from(e, 'utf8').toString('base64url')}.${sig}`;
}

function parseUnsubscribeToken(token) {
  const raw = String(token || '').trim();
  const [encoded, sig] = raw.split('.');
  if (!encoded || !sig) return null;
  let email;
  try {
    email = Buffer.from(encoded, 'base64url').toString('utf8').trim().toLowerCase();
  } catch {
    return null;
  }
  if (!email || !email.includes('@')) return null;
  const expected = crypto
    .createHmac('sha256', getUnsubscribeSecret())
    .update(`unsub:${email}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return email;
}

function buildUnsubscribeUrl(email) {
  const token = createUnsubscribeToken(email);
  return `${getAppBaseUrl()}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function baseSendOptions() {
  const opts = { from: getFromAddress() };
  const replyTo = getReplyToAddress();
  if (replyTo) opts.replyTo = replyTo;
  return opts;
}

/**
 * Envia e-mail com os ingressos e QR Codes (HTML + anexos PNG).
 * QR fica só em anexo (sem data-URL no HTML — melhor para filtros de spam).
 */
async function sendTicketEmail({ to, buyerName, event, lot, tickets, complimentary = false }) {
  const resend = getResendClient();
  const attachments = [];
  const ticketBlocksHtml = [];
  const ticketLinesText = [];

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const png = await generateTicketQrPng(ticket.code);
    const filename = `ingresso-${ticket.code}.png`;
    const base64 = png.toString('base64');
    attachments.push({
      filename,
      content: base64
    });
    ticketBlocksHtml.push(`
      <div style="margin:24px 0;padding:16px;border:1px solid #e5e5e5;border-radius:12px;">
        <p style="margin:0 0 8px;font-weight:600;">Ingresso ${i + 1} de ${tickets.length}</p>
        <p style="margin:0;font-family:monospace;font-size:14px;">Código: <strong>${escapeHtml(ticket.code)}</strong></p>
        <p style="margin:12px 0 0;color:#666;font-size:12px;">QR Code anexado: ${escapeHtml(filename)}</p>
      </div>
    `);
    ticketLinesText.push(
      `Ingresso ${i + 1}/${tickets.length}: código ${ticket.code} (QR em anexo: ${filename})`
    );
  }

  const introLine = complimentary
    ? 'Seu ingresso VIP/cortesia para o evento:'
    : 'Pagamento confirmado. Segue o ingresso para o evento:';
  const subject = complimentary
    ? `Ingresso VIP — ${event.title}`
    : `Ingresso confirmado — ${event.title}`;

  const replyTo = getReplyToAddress();
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0E1F16;">
      <h1 style="color:#1D6B3A;font-size:22px;">Seu ingresso FitPoint</h1>
      <p>Olá, <strong>${escapeHtml(buyerName)}</strong>!</p>
      <p>${introLine}</p>
      <div style="background:#F5F3EE;padding:16px;border-radius:12px;margin:16px 0;">
        <p style="margin:0 0 6px;"><strong>${escapeHtml(event.title)}</strong></p>
        <p style="margin:0 0 6px;">${formatTimestampPtBR(event.starts_at)}</p>
        <p style="margin:0 0 6px;">Local: ${escapeHtml(event.venue || 'A definir')}</p>
        <p style="margin:0;">Lote: ${escapeHtml(lot.name)}</p>
      </div>
      ${ticketBlocksHtml.join('')}
      <p style="color:#666;font-size:13px;">Apresente o QR Code na entrada. Guarde este e-mail.</p>
      <p style="color:#1D6B3A;font-weight:600;">FitPoint Fitness</p>
      ${replyTo ? `<p style="color:#888;font-size:12px;margin-top:24px;">Dúvidas? Responda este e-mail ou escreva para ${escapeHtml(replyTo)}.</p>` : ''}
    </div>
  `;

  const text = [
    'Seu ingresso FitPoint',
    '',
    `Olá, ${buyerName}!`,
    introLine,
    '',
    `Evento: ${event.title}`,
    `Data: ${formatTimestampPtBR(event.starts_at)}`,
    `Local: ${event.venue || 'A definir'}`,
    `Lote: ${lot.name}`,
    '',
    ...ticketLinesText,
    '',
    'Apresente o QR Code na entrada. Guarde este e-mail.',
    'FitPoint Fitness',
    replyTo ? `Dúvidas: ${replyTo}` : ''
  ]
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n')
    .trim();

  const result = await resend.emails.send({
    ...baseSendOptions(),
    to: [to],
    subject,
    html,
    text,
    attachments,
    tags: [{ name: 'category', value: 'ticket' }]
  });

  if (result.error) {
    throw new Error(result.error.message || 'Falha ao enviar e-mail via Resend');
  }

  return result.data;
}

/**
 * Converte texto plano do admin em HTML simples para campanha.
 */
function campaignBodyToHtml(body, { unsubscribeUrl, replyTo } = {}) {
  const escaped = escapeHtml(body).replace(/\r\n|\r|\n/g, '<br>\n');
  const unsubBlock = unsubscribeUrl
    ? `<p style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e5e5;color:#888;font-size:12px;line-height:1.5;">
         Você recebeu este e-mail da FitPoint Fitness.
         <a href="${escapeHtml(unsubscribeUrl)}" style="color:#1D6B3A;">Cancelar inscrição</a>
         ${replyTo ? ` · Contato: <a href="mailto:${escapeHtml(replyTo)}" style="color:#1D6B3A;">${escapeHtml(replyTo)}</a>` : ''}
       </p>`
    : '';

  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0E1F16;line-height:1.6;">
      <div>${escaped}</div>
      <p style="margin-top:24px;color:#1D6B3A;font-weight:600;">FitPoint Fitness</p>
      ${unsubBlock}
    </div>
  `;
}

function campaignBodyToText(body, { unsubscribeUrl, replyTo } = {}) {
  const lines = [
    String(body || '').trim(),
    '',
    'FitPoint Fitness',
    unsubscribeUrl ? `Cancelar inscrição: ${unsubscribeUrl}` : '',
    replyTo ? `Contato: ${replyTo}` : ''
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Envia e-mail de campanha (assunto + corpo definidos pelo admin).
 */
async function sendCampaignEmail({ to, subject, html, body }) {
  const resend = getResendClient();
  const replyTo = getReplyToAddress();
  const unsubscribeUrl = buildUnsubscribeUrl(to);
  const finalHtml =
    html ||
    campaignBodyToHtml(body || '', { unsubscribeUrl, replyTo });
  const text = campaignBodyToText(body || htmlToPlainText(finalHtml), {
    unsubscribeUrl,
    replyTo
  });

  const result = await resend.emails.send({
    ...baseSendOptions(),
    to: [to],
    subject: String(subject || '').trim() || '(sem assunto)',
    html: finalHtml,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    },
    tags: [{ name: 'category', value: 'campaign' }]
  });

  if (result.error) {
    throw new Error(result.error.message || 'Falha ao enviar e-mail via Resend');
  }

  return result.data;
}

module.exports = {
  sendTicketEmail,
  sendCampaignEmail,
  campaignBodyToHtml,
  campaignBodyToText,
  escapeHtml,
  extractEmailAddress,
  getReplyToAddress,
  getFromAddress,
  createUnsubscribeToken,
  parseUnsubscribeToken,
  buildUnsubscribeUrl,
  htmlToPlainText
};
