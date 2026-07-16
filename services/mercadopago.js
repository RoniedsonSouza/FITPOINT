const crypto = require('crypto');
const { MercadoPagoConfig, Payment } = require('mercadopago');

function getAccessToken() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    throw new Error('MP_ACCESS_TOKEN não configurado');
  }
  return token;
}

function getPublicKey() {
  return process.env.MP_PUBLIC_KEY || null;
}

function getClient() {
  return new MercadoPagoConfig({ accessToken: getAccessToken() });
}

function getAppUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// Webhook só funciona com URL pública (não localhost)
function getNotificationUrl() {
  const appUrl = getAppUrl();
  if (/localhost|127\.0\.0\.1/i.test(appUrl)) return undefined;
  return `${appUrl}/api/tickets/webhooks/mercadopago`;
}

const PIX_EXPIRATION_MINUTES = 30;

/**
 * Cria pagamento Pix (checkout transparente): o comprador paga no site,
 * via QR Code ou copia-e-cola, sem redirecionamento.
 */
async function createPixPayment({ orderId, amount, description, buyerEmail, buyerName }) {
  const payment = new Payment(getClient());

  const expiresAt = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000);
  // Formato exigido pelo MP: yyyy-MM-dd'T'HH:mm:ss.SSSXXX (com offset)
  const dateOfExpiration = expiresAt.toISOString().replace('Z', '+00:00');

  const nameParts = String(buyerName || '').trim().split(/\s+/);
  const firstName = nameParts.shift() || undefined;
  const lastName = nameParts.join(' ') || undefined;

  const body = {
    transaction_amount: Number(amount),
    description: String(description).slice(0, 256),
    payment_method_id: 'pix',
    external_reference: String(orderId),
    date_of_expiration: dateOfExpiration,
    payer: {
      email: buyerEmail,
      first_name: firstName,
      last_name: lastName
    }
  };

  const notificationUrl = getNotificationUrl();
  if (notificationUrl) body.notification_url = notificationUrl;

  const result = await payment.create({
    body,
    requestOptions: { idempotencyKey: `pix-${orderId}-${crypto.randomUUID()}` }
  });

  const tx = result.point_of_interaction?.transaction_data || {};
  return {
    id: result.id,
    status: result.status,
    qr_code: tx.qr_code || null,
    qr_code_base64: tx.qr_code_base64 || null,
    expires_at: result.date_of_expiration || dateOfExpiration
  };
}

/**
 * Cria pagamento com cartão de crédito (checkout transparente).
 * O número do cartão nunca chega ao nosso servidor: o navegador gera um
 * token de uso único (SDK JS) e só o token trafega até aqui.
 */
async function createCardPayment({
  orderId,
  amount,
  description,
  token,
  installments,
  paymentMethodId,
  issuerId,
  buyerEmail,
  identificationType,
  identificationNumber
}) {
  const payment = new Payment(getClient());

  const body = {
    transaction_amount: Number(amount),
    token: String(token),
    description: String(description).slice(0, 256),
    installments: Math.max(1, parseInt(installments, 10) || 1),
    payment_method_id: paymentMethodId ? String(paymentMethodId) : undefined,
    issuer_id: issuerId ? String(issuerId) : undefined,
    external_reference: String(orderId),
    statement_descriptor: 'FITPOINT',
    payer: {
      email: buyerEmail,
      identification:
        identificationType && identificationNumber
          ? { type: String(identificationType), number: String(identificationNumber) }
          : undefined
    }
  };

  const notificationUrl = getNotificationUrl();
  if (notificationUrl) body.notification_url = notificationUrl;

  const result = await payment.create({
    body,
    requestOptions: { idempotencyKey: `card-${orderId}-${crypto.randomUUID()}` }
  });

  return {
    id: result.id,
    status: result.status,
    status_detail: result.status_detail || null
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
  createPixPayment,
  createCardPayment,
  getPaymentById,
  findApprovedPaymentByOrderId,
  getAppUrl,
  getPublicKey,
  PIX_EXPIRATION_MINUTES
};
