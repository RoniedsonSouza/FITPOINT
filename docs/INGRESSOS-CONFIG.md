# Configuração: Ingressos, Mercado Pago e Resend

Guia passo a passo para obter as chaves de API e deixar o fluxo de eventos/ingressos funcionando (compra → Pix/cartão → QR Code por e-mail).

---

## O que você precisa configurar

No arquivo `.env` (copie de `.env.example` se ainda não tiver):

| Variável | Obrigatória | Para quê |
|----------|-------------|----------|
| `APP_URL` | Sim | URL do site (webhook de pagamento) |
| `MP_ACCESS_TOKEN` | Sim | Criar pagamentos Pix/cartão (backend) |
| `MP_PUBLIC_KEY` | Sim (cartão) | Tokenizar o cartão no navegador — sem ela, o site oferece só Pix |
| `MP_WEBHOOK_SECRET` | Não | Validar notificações do Mercado Pago |
| `RESEND_API_KEY` | Sim | Enviar e-mail com o ingresso |
| `RESEND_FROM` | Sim | Remetente do e-mail |

Exemplo mínimo:

```env
APP_URL=https://seudominio.com
MP_ACCESS_TOKEN=APP_USR-xxxxxxxx
MP_PUBLIC_KEY=APP_USR-xxxxxxxx
MP_WEBHOOK_SECRET=
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=FitPoint <ingressos@seudominio.com>
```

Depois de salvar o `.env`, **reinicie o servidor** (`npm start` ou `npm run dev`).

---

## 1. APP_URL

É a URL pública onde o FitPoint está acessível.

| Ambiente | Valor típico |
|----------|----------------|
| Local | `http://localhost:3000` |
| Produção | `https://seudominio.com` (sem barra no final) |

**Importante**

- Em **localhost**, o webhook do Mercado Pago **não chega** no seu PC (a internet não alcança `localhost`). O sistema ainda tenta confirmar o pagamento quando o comprador volta para `evento.html?id=…&payment=success` (rota de sync).
- Em **produção**, use HTTPS. Sem `APP_URL` correta, o retorno após o pagamento e as notificações falham.
- Para testar o **webhook de verdade** no PC, use o **ngrok** (seção abaixo) e coloque a URL HTTPS do túnel em `APP_URL`.

---

## 1.1 Testar localmente com ngrok (webhook)

O Mercado Pago precisa chamar uma URL **pública HTTPS**. A rota de webhook do FitPoint é:

```text
POST /api/tickets/webhooks/mercadopago
```

Com o ngrok, a URL completa fica assim (exemplo):

```text
https://abc123.ngrok-free.app/api/tickets/webhooks/mercadopago
```

### Passo a passo

1. **Suba o FitPoint local**

```bash
npm run dev
```

Confirme que responde em `http://localhost:3000`.

2. **Instale o ngrok**

- Site: [https://ngrok.com/download](https://ngrok.com/download)
- Ou com Chocolatey: `choco install ngrok`
- Crie conta gratuita e copie o authtoken
- Configure uma vez:

```bash
ngrok config add-authtoken SEU_TOKEN_AQUI
```

3. **Abra o túnel para a porta do servidor**

```bash
ngrok http 3000
```

O terminal mostra algo como:

```text
Forwarding    https://abc123.ngrok-free.app -> http://localhost:3000
```

Copie a URL **https** (sem barra no final).

4. **Atualize o `.env`**

```env
APP_URL=https://abc123.ngrok-free.app
```

Reinicie o Node (`Ctrl+C` e `npm run dev` de novo) para carregar o novo `APP_URL`.

Com isso, nas Preferences novas o FitPoint registra:

```text
notification_url = {APP_URL}/api/tickets/webhooks/mercadopago
```

Ex.: `https://abc123.ngrok-free.app/api/tickets/webhooks/mercadopago`

5. **(Opcional) Cadastre o webhook no painel do Mercado Pago**

Em **Suas integrações** → sua app → **Webhooks**:

| Campo | Valor |
|-------|--------|
| URL de produção / teste | `https://abc123.ngrok-free.app/api/tickets/webhooks/mercadopago` |
| Eventos | Pagamentos (`payment`) |

Se gerar secret, coloque em `MP_WEBHOOK_SECRET`.

6. **Teste o fluxo pela URL do ngrok**

Abra o site pelo túnel (não só pelo localhost), para o retorno do pagamento também usar a mesma origem:

- Eventos: `https://abc123.ngrok-free.app/eventos.html`
- Admin: `https://abc123.ngrok-free.app/admin.html`

Faça uma compra de teste. No terminal do ngrok (`http://127.0.0.1:4040`) você deve ver o `POST` em `/api/tickets/webhooks/mercadopago`. Nos logs do Node deve aparecer o processamento do pagamento e o envio do e-mail.

### Dicas e cuidados

- No plano gratuito a URL do ngrok **muda** a cada reinício. Sempre atualize `APP_URL` e reinicie o servidor.
- Não use `http://` do ngrok; use sempre a URL **https**.
- Se o ngrok mostrar página de aviso (“Visit Site”), clique uma vez no browser; para APIs/webhooks isso costuma ser liberado, mas se o MP falhar, use conta ngrok autenticada / domínio reservado.
- Para inspecionar requisições: abra [http://127.0.0.1:4040](http://127.0.0.1:4040) enquanto o ngrok estiver rodando.
- Quando terminar os testes, volte `APP_URL` para `http://localhost:3000` (ou sua URL de produção) e reinicie o servidor.

### Resumo rápido

```bash
# Terminal 1 — FitPoint
npm run dev

# Terminal 2 — túnel
ngrok http 3000
```

```env
# .env (cole a URL https que o ngrok mostrar)
APP_URL=https://SEU-SUBDOMINIO.ngrok-free.app
```

Rota que o Mercado Pago deve chamar:

```text
{APP_URL}/api/tickets/webhooks/mercadopago
```

---

## 2. Mercado Pago — obter o Access Token

### 2.1 Criar / entrar na conta

1. Acesse [https://www.mercadopago.com.br/developers](https://www.mercadopago.com.br/developers)
2. Faça login com a conta Mercado Pago que vai **receber** os pagamentos
3. Abra **Suas integrações** → **Criar aplicação** (ou use uma já existente)
4. Nome sugerido: `FitPoint Ingressos`
5. Tipo: integração para **pagamentos online** / Checkout Pro

### 2.2 Credenciais de teste (recomendado primeiro)

1. Na aplicação, abra **Credenciais de teste**
2. Copie o **Access Token** e a **Public Key** de teste
3. Cole no `.env`:

```env
MP_ACCESS_TOKEN=TEST-seu-token-aqui
MP_PUBLIC_KEY=TEST-sua-public-key-aqui
```

4. Com token de teste, use cartões/Pix de teste da documentação do Mercado Pago (não cobra de verdade)

Documentação útil:

- [Credenciais](https://www.mercadopago.com.br/developers/pt/docs/credentials)
- [Cartões de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/test-cards)
- [Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/landing)

### 2.3 Credenciais de produção

Quando for vender de verdade:

1. Na mesma aplicação → **Credenciais de produção**
2. Complete a ativação da conta (dados da empresa, se pedido)
3. Copie o **Access Token** e a **Public Key** de produção (geralmente `APP_USR-...`)
4. Atualize o `.env` e reinicie o servidor

```env
MP_ACCESS_TOKEN=APP_USR-seu-token-producao
MP_PUBLIC_KEY=APP_USR-sua-public-key-producao
APP_URL=https://seudominio.com
```

**Nunca** publique o Access Token no GitHub nem no frontend. Ele fica só no `.env` do servidor. A **Public Key** é a única que aparece no navegador — ela serve apenas para tokenizar cartões e não permite movimentar a conta.

### 2.4 Webhook (produção)

O FitPoint já registra a URL de notificação assim:

```text
{APP_URL}/api/tickets/webhooks/mercadopago
```

Exemplo: `https://seudominio.com/api/tickets/webhooks/mercadopago`

No painel do Mercado Pago (Webhooks / Notificações da aplicação):

1. Cadastre essa URL (se o painel pedir)
2. Eventos: preferencialmente **Pagamentos** (`payment`)
3. Se o painel gerar uma **chave secreta** (secret), cole em:

```env
MP_WEBHOOK_SECRET=sua-chave-secreta
```

Se deixar `MP_WEBHOOK_SECRET` vazio, o webhook ainda funciona; só não valida a assinatura HMAC.

### 2.5 Formas de pagamento neste projeto

O checkout é **transparente**: o comprador paga **dentro do site**, sem redirecionamento e sem ver a marca do processador.

- **Pix** — o site gera QR Code + copia-e-cola; a confirmação é automática (webhook/sync) e o código expira em 30 minutos, liberando o estoque reservado.
- **Cartão de crédito** — formulário no próprio site; o número do cartão é tokenizado no navegador (via `MP_PUBLIC_KEY`) e **nunca passa pelo servidor do FitPoint**. Na fatura aparece como `FITPOINT`.

Sem `MP_PUBLIC_KEY` configurada, a opção de cartão fica desabilitada e o site oferece apenas Pix.

---

## 3. Resend — e-mail dos ingressos

### 3.1 Criar conta

1. Acesse [https://resend.com](https://resend.com)
2. Crie uma conta e confirme o e-mail

### 3.2 Criar API Key

1. No dashboard: **API Keys** → **Create API Key**
2. Nome: `FitPoint`
3. Permissão: envio de e-mails (Sending access)
4. Copie a chave (`re_...`) — ela só aparece uma vez
5. Cole no `.env`:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
```

### 3.3 Remetente (`RESEND_FROM`)

#### Opção A — Teste rápido (sem domínio próprio)

Resend permite enviar a partir do endereço de testes:

```env
RESEND_FROM=FitPoint <onboarding@resend.dev>
```

**Limitação:** em geral só envia **para o e-mail da sua conta Resend**. Serve para validar o fluxo, não para vender para clientes.

#### Opção B — Produção (domínio próprio) — recomendado

1. No Resend: **Domains** → **Add Domain**
2. Informe seu domínio (ex.: `seudominio.com` ou `mail.seudominio.com`)
3. Adicione os registros DNS que o Resend mostrar (SPF, DKIM, etc.) no painel do seu provedor (Registro.br, Cloudflare, Hostinger, etc.)
4. Aguarde o status **Verified**
5. Configure no `.env`:

```env
RESEND_FROM=FitPoint <ingressos@seudominio.com>
```

O e-mail após `@` deve ser de um domínio **verificado** no Resend.

Documentação: [https://resend.com/docs](https://resend.com/docs)

---

## 4. Checklist de configuração

1. [ ] `.env` criado a partir de `.env.example`
2. [ ] `APP_URL` apontando para a URL correta
3. [ ] `MP_ACCESS_TOKEN` (teste primeiro, depois produção)
4. [ ] `RESEND_API_KEY` preenchida
5. [ ] `RESEND_FROM` com remetente válido
6. [ ] Servidor reiniciado
7. [ ] Banco atualizado: `npm run migrate` **ou** só subir o app (o `ensureDatabase` cria as tabelas de ingressos)

---

## 5. Como testar o fluxo completo

### No admin

1. Abra `http://localhost:3000/admin.html` (ou sua `APP_URL`)
2. Login → menu **Eventos**
3. Crie um **evento** (título, data, local; opcional: logo, capa e patrocinadores com nome fantasia + Instagram)
4. Selecione o evento → **Novo lote** (nome, preço, quantidade)
5. Deixe evento e lote **ativos**

### No site

1. Abra `/eventos.html`
2. Clique em **Ver detalhes** no card do evento (página `/evento.html?id=…`)
3. Confira capa, logo, descrição, lotes e patrocinadores; clique em **Comprar** / escolha um lote
4. Preencha nome, e-mail (use o e-mail da conta Resend se ainda estiver em `onboarding@resend.dev`) e quantidade
5. Escolha a forma de pagamento, **sem sair do site**:
   - **Pix**: clique em **Gerar código Pix**, pague pelo QR Code/copia-e-cola; a tela confirma sozinha
   - **Cartão**: preencha os dados e clique em **Pagar R$ …** (cartões de **teste** se estiver com credenciais de teste)
6. Na confirmação em tela, o e-mail com QR Code deve chegar
7. No admin → **Validar ingresso**: cole o código do e-mail

### Imagens e patrocinadores

- **Logo** e **capa** são opcionais. Sem imagem, a página de detalhe mantém o espaço reservado (placeholder).
- Upload pelo admin (JPG/PNG/WebP/GIF, máx. 5 MB) ou URL externa.
- **Patrocinadores:** nome fantasia + Instagram (`@handle` ou URL) e logo opcional. Aparecem na página de detalhe com link para o perfil quando houver Instagram.

### Se o e-mail não chegar

- Confira `RESEND_API_KEY` e `RESEND_FROM`
- Com `onboarding@resend.dev`, o destinatário costuma precisar ser o e-mail da conta Resend
- Veja logs do servidor (erro de envio aparece no console)
- Confira spam / lixeira

### Se o pagamento não gerar ingresso

- Confirme `MP_ACCESS_TOKEN` (e `MP_PUBLIC_KEY` para cartão)
- Em produção, confira se `APP_URL` é HTTPS e se o webhook responde
- Enquanto o Pix está na tela, o site consulta `/api/tickets/orders/:id` e chama `/api/tickets/orders/:id/sync` periodicamente — confirma mesmo sem webhook (útil em localhost)
- Veja logs do servidor na hora do checkout e do webhook

---

## 6. Variáveis no `.env` (referência rápida)

```env
# URL pública do site (sem / no final)
APP_URL=https://seudominio.com

# Mercado Pago (checkout transparente)
MP_ACCESS_TOKEN=APP_USR-xxxxxxxx
MP_PUBLIC_KEY=APP_USR-xxxxxxxx
# Opcional
MP_WEBHOOK_SECRET=

# Resend
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=FitPoint <ingressos@seudominio.com>
```

---

## 7. Segurança

- Não commit o arquivo `.env`
- Não compartilhe Access Token do Mercado Pago nem API Key do Resend
- Em produção use tokens de **produção**, HTTPS e domínio verificado no Resend
- Troque `JWT_SECRET` e a senha do admin se ainda estiverem nos valores de exemplo

---

## 8. Ingresso VIP e Dar ingresso

### Ingresso VIP (cortesia)

- No admin → **Eventos** → aba **Lotes**, use **Criar lote VIP**. Cria um lote oculto (`is_vip`), nome fixo “Ingresso VIP”, preço R$ 0 — **no máximo um por evento**.
- Esse lote **não aparece** em `eventos.html` / `evento.html` (listagens públicas filtram lotes VIP).
- Emissão só no admin → aba **Ingressos** → **Emitir VIP**: quantidade 1–10, dados do emissor e slots **Dar ingresso**. Chama `POST /api/tickets/issue-vip` **sem Mercado Pago**; pedido nasce `paid` com `source = 'vip'`.
- Cada titular recebe e-mail com QR (copy de cortesia). Na lista admin, ingressos VIP exibem badge **VIP**.

### Dar ingresso (checkout pago)

- No checkout público (lotes **não-VIP**), quantidade 1–10: por slot, **Dar ingresso** abre nome, e-mail e telefone do destinatário.
- O body de `POST /api/tickets/checkout` pode incluir `assignees` (array do tamanho da quantidade; `null` = comprador, objeto = titular do slot).
- Após pagamento, cada titular recebe só o(s) ingresso(s) dele. Lotes VIP via checkout retornam **400**.

---

## Links úteis

| Serviço | Link |
|---------|------|
| Mercado Pago Developers | https://www.mercadopago.com.br/developers |
| Credenciais MP | https://www.mercadopago.com.br/developers/pt/docs/credentials |
| Checkout Pro | https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/landing |
| Resend | https://resend.com |
| Resend Docs | https://resend.com/docs |
| ngrok | https://ngrok.com |
| Setup geral do projeto | [SETUP.md](SETUP.md) |
