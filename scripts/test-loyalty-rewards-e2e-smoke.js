/**
 * Smoke E2E dos prêmios de fidelidade (ganhar, listar pendentes, retirar, desfazer).
 * Cria um cliente de fidelidade temporário, valida as APIs e limpa no final.
 *
 * Uso:
 *   node scripts/test-loyalty-rewards-e2e-smoke.js
 *
 * Requer servidor rodando (APP_URL) e ADMIN_* no .env.
 */
require('dotenv').config();

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
if (/fitpoint-fitness\.com\.br/i.test(BASE)) {
  console.error('Recusado: SMOKE_BASE_URL aponta para produção. Use localhost.');
  process.exit(1);
}
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD;

let failures = 0;
function ok(desc) {
  console.log(`ok   ${desc}`);
}
function fail(desc, detail) {
  failures++;
  console.log(`FAIL ${desc}${detail ? ': ' + detail : ''}`);
}
function eq(desc, actual, expected) {
  if (actual === expected) ok(desc);
  else fail(desc, `esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
}

async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function cleanup(token, customerId) {
  if (!customerId) return;
  await req('DELETE', `/api/loyalty/customers/${customerId}`, { token });
}

async function main() {
  if (!ADMIN_PASS) {
    console.error('ADMIN_PASSWORD não definido no .env');
    process.exit(1);
  }

  console.log(`Smoke E2E prêmios de fidelidade → ${BASE}\n`);

  const health = await fetch(BASE);
  if (!health.ok && health.status >= 500) {
    fail('servidor acessível', `HTTP ${health.status}`);
    process.exit(1);
  }
  ok('servidor responde');

  const login = await req('POST', '/api/auth/login', {
    body: { username: ADMIN_USER, password: ADMIN_PASS }
  });
  if (login.status !== 200 || !login.data?.token) {
    fail('login admin', JSON.stringify(login.data));
    process.exit(1);
  }
  ok('login admin');
  const token = login.data.token;

  const stamp = Date.now();
  const name = `[SMOKE-REWARDS] ${stamp}`;
  const phone = `119${String(stamp).slice(-8)}`;
  let customerId = null;

  try {
    const settings = await req('GET', '/api/loyalty/settings', { token });
    const visitsPerReward = settings.data?.visits_per_reward || 10;
    ok(`visits_per_reward = ${visitsPerReward}`);

    const created = await req('POST', '/api/loyalty/customers', {
      token,
      body: { name, phone, total_visits: 0, total_rewards: 0 }
    });
    eq('cria cliente de teste', created.status, 201);
    customerId = created.data?.id;
    if (!customerId) {
      fail('cliente de teste tem id', JSON.stringify(created.data));
      process.exit(1);
    }

    // --- Ganhar 1 prêmio de uma vez (completa exatamente 1 ciclo) ---
    const earn = await req('POST', `/api/loyalty/customers/${customerId}/visit`, {
      token,
      body: { delta: visitsPerReward }
    });
    eq('ganha 1 prêmio ao completar o ciclo (status)', earn.status, 200);
    eq('rewards_earned = 1', earn.data?.rewards_earned, 1);
    eq('rewards_pending_total = 1 após ganhar', earn.data?.rewards_pending_total, 1);
    eq('customer.rewards_pending = 1', earn.data?.customer?.rewards_pending, 1);

    // --- Aparece na lista de pendentes ---
    const pendingAfterEarn = await req('GET', '/api/loyalty/rewards/pending', { token });
    const foundPending = (pendingAfterEarn.data?.items || []).find(i => i.customer_id === customerId);
    eq('cliente aparece em rewards/pending', Boolean(foundPending), true);
    eq('pending_count = 1 na listagem', foundPending?.pending_count, 1);
    eq('rewards/pending tem page = 1', pendingAfterEarn.data?.page, 1);
    eq('rewards/pending tem total_pages >= 1', (pendingAfterEarn.data?.total_pages || 0) >= 1, true);

    const pendingPage2 = await req('GET', '/api/loyalty/rewards/pending?page=999&limit=5', { token });
    eq('página além do total volta lista vazia (sem erro)', Array.isArray(pendingPage2.data?.items) && pendingPage2.data.items.length === 0, true);

    // --- Aparece com rewards_pending na listagem geral de clientes ---
    const customersList = await req('GET', `/api/loyalty/customers?q=${encodeURIComponent(stamp)}`, { token });
    const foundCustomer = (customersList.data?.items || []).find(c => c.id === customerId);
    eq('cliente aparece em GET /customers', Boolean(foundCustomer), true);
    eq('rewards_pending = 1 em GET /customers', foundCustomer?.rewards_pending, 1);

    // --- Retirar o prêmio ---
    const claim = await req('POST', `/api/loyalty/customers/${customerId}/claim-reward`, { token });
    eq('retira o prêmio (status)', claim.status, 200);
    eq('claimed = true', claim.data?.claimed, true);
    eq('rewards_pending_total = 0 após retirar', claim.data?.rewards_pending_total, 0);

    // --- Some da lista de pendentes ---
    const pendingAfterClaim = await req('GET', '/api/loyalty/rewards/pending', { token });
    const stillPending = (pendingAfterClaim.data?.items || []).some(i => i.customer_id === customerId);
    eq('cliente some de rewards/pending após retirar', stillPending, false);

    // --- Retirar de novo sem ter pendente → 404 ---
    const claimAgain = await req('POST', `/api/loyalty/customers/${customerId}/claim-reward`, { token });
    eq('retirar sem pendente retorna 404', claimAgain.status, 404);

    // --- Ganhar de novo, depois desfazer removendo 1 visita no limite do ciclo ---
    const earnAgain = await req('POST', `/api/loyalty/customers/${customerId}/visit`, {
      token,
      body: { delta: visitsPerReward }
    });
    eq('ganha o 2º prêmio (rewards_earned = 1)', earnAgain.data?.rewards_earned, 1);

    const undo = await req('POST', `/api/loyalty/customers/${customerId}/visit`, {
      token,
      body: { delta: -1 }
    });
    eq('remover 1 visita no limite não gera rewards_earned', undo.data?.rewards_earned, 0);
    eq('remover 1 visita no limite desfaz o prêmio pendente', undo.data?.rewards_pending_total, 0);

    const pendingAfterUndo = await req('GET', '/api/loyalty/rewards/pending', { token });
    const stillPendingAfterUndo = (pendingAfterUndo.data?.items || []).some(i => i.customer_id === customerId);
    eq('cliente não aparece em rewards/pending após desfazer', stillPendingAfterUndo, false);
  } finally {
    await cleanup(token, customerId);
  }

  console.log('');
  if (failures) {
    console.error(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log('SMOKE E2E OK — prêmios de fidelidade (ganhar/listar/retirar/desfazer) validados');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
