# Diário — Prêmios de Fidelidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rastrear prêmios de fidelidade ganhos vs. retirados (tabela nova + 2 endpoints), com aviso persistente no Diário ao ganhar, lista de pendentes na tela "Vendas do dia" e badge/ação no card da Fidelidade.

**Architecture:** Nova tabela `loyalty_rewards` (1 linha por prêmio ganho, `claimed_at` nulo = pendente), espelhando o padrão já existente de `loyalty_visit_events`. Toda a matemática de "quando um prêmio é ganho" continua em `applyVisitDelta` (intocada); a tabela nova só registra o resultado. Retirada é sempre FIFO (prêmio mais antigo primeiro), via um único endpoint reaproveitado nos 3 pontos de UI.

**Tech Stack:** Node/Express, PostgreSQL, HTML/JS admin vanilla (`js/admin/loyalty.js`, `js/admin/daily-sales.js`, `admin.html`). Testes: script `node scripts/test-*.js` (padrão do repo) para lógica pura; resto verificado manualmente no navegador (`http://localhost:3000/admin.html`), já que o projeto não tem framework de teste de integração.

## Global Constraints

- Não mudar a matemática de `applyVisitDelta` (função pura em `routes/loyaltyHelpers.js`) — ela permanece exatamente como está.
- `total_rewards` em `loyalty_customers` mantém a semântica atual (contador vitalício, usado pelo hall da fama público em `fidelidade.html`) — nunca é lido/escrito com um significado novo.
- Retirada de prêmio é sempre FIFO (`ORDER BY earned_at ASC LIMIT 1`), nunca por escolha manual de qual prêmio.
- Novos endpoints usam `requireAnyPermission('fidelidade', 'vendas')` — mesma regra já usada em `GET /api/loyalty/customers`.
- Campos de resposta já existentes (`rewards_earned`, `loyalty_applied`, `loyalty_visits_applied`, etc.) não mudam de nome nem de tipo — só ganham campos novos ao lado.
- Spec: [docs/superpowers/specs/2026-08-13-diario-loyalty-rewards-design.md](../specs/2026-08-13-diario-loyalty-rewards-design.md).

---

## File Structure

| Arquivo | Papel |
|---------|-------|
| `config/database.js` | Cria tabela `loyalty_rewards` + 2 índices |
| `routes/loyaltyHelpers.js` | `insertRewardEvents`, `removeNewestPendingRewards`, `countPendingRewards`, `computeRewardsRemoved` (novas); `mapCustomerRow` ganha `rewards_pending` |
| `routes/dailySales.js` | `applyLoyaltyForSale` grava prêmios ganhos e retorna `rewardsPendingTotal`; resposta do `/batch` ganha `rewards_pending_total` |
| `routes/loyalty.js` | `POST /customers/:id/visit` grava/desfaz prêmios; novo `GET /rewards/pending`; novo `POST /customers/:id/claim-reward`; `GET /customers` ganha `rewards_pending` por cliente |
| `js/database.js` | `DB.claimLoyaltyReward(id)`, `DB.getPendingLoyaltyRewards()` |
| `js/admin/loyalty.js` | Badge + botão de retirada no card do cliente; handler `claimLoyaltyReward` |
| `js/admin/daily-sales.js` | Banner de "ganhou prêmio" após registrar no Diário; seção "Prêmios pendentes" na tela Vendas do dia |
| `admin.html` | Container dos banners no Diário; seção de pendentes na tela Vendas do dia |
| `css/admin.css` | Estilos do banner, da seção de pendentes, do badge e do botão de retirada compartilhado |
| `scripts/test-loyalty-rewards.js` | Testes da lógica pura de ganho/perda de prêmio (novo) |

---

### Task 1: Modelo de dados + concessão de prêmios nos fluxos existentes

**Files:**
- Modify: `config/database.js`
- Modify: `routes/loyaltyHelpers.js`
- Modify: `routes/dailySales.js`
- Modify: `routes/loyalty.js`
- Create: `scripts/test-loyalty-rewards.js`

**Interfaces:**
- Produces (em `routes/loyaltyHelpers.js`, consumidas pelas Tasks 1-3):
  - `insertRewardEvents(db, customerId, count, source) → Promise<void>`
  - `removeNewestPendingRewards(db, customerId, count) → Promise<number>` (linhas removidas)
  - `countPendingRewards(db, customerId) → Promise<number>`
  - `computeRewardsRemoved(rewardsBefore, rewardsAfter) → number`
  - `mapCustomerRow(row, opts)` passa a incluir `rewards_pending` no objeto retornado (lê `row.rewards_pending`, default `0`)

- [ ] **Step 1: Criar a tabela `loyalty_rewards`**

Em `config/database.js`, logo depois do bloco que cria o índice `idx_loyalty_visit_events_customer_created` (por volta da linha 98-101) e antes da criação de `loyalty_settings`, adicionar:

```js
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.loyalty_rewards (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES ${SCHEMA}.loyalty_customers(id) ON DELETE CASCADE,
        earned_at TIMESTAMP NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMP NULL,
        source VARCHAR(20) NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_customer
      ON ${SCHEMA}.loyalty_rewards (customer_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_pending
      ON ${SCHEMA}.loyalty_rewards (claimed_at)
      WHERE claimed_at IS NULL
    `);
```

- [ ] **Step 2: Adicionar os helpers em `routes/loyaltyHelpers.js`**

Logo depois da função `insertVisitEvents` (que termina por volta da linha 132) e antes de `mapVisitEventRow`, adicionar:

```js
async function insertRewardEvents(db, customerId, count, source) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (n === 0) return;
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  const placeholders = [];
  const values = [];
  for (let i = 0; i < n; i++) {
    const base = i * 2;
    placeholders.push(`($${base + 1}, $${base + 2})`);
    values.push(customerId, source);
  }
  await run(
    `INSERT INTO ${table('loyalty_rewards')} (customer_id, source)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

async function removeNewestPendingRewards(db, customerId, count) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (n === 0) return 0;
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  const result = await run(
    `DELETE FROM ${table('loyalty_rewards')}
     WHERE id IN (
       SELECT id FROM ${table('loyalty_rewards')}
       WHERE customer_id = $1 AND claimed_at IS NULL
       ORDER BY earned_at DESC
       LIMIT $2
     )`,
    [customerId, n]
  );
  return result.rowCount || 0;
}

async function countPendingRewards(db, customerId) {
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  const result = await run(
    `SELECT COUNT(*)::int AS cnt FROM ${table('loyalty_rewards')} WHERE customer_id = $1 AND claimed_at IS NULL`,
    [customerId]
  );
  return result.rows[0]?.cnt || 0;
}

function computeRewardsRemoved(rewardsBefore, rewardsAfter) {
  return Math.max(0, (Number(rewardsBefore) || 0) - (Number(rewardsAfter) || 0));
}
```

No `module.exports` do mesmo arquivo (por volta da linha 223), adicionar as 4 funções novas à lista:

```js
module.exports = {
  DEFAULT_VISITS_PER_REWARD,
  DEFAULT_ACCESS_VALUE,
  INACTIVE_VISIT_DAYS,
  normalizePhone,
  getProgress,
  getDisplayProgress,
  isCycleComplete,
  getVisitsToReward,
  isInactiveVisit,
  mapCustomerRow,
  applyVisitDelta,
  insertVisitEvents,
  insertRewardEvents,
  removeNewestPendingRewards,
  countPendingRewards,
  computeRewardsRemoved,
  mapVisitEventRow,
  parseNonNegativeInt,
  parseVisitsPerReward,
  parseAccessValue,
  computeLoyaltyVisitsFromAmount,
  parsePaginationQuery,
  parseSearchQuery,
  buildNamePhoneSearchClause,
  participantOrderSql,
  computeTotalPages
};
```

Ainda no mesmo arquivo, dentro de `mapCustomerRow`, o objeto `out` (por volta da linha 59-75) ganha uma linha nova logo depois de `total_rewards: totalRewards,`:

```js
  const out = {
    id: row.id,
    name: row.name,
    display_name: row.name,
    avatar: row.avatar || null,
    total_visits: totalVisits,
    total_rewards: totalRewards,
    rewards_pending: row.rewards_pending != null ? Number(row.rewards_pending) : 0,
    progress: rawProgress,
```

- [ ] **Step 3: Gravar prêmio ganho no fluxo de venda do Diário (`routes/dailySales.js`)**

No topo do arquivo (linha 5), o import de `loyaltyHelpers` ganha as funções novas:

```js
const { applyVisitDelta, insertVisitEvents, insertRewardEvents, countPendingRewards, computeLoyaltyVisitsFromAmount, DEFAULT_ACCESS_VALUE, DEFAULT_VISITS_PER_REWARD } = require('./loyaltyHelpers');
```

A função `applyLoyaltyForSale` (linhas 231-278) passa a gravar o prêmio e retornar o total pendente:

```js
async function applyLoyaltyForSale(client, customerId, validatedItems) {
  if (!customerId) {
    return { loyaltyApplied: false, rewardsEarned: 0, loyaltyVisitsApplied: 0, rewardsPendingTotal: 0 };
  }

  const saleTotal = computeSaleTotal(validatedItems);
  const { visitsPerReward, accessValue } = await getLoyaltySettingsFromDb(client);
  const visitDelta = computeLoyaltyVisitsFromAmount(saleTotal, accessValue);

  if (visitDelta <= 0) {
    return { loyaltyApplied: false, rewardsEarned: 0, loyaltyVisitsApplied: 0, rewardsPendingTotal: 0 };
  }

  const customerRow = (
    await client.query(`SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`, [customerId])
  ).rows[0];

  const { visits, rewards, rewards_earned, delta_applied } = applyVisitDelta(
    customerRow.total_visits,
    customerRow.total_rewards,
    visitDelta,
    visitsPerReward
  );

  const visitsChanged = delta_applied !== 0;
  const positiveVisit = delta_applied > 0;

  await client.query(
    `UPDATE ${table('loyalty_customers')}
     SET total_visits = $1,
         total_rewards = $2,
         updated_at = NOW()
         ${visitsChanged ? ', last_visit_at = NOW()' : ''}
         ${positiveVisit ? ', last_positive_visit_at = NOW()' : ''}
     WHERE id = $3`,
    [visits, rewards, customerId]
  );

  if (visitsChanged) {
    await insertVisitEvents(client, customerId, delta_applied, 'daily_sales');
  }

  if (rewards_earned > 0) {
    await insertRewardEvents(client, customerId, rewards_earned, 'daily_sales');
  }

  const rewardsPendingTotal = await countPendingRewards(client, customerId);

  return {
    loyaltyApplied: true,
    rewardsEarned: rewards_earned,
    loyaltyVisitsApplied: delta_applied > 0 ? delta_applied : visitDelta,
    rewardsPendingTotal
  };
}
```

No handler `POST /batch` (por volta da linha 510-516), a resposta ganha o campo novo:

```js
    res.status(201).json({
      items: insertedItems,
      summary,
      loyalty_applied: loyaltyResult.loyaltyApplied,
      loyalty_visits_applied: loyaltyResult.loyaltyVisitsApplied,
      rewards_earned: loyaltyResult.rewardsEarned,
      rewards_pending_total: loyaltyResult.rewardsPendingTotal
    });
```

- [ ] **Step 4: Gravar/desfazer prêmio no ajuste manual de visita (`routes/loyalty.js`)**

No import de `loyaltyHelpers` (linhas 5-21), adicionar as funções novas à lista:

```js
const {
  DEFAULT_VISITS_PER_REWARD,
  DEFAULT_ACCESS_VALUE,
  normalizePhone,
  mapCustomerRow,
  applyVisitDelta,
  insertVisitEvents,
  insertRewardEvents,
  removeNewestPendingRewards,
  countPendingRewards,
  computeRewardsRemoved,
  mapVisitEventRow,
  parseNonNegativeInt,
  parseVisitsPerReward,
  parseAccessValue,
  parsePaginationQuery,
  parseSearchQuery,
  buildNamePhoneSearchClause,
  participantOrderSql,
  computeTotalPages
} = require('./loyaltyHelpers');
```

No handler `POST /customers/:id/visit` (linhas 451-513), o trecho atual:

```js
    if (visitsChanged) {
      await insertVisitEvents(client, req.params.id, delta_applied, 'admin');
    }

    await client.query('COMMIT');

    res.json({
      customer: mapCustomerRow(result.rows[0], { includePhone: true, visitsPerReward }),
      rewards_earned,
      reward_earned: rewards_earned > 0,
      delta_applied,
      visits_per_reward: visitsPerReward
    });
```

Vira:

```js
    if (visitsChanged) {
      await insertVisitEvents(client, req.params.id, delta_applied, 'admin');
    }

    if (rewards_earned > 0) {
      await insertRewardEvents(client, req.params.id, rewards_earned, 'admin');
    } else {
      const removed = computeRewardsRemoved(row.total_rewards, rewards);
      if (removed > 0) {
        await removeNewestPendingRewards(client, req.params.id, removed);
      }
    }

    const rewardsPendingTotal = await countPendingRewards(client, req.params.id);

    await client.query('COMMIT');

    res.json({
      customer: mapCustomerRow(
        { ...result.rows[0], rewards_pending: rewardsPendingTotal },
        { includePhone: true, visitsPerReward }
      ),
      rewards_earned,
      reward_earned: rewards_earned > 0,
      delta_applied,
      visits_per_reward: visitsPerReward,
      rewards_pending_total: rewardsPendingTotal
    });
```

(`row` já existe nesse escopo — é o resultado do `SELECT ... FOR UPDATE` feito logo acima, antes de `applyVisitDelta` ser chamado.)

- [ ] **Step 5: Escrever o script de teste**

```js
// scripts/test-loyalty-rewards.js
const { applyVisitDelta, computeRewardsRemoved } = require('../routes/loyaltyHelpers');

let failures = 0;
function eq(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${desc}: esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${desc}`);
  }
}

const earn = applyVisitDelta(9, 0, 1, 10);
eq('ganha 1 prêmio ao completar o ciclo', { rewards: earn.rewards, earned: earn.rewards_earned }, { rewards: 1, earned: 1 });

const earnMultiple = applyVisitDelta(9, 0, 11, 10);
eq('ganha 2 prêmios cruzando 2 ciclos numa venda só', { rewards: earnMultiple.rewards, earned: earnMultiple.rewards_earned }, { rewards: 2, earned: 2 });

const noCross = applyVisitDelta(9, 0, -1, 10);
eq('remover 1 visita sem cruzar ciclo não mexe no prêmio', computeRewardsRemoved(0, noCross.rewards), 0);

const cross = applyVisitDelta(10, 1, -1, 10);
eq('remover 1 visita no limite do ciclo desfaz o prêmio', cross.rewards, 0);
eq('computeRewardsRemoved detecta a perda', computeRewardsRemoved(1, cross.rewards), 1);

eq('computeRewardsRemoved nunca é negativo', computeRewardsRemoved(1, 2), 0);
eq('computeRewardsRemoved trata undefined como 0', computeRewardsRemoved(undefined, undefined), 0);

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log('\nTodos ok');
```

- [ ] **Step 6: Rodar o script e verificar sintaxe**

Run: `node scripts/test-loyalty-rewards.js`
Expected: todas as linhas `ok`, termina com "Todos ok".

Run: `node --check config/database.js && node --check routes/loyaltyHelpers.js && node --check routes/dailySales.js && node --check routes/loyalty.js`
Expected: sem saída (sucesso silencioso).

- [ ] **Step 7: Verificar manualmente que nada quebrou**

1. Reiniciar o servidor (`nodemon` já recarrega sozinho; se não, `npm run dev`) — confirmar no log que sobe sem erro (a criação da tabela roda no `ensureDatabase()` do boot).
2. No admin, tela Fidelidade, usar o botão "+1" num cliente até completar um ciclo — confirmar que o toast "Parabéns! ... ganhou 1 prêmio!" continua aparecendo normalmente (comportamento visível ainda não muda nesta task, só o banco por trás).
3. No Diário, registrar uma venda pra um cliente de fidelidade — confirmar que o toast de sempre ("Venda registrada. N visita(s)...") continua funcionando sem erro no console do navegador.

---

### Task 2: Novos endpoints — listar pendentes e retirar prêmio

**Files:**
- Modify: `routes/loyalty.js`

**Interfaces:**
- Consumes: `insertRewardEvents`, `countPendingRewards`, `mapCustomerRow` (Task 1).
- Produces: `GET /api/loyalty/rewards/pending`, `POST /api/loyalty/customers/:id/claim-reward` — consumidos pela Task 3 (client) e Tasks 4-6 (UI).

- [ ] **Step 1: Adicionar `GET /rewards/pending`**

Em `routes/loyalty.js`, depois do handler `POST /customers/:id/visit` (que termina por volta da linha 520, no `});` seguido de linha em branco), adicionar:

```js
// GET /api/loyalty/rewards/pending — admin (clientes com prêmio pendente, qualquer data)
router.get('/rewards/pending', authenticateToken, requireAnyPermission('fidelidade', 'vendas'), async (req, res) => {
  try {
    const result = await query(
      `SELECT
         lc.id AS customer_id,
         lc.name,
         lc.phone,
         COUNT(lr.id)::int AS pending_count,
         MIN(lr.earned_at) AS oldest_earned_at
       FROM ${table('loyalty_rewards')} lr
       JOIN ${table('loyalty_customers')} lc ON lc.id = lr.customer_id
       WHERE lr.claimed_at IS NULL AND lc.active = true
       GROUP BY lc.id, lc.name, lc.phone
       ORDER BY MIN(lr.earned_at) ASC`
    );
    const items = result.rows.map(row => ({
      customer_id: row.customer_id,
      name: row.name,
      phone: row.phone,
      pending_count: row.pending_count,
      oldest_earned_at: row.oldest_earned_at ? new Date(row.oldest_earned_at).toISOString() : null
    }));
    res.json({ items, total: items.length });
  } catch (error) {
    console.error('Erro ao buscar prêmios pendentes:', error);
    res.status(500).json({ error: 'Erro ao buscar prêmios pendentes' });
  }
});
```

- [ ] **Step 2: Adicionar `POST /customers/:id/claim-reward`**

Logo depois do endpoint anterior, adicionar:

```js
// POST /api/loyalty/customers/:id/claim-reward — admin (retira o prêmio pendente mais antigo)
router.post('/customers/:id/claim-reward', authenticateToken, requireAnyPermission('fidelidade', 'vendas'), async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const pending = await client.query(
      `SELECT id FROM ${table('loyalty_rewards')}
       WHERE customer_id = $1 AND claimed_at IS NULL
       ORDER BY earned_at ASC
       LIMIT 1
       FOR UPDATE`,
      [req.params.id]
    );
    if (pending.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nenhum prêmio pendente para este cliente' });
    }

    await client.query(
      `UPDATE ${table('loyalty_rewards')} SET claimed_at = NOW() WHERE id = $1`,
      [pending.rows[0].id]
    );

    const rewardsPendingTotal = await countPendingRewards(client, req.params.id);

    const customerResult = await client.query(
      `SELECT * FROM ${table('loyalty_customers')} WHERE id = $1`,
      [req.params.id]
    );

    await client.query('COMMIT');

    const visitsPerReward = await getVisitsPerReward();
    res.json({
      claimed: true,
      rewards_pending_total: rewardsPendingTotal,
      customer: customerResult.rows[0]
        ? mapCustomerRow(
            { ...customerResult.rows[0], rewards_pending: rewardsPendingTotal },
            { includePhone: true, visitsPerReward }
          )
        : null
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao marcar prêmio como retirado:', error);
    res.status(500).json({ error: 'Erro ao marcar prêmio como retirado' });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check routes/loyalty.js`
Expected: sem saída.

- [ ] **Step 4: Verificar manualmente via console do navegador**

1. Abrir `http://localhost:3000/admin.html`, logado, com o DevTools aberto (F12 → Console).
2. Rodar: `fetch('/api/loyalty/rewards/pending', { headers: getAuthHeaders() }).then(r => r.json()).then(console.log)`
   Esperado: `{ items: [...], total: N }` (pode ser `total: 0` se ninguém tiver prêmio pendente ainda — normal, nenhum fluxo grava isso na tela ainda, só o banco).
3. Pra gerar um pendente de teste: na tela Fidelidade, usar "+1" num cliente até completar um ciclo (gera 1 linha em `loyalty_rewards`). Repetir o `fetch` acima — o cliente deve aparecer na lista.
4. Pegar o `customer_id` retornado e rodar: `fetch('/api/loyalty/customers/' + ID + '/claim-reward', { method: 'POST', headers: getAuthHeaders() }).then(r => r.json()).then(console.log)`
   Esperado: `{ claimed: true, rewards_pending_total: 0, customer: {...} }`.
5. Repetir o `fetch` do passo 2 — o cliente não deve mais aparecer na lista.

---

### Task 3: `GET /customers` com `rewards_pending` + métodos no cliente HTTP

**Files:**
- Modify: `routes/loyalty.js`
- Modify: `js/database.js`

**Interfaces:**
- Consumes: `POST /customers/:id/claim-reward`, `GET /rewards/pending` (Task 2).
- Produces: `DB.claimLoyaltyReward(id) → Promise<{claimed, rewards_pending_total, customer}>`; `DB.getPendingLoyaltyRewards() → Promise<{items, total}>` — consumidos pelas Tasks 4-6.

- [ ] **Step 1: Estender a query de `GET /customers`**

Em `routes/loyalty.js`, dentro do handler `GET /customers` (por volta da linha 209-215), o trecho:

```js
    const result = await query(
      `SELECT * FROM ${table('loyalty_customers')}
       ${baseWhere}
       ORDER BY name ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listValues
    );
```

Vira:

```js
    const result = await query(
      `SELECT *,
         (SELECT COUNT(*)::int FROM ${table('loyalty_rewards')} lr
          WHERE lr.customer_id = ${table('loyalty_customers')}.id AND lr.claimed_at IS NULL) AS rewards_pending
       FROM ${table('loyalty_customers')}
       ${baseWhere}
       ORDER BY name ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listValues
    );
```

(`mapCustomerRow`, chamado logo abaixo em `result.rows.map(...)`, já lê `row.rewards_pending` desde a Task 1 — nada mais muda nesse handler.)

- [ ] **Step 2: Adicionar os métodos em `js/database.js`**

Logo depois de `registerLoyaltyVisit` (que termina por volta da linha 352, antes de `getLoyaltyVisitHistory`), adicionar:

```js
  async claimLoyaltyReward(id) {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/customers/${id}/claim-reward`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao marcar prêmio como retirado';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },

  async getPendingLoyaltyRewards() {
    const response = await fetch(`${getApiBaseUrl()}/loyalty/rewards/pending`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMsg = error.error || 'Erro ao buscar prêmios pendentes';
      if (response.status === 401 || response.status === 403) throw new Error(`401: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    return response.json();
  },
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check routes/loyalty.js && node --check js/database.js`
Expected: sem saída.

- [ ] **Step 4: Verificar manualmente via console do navegador**

1. Com a página do admin aberta e logada, no Console: `DB.getPendingLoyaltyRewards().then(console.log)` — mesmo resultado do `fetch` manual da Task 2.
2. `DB.getLoyaltyCustomers({ limit: 5 }).then(d => console.log(d.items.map(c => ({ name: c.name, rewards_pending: c.rewards_pending }))))` — confirmar que todo cliente aparece com `rewards_pending` (0 pra a maioria, >0 pra quem tiver pendente).

---

### Task 4: Badge + retirada no card da Fidelidade

**Files:**
- Modify: `js/admin/loyalty.js`
- Modify: `css/admin.css`

**Interfaces:**
- Consumes: `DB.claimLoyaltyReward` (Task 3); `c.rewards_pending` já vem em cada item de `DB.getLoyaltyCustomers` (Task 3).

- [ ] **Step 1: Adicionar o bloco de pendente no card**

Em `js/admin/loyalty.js`, dentro de `renderLoyaltyCustomerCard` (por volta da linha 178-191), o trecho:

```js
      <div class="loyalty-card-status">
        <div class="loyalty-card-cycle">
          <span class="loyalty-card-cycle-count" title="${escapeAttr(loyaltyProgressLabel(c))}">${display}/${n}</span>
          <div class="loyalty-card-progress" role="progressbar" aria-valuenow="${display}" aria-valuemin="0" aria-valuemax="${n}">
            <div class="loyalty-card-progress-bar ${c.cycle_complete ? 'loyalty-card-progress-bar--complete' : ''}" style="width: ${progressPct}%"></div>
          </div>
          <span class="loyalty-card-cycle-hint">${escapeHtml(loyaltyCycleHint(c))}</span>
        </div>
        <div class="loyalty-card-meta">
          <span>${c.total_visits} visita${c.total_visits === 1 ? '' : 's'} · ${c.total_rewards} prêmio${c.total_rewards === 1 ? '' : 's'}</span>
          ${statusBadges}
        </div>
      </div>
      <div class="loyalty-card-footer">
```

Vira:

```js
      <div class="loyalty-card-status">
        <div class="loyalty-card-cycle">
          <span class="loyalty-card-cycle-count" title="${escapeAttr(loyaltyProgressLabel(c))}">${display}/${n}</span>
          <div class="loyalty-card-progress" role="progressbar" aria-valuenow="${display}" aria-valuemin="0" aria-valuemax="${n}">
            <div class="loyalty-card-progress-bar ${c.cycle_complete ? 'loyalty-card-progress-bar--complete' : ''}" style="width: ${progressPct}%"></div>
          </div>
          <span class="loyalty-card-cycle-hint">${escapeHtml(loyaltyCycleHint(c))}</span>
        </div>
        <div class="loyalty-card-meta">
          <span>${c.total_visits} visita${c.total_visits === 1 ? '' : 's'} · ${c.total_rewards} prêmio${c.total_rewards === 1 ? '' : 's'}</span>
          ${statusBadges}
        </div>
      </div>
      ${c.rewards_pending > 0 ? `
      <div class="loyalty-card-rewards-pending">
        <span>🎁 ${c.rewards_pending} prêmio${c.rewards_pending === 1 ? '' : 's'} pendente${c.rewards_pending === 1 ? '' : 's'}</span>
        <button type="button" onclick="claimLoyaltyReward(event, ${c.id})" class="loyalty-claim-btn" title="Marcar prêmio como retirado" aria-label="Marcar prêmio como retirado">
          <i data-lucide="check"></i> Retirado
        </button>
      </div>` : ''}
      <div class="loyalty-card-footer">
```

- [ ] **Step 2: Adicionar o handler `claimLoyaltyReward`**

Depois da função `applyLoyaltyVisitDelta` (que termina por volta da linha 502, no `}` antes de `document.addEventListener('DOMContentLoaded', ...)`), adicionar:

```js
async function claimLoyaltyReward(event, id) {
  const btn = event?.currentTarget || event?.target;
  if (btn?.disabled) return;

  await withButtonLoading(btn, async () => {
    try {
      const result = await DB.claimLoyaltyReward(id);
      showToast('Prêmio marcado como retirado.', 'success');
      if (result.customer && !updateLoyaltyCustomerCardDom(id, result.customer)) {
        await loadLoyaltyCustomers({ silent: true });
      }
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, '');
}
```

- [ ] **Step 3: Adicionar o CSS**

Em `css/admin.css`, depois da regra `.loyalty-chip-inactive` (por volta da linha 1519-1522), adicionar:

```css
.loyalty-card-rewards-pending {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: rgba(245, 124, 0, 0.1);
  border-radius: 0.625rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #c2410c;
}

.loyalty-claim-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
  padding: 0.3rem 0.6rem;
  border: none;
  border-radius: 999px;
  background: var(--fp-green);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.loyalty-claim-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.loyalty-claim-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loyalty-claim-btn svg {
  width: 0.8125rem;
  height: 0.8125rem;
}
```

- [ ] **Step 4: Verificar sintaxe**

Run: `node --check js/admin/loyalty.js`
Expected: sem saída.

- [ ] **Step 5: Verificar manualmente no navegador**

1. Abrir a tela Fidelidade. Num cliente qualquer, clicar "+1" até completar um ciclo (10 visitas por padrão).
2. Confirmar que o card desse cliente passa a mostrar a faixa laranja "🎁 1 prêmio pendente" com o botão "Retirado".
3. Clicar "Retirado" — confirmar toast "Prêmio marcado como retirado." e que a faixa some do card.
4. Repetir "+1" até completar 2 ciclos seguidos sem clicar em retirar — confirmar que a faixa mostra "🎁 2 prêmios pendentes" (plural correto).

---

### Task 5: Banner de "ganhou prêmio" no Diário

**Files:**
- Modify: `admin.html`
- Modify: `js/admin/daily-sales.js`
- Modify: `css/admin.css`

**Interfaces:**
- Consumes: `DB.claimLoyaltyReward` (Task 3); `result.rewards_earned` e `result.rewards_pending_total` já vêm na resposta de `DB.addDailySalesBatch` (Task 1); `.loyalty-claim-btn` (Task 4, reaproveitada aqui).

- [ ] **Step 1: Adicionar o container dos banners**

Em `admin.html`, dentro de `view-daily-diario`, logo depois do `</form>` do formulário do Diário e antes de `<div class="daily-diario-day-section">` (por volta da linha 405-406), adicionar:

```html
          </form>
          <div id="daily-diario-reward-banners" class="daily-diario-reward-banners"></div>
          <div class="daily-diario-day-section">
```

- [ ] **Step 2: Renderizar o banner ao registrar**

Em `js/admin/daily-sales.js`, dentro de `submitDailyDiario`, o trecho:

```js
      const result = await DB.addDailySalesBatch(payload);

      diarioCart = [];
      diarioCartDiscount = 0;
      renderDiarioCart();
      updateDiarioLoyaltyUI();
```

Vira:

```js
      const result = await DB.addDailySalesBatch(payload);

      if (result.rewards_earned > 0 && diarioSelectedCustomer) {
        renderDiarioRewardBanner({
          customerId: diarioSelectedCustomer.id,
          customerName: diarioSelectedCustomer.name,
          rewardsEarned: result.rewards_earned,
          rewardsPendingTotal: result.rewards_pending_total || result.rewards_earned
        });
      }

      diarioCart = [];
      diarioCartDiscount = 0;
      renderDiarioCart();
      updateDiarioLoyaltyUI();
```

- [ ] **Step 3: Adicionar as funções do banner**

Antes da função `submitDailyDiario` (por volta da linha 1249), adicionar:

```js
function renderDiarioRewardBanner({ customerId, customerName, rewardsEarned, rewardsPendingTotal }) {
  const container = document.getElementById('daily-diario-reward-banners');
  if (!container) return;

  const earnedLabel = rewardsEarned === 1 ? '1 prêmio' : `${rewardsEarned} prêmios`;
  const pendingLabel = rewardsPendingTotal > 1 ? ` · ${rewardsPendingTotal} pendentes no total` : '';

  const banner = document.createElement('div');
  banner.className = 'daily-diario-reward-banner';
  banner.dataset.rewardCustomer = String(customerId);
  banner.innerHTML = `
    <div class="daily-diario-reward-banner-text">
      <span class="daily-diario-reward-banner-title">🎉 ${escapeHtml(customerName)} ganhou ${earnedLabel}!</span>
      <span class="daily-diario-reward-banner-sub">Completou o ciclo de fidelidade${escapeHtml(pendingLabel)}</span>
    </div>
    <div class="daily-diario-reward-banner-actions">
      <button type="button" class="loyalty-claim-btn" data-claim-banner title="Marcar prêmio como retirado" aria-label="Marcar prêmio como retirado">
        <i data-lucide="check"></i> Marcar como retirado
      </button>
      <button type="button" class="daily-diario-reward-banner-dismiss" data-dismiss-banner title="Dispensar" aria-label="Dispensar aviso">
        <i data-lucide="x"></i>
      </button>
    </div>
  `;
  container.prepend(banner);
  refreshIcons();
}

async function onDiarioRewardBannersClick(e) {
  const banner = e.target.closest('.daily-diario-reward-banner');
  if (!banner) return;
  const customerId = banner.dataset.rewardCustomer;

  if (e.target.closest('[data-dismiss-banner]')) {
    banner.remove();
    return;
  }

  const claimBtn = e.target.closest('[data-claim-banner]');
  if (claimBtn) {
    await withButtonLoading(claimBtn, async () => {
      try {
        await DB.claimLoyaltyReward(customerId);
        showToast('Prêmio marcado como retirado.', 'success');
        banner.remove();
      } catch (error) {
        if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
      }
    }, '');
  }
}
```

- [ ] **Step 4: Ligar o clique do container e limpar banners ao trocar de dia**

Em `initDiarioComboboxes` (por volta da linha 1015-1018), logo depois do bloco `if (cartDiscount) { ... }`, adicionar:

```js
  const rewardBanners = document.getElementById('daily-diario-reward-banners');
  if (rewardBanners) rewardBanners.addEventListener('click', onDiarioRewardBannersClick);
```

Em `clearDiarioFormState` (por volta da linha 1154), logo depois de `if (cartDiscount) cartDiscount.value = formatDiarioMoneyMaskDisplay(0);`, adicionar:

```js
  const rewardBanners = document.getElementById('daily-diario-reward-banners');
  if (rewardBanners) rewardBanners.innerHTML = '';
```

- [ ] **Step 5: Adicionar o CSS**

Em `css/admin.css`, junto com as regras `.daily-diario-*` já existentes (ex: logo depois de `.daily-diario-day-stats`), adicionar:

```css
.daily-diario-reward-banners {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  margin-top: 1rem;
}

.daily-diario-reward-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  background: rgba(29, 107, 58, 0.08);
  border: 1px solid rgba(29, 107, 58, 0.2);
  border-radius: 0.75rem;
}

.daily-diario-reward-banner-text {
  min-width: 0;
}

.daily-diario-reward-banner-title {
  display: block;
  font-weight: 700;
  font-size: 0.875rem;
  color: rgba(14, 31, 22, 0.9);
}

.daily-diario-reward-banner-sub {
  display: block;
  font-size: 0.75rem;
  color: rgba(14, 31, 22, 0.6);
  margin-top: 0.125rem;
}

.daily-diario-reward-banner-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.daily-diario-reward-banner-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: rgba(14, 31, 22, 0.4);
  cursor: pointer;
}

.daily-diario-reward-banner-dismiss:hover {
  background: rgba(0, 0, 0, 0.08);
  color: rgba(14, 31, 22, 0.7);
}

.daily-diario-reward-banner-dismiss svg {
  width: 0.875rem;
  height: 0.875rem;
}
```

- [ ] **Step 6: Verificar sintaxe**

Run: `node --check js/admin/daily-sales.js`
Expected: sem saída.

- [ ] **Step 7: Verificar manualmente no navegador**

1. No Diário, selecionar um cliente que esteja a 1 visita de completar o ciclo (ou ajustar via "+1" na Fidelidade antes, deixando faltar exatamente o valor de 1 venda).
2. Adicionar um produto cujo valor cruze o `access_value` (padrão R$ 27) e clicar Registrar.
3. Confirmar: toast normal aparece E o banner verde aparece logo abaixo do botão Registrar, com o nome do cliente.
4. Clicar "Marcar como retirado" no banner — confirmar toast de sucesso e que o banner some.
5. Repetir o registro pra gerar prêmio de novo, mas dessa vez clicar no × — confirmar que o banner some sem chamar a API (conferir na tela Fidelidade ou Vendas do dia que o prêmio continua pendente).
6. Trocar a data no seletor do Diário — confirmar que os banners somem (não persistem entre dias).

---

### Task 6: Lista "Prêmios pendentes" na tela Vendas do dia

**Files:**
- Modify: `admin.html`
- Modify: `js/admin/daily-sales.js`
- Modify: `css/admin.css`

**Interfaces:**
- Consumes: `DB.getPendingLoyaltyRewards`, `DB.claimLoyaltyReward` (Task 3); `.loyalty-claim-btn` (Task 4).

- [ ] **Step 1: Adicionar a seção no HTML**

Em `admin.html`, dentro de `view-daily-sales`, logo depois de `</div>` que fecha `.admin-view-header` e antes de `<div class="module-toolbar">` (por volta da linha 298-300), adicionar:

```html
        </div>

        <div id="daily-sales-rewards-pending" class="daily-sales-rewards-pending hidden">
          <div class="daily-sales-rewards-pending-header">
            <i data-lucide="gift"></i>
            <span id="daily-sales-rewards-pending-title">Prêmios pendentes</span>
          </div>
          <div id="daily-sales-rewards-pending-list" class="daily-sales-rewards-pending-list"></div>
        </div>

        <div class="module-toolbar">
```

- [ ] **Step 2: Adicionar as funções de carregamento/renderização**

Em `js/admin/daily-sales.js`, antes da função `loadDailySales` (por volta da linha 1190), adicionar:

```js
function formatRewardEarnedDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

async function loadPendingLoyaltyRewards() {
  const wrap = document.getElementById('daily-sales-rewards-pending');
  const titleEl = document.getElementById('daily-sales-rewards-pending-title');
  const listEl = document.getElementById('daily-sales-rewards-pending-list');
  if (!wrap || !listEl || typeof DB === 'undefined') return;

  try {
    const data = await DB.getPendingLoyaltyRewards();
    const items = data.items || [];

    if (items.length === 0) {
      wrap.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }

    if (titleEl) titleEl.textContent = `Prêmios pendentes (${items.length})`;
    listEl.innerHTML = items.map(item => `
      <div class="daily-sales-rewards-pending-item" data-reward-customer="${item.customer_id}">
        <span class="daily-sales-rewards-pending-name">
          ${escapeHtml(item.name)}
          <span class="daily-sales-rewards-pending-meta">${item.pending_count > 1 ? `${item.pending_count} prêmios · ` : ''}ganhou em ${formatRewardEarnedDate(item.oldest_earned_at)}</span>
        </span>
        <button type="button" class="loyalty-claim-btn" data-claim-pending title="Marcar prêmio como retirado" aria-label="Marcar prêmio como retirado">
          <i data-lucide="check"></i> Retirado
        </button>
      </div>
    `).join('');
    wrap.classList.remove('hidden');
    refreshIcons();
  } catch (error) {
    if (handleAuthError(error)) return;
    wrap.classList.add('hidden');
  }
}

async function onPendingRewardsListClick(e) {
  const btn = e.target.closest('[data-claim-pending]');
  if (!btn) return;
  const row = btn.closest('[data-reward-customer]');
  const customerId = row?.dataset.rewardCustomer;
  if (!customerId) return;

  await withButtonLoading(btn, async () => {
    try {
      await DB.claimLoyaltyReward(customerId);
      showToast('Prêmio marcado como retirado.', 'success');
      await loadPendingLoyaltyRewards();
    } catch (error) {
      if (!handleAuthError(error)) showToast('Erro: ' + error.message, 'error');
    }
  }, '');
}
```

- [ ] **Step 3: Carregar a lista junto com a tela e ligar o clique**

No início de `loadDailySales` (logo na primeira linha do corpo da função, por volta da linha 1191), adicionar a chamada (sem `await` — é uma seção independente do resto da tela):

```js
async function loadDailySales() {
  loadPendingLoyaltyRewards();
  const listEl = document.getElementById('daily-sales-list');
```

Em `bindDailySalesEvents` (por volta da linha 1328-1339), logo antes do `}` final da função, adicionar:

```js
  const pendingRewardsList = document.getElementById('daily-sales-rewards-pending-list');
  if (pendingRewardsList && !pendingRewardsList.dataset.bound) {
    pendingRewardsList.dataset.bound = '1';
    pendingRewardsList.addEventListener('click', onPendingRewardsListClick);
  }
```

- [ ] **Step 4: Adicionar o CSS**

Em `css/admin.css`, junto com as regras `.daily-sales-*` já existentes, adicionar:

```css
.daily-sales-rewards-pending {
  margin-bottom: 1rem;
  padding: 0.875rem 1rem;
  background: rgba(245, 124, 0, 0.08);
  border: 1px solid rgba(245, 124, 0, 0.2);
  border-radius: 0.875rem;
}

.daily-sales-rewards-pending.hidden {
  display: none;
}

.daily-sales-rewards-pending-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.625rem;
  font-weight: 700;
  font-size: 0.875rem;
  color: #c2410c;
}

.daily-sales-rewards-pending-header svg {
  width: 1rem;
  height: 1rem;
}

.daily-sales-rewards-pending-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.daily-sales-rewards-pending-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.625rem;
  background: #fff;
  border-radius: 0.625rem;
}

.daily-sales-rewards-pending-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 600;
}

.daily-sales-rewards-pending-meta {
  display: block;
  font-size: 0.6875rem;
  font-weight: 400;
  color: rgba(14, 31, 22, 0.55);
  margin-top: 0.0625rem;
}
```

- [ ] **Step 5: Verificar sintaxe**

Run: `node --check js/admin/daily-sales.js`
Expected: sem saída.

- [ ] **Step 6: Verificação final — fluxo completo de ponta a ponta**

1. Gerar um prêmio pendente pra 2 clientes diferentes (via "+1" na Fidelidade ou registrando vendas no Diário até completar um ciclo).
2. Abrir a tela "Vendas do dia" (menu lateral) — confirmar que a seção "Prêmios pendentes (2)" aparece no topo, acima do filtro de data, com os 2 clientes e "ganhou em DD/MM".
3. Trocar a data no filtro dessa tela pra uma data qualquer sem vendas — confirmar que a seção de pendentes continua mostrando os mesmos 2 clientes (não é afetada pelo filtro).
4. Clicar "Retirado" num dos dois — confirmar que ele some da lista e o título atualiza pra "Prêmios pendentes (1)"; retirar o último e confirmar que a seção inteira some.
5. Ir na tela Fidelidade e conferir que o card do cliente que teve o prêmio retirado não mostra mais a faixa de pendente.
6. Registrar uma nova venda no Diário que gere prêmio pra um cliente — confirmar que ele aparece imediatamente na lista de pendentes da tela "Vendas do dia" ao navegar até lá (sem precisar recarregar a página).
