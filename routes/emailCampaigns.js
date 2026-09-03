const express = require('express');
const router = express.Router();
const { query, getClient, table } = require('../config/database');
const { authenticateToken, requirePermission } = require('../config/auth');
const {
  EMAIL_CAMPAIGN_THEME_LABELS,
  isValidEmailCampaignTheme
} = require('../services/emailCampaignThemes');
const { resolveCampaignRecipients, parseManualEmails } = require('../services/emailRecipients');

function mapCampaignRow(row) {
  return {
    id: row.id,
    theme: row.theme,
    theme_label: EMAIL_CAMPAIGN_THEME_LABELS[row.theme] || row.theme,
    subject: row.subject,
    body: row.body,
    event_id: row.event_id,
    lot_id: row.lot_id,
    manual_emails: row.manual_emails || [],
    status: row.status,
    total_count: Number(row.total_count) || 0,
    sent_count: Number(row.sent_count) || 0,
    failed_count: Number(row.failed_count) || 0,
    created_by: row.created_by,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at
  };
}

function mapJobRow(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    to_email: row.to_email,
    to_name: row.to_name,
    status: row.status,
    attempts: Number(row.attempts) || 0,
    max_attempts: Number(row.max_attempts) || 3,
    last_error: row.last_error,
    sent_at: row.sent_at,
    available_at: row.available_at
  };
}

router.use(authenticateToken, requirePermission('emails'));

router.get('/themes', (_req, res) => {
  res.json({
    themes: Object.entries(EMAIL_CAMPAIGN_THEME_LABELS).map(([value, label]) => ({
      value,
      label,
      shortcutEnabled: value === 'evento'
    }))
  });
});

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const result = await query(
      `SELECT *
       FROM ${table('email_campaigns')}
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows.map(mapCampaignRow));
  } catch (error) {
    console.error('Erro ao listar campanhas de e-mail:', error);
    res.status(500).json({ error: 'Erro ao listar campanhas' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const campaignResult = await query(
      `SELECT * FROM ${table('email_campaigns')} WHERE id = $1`,
      [id]
    );
    if (!campaignResult.rows.length) {
      return res.status(404).json({ error: 'Campanha não encontrada' });
    }

    const jobsResult = await query(
      `SELECT *
       FROM ${table('email_campaign_jobs')}
       WHERE campaign_id = $1
       ORDER BY
         CASE status
           WHEN 'failed' THEN 0
           WHEN 'processing' THEN 1
           WHEN 'pending' THEN 2
           ELSE 3
         END,
         id ASC`,
      [id]
    );

    res.json({
      ...mapCampaignRow(campaignResult.rows[0]),
      jobs: jobsResult.rows.map(mapJobRow)
    });
  } catch (error) {
    console.error('Erro ao buscar campanha de e-mail:', error);
    res.status(500).json({ error: 'Erro ao buscar campanha' });
  }
});

router.post('/preview-recipients', async (req, res) => {
  try {
    const { theme, eventId, lotId, manualEmails } = req.body || {};
    if (!isValidEmailCampaignTheme(theme)) {
      return res.status(400).json({ error: 'Tema inválido' });
    }

    const resolved = await resolveCampaignRecipients({
      theme,
      eventId,
      lotId,
      manualEmails
    });

    res.json({
      count: resolved.count,
      shortcutCount: resolved.shortcutCount,
      manualCount: resolved.manualCount,
      emails: resolved.emails
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('Erro no preview de destinatários:', error);
    }
    res.status(status).json({
      error: error.message || 'Erro ao pré-visualizar destinatários',
      invalid: error.invalid
    });
  }
});

router.post('/', async (req, res) => {
  const client = await getClient();
  try {
    const {
      theme,
      subject,
      body,
      eventId,
      lotId,
      manualEmails
    } = req.body || {};

    if (!isValidEmailCampaignTheme(theme)) {
      return res.status(400).json({ error: 'Tema inválido' });
    }

    const trimmedSubject = String(subject || '').trim();
    const trimmedBody = String(body || '').trim();
    if (!trimmedSubject) {
      return res.status(400).json({ error: 'Assunto é obrigatório' });
    }
    if (!trimmedBody) {
      return res.status(400).json({ error: 'Corpo do e-mail é obrigatório' });
    }

    if (theme === 'evento' && !eventId && !lotId) {
      // permitido se houver manuais; validado abaixo no count
    }

    let resolved;
    try {
      resolved = await resolveCampaignRecipients({
        theme,
        eventId,
        lotId,
        manualEmails
      });
    } catch (error) {
      return res.status(error.status || 400).json({
        error: error.message || 'Destinatários inválidos',
        invalid: error.invalid
      });
    }

    if (!resolved.count) {
      return res.status(400).json({ error: 'Nenhum destinatário após deduplicação' });
    }

    const eventIdNum = eventId != null && eventId !== '' ? Number(eventId) : null;
    const lotIdNum = lotId != null && lotId !== '' ? Number(lotId) : null;

    if (theme === 'evento') {
      if (lotIdNum != null && Number.isFinite(lotIdNum)) {
        const lotCheck = await query(
          `SELECT id, event_id FROM ${table('ticket_lots')} WHERE id = $1`,
          [lotIdNum]
        );
        if (!lotCheck.rows.length) {
          return res.status(400).json({ error: 'Lote não encontrado' });
        }
        if (eventIdNum != null && Number(lotCheck.rows[0].event_id) !== eventIdNum) {
          return res.status(400).json({ error: 'Lote não pertence ao evento informado' });
        }
      } else if (eventIdNum != null && Number.isFinite(eventIdNum)) {
        const eventCheck = await query(
          `SELECT id FROM ${table('events')} WHERE id = $1`,
          [eventIdNum]
        );
        if (!eventCheck.rows.length) {
          return res.status(400).json({ error: 'Evento não encontrado' });
        }
      }
    }

    const { emails: manualOnly } = parseManualEmails(manualEmails);

    await client.query('BEGIN');

    const campaignInsert = await client.query(
      `INSERT INTO ${table('email_campaigns')}
        (theme, subject, body, event_id, lot_id, manual_emails, status, total_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued', $7, $8)
       RETURNING *`,
      [
        theme,
        trimmedSubject,
        trimmedBody,
        theme === 'evento' && Number.isFinite(eventIdNum) ? eventIdNum : null,
        theme === 'evento' && Number.isFinite(lotIdNum) ? lotIdNum : null,
        JSON.stringify(manualOnly),
        resolved.count,
        req.user?.id || null
      ]
    );

    const campaign = campaignInsert.rows[0];

    for (const email of resolved.emails) {
      await client.query(
        `INSERT INTO ${table('email_campaign_jobs')}
          (campaign_id, to_email, status, available_at)
         VALUES ($1, $2, 'pending', NOW())
         ON CONFLICT (campaign_id, to_email) DO NOTHING`,
        [campaign.id, email]
      );
    }

    await client.query('COMMIT');

    res.status(201).json(mapCampaignRow(campaign));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao criar campanha de e-mail:', error);
    res.status(500).json({ error: 'Erro ao criar campanha' });
  } finally {
    client.release();
  }
});

module.exports = router;
