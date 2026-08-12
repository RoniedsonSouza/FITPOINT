/**
 * Smoke E2E / regressão dos fluxos de ingressos (VIP + checkout).
 * Cria um evento temporário, valida APIs e limpa no final.
 *
 * Uso:
 *   node scripts/test-tickets-e2e-smoke.js
 *
 * Requer servidor rodando (APP_URL) e ADMIN_* no .env.
 * Não cobra cartão; checkout Pix só valida rejeição VIP e criação pending em lote pago (libera estoque via cancel interno se necessário).
 */
require('dotenv').config();

// Sempre preferir localhost para não bater em produção por acidente.
// Override explícito: SMOKE_BASE_URL=http://localhost:3000
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

async function cleanup(token, eventId) {
  if (!eventId || !token) return;
  const { query, table, getClient } = require('../config/database');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${table('tickets')} WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM ${table('ticket_orders')} WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM ${table('ticket_lots')} WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM ${table('event_sponsors')} WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM ${table('events')} WHERE id = $1`, [eventId]);
    await client.query('COMMIT');
    ok(`cleanup evento ${eventId}`);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    fail('cleanup', e.message);
  } finally {
    client.release();
  }
}

async function main() {
  if (!ADMIN_PASS) {
    console.error('ADMIN_PASSWORD não definido no .env');
    process.exit(1);
  }

  console.log(`Smoke E2E → ${BASE}\n`);

  // Health
  try {
    const health = await fetch(BASE);
    if (!health.ok && health.status >= 500) {
      fail('servidor acessível', `HTTP ${health.status}`);
      process.exit(1);
    }
    ok('servidor responde');
  } catch (e) {
    fail('servidor acessível', e.message);
    console.error('\nSuba o servidor: npm start');
    process.exit(1);
  }

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
  const title = `[SMOKE-VIP] ${stamp}`;
  let eventId = null;

  try {
    // --- Criar evento temporário ---
    const starts = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const startsLocal = `${starts.getFullYear()}-${pad(starts.getMonth() + 1)}-${pad(starts.getDate())}T${pad(starts.getHours())}:${pad(starts.getMinutes())}:00`;

    const created = await req('POST', '/api/events', {
      token,
      body: {
        title,
        description: 'Evento temporário do smoke E2E — pode apagar',
        venue: 'Sala de teste',
        starts_at: startsLocal,
        active: true
      }
    });
    if (created.status !== 201 || !created.data?.id) {
      fail('criar evento', JSON.stringify(created.data));
      process.exit(1);
    }
    eventId = created.data.id;
    ok(`criar evento id=${eventId}`);

    // --- Lote pago normal (regressão) ---
    const lotPaid = await req('POST', `/api/events/${eventId}/lots`, {
      token,
      body: {
        name: '1º lote',
        price: 50,
        quantity_total: 20,
        sales_start: `${new Date().toISOString().slice(0, 10)}T00:00:00`,
        active: true
      }
    });
    eq('criar lote pago', lotPaid.status, 201);
    eq('lote pago não é VIP', lotPaid.data?.is_vip === true, false);
    const paidLotId = lotPaid.data?.id;

    // --- Lote VIP ---
    const lotVip = await req('POST', `/api/events/${eventId}/lots`, {
      token,
      body: {
        is_vip: true,
        quantity_total: 10,
        active: true
      }
    });
    eq('criar lote VIP', lotVip.status, 201);
    eq('VIP nome', lotVip.data?.name, 'Ingresso VIP');
    eq('VIP preço 0', Number(lotVip.data?.price), 0);
    eq('VIP flag', lotVip.data?.is_vip === true, true);
    const vipLotId = lotVip.data?.id;

    const lotVip2 = await req('POST', `/api/events/${eventId}/lots`, {
      token,
      body: { is_vip: true, quantity_total: 5 }
    });
    eq('bloquear 2º lote VIP', lotVip2.status, 400);

    // --- Público: VIP oculto ---
    const publicEvent = await req('GET', `/api/events/${eventId}`);
    eq('GET evento público', publicEvent.status, 200);
    const publicLots = publicEvent.data?.lots || [];
    const publicHasVip = publicLots.some((l) => l.is_vip === true || l.name === 'Ingresso VIP');
    eq('VIP oculto no público', publicHasVip, false);
    const publicHasPaid = publicLots.some((l) => l.id === paidLotId);
    eq('lote pago visível no público', publicHasPaid, true);

    // --- Admin vê VIP ---
    const adminLots = await req('GET', `/api/events/${eventId}/lots`, { token });
    eq('admin lista lotes', adminLots.status, 200);
    eq(
      'admin vê VIP',
      Array.isArray(adminLots.data) && adminLots.data.some((l) => l.is_vip === true),
      true
    );

    // --- Checkout bloqueia VIP ---
    const checkoutVip = await req('POST', '/api/tickets/checkout', {
      body: {
        lot_id: vipLotId,
        quantity: 1,
        buyer_name: 'Smoke Tester',
        buyer_email: 'smoke-vip@example.com',
        payment_method: 'pix'
      }
    });
    eq('checkout VIP rejeitado', checkoutVip.status, 400);

    // --- Emitir VIP com Dar ingresso ---
    const issue = await req('POST', '/api/tickets/issue-vip', {
      token,
      body: {
        event_id: eventId,
        quantity: 2,
        buyer_name: 'Emissor Smoke',
        buyer_email: 'emissor-smoke@example.com',
        buyer_phone: '11999990000',
        assignees: [
          null,
          { name: 'Convidado Smoke', email: 'convidado-smoke@example.com', phone: '11988887777' }
        ]
      }
    });
    if (issue.status !== 201) {
      fail('emitir VIP', JSON.stringify(issue.data));
    } else {
      ok('emitir VIP 201');
      const tickets = issue.data?.tickets || [];
      eq('2 tickets VIP', tickets.length, 2);
      const emails = tickets.map((t) => t.buyer_email).sort();
      eq(
        'titulares VIP distintos',
        emails.join(','),
        'convidado-smoke@example.com,emissor-smoke@example.com'
      );
    }

    // --- Lista admin com badge is_vip ---
    const list = await req('GET', `/api/tickets?event_id=${eventId}&limit=20`, { token });
    eq('listar tickets', list.status, 200);
    const items = list.data?.items || [];
    eq('há tickets VIP na lista', items.length >= 2, true);
    eq(
      'tickets marcados is_vip',
      items.every((t) => t.is_vip === true),
      true
    );

    // --- Checkout pago: validação assignees + criação Pix pending (sem esperar pagamento) ---
    const checkoutBad = await req('POST', '/api/tickets/checkout', {
      body: {
        lot_id: paidLotId,
        quantity: 2,
        buyer_name: 'Comprador Smoke',
        buyer_email: 'comprador-smoke@example.com',
        payment_method: 'pix',
        assignees: [{ name: 'X', email: 'email-invalido' }, null]
      }
    });
    eq('checkout assignees inválidos → 400', checkoutBad.status, 400);

    const checkoutOk = await req('POST', '/api/tickets/checkout', {
      body: {
        lot_id: paidLotId,
        quantity: 2,
        buyer_name: 'Comprador Smoke',
        buyer_email: 'comprador-smoke@example.com',
        buyer_phone: '11977776666',
        payment_method: 'pix',
        assignees: [
          null,
          { name: 'Presenteado Smoke', email: 'presenteado-smoke@example.com', phone: '11966665555' }
        ]
      }
    });
    if (checkoutOk.status === 201) {
      ok('checkout Pix pending com assignees');
      eq('status pending', checkoutOk.data?.status, 'pending');
      eq('tem order_id', typeof checkoutOk.data?.order_id, 'number');
    } else if (
      checkoutOk.status === 502 &&
      /pix|mercado|pagamento/i.test(String(checkoutOk.data?.error || ''))
    ) {
      // Assignees/estoque passaram; falha é só do provedor MP neste ambiente.
      ok('checkout assignees OK até MP (Pix indisponível neste ambiente — 502 esperado)');
    } else {
      fail('checkout Pix com assignees', JSON.stringify(checkoutOk.data));
    }

    // --- Validação de ingresso VIP (não marca used se validar falhar permissão — só checa GET list) ---
    // Promo/pricing unit tests já cobrem regressão de preço.
  } finally {
    await cleanup(token, eventId);
  }

  console.log('');
  if (failures) {
    console.error(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log('SMOKE E2E OK — fluxos VIP e regressão de lotes/checkout validados');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
