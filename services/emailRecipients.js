const { query, table } = require('../config/database');
const { isValidEmail } = require('../config/auth');
const {
  EMAIL_CAMPAIGN_THEMES,
  isValidEmailCampaignTheme
} = require('./emailCampaignThemes');
const { filterUnsubscribedEmails } = require('./emailUnsubscribes');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Aceita string (linhas / vírgulas / ;) ou array. Retorna { emails, invalid }.
 */
function parseManualEmails(raw) {
  let parts = [];
  if (Array.isArray(raw)) {
    parts = raw.map((item) => String(item ?? ''));
  } else if (typeof raw === 'string') {
    parts = raw.split(/[\n,;]+/);
  } else if (raw == null) {
    parts = [];
  } else {
    parts = [String(raw)];
  }

  const emails = [];
  const invalid = [];
  const seen = new Set();

  for (const part of parts) {
    const email = normalizeEmail(part);
    if (!email) continue;
    if (!isValidEmail(email)) {
      invalid.push(part.trim());
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  return { emails, invalid };
}

async function resolveEventShortcutEmails({ eventId, lotId }) {
  const eventIdNum = eventId != null && eventId !== '' ? Number(eventId) : null;
  const lotIdNum = lotId != null && lotId !== '' ? Number(lotId) : null;

  if (lotIdNum != null && Number.isFinite(lotIdNum)) {
    const result = await query(
      `SELECT DISTINCT email FROM (
         SELECT LOWER(TRIM(buyer_email)) AS email
         FROM ${table('ticket_orders')}
         WHERE lot_id = $1 AND status = 'paid'
           AND buyer_email IS NOT NULL AND TRIM(buyer_email) <> ''
         UNION
         SELECT LOWER(TRIM(buyer_email)) AS email
         FROM ${table('tickets')}
         WHERE lot_id = $1 AND status <> 'cancelled'
           AND buyer_email IS NOT NULL AND TRIM(buyer_email) <> ''
       ) e
       WHERE email <> ''
       ORDER BY 1`,
      [lotIdNum]
    );
    return result.rows.map((row) => row.email);
  }

  if (eventIdNum != null && Number.isFinite(eventIdNum)) {
    const result = await query(
      `SELECT DISTINCT email FROM (
         SELECT LOWER(TRIM(buyer_email)) AS email
         FROM ${table('ticket_orders')}
         WHERE event_id = $1 AND status = 'paid'
           AND buyer_email IS NOT NULL AND TRIM(buyer_email) <> ''
         UNION
         SELECT LOWER(TRIM(buyer_email)) AS email
         FROM ${table('tickets')}
         WHERE event_id = $1 AND status <> 'cancelled'
           AND buyer_email IS NOT NULL AND TRIM(buyer_email) <> ''
       ) e
       WHERE email <> ''
       ORDER BY 1`,
      [eventIdNum]
    );
    return result.rows.map((row) => row.email);
  }

  return [];
}

/**
 * Resolve destinatários finais por tema + atalho + manuais.
 * @throws {{ status: number, message: string, invalid?: string[] }}
 */
async function resolveCampaignRecipients({ theme, eventId, lotId, manualEmails }) {
  if (!isValidEmailCampaignTheme(theme)) {
    const err = new Error('Tema inválido');
    err.status = 400;
    throw err;
  }

  const { emails: manual, invalid } = parseManualEmails(manualEmails);
  if (invalid.length) {
    const err = new Error(
      `E-mail(s) inválido(s): ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}`
    );
    err.status = 400;
    err.invalid = invalid;
    throw err;
  }

  let shortcut = [];
  if (theme === EMAIL_CAMPAIGN_THEMES.EVENTO) {
    if (eventId || lotId) {
      shortcut = await resolveEventShortcutEmails({ eventId, lotId });
    }
  }

  const seen = new Set();
  const emails = [];
  for (const email of [...shortcut, ...manual]) {
    const normalized = normalizeEmail(email);
    if (!normalized || seen.has(normalized)) continue;
    if (!isValidEmail(normalized)) continue;
    seen.add(normalized);
    emails.push(normalized);
  }

  const deliverable = await filterUnsubscribedEmails(emails);

  return {
    emails: deliverable,
    count: deliverable.length,
    shortcutCount: shortcut.length,
    manualCount: manual.length,
    skippedUnsubscribed: emails.length - deliverable.length
  };
}

module.exports = {
  normalizeEmail,
  parseManualEmails,
  resolveEventShortcutEmails,
  resolveCampaignRecipients
};
