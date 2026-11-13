# FitPoint Fitness

Sistema da loja FitPoint Fitness (lanches proteicos e bebidas funcionais): site público e painel administrativo. O Express serve as páginas e a API; o PostgreSQL guarda os dados no schema `fitpoint`.

## Funcionalidades

- Cardápio, promoções, mapa das unidades, fidelidade e eventos com ingressos (Pix e cartão via Mercado Pago, ingresso em QR por e-mail)
- Admin com JWT: produtos, diário de vendas, relatórios, OCR de listas (Gemini), ingressos, campanhas de e-mail (Resend), WhatsApp e usuários

## Stack

Node.js, Express, PostgreSQL, JWT, Mercado Pago, Resend, WhatsApp Cloud API, Gemini Vision e Google Maps. O frontend é HTML, Tailwind e JavaScript.

## Como rodar

Node.js 18+, npm e PostgreSQL 12+.

```bash
cp .env.example .env
npm install
npm run migrate
npm start
```

Preencha o `.env` com o seu ambiente. Os nomes das variáveis estão em [`.env.example`](.env.example). Não commite o `.env`.

`JWT_SECRET` e `ADMIN_PASSWORD` são obrigatórios: o código não traz fallback. A senha padrão de novos usuários do painel, quando usada, vem de `DEFAULT_USER_PASSWORD` e não fica no frontend.

- Site: http://localhost:3000
- Admin: http://localhost:3000/admin.html

Instalação do banco e deploy: [SETUP.md](SETUP.md).

## Licença

ISC
