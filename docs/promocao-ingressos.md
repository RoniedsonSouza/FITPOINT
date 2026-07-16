# Escopo — Promoção por quantidade na compra de ingressos

## Objetivo

Permitir que o admin configure, por lote, uma promoção do tipo "N ingressos por R$ X".
Exemplo: ingresso a R$ 50; na compra de 2, o par sai por R$ 75.

## Regra de negócio

A promoção pertence ao **lote** (`ticket_lots`) e tem 4 parâmetros:

| Campo | Significado | Exemplo |
|---|---|---|
| `promo_enabled` | Liga/desliga a promoção | `true` |
| `promo_qty` | Quantidade mínima que ativa a promo (≥ 2) | `2` |
| `promo_price` | Preço total do pacote promocional | `75.00` |
| `promo_mode` | Como a promo escala acima de `promo_qty` | `repeat` |

### Modos de escala (configurável pelo admin)

Com ingresso a R$ 50 e promo "2 por R$ 75":

| Qtd | `repeat` (pacote repetido) | `once` (aplica uma vez) | `proportional` (preço unitário cai) |
|---|---|---|---|
| 1 | 50,00 | 50,00 | 50,00 |
| 2 | 75,00 | 75,00 | 75,00 |
| 3 | 125,00 (75 + 50) | 125,00 (75 + 50) | 112,50 (3 × 37,50) |
| 4 | 150,00 (2 × 75) | 175,00 (75 + 2×50) | 150,00 |
| 5 | 200,00 (2×75 + 50) | 225,00 | 187,50 |

- `repeat`: cada pacote completo sai pelo preço promocional; o resto paga preço cheio.
- `once`: apenas o primeiro pacote tem desconto; ingressos adicionais pagam preço cheio.
- `proportional`: atingiu a quantidade mínima, todos os ingressos saem ao preço unitário do pacote (`promo_price / promo_qty`).

### Validações (backend)

- `promo_qty` inteiro ≥ 2.
- `promo_price` > 0 e **menor** que `promo_qty × price` (precisa ser desconto real).
- `promo_mode` ∈ `repeat | once | proportional`.
- Se `promo_enabled = false`, os demais campos são ignorados (mantidos para reativação).
- Arredondamento: totais com 2 casas decimais (`proportional` pode gerar dízima).

### Fonte da verdade do preço

O **servidor recalcula o total no checkout** (`services/ticketPricing.js`). O valor exibido
no frontend é apenas informativo — o `amount` do pedido e o valor enviado ao Mercado Pago
saem sempre do cálculo do backend, com o lote travado (`FOR UPDATE`).

### Mercado Pago

Como o total promocional pode não dividir igualmente por ingresso (ex.: `once`, 3 un. = R$ 125),
a preference passa a enviar **1 item com o valor total** (`quantity: 1`, `unit_price: total`)
e o título indica a quantidade: `Evento — Lote (3 ingressos)`.

## Modelo de dados

```sql
ALTER TABLE fitpoint.ticket_lots
  ADD COLUMN IF NOT EXISTS promo_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_qty INTEGER,
  ADD COLUMN IF NOT EXISTS promo_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS promo_mode VARCHAR(20) NOT NULL DEFAULT 'repeat';
```

Sem tabela nova: promoção é atributo do lote (decisão: 1 promo por lote, pedido é de um único lote).

## API

Sem endpoints novos — os existentes passam a aceitar/retornar os campos:

- `GET /api/events` e `GET /api/events/:id` — lotes incluem `promo_enabled`, `promo_qty`, `promo_price`, `promo_mode`.
- `POST/PUT /api/events/:id/lots[/:lotId]` — aceitam e validam os campos de promo.
- `POST /api/tickets/checkout` — sem mudança de contrato; `amount` retorna já com desconto.

## UI

### Admin (aba Eventos → modal de lote)

- Checkbox "Ativar promoção por quantidade" revela: quantidade do pacote, preço do pacote e
  select do modo de escala (com descrição de cada modo).
- Listagem de lotes mostra resumo: `Promo: 2 por R$ 75,00 (pacote repetido)`.

### Página pública (eventos.html)

- Card do evento: badge "🎟 2 por R$ 75,00" quando algum lote tem promo ativa.
- Checkout: opção do lote indica a promo; o total reage à quantidade e exibe a linha
  "Você economiza R$ X" quando a promo é aplicada.

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `scripts/migrate.js` | Colunas novas em `ticket_lots` (CREATE + ALTER idempotente) |
| `services/ticketPricing.js` | **Novo** — cálculo puro do total (usado no checkout e testável) |
| `routes/events.js` | `mapLotRow` + validação de promo em POST/PUT de lotes |
| `routes/tickets.js` | Checkout usa `computeOrderTotal`; título/total da preference |
| `services/mercadopago.js` | Preference com item único de valor total |
| `js/events-page.js` | Badge, label do lote, total com economia (espelho do cálculo) |
| `eventos.html` | Elemento da linha de economia |
| `admin.html` | Campos de promo no modal de lote |
| `js/admin/events.js` | Carregar/salvar promo, resumo na listagem |

## Fora de escopo (registrado para o futuro)

- Cupons de desconto por código.
- Promoção cruzando lotes diferentes no mesmo pedido (checkout atual é mono-lote).
- Janela de validade própria da promo (usa a janela de vendas do lote).
