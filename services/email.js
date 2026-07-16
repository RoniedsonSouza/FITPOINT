const { Resend } = require('resend');
const { generateTicketQrPng } = require('./qrcode');

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

function formatDatePt(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short'
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Envia e-mail com os ingressos e QR Codes (HTML + anexos PNG).
 */
async function sendTicketEmail({ to, buyerName, event, lot, tickets }) {
  const resend = getResendClient();
  const attachments = [];
  const ticketBlocks = [];

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const png = await generateTicketQrPng(ticket.code);
    const filename = `ingresso-${ticket.code}.png`;
    const base64 = png.toString('base64');
    attachments.push({
      filename,
      content: base64
    });
    ticketBlocks.push(`
      <div style="margin:24px 0;padding:16px;border:1px solid #e5e5e5;border-radius:12px;text-align:center;">
        <p style="margin:0 0 8px;font-weight:600;">Ingresso ${i + 1} de ${tickets.length}</p>
        <p style="margin:0 0 12px;font-family:monospace;font-size:14px;">Código: <strong>${escapeHtml(ticket.code)}</strong></p>
        <img src="data:image/png;base64,${base64}" alt="QR Code ${escapeHtml(ticket.code)}" width="200" height="200" style="display:block;margin:0 auto;" />
        <p style="margin:12px 0 0;color:#666;font-size:12px;">Também anexado como ${escapeHtml(filename)}</p>
      </div>
    `);
  }

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0E1F16;">
      <h1 style="color:#1D6B3A;font-size:22px;">Seu ingresso FitPoint</h1>
      <p>Olá, <strong>${escapeHtml(buyerName)}</strong>!</p>
      <p>Pagamento confirmado. Segue o ingresso para o evento:</p>
      <div style="background:#F5F3EE;padding:16px;border-radius:12px;margin:16px 0;">
        <p style="margin:0 0 6px;"><strong>${escapeHtml(event.title)}</strong></p>
        <p style="margin:0 0 6px;">${formatDatePt(event.starts_at)}</p>
        <p style="margin:0 0 6px;">Local: ${escapeHtml(event.venue || 'A definir')}</p>
        <p style="margin:0;">Lote: ${escapeHtml(lot.name)}</p>
      </div>
      ${ticketBlocks.join('')}
      <p style="color:#666;font-size:13px;">Apresente o QR Code na entrada. Guarde este e-mail.</p>
      <p style="color:#1D6B3A;font-weight:600;">FitPoint Fitness</p>
    </div>
  `;

  const result = await resend.emails.send({
    from: getFromAddress(),
    to: [to],
    subject: `Ingresso confirmado — ${event.title}`,
    html,
    attachments
  });

  if (result.error) {
    throw new Error(result.error.message || 'Falha ao enviar e-mail via Resend');
  }

  return result.data;
}

module.exports = {
  sendTicketEmail
};
