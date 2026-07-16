const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

function getAccessToken() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    throw new Error('MP_ACCESS_TOKEN não configurado');
  }
  return token;
}

function getClient() {
  return new MercadoPagoConfig({ accessToken: getAccessToken() });
}

function getAppUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Cria Preference Checkout Pro permitindo apenas Pix e cartão de crédito.
 */
async function createTicketPreference({ orderId, title, unitPrice, quantity, buyerEmail, buyerName }) {
  const preference = new Preference(getClient());
  const appUrl = getAppUrl();

  const body = {
    items: [
      {
        id: String(orderId),
        title: String(title).slice(0, 256),
        quantity: Number(quantity),
        unit_price: Number(unitPrice),
        currency_id: 'BRL'
      }
    ],
    payer: {
      name: buyerName || undefined,
      email: buyerEmail || undefined
    },
    external_reference: String(orderId),
    back_urls: {
      success: `${appUrl}/eventos.html?payment=success&order=${orderId}`,
      failure: `${appUrl}/eventos.html?payment=failure&order=${orderId}`,
      pending: `${appUrl}/eventos.html?payment=pending&order=${orderId}`
    },
    auto_return: 'approved',
    payment_methods: {
      excluded_payment_types: [
        { id: 'ticket' },
        { id: 'atm' },
        { id: 'debit_card' }
      ],
      installments: 12
    },
    statement_descriptor: 'FITPOINT'
  };

  // Webhook só funciona com URL pública (não localhost)
  if (!/localhost|127\.0\.0\.1/i.test(appUrl)) {
    body.notification_url = `${appUrl}/api/tickets/webhooks/mercadopago`;
  }

  const result = await preference.create({ body });
  return {
    id: result.id,
    init_point: result.init_point,
    sandbox_init_point: result.sandbox_init_point
  };
}

async function getPaymentById(paymentId) {
  const payment = new Payment(getClient());
  return payment.get({ id: String(paymentId) });
}

/**
 * Busca pagamentos aprovados pela external_reference (id do pedido).
 */
async function findApprovedPaymentByOrderId(orderId) {
  const payment = new Payment(getClient());
  const result = await payment.search({
    options: {
      criteria: 'desc',
      sort: 'date_created',
      external_reference: String(orderId)
    }
  });
  const results = result.results || [];
  return results.find((p) => p.status === 'approved') || null;
}

module.exports = {
  createTicketPreference,
  getPaymentById,
  findApprovedPaymentByOrderId,
  getAppUrl
};
