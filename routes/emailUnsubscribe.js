const express = require('express');
const router = express.Router();
const { parseUnsubscribeToken } = require('../services/email');
const { upsertUnsubscribe } = require('../services/emailUnsubscribes');

function unsubscribePageHtml({ title, message, ok }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — FitPoint</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; background: #F5F3EE; color: #0E1F16; margin: 0; padding: 2rem 1rem; }
    .card { max-width: 28rem; margin: 3rem auto; background: #fff; border-radius: 1rem; padding: 1.75rem; box-shadow: 0 6px 24px rgba(0,0,0,.06); }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; color: ${ok ? '#1D6B3A' : '#b42318'}; }
    p { margin: 0; line-height: 1.5; color: rgba(14,31,22,.75); font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

async function handleUnsubscribe(req, res) {
  const token = req.query.token || req.body?.token || req.body?.Token;
  const email = parseUnsubscribeToken(token);

  if (!email) {
    if (req.method === 'POST') {
      return res.status(400).send('');
    }
    return res.status(400).send(
      unsubscribePageHtml({
        title: 'Link inválido',
        message: 'Este link de cancelamento é inválido ou expirou.',
        ok: false
      })
    );
  }

  try {
    await upsertUnsubscribe(email, req.method === 'POST' ? 'one-click' : 'link');
  } catch (error) {
    console.error('Erro ao registrar descadastro de e-mail:', error);
    if (req.method === 'POST') return res.status(500).send('');
    return res.status(500).send(
      unsubscribePageHtml({
        title: 'Erro',
        message: 'Não foi possível processar o cancelamento. Tente novamente.',
        ok: false
      })
    );
  }

  if (req.method === 'POST') {
    return res.status(200).send('');
  }

  return res.status(200).send(
    unsubscribePageHtml({
      title: 'Inscrição cancelada',
      message: `O e-mail ${email} não receberá mais campanhas da FitPoint. Ingressos e avisos transacionais podem continuar sendo enviados quando necessário.`,
      ok: true
    })
  );
}

router.get('/unsubscribe', handleUnsubscribe);
router.post('/unsubscribe', handleUnsubscribe);

module.exports = router;
