# Design: Ingresso VIP + Dar ingresso

**Data:** 2026-08-12  
**Status:** aprovado (abordagem 1 + modelo de dados)

## Problema

Hoje todo ingresso nasce de um pedido pago (Mercado Pago). Não há cortesia/VIP nem forma de atribuir cada ingresso de um pedido a pessoas diferentes.

## Objetivos

1. **Ingresso VIP (cortesia):** lote dedicado, emissão só no admin, sem pagamento, mesmos dados de um ingresso normal, e-mail com QR, flag VIP na lista de ingressos.
2. **Dar ingresso:** no checkout público e na emissão VIP, com quantidade 1–10, permitir vincular cada unidade a outro titular (nome, e-mail, telefone). Cada titular recebe só o(s) ingresso(s) dele no e-mail.

## Não objetivos

- Lote VIP visível/comprável na página pública
- Pedidos filhos / checkouts separados no Mercado Pago
- Transferência de ingresso depois do pagamento
- Cupons ou alteração da promoção por quantidade

## Decisões

| Tema | Decisão |
|------|---------|
| Estoque VIP | Lote dedicado (`is_vip`), estoque próprio |
| Criação do lote | Botão admin “Criar lote VIP” (nome “Ingresso VIP”, preço 0, oculto do público) |
| Quem emite VIP | Só admin (`eventos` + `lotes`) |
| Quantidade | 1–10 por emissão/compra |
| Dar ingresso | Checkout pago **e** emissão VIP |
| E-mail | Só o titular de cada ingresso |
| Abordagem | Flag no lote + assignees no pedido (sem pedidos filhos) |

## Modelo de dados

### `ticket_lots`

- `is_vip BOOLEAN NOT NULL DEFAULT false`
- Lote VIP: `name = 'Ingresso VIP'`, `price = 0`, `is_vip = true`
- No máximo **um** lote VIP por evento (rejeitar segundo create)
- Lotes `is_vip` **nunca** entram em listagens públicas (`onlyAvailable` / eventos públicos)
- Checkout público rejeita `lot_id` com `is_vip = true`

### `ticket_orders`

- `source VARCHAR(20) NOT NULL DEFAULT 'checkout'` com check `'checkout' | 'vip'`
- `assignees JSONB NULL` — array de tamanho `quantity`; cada item é `null` (herda comprador) ou `{ "name", "email", "phone" }`
- Pedido VIP: `amount = 0`, `status = 'paid'` na criação, `source = 'vip'`, sem IDs MP

### `tickets`

- `buyer_name` / `buyer_email` = **titular do ingresso** (quem recebe o e-mail e aparece na validação)
- `buyer_phone VARCHAR(50) NULL` (opcional, espelha formulário)

## Fluxos

### Criar lote VIP (admin)

1. Na aba Lotes do evento, botão “Criar lote VIP”.
2. Abre modal pré-preenchido (nome fixo/readonly, preço 0 readonly, `is_vip` implícito); admin define quantidade total e janelas.
3. Se já existir lote VIP no evento, não cria outro — sugere editar o existente.

### Emitir VIP (admin)

1. Aba Ingressos: botão “Emitir VIP”.
2. Formulário: quantidade, dados do emissor/comprador (nome, e-mail, telefone), lista de slots com “Dar ingresso”.
3. `POST /api/tickets/issue-vip` → reserva estoque do lote VIP → order `paid` → emite tickets → e-mails por titular.

### Checkout público + Dar ingresso

1. Comprador escolhe lote **não-VIP**, qty, dados próprios.
2. Se qty > 1 (ou sempre disponível): botão “Dar ingresso” por slot; abre formulário do destinatário (nome, e-mail, telefone obrigatórios no slot doado).
3. `POST /api/tickets/checkout` inclui `assignees`; order `pending` guarda JSON; após pagamento, `fulfillPaidOrder` usa assignees.

### E-mail

- Agrupar tickets emitidos por `buyer_email` do ticket.
- Um e-mail por endereço com apenas os códigos daquele titular.
- Copy VIP/cortesia: não dizer “Pagamento confirmado”; usar “Seu ingresso VIP” / “Ingresso cortesia confirmado”.
- Copy presentado: titular normal; se `source === 'vip'`, tom de cortesia.

### Lista admin

- Badge **VIP** quando `lot.is_vip` ou `order.source === 'vip'`.
- Coluna/card: titular permanece como hoje; badge ao lado do lote ou do status.

## API

### `POST /api/tickets/issue-vip` (auth + `eventos.lotes`)

Body:

```json
{
  "event_id": 1,
  "quantity": 3,
  "buyer_name": "Admin Emissor",
  "buyer_email": "admin@fitpoint.com",
  "buyer_phone": "11999999999",
  "assignees": [
    null,
    { "name": "Maria", "email": "maria@x.com", "phone": "11988887777" },
    null
  ]
}
```

- Resolve o único lote VIP do evento (ou `lot_id` explícito se `is_vip`).
- Valida assignees (length ≤ quantity; pads com null; e-mail válido quando presente).
- Resposta: `{ order_id, tickets: [...] }`.

### `POST /api/tickets/checkout` (estendido)

- Aceita `assignees` opcional (mesma regra).
- Recusa lote VIP.
- Persiste `assignees` e `source = 'checkout'`.

### `GET /api/tickets` (admin)

- Incluir `is_vip` (via join no lote) e/ou `order_source` no item.

### Lotes

- `POST/PUT` lots aceitam `is_vip`; create VIP força name/price.
- `mapLotRow` inclui `is_vip`.
- `getLotsForEvent({ onlyAvailable })` exclui `is_vip`.

## Componentes de código

| Unidade | Responsabilidade |
|---------|------------------|
| `services/ticketAssignees.js` | Normalizar/validar assignees; resolver titulares por índice |
| `fulfillPaidOrder` (refator) | Criar tickets por titular; enviar e-mails agrupados; aceitar pedido já `paid` (VIP) |
| `services/email.js` | `complimentary` / copy VIP; envio por destinatário |
| `routes/tickets.js` | `issue-vip` + checkout com assignees |
| `routes/events.js` | `is_vip`, hide público, create VIP |
| Admin UI | Criar lote VIP, Emitir VIP, badge |
| `js/events-page.js` + `evento.html` | UI Dar ingresso |

## Erros e bordas

- Estoque VIP insuficiente → 400/409
- Segundo lote VIP no evento → 400
- Checkout de lote VIP → 400
- Assignees > quantity ou e-mail inválido → 400
- Falha de e-mail não reverte emissão (igual hoje)
- Pedido VIP idempotente: se já houver tickets, não duplicar (reusar caminho paid/already)

## Testes

Scripts Node no padrão `scripts/test-ticket-pricing.js`:

- `normalizeAssignees` / `resolveHolders`
- Regras de rejeição VIP no mapeamento de lotes públicos (funções puras quando possível)
