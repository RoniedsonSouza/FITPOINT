const { query, table } = require('../config/database');

async function upsertUnsubscribe(email, source = 'link') {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return;
  await query(
    `INSERT INTO ${table('email_unsubscribes')} (email, source, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source`,
    [normalized, source]
  );
}

async function isEmailUnsubscribed(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  const result = await query(
    `SELECT 1 FROM ${table('email_unsubscribes')} WHERE email = $1 LIMIT 1`,
    [normalized]
  );
  return result.rows.length > 0;
}

async function filterUnsubscribedEmails(emails) {
  const list = [...new Set(
    (emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
  )];
  if (!list.length) return [];
  const result = await query(
    `SELECT email FROM ${table('email_unsubscribes')} WHERE email = ANY($1::text[])`,
    [list]
  );
  const blocked = new Set(result.rows.map((r) => r.email));
  return list.filter((email) => !blocked.has(email));
}

module.exports = {
  upsertUnsubscribe,
  isEmailUnsubscribed,
  filterUnsubscribedEmails
};
