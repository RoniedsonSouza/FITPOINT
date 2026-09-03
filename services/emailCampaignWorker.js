const { getClient, table } = require('../config/database');
const { sendCampaignEmail, campaignBodyToHtml } = require('./email');

const POLL_INTERVAL_MS = 3000;
const RATE_LIMIT_MS = 1000;
const ORPHAN_MINUTES = 5;
const BACKOFF_MS = [30_000, 120_000, 600_000];

let timer = null;
let running = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshCampaignCounters(client, campaignId) {
  await client.query(
    `UPDATE ${table('email_campaigns')} c
     SET
       sent_count = (SELECT COUNT(*)::int FROM ${table('email_campaign_jobs')} j
                     WHERE j.campaign_id = c.id AND j.status = 'sent'),
       failed_count = (SELECT COUNT(*)::int FROM ${table('email_campaign_jobs')} j
                       WHERE j.campaign_id = c.id AND j.status = 'failed'),
       started_at = COALESCE(c.started_at, NOW()),
       status = CASE
         WHEN EXISTS (
           SELECT 1 FROM ${table('email_campaign_jobs')} j
           WHERE j.campaign_id = c.id AND j.status IN ('pending', 'processing')
         ) THEN 'sending'
         WHEN (
           SELECT COUNT(*)::int FROM ${table('email_campaign_jobs')} j
           WHERE j.campaign_id = c.id AND j.status = 'sent'
         ) = 0
         AND (
           SELECT COUNT(*)::int FROM ${table('email_campaign_jobs')} j
           WHERE j.campaign_id = c.id AND j.status = 'failed'
         ) > 0
         THEN 'failed'
         ELSE 'completed'
       END,
       finished_at = CASE
         WHEN EXISTS (
           SELECT 1 FROM ${table('email_campaign_jobs')} j
           WHERE j.campaign_id = c.id AND j.status IN ('pending', 'processing')
         ) THEN NULL
         ELSE NOW()
       END
     WHERE c.id = $1`,
    [campaignId]
  );
}

async function reclaimOrphans(client) {
  await client.query(
    `UPDATE ${table('email_campaign_jobs')}
     SET status = 'pending', available_at = NOW()
     WHERE status = 'processing'
       AND available_at < NOW() - make_interval(mins => $1)`,
    [ORPHAN_MINUTES]
  );
}

async function claimNextJob(client) {
  const result = await client.query(
    `UPDATE ${table('email_campaign_jobs')} j
     SET status = 'processing',
         attempts = j.attempts + 1,
         available_at = NOW()
     FROM (
       SELECT id
       FROM ${table('email_campaign_jobs')}
       WHERE status = 'pending'
         AND available_at <= NOW()
       ORDER BY available_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     ) picked
     WHERE j.id = picked.id
     RETURNING j.*`
  );
  return result.rows[0] || null;
}

async function loadCampaign(client, campaignId) {
  const result = await client.query(
    `SELECT id, subject, body, status
     FROM ${table('email_campaigns')}
     WHERE id = $1`,
    [campaignId]
  );
  return result.rows[0] || null;
}

async function markJobSent(client, jobId) {
  await client.query(
    `UPDATE ${table('email_campaign_jobs')}
     SET status = 'sent', sent_at = NOW(), last_error = NULL
     WHERE id = $1`,
    [jobId]
  );
}

async function markJobFailure(client, job, errorMessage) {
  const attempts = Number(job.attempts) || 0;
  const maxAttempts = Number(job.max_attempts) || 3;
  const message = String(errorMessage || 'Erro desconhecido').slice(0, 2000);

  if (attempts >= maxAttempts) {
    await client.query(
      `UPDATE ${table('email_campaign_jobs')}
       SET status = 'failed', last_error = $2
       WHERE id = $1`,
      [job.id, message]
    );
    return;
  }

  const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] || 600_000;
  await client.query(
    `UPDATE ${table('email_campaign_jobs')}
     SET status = 'pending',
         last_error = $2,
         available_at = NOW() + make_interval(secs => $3::int)
     WHERE id = $1`,
    [job.id, message, Math.round(backoff / 1000)]
  );
}

async function processOneJob() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await reclaimOrphans(client);
    const job = await claimNextJob(client);
    if (!job) {
      await client.query('COMMIT');
      return false;
    }

    const campaign = await loadCampaign(client, job.campaign_id);
    if (!campaign || campaign.status === 'cancelled') {
      await client.query(
        `UPDATE ${table('email_campaign_jobs')}
         SET status = 'failed', last_error = $2
         WHERE id = $1`,
        [job.id, 'Campanha cancelada ou inexistente']
      );
      if (campaign) await refreshCampaignCounters(client, campaign.id);
      await client.query('COMMIT');
      return true;
    }

    if (campaign.status === 'queued') {
      await client.query(
        `UPDATE ${table('email_campaigns')}
         SET status = 'sending', started_at = COALESCE(started_at, NOW())
         WHERE id = $1`,
        [campaign.id]
      );
    }

    await client.query('COMMIT');

    try {
      await sendCampaignEmail({
        to: job.to_email,
        subject: campaign.subject,
        html: campaignBodyToHtml(campaign.body)
      });

      const clientOk = await getClient();
      try {
        await clientOk.query('BEGIN');
        await markJobSent(clientOk, job.id);
        await refreshCampaignCounters(clientOk, campaign.id);
        await clientOk.query('COMMIT');
      } catch (err) {
        await clientOk.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        clientOk.release();
      }
    } catch (sendErr) {
      const clientFail = await getClient();
      try {
        await clientFail.query('BEGIN');
        await markJobFailure(clientFail, job, sendErr.message);
        await refreshCampaignCounters(clientFail, campaign.id);
        await clientFail.query('COMMIT');
      } catch (err) {
        await clientFail.query('ROLLBACK').catch(() => {});
        console.error('[emailCampaignWorker] falha ao gravar erro do job:', err.message);
      } finally {
        clientFail.release();
      }
    }

    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[emailCampaignWorker] erro no ciclo:', err.message);
    return false;
  } finally {
    client.release();
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    let processed = false;
    do {
      processed = await processOneJob();
      if (processed) await sleep(RATE_LIMIT_MS);
    } while (processed);
  } finally {
    running = false;
  }
}

function startEmailCampaignWorker() {
  if (timer) return;
  console.log('[emailCampaignWorker] iniciado (fila Postgres)');
  timer = setInterval(() => {
    tick().catch((err) => {
      console.error('[emailCampaignWorker] tick falhou:', err.message);
    });
  }, POLL_INTERVAL_MS);
  // Não impedir o processo de encerrar por causa do timer
  if (typeof timer.unref === 'function') timer.unref();
  tick().catch(() => {});
}

function stopEmailCampaignWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startEmailCampaignWorker,
  stopEmailCampaignWorker,
  refreshCampaignCounters
};
