# Design: Diário — Prêmios de fidelidade (ganhar + retirar)

**Data:** 2026-08-13
**Status:** aprovado

## Problema

Hoje `loyalty_customers.total_rewards` é só um contador que soma automaticamente a cada N visitas (via `applyVisitDelta`), sem nenhuma noção de "retirado". O único aviso ao cliente ganhar é um toast que some sozinho, e não existe fluxo pra confirmar que o prêmio foi entregue — a única forma de "zerar" hoje é editando manualmente o campo numérico no cadastro do cliente na tela Fidelidade.

## Objetivos

1. Ao ganhar um prêmio registrando uma venda no Diário, mostrar um aviso claro e persistente (banner) com ação de retirada ali mesmo.
2. Fluxo explícito para marcar que o prêmio foi retirado pelo cliente.
3. Enquanto não for marcado como retirado, o prêmio continua "pendente" indefinidamente — o cliente continua acumulando visitas e ganhando novos prêmios normalmente (podem existir vários pendentes ao mesmo tempo pro mesmo cliente).
4. Lista de "prêmios pendentes" sempre visível (não presa a uma data) na tela "Vendas do dia", e indicador + ação no card do cliente na tela Fidelidade.

## Não objetivos

- Página pública (`fidelidade.html` / hall da fama) — inalterada, continua usando `total_rewards` (contador vitalício) como já funciona hoje.
- Desfazer uma retirada marcada por engano — sem essa ação pela UI (mesma limitação que já existe hoje pra visitas).
- Notificar o cliente (SMS/e-mail/WhatsApp) sobre o prêmio — só uso interno do admin.
- Mudar a matemática de quando um prêmio é ganho (`applyVisitDelta`, `visits_per_reward`) — permanece igual.
- Escolher QUAL prêmio retirar quando há mais de um pendente — retira sempre o mais antigo primeiro (FIFO), sem seleção manual.

## Decisões

| Tema | Decisão |
|------|---------|
| Modelo de dados | Nova tabela `loyalty_rewards` (1 linha por prêmio ganho), mesmo padrão de `loyalty_visit_events` já existente |
| Múltiplos pendentes | Suportado nativamente — cada prêmio é uma linha independente com `claimed_at` próprio |
| Qual prêmio retirar | Sempre o mais antigo não retirado (FIFO) — 1 clique = 1 prêmio |
| Confirmação ao retirar | Ação direta (sem popup de confirmação), com toast de sucesso |
| Aviso ao ganhar | Banner persistente no Diário, logo abaixo do botão Registrar, acima de "Vendas do dia". Empilha se houver mais de um ganho na sessão (mais recente no topo). Dispensável (×), mas dispensar não afeta o pendente. |
| Toast existente | Mantido como está (some sozinho, confirma a venda) — banner é adicional, só quando ganha prêmio |
| Lista de pendentes | Nova seção fixa no topo da tela "Vendas do dia", ignora o filtro de data — mostra todo pendente de qualquer dia, com nome + telefone + data do prêmio mais antigo |
| Card da Fidelidade | Indicador + botão de retirada quando `rewards_pending > 0`, ao lado de "X visitas · Y prêmios" |
| Copy/ícone | Ícone `check` + texto curto "Retirado" nos lugares compactos (lista e card); texto completo "Marcar como retirado" no banner; `title`/aria-label sempre "Marcar prêmio como retirado" |
| Permissão | `requireAnyPermission('fidelidade', 'vendas')` — mesma regra já usada pra listar clientes de fidelidade |
| `total_rewards` (contador atual) | Não muda de significado — continua contando vitalício, independente de retirado ou não |
| Remoção manual de visita (-1) cruzando um ciclo pra trás | Remove a linha pendente mais recente de `loyalty_rewards` do cliente pra manter consistência (ver Erros e bordas) |

## Modelo de dados

### `loyalty_rewards` (nova)

```sql
CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE,
  earned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMP NULL,
  source VARCHAR(20) NOT NULL
)
```

- Índice em `(customer_id)` e um parcial em `(claimed_at) WHERE claimed_at IS NULL` pra acelerar a listagem de pendentes.
- `source`: mesma convenção de `loyalty_visit_events.source` (`'daily_sales'` | `'admin'`).
- Uma linha é inserida pra cada unidade de `rewards_earned` retornado por `applyVisitDelta`, na mesma transação em que `insertVisitEvents` já roda hoje.
- `claimed_at IS NULL` = pendente. Sem campo "quem retirou" (fora do escopo).

### `loyalty_customers` / `total_rewards`

Sem mudança de schema nem de semântica — continua o contador vitalício incrementado por `applyVisitDelta`, usado pelo hall da fama público.

## Fluxos

### Ganhar (registro de venda no Diário)

1. `submitDailyDiario` → `POST /api/daily-sales/batch` (existente) → dentro da mesma transação, `applyLoyaltyForSale` já calcula `rewards_earned` via `applyVisitDelta`.
2. Se `rewards_earned > 0`: insere `rewards_earned` linhas em `loyalty_rewards` (`claimed_at = NULL`, `source = 'daily_sales'`), igual ao já feito hoje com `insertVisitEvents`.
3. Resposta do endpoint ganha o campo `rewards_pending_total` (contagem atual de pendentes daquele cliente, após o insert).
4. No front, se `result.rewards_earned > 0`: empilha um card no topo de `daily-diario-reward-banners`, com o nome do cliente (já conhecido via `diarioSelectedCustomer.name`, sem precisar vir do servidor), `rewards_earned` e `rewards_pending_total`. Cada banner tem botão "Marcar como retirado" (chama a claim API pra esse cliente) e um × (remove só o card da tela, sem chamar API).
5. Toast de sucesso já existente continua disparando normalmente, sem mudança.

### Ganhar (ajuste manual de visita na Fidelidade, +1)

1. `POST /api/loyalty/customers/:id/visit` (existente) → mesma lógica: se `rewards_earned > 0`, insere em `loyalty_rewards` com `source = 'admin'`.
2. Sem banner nessa tela (fora do escopo) — o toast "Parabéns! ganhou prêmio" que já existe ali continua igual; o card do cliente reflete o pendente na atualização normal da lista.

### Remover visita manualmente (-1) na Fidelidade, cruzando um ciclo pra trás

1. Mesmo endpoint. Se a chamada a `applyVisitDelta` resultar em `rewards < total_rewards_anterior` (o total de prêmios caiu), a diferença é a quantidade de prêmios "desfeitos".
2. Pra cada prêmio desfeito: remove (`DELETE`, não `UPDATE`) a linha **pendente mais recente** (`ORDER BY earned_at DESC LIMIT 1 WHERE claimed_at IS NULL`) de `loyalty_rewards` do cliente. Se não houver pendente suficiente (o prêmio já foi retirado), não faz nada — fica uma inconsistência histórica aceitável, mesma limitação que já existe hoje com visitas removidas depois de já contabilizadas.

### Retirar (banner, lista da tela Vendas do dia, ou card da Fidelidade — mesmo endpoint nos 3 pontos)

1. Clique em "Retirado" / "Marcar como retirado" → `POST /api/loyalty/customers/:id/claim-reward`.
2. Backend, em transação: `SELECT id FROM loyalty_rewards WHERE customer_id=$1 AND claimed_at IS NULL ORDER BY earned_at ASC LIMIT 1 FOR UPDATE`; se não achar, 404 ("Nenhum prêmio pendente"); senão `UPDATE ... SET claimed_at = NOW() WHERE id = $rewardId`.
3. Resposta: `{ claimed: true, rewards_pending_total: N }` (N = quantos ainda restam pendentes pra esse cliente).
4. Front: toast "Prêmio marcado como retirado." + atualiza/remove a linha ou badge correspondente (some se `rewards_pending_total === 0`, senão atualiza a contagem exibida).

### Listar pendentes (tela "Vendas do dia")

1. Ao carregar a tela — independente da data selecionada no filtro — `GET /api/loyalty/rewards/pending` busca todo cliente ativo com pendente >= 1.
2. Renderiza seção fixa no topo (acima do filtro de data): "Prêmios pendentes (N)", uma linha por cliente — nome, telefone, "ganhou em DD/MM" (data do prêmio pendente mais antigo) e botão de retirar. Seção inteira some se N = 0.

## API

### `GET /api/loyalty/rewards/pending` (auth + `requireAnyPermission('fidelidade', 'vendas')`)

Resposta:

```json
{
  "items": [
    {
      "customer_id": 12,
      "name": "Maria Silva",
      "phone": "11988887777",
      "pending_count": 2,
      "oldest_earned_at": "2026-08-10T14:00:00.000Z"
    }
  ],
  "total": 1
}
```

Agrupado por cliente (`GROUP BY customer_id`), só `claimed_at IS NULL`, join com `loyalty_customers` pra pegar nome/telefone e filtrar `active = true`.

### `POST /api/loyalty/customers/:id/claim-reward` (auth + `requireAnyPermission('fidelidade', 'vendas')`)

Sem body. Retira o prêmio mais antigo pendente do cliente `:id`.

- 404 se cliente não existe ou não tem prêmio pendente.
- 200: `{ claimed: true, rewards_pending_total: number }`.

### `POST /api/daily-sales/batch` (existente, estendido)

Resposta ganha o campo `rewards_pending_total` (só quando `loyalty_customer_id` foi informado), ao lado de `rewards_earned` que já existe.

### `GET /api/loyalty/customers` (existente, estendido)

Cada item do array `items` ganha `rewards_pending` (contagem de pendentes daquele cliente), via subquery/join em `loyalty_rewards`, pra alimentar o badge no card da Fidelidade sem round-trip extra.

## Componentes de código

| Unidade | Responsabilidade |
|---------|------------------|
| `config/database.js` | Cria tabela `loyalty_rewards` + índices |
| `routes/loyaltyHelpers.js` | `insertRewardEvents(db, customerId, count, source)` (espelha `insertVisitEvents`); `mapPendingRewardRow` |
| `routes/loyalty.js` | Novo `GET /rewards/pending`, novo `POST /customers/:id/claim-reward`; `POST /customers/:id/visit` existente passa a chamar `insertRewardEvents` (ganho) e a remover pendente mais recente (perda, ver Fluxos); `GET /customers` estendido com `rewards_pending` |
| `routes/dailySales.js` | `applyLoyaltyForSale` chama `insertRewardEvents` quando `rewards_earned > 0`; resposta do batch ganha `rewards_pending_total` |
| `js/database.js` | `DB.getPendingLoyaltyRewards()`, `DB.claimLoyaltyReward(customerId)` |
| `js/admin/daily-sales.js` | Renderiza pilha de banners após `submitDailyDiario`; nova função pra carregar/renderizar "Prêmios pendentes" na tela Vendas do dia |
| `js/admin/loyalty.js` | Badge + botão de retirada no card do cliente quando `rewards_pending > 0` |
| `admin.html` | Container dos banners no Diário (`#daily-diario-reward-banners`); seção "Prêmios pendentes" na tela Vendas do dia |
| `css/admin.css` | Estilos do banner, da seção de pendentes e do badge/botão |

## Erros e bordas

- Cliente sem prêmio pendente clica em retirar (ex: duas abas abertas) → 404 tratado com toast informativo, sem quebrar a tela.
- Corrida entre duas retiradas simultâneas do mesmo cliente → `FOR UPDATE` na query do prêmio mais antigo evita retirar o mesmo registro duas vezes.
- Cliente inativo (`active = false`) some da lista de pendentes na tela Vendas do dia (mesma regra do hall da fama), mas o prêmio continua no banco (não é excluído, só deixa de aparecer).
- Exclusão de cliente de fidelidade (`ON DELETE CASCADE`) remove os prêmios pendentes junto — mesmo comportamento já usado em `loyalty_visit_events`.
- Remoção manual de visita (-1) cruzando um ciclo pra trás sem pendente disponível pra remover (prêmio já retirado) → fica uma inconsistência histórica aceitável entre `total_rewards` e a soma de linhas em `loyalty_rewards`; não é corrigida automaticamente (mesma limitação que já existe hoje entre `total_visits` e `loyalty_visit_events`).

## Testes

Script Node no padrão `scripts/test-ticket-assignees.js`:

- `scripts/test-loyalty-rewards.js`: testa `insertRewardEvents` (insere N linhas), a query/lógica FIFO de retirada (retira sempre a mais antiga), o agrupamento de `GET /rewards/pending` (contagem + data mais antiga por cliente), e a remoção da linha pendente mais recente ao desfazer um ciclo via -1 — funções isoladas sempre que possível, sem precisar de servidor rodando.
