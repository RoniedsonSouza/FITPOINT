# Ingresso VIP + Dar ingresso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir emissão admin de Ingresso VIP (sem pagamento, e-mail com QR, flag na lista) e atribuição de titulares (“Dar ingresso”) no checkout público e na emissão VIP.

**Architecture:** Lote com `is_vip` oculto do público; pedido com `source` (`checkout`|`vip`) e `assignees` JSONB; na emissão, cada ticket recebe o titular resolvido; e-mails agrupados por e-mail do titular. VIP cria order já `paid` e reutiliza a lógica de fulfill (sem Mercado Pago).

**Tech Stack:** Node/Express, PostgreSQL, Resend, HTML/JS admin e `evento.html` / `events-page.js`. Testes: scripts `node scripts/test-*.js` (padrão do repo).

## Global Constraints

- Quantidade por pedido/emissão: 1–10.
- Lote VIP: nome `"Ingresso VIP"`, `price = 0`, `is_vip = true`; no máximo um por evento.
- Lotes VIP nunca aparecem em listagens públicas nem podem ser comprados no checkout.
- Assignees: array de tamanho `quantity`; `null` = herda comprador/emissor; objeto exige `name` + `email` válidos; `phone` opcional.
- E-mail: um envio por endereço de titular, só com os tickets daquele titular.
- Permissão emissão VIP e criar lote VIP: `authenticateToken` + `requirePermission('eventos', 'lotes')`.
- Spec: [docs/superpowers/specs/2026-08-12-ingresso-vip-design.md](../specs/2026-08-12-ingresso-vip-design.md).

---

## File Structure

| Arquivo | Papel |
|---------|--------|
| `services/ticketAssignees.js` | Validar/normalizar assignees e resolver titulares |
| `scripts/test-ticket-assignees.js` | Testes unitários dos assignees |
| `scripts/migrate.js` + `config/database.js` | Colunas `is_vip`, `source`, `assignees`, `tickets.buyer_phone` |
| `routes/events.js` | CRUD lote VIP + hide público |
| `routes/tickets.js` | Checkout assignees, `issue-vip`, fulfill multi-e-mail |
| `services/email.js` | Copy cortesia/VIP + múltiplos destinatários via caller |
| `js/database.js` | Cliente `issueVipTicket` |
| `js/admin/events.js` + `admin.html` | Criar VIP, emitir VIP, badge |
| `js/events-page.js` + `evento.html` | UI Dar ingresso no checkout |
| `docs/INGRESSOS-CONFIG.md` | Nota curta sobre VIP (opcional na última task) |

---

### Task 1: Serviço `ticketAssignees`

**Files:**
- Create: `services/ticketAssignees.js`
- Create: `scripts/test-ticket-assignees.js`

**Interfaces:**
- Produces:
  - `normalizeAssignees(assignees, quantity) → { ok: true, value: Array } | { ok: false, error: string }`
  - `resolveHolders(order) → Array<{ name, email, phone }>` length `order.quantity`

- [ ] **Step 1: Escrever o script de teste**

```js
// scripts/test-ticket-assignees.js
const { normalizeAssignees, resolveHolders } = require('../services/ticketAssignees');

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

eq('pads nulls to quantity', normalizeAssignees(undefined, 3), {
  ok: true,
  value: [null, null, null]
});
eq('rejects too many', normalizeAssignees([null, null, null], 2).ok, false);
eq('normalizes email', normalizeAssignees([{ name: 'A', email: 'A@X.COM', phone: '1' }], 1), {
  ok: true,
  value: [{ name: 'A', email: 'a@x.com', phone: '1' }]
});
eq('rejects bad email', normalizeAssignees([{ name: 'A', email: 'x' }], 1).ok, false);
eq('rejects missing name', normalizeAssignees([{ name: ' ', email: 'a@b.com' }], 1).ok, false);

const holders = resolveHolders({
  quantity: 3,
  buyer_name: 'Comprador',
  buyer_email: 'c@c.com',
  buyer_phone: '11',
  assignees: [null, { name: 'Maria', email: 'm@m.com', phone: '22' }, null]
});
eq('resolve holders', holders, [
  { name: 'Comprador', email: 'c@c.com', phone: '11' },
  { name: 'Maria', email: 'm@m.com', phone: '22' },
  { name: 'Comprador', email: 'c@c.com', phone: '11' }
]);

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log('\nTodos ok');
```

- [ ] **Step 2: Rodar e confirmar falha (módulo inexistente)**

Run: `node scripts/test-ticket-assignees.js`  
Expected: erro `Cannot find module '../services/ticketAssignees'`

- [ ] **Step 3: Implementar `services/ticketAssignees.js`**

```js
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAssignees(assignees, quantity) {
  const qty = parseInt(quantity, 10);
  if (!qty || qty < 1 || qty > 10) {
    return { ok: false, error: 'Quantidade deve ser entre 1 e 10' };
  }

  let list = assignees;
  if (list == null) list = [];
  if (!Array.isArray(list)) {
    return { ok: false, error: 'assignees inválido' };
  }
  if (list.length > qty) {
    return { ok: false, error: 'Há mais destinatários do que ingressos' };
  }

  const value = [];
  for (let i = 0; i < qty; i++) {
    const raw = i < list.length ? list[i] : null;
    if (raw == null) {
      value.push(null);
      continue;
    }
    if (typeof raw !== 'object') {
      return { ok: false, error: `Destinatário ${i + 1} inválido` };
    }
    const name = raw.name != null ? String(raw.name).trim() : '';
    const email = raw.email != null ? String(raw.email).trim().toLowerCase() : '';
    const phone = raw.phone != null && String(raw.phone).trim() ? String(raw.phone).trim() : null;
    if (!name) return { ok: false, error: `Nome do destinatário ${i + 1} é obrigatório` };
    if (!email || !isValidEmail(email)) {
      return { ok: false, error: `E-mail do destinatário ${i + 1} é inválido` };
    }
    value.push({ name, email, phone });
  }
  return { ok: true, value };
}

function resolveHolders(order) {
  const qty = Number(order.quantity);
  const assignees = Array.isArray(order.assignees) ? order.assignees : [];
  const buyer = {
    name: order.buyer_name,
    email: String(order.buyer_email).trim().toLowerCase(),
    phone: order.buyer_phone || null
  };
  const holders = [];
  for (let i = 0; i < qty; i++) {
    const a = i < assignees.length ? assignees[i] : null;
    if (a && a.name && a.email) {
      holders.push({
        name: String(a.name).trim(),
        email: String(a.email).trim().toLowerCase(),
        phone: a.phone || null
      });
    } else {
      holders.push({ ...buyer });
    }
  }
  return holders;
}

module.exports = { normalizeAssignees, resolveHolders, isValidEmail };
```

- [ ] **Step 4: Rodar testes**

Run: `node scripts/test-ticket-assignees.js`  
Expected: `Todos ok`

- [ ] **Step 5: Commit**

```bash
git add services/ticketAssignees.js scripts/test-ticket-assignees.js
git commit -m "feat(tickets): add assignee normalize/resolve helpers"
```

---

### Task 2: Migração de schema

**Files:**
- Modify: `scripts/migrate.js` (bloco ticket_lots / ticket_orders / tickets — espelhar padrão `ADD COLUMN IF NOT EXISTS` das promos)
- Modify: `config/database.js` (`ensureDatabase` — mesmas colunas nos `CREATE TABLE` e alters idempotentes)

**Interfaces:**
- Produces: colunas `ticket_lots.is_vip`, `ticket_orders.source`, `ticket_orders.assignees`, `tickets.buyer_phone`

- [ ] **Step 1: Em `migrate.js`, após os alters de promo dos lotes, adicionar**

```js
await client.query(`
  ALTER TABLE ${SCHEMA}.ticket_lots
  ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT false
`);

await client.query(`
  ALTER TABLE ${SCHEMA}.ticket_orders
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'checkout'
`);

await client.query(`
  ALTER TABLE ${SCHEMA}.ticket_orders
  ADD COLUMN IF NOT EXISTS assignees JSONB
`);

await client.query(`
  ALTER TABLE ${SCHEMA}.tickets
  ADD COLUMN IF NOT EXISTS buyer_phone VARCHAR(50)
`);
```

Atualizar também os `CREATE TABLE IF NOT EXISTS` iniciais de `ticket_lots`, `ticket_orders` e `tickets` para incluir as colunas (instalações novas).

Para `source`, se o CHECK do CREATE for possível, usar:

```sql
source VARCHAR(20) NOT NULL DEFAULT 'checkout'
  CHECK (source IN ('checkout', 'vip'))
```

No ALTER de bases existentes, se não houver constraint ainda, opcionalmente:

```js
await client.query(`
  DO $$ BEGIN
    ALTER TABLE ${SCHEMA}.ticket_orders
      ADD CONSTRAINT ticket_orders_source_check
      CHECK (source IN ('checkout', 'vip'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
`);
```

(Ajustar `SCHEMA`/nome conforme o arquivo já faz.)

- [ ] **Step 2: Espelhar em `config/database.js`**

Mesmos campos nos CREATE e os mesmos `ADD COLUMN IF NOT EXISTS` no boot.

- [ ] **Step 3: Rodar migrate localmente**

Run: `node scripts/migrate.js`  
Expected: exit 0, sem erro nas novas colunas.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate.js config/database.js
git commit -m "feat(db): add VIP lot flag, order source/assignees, ticket phone"
```

---

### Task 3: Lotes VIP na API de eventos

**Files:**
- Modify: `routes/events.js` (`mapLotRow`, `getLotsForEvent`, `POST/PUT lots`)

**Interfaces:**
- Consumes: coluna `is_vip`
- Produces: lotes com `is_vip` no JSON; públicos sem VIP; create VIP com regras do spec

- [ ] **Step 1: Atualizar `mapLotRow`**

Incluir `is_vip: row.is_vip === true`.

- [ ] **Step 2: Em `getLotsForEvent`, quando `onlyAvailable === true`, excluir VIP**

```js
if (onlyAvailable) {
  const now = new Date();
  lots = lots.filter((lot) => !lot.is_vip && isLotOnSale(lot, now));
}
```

Admin (`onlyAvailable: false`) continua vendo VIP.

- [ ] **Step 3: Em `POST /:id/lots`**

- Ler `is_vip` do body (boolean).
- Se `is_vip`:
  - Forçar `name = 'Ingresso VIP'`, `priceNum = 0`, `promo` desligado.
  - Antes do INSERT, checar se já existe VIP no evento:

```js
const vipExists = await query(
  `SELECT id FROM ${table('ticket_lots')} WHERE event_id = $1 AND is_vip = true LIMIT 1`,
  [req.params.id]
);
if (vipExists.rows.length) {
  return res.status(400).json({ error: 'Este evento já possui um lote VIP' });
}
```

- Incluir `is_vip` no INSERT.

- [ ] **Step 4: Em `PUT /:eventId/lots/:lotId`**

- Não permitir “desmarcar” VIP para lote comum nem criar segundo VIP via rename.
- Se `current.is_vip`: manter `is_vip = true`, name `'Ingresso VIP'`, price `0`, promo off (permitir editar qty/janelas/active).
- Se não for VIP, ignorar `is_vip: true` no PUT (VIP só via create) **ou** rejeitar com 400 — preferir rejeitar: `{ error: 'Use a criação de lote VIP' }`.

- [ ] **Step 5: Smoke manual rápido**

Criar lote VIP via API autenticada; `GET /api/events/:id` sem auth não deve listar o lote VIP.

- [ ] **Step 6: Commit**

```bash
git add routes/events.js
git commit -m "feat(events): VIP lot create/hide from public listings"
```

---

### Task 4: E-mail e fulfill multi-titular

**Files:**
- Modify: `services/email.js`
- Modify: `routes/tickets.js` (`fulfillPaidOrder`)

**Interfaces:**
- Consumes: `resolveHolders` de `services/ticketAssignees.js`
- Produces: `sendTicketEmail({ ..., complimentary?: boolean })`; fulfill cria tickets por titular e envia N e-mails

- [ ] **Step 1: Estender `sendTicketEmail`**

Aceitar `complimentary = false`. Se true:

- Assunto: `Ingresso VIP — ${event.title}`
- Corpo: trocar “Pagamento confirmado…” por “Seu ingresso VIP/cortesia para o evento:”

Manter anexos/QR iguais.

- [ ] **Step 2: Refatorar `fulfillPaidOrder(orderId, mpPaymentId, options = {})`**

Comportamento:

1. SELECT order `FOR UPDATE` (incluir `assignees`, `source`, `is_vip` do lote se útil).
2. Se `status === 'paid'` **e** já existem tickets para o order → `{ ok: true, already: true }` (idempotente).
3. Se VIP acabou de inserir order já `paid` sem tickets: permitir emitir quando `options.allowAlreadyPaid === true` **ou** quando `order.source === 'vip'` e count tickets = 0.
4. Para `pending`: marcar `paid` + `mp_payment_id` como hoje.
5. `const holders = resolveHolders(order)` — se `assignees` vier string JSON do pg, fazer `typeof === 'string' ? JSON.parse : assignees`.
6. INSERT cada ticket com `holders[i].name/email/phone`.
7. Agrupar tickets por `email`; para cada grupo chamar `sendTicketEmail` com `complimentary: order.source === 'vip'`.
8. Falha de e-mail: log, não rollback (após COMMIT dos tickets).

Pseudocódigo do agrupamento:

```js
const byEmail = new Map();
for (const t of tickets) {
  const key = t.buyer_email;
  if (!byEmail.has(key)) byEmail.set(key, { name: t.buyer_name, tickets: [] });
  byEmail.get(key).tickets.push({ code: t.code });
}
for (const [to, group] of byEmail) {
  await sendTicketEmail({
    to,
    buyerName: group.name,
    event: { ... },
    lot: { name: order.lot_name },
    tickets: group.tickets,
    complimentary: order.source === 'vip'
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add services/email.js routes/tickets.js
git commit -m "feat(tickets): fulfill per holder and VIP email copy"
```

---

### Task 5: Checkout com assignees + bloqueio VIP

**Files:**
- Modify: `routes/tickets.js` (`POST /checkout`)

**Interfaces:**
- Consumes: `normalizeAssignees`
- Produces: order com `source='checkout'`, `assignees` persistido

- [ ] **Step 1: No checkout, após carregar o lote**

```js
if (lot.is_vip === true) {
  await client.query('ROLLBACK');
  return res.status(400).json({ error: 'Este lote não está disponível para compra' });
}
```

Garantir que o `SELECT` do lote retorna `is_vip`.

- [ ] **Step 2: Normalizar assignees do body**

```js
const normalized = normalizeAssignees(req.body.assignees, qty);
if (!normalized.ok) {
  await client.query('ROLLBACK'); // se já abriu BEGIN — senão return antes
  return res.status(400).json({ error: normalized.error });
}
```

Preferir validar assignees **antes** do BEGIN/reserva de estoque.

- [ ] **Step 3: INSERT do order incluir**

```sql
(..., status, source, assignees, created_at, updated_at)
VALUES (..., 'pending', 'checkout', $assignees::jsonb, NOW(), NOW())
```

Passar `JSON.stringify(normalized.value)`.

- [ ] **Step 4: Commit**

```bash
git add routes/tickets.js
git commit -m "feat(tickets): store assignees on checkout; block VIP lots"
```

---

### Task 6: Endpoint `POST /api/tickets/issue-vip`

**Files:**
- Modify: `routes/tickets.js`
- Modify: `js/database.js` (método cliente)

**Interfaces:**
- Consumes: `normalizeAssignees`, `fulfillPaidOrder` (caminho VIP)
- Produces: emissão cortesia autenticada

- [ ] **Step 1: Adicionar rota (antes de rotas `/:id` se houver conflito — neste arquivo a lista é `GET /`, então `POST /issue-vip` é seguro)**

```js
router.post('/issue-vip', authenticateToken, requirePermission('eventos', 'lotes'), async (req, res) => {
  // body: event_id, quantity, buyer_name, buyer_email, buyer_phone, assignees, lot_id?
});
```

Fluxo:

1. Validar buyer (mesmas regras do checkout: nome, e-mail).
2. `normalizeAssignees(assignees, qty)`.
3. BEGIN; SELECT lote VIP do evento `FOR UPDATE` (`WHERE event_id=$1 AND is_vip=true` ou `id=lot_id AND is_vip`).
4. Se não achar → 404; se estoque insuficiente → 400; evento inativo → 400 (admin pode emitir mesmo com janela de venda? Spec: emitir consome estoque do lote VIP ativo — exigir `lot.active` e estoque; **não** exigir sales_start/end para VIP admin).
5. `quantity_sold += qty`.
6. INSERT order: `amount=0`, `status='paid'`, `source='vip'`, `assignees`, buyer_*.
7. COMMIT.
8. Chamar lógica de emissão de tickets (extrair `emitTicketsForPaidOrder(orderId)` se `fulfillPaidOrder` não cobrir paid-sem-tickets; ou `fulfillPaidOrder(orderId, null)` com suporte a `source=vip`).
9. `201` com `{ order_id, tickets: [{ id, code, buyer_name, buyer_email }] }`.

- [ ] **Step 2: Em `js/database.js`**

```js
async issueVipTicket(payload) {
  return this.request('/tickets/issue-vip', { method: 'POST', body: payload });
}
```

(Ajustar ao padrão real de `checkoutTicket` / `request` do arquivo.)

- [ ] **Step 3: Smoke**

Emitir 2 VIP com 1 assignee; conferir 2 rows em `tickets` com titulares distintos.

- [ ] **Step 4: Commit**

```bash
git add routes/tickets.js js/database.js
git commit -m "feat(tickets): admin VIP complimentary issue endpoint"
```

---

### Task 7: UI admin — lote VIP, emitir VIP, badge

**Files:**
- Modify: `admin.html`
- Modify: `js/admin/events.js`

**Interfaces:**
- Consumes: `DB.createEventLot`, `DB.issueVipTicket`, `GET tickets` com `is_vip`

- [ ] **Step 1: Garantir API de listagem devolve `is_vip`**

Em `GET /api/tickets` (`routes/tickets.js`), no SELECT/join incluir `l.is_vip` e mapear `is_vip: row.is_vip === true` (e opcional `order_source`).

- [ ] **Step 2: Aba Lotes — botão “Criar lote VIP”**

Ao lado de “Novo lote”. Handler `openVipLotModal()`:

- Se já existe lote com `is_vip` na lista carregada → toast “Já existe lote VIP” e opcionalmente `editLot(id)`.
- Senão: abrir modal com nome/preço readonly, hidden `lot-is-vip=true`, título “Novo lote VIP”.

Em `saveLot`, se VIP: enviar `is_vip: true`, `name: 'Ingresso VIP'`, `price: 0`, promo off.

Na listagem de lotes, badge pequena “VIP” no card do lote VIP.

- [ ] **Step 3: Aba Ingressos — botão “Emitir VIP” + modal**

Markup modal (`#vip-issue-modal`): qty, nome, e-mail, telefone, container `#vip-assignee-slots`, botões Dar ingresso / remover.

JS:

- Ao mudar qty, renderizar N slots (“Ingresso 1 — você” + botão Dar ingresso).
- Dar ingresso: campos nome/e-mail/telefone naquele slot.
- Submit → `DB.issueVipTicket({ event_id: selectedEventId, quantity, buyer_*, assignees })`.
- Sucesso: fechar, toast, `loadTicketsAdmin()`.

- [ ] **Step 4: Badge VIP em `loadTicketsAdmin`**

Mobile e desktop: se `t.is_vip`, exibir `<span class="badge ...">VIP</span>` junto ao lote ou status (classe existente de badge se houver; senão texto curto `VIP` com estilo discreto alinhado ao admin).

- [ ] **Step 5: Commit**

```bash
git add admin.html js/admin/events.js routes/tickets.js
git commit -m "feat(admin): VIP lot button, issue modal, list badge"
```

---

### Task 8: UI checkout público — Dar ingresso

**Files:**
- Modify: `evento.html`
- Modify: `js/events-page.js`

**Interfaces:**
- Consumes: checkout API com `assignees`
- Produces: UI de slots + payload

- [ ] **Step 1: Em `evento.html`, após telefone do checkout, adicionar bloco**

```html
<div id="checkout-gift-section" class="field hidden">
  <label>Destinatários dos ingressos</label>
  <p class="field-hint">Por padrão todos ficam no seu nome. Use “Dar ingresso” para enviar o QR a outra pessoa.</p>
  <div id="checkout-assignee-slots"></div>
</div>
```

- [ ] **Step 2: Em `events-page.js`**

- Estado `checkoutAssignees = []` (null ou objeto por índice).
- Ao mudar `#checkout-qty`, re-render slots (1..qty); mostrar seção se qty >= 1 (sempre ok; botão útil sobretudo qty > 1).
- Slot UI: “Ingresso i — [Seu nome / Nome doado]” + botão Dar ingresso / Limpar.
- Mini-form por slot (nome, e-mail, telefone) ao doar.
- No submit do checkout (onde monta o body ~linha do `quantity:`), incluir:

```js
assignees: buildAssigneesPayload(qty)
```

`buildAssigneesPayload` devolve array length qty com null ou `{name,email,phone}`.

- Validação front: se slot doado, nome+e-mail preenchidos antes de pagar.

- [ ] **Step 3: Ajuste de copy do hint de e-mail**

Se houver doações: hint “Cada pessoa receberá o QR no e-mail informado.”

- [ ] **Step 4: Commit**

```bash
git add evento.html js/events-page.js
git commit -m "feat(checkout): assign gifted tickets to other holders"
```

---

### Task 9: Verificação ponta a ponta + docs

**Files:**
- Modify (leve): `docs/INGRESSOS-CONFIG.md` — parágrafo VIP + Dar ingresso
- Run: `scripts/test-ticket-assignees.js`, `scripts/test-ticket-pricing.js`

- [ ] **Step 1: Rodar testes unitários**

```bash
node scripts/test-ticket-assignees.js
node scripts/test-ticket-pricing.js
```

Expected: ambos ok.

- [ ] **Step 2: Checklist manual**

1. Criar lote VIP no admin → não aparece em `evento.html`.
2. Emitir 3 VIP, doar 1 → 2 e-mails (ou logs Resend); lista com badge VIP.
3. Checkout pago qty 2 com 1 doado → após pagamento, e-mails corretos; lista sem badge VIP.
4. Tentar checkout com `lot_id` VIP via API → 400.
5. Segundo “Criar lote VIP” → 400 / toast.

- [ ] **Step 3: Doc curta em `docs/INGRESSOS-CONFIG.md`**

Seção “Ingresso VIP”: lote oculto, emissão admin, assignees no checkout.

- [ ] **Step 4: Commit final**

```bash
git add docs/INGRESSOS-CONFIG.md
git commit -m "docs: document VIP complimentary tickets and gift assignees"
```

---

## Self-review (plan vs spec)

| Spec | Task |
|------|------|
| `is_vip` + criar lote VIP botão | 2, 3, 7 |
| Um VIP por evento, oculto público | 3 |
| `source` + `assignees` + phone no ticket | 2, 4, 5 |
| issue-vip sem MP | 6 |
| Checkout assignees + block VIP | 5, 8 |
| E-mail só ao titular / copy VIP | 4 |
| Badge VIP na lista | 7 |
| Qty 1–10 | 1, 5, 6 |
| Testes assignees | 1, 9 |
