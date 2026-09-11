// Regras de reembolso de ingresso.
// O estorno do dinheiro acontece no Mercado Pago; aqui só invalidamos o
// ingresso no app, mantendo-o visível com a marca de reembolsado.

const TICKET_STATUSES = ['valid', 'used', 'cancelled', 'refunded'];
const REFUNDABLE_STATUSES = ['valid', 'used'];
const REFUND_SOURCES = ['admin', 'mercadopago'];
const REFUND_SCOPES = ['ticket', 'order'];
const REFUND_REASON_MAX_LENGTH = 300;

function isRefunded(ticket) {
  return !!ticket && ticket.status === 'refunded';
}

/**
 * @returns {{ ok: true } | { ok: false, error: string, code: number }}
 */
function canRefundTicket(ticket) {
  if (!ticket) {
    return { ok: false, error: 'Ingresso não encontrado', code: 404 };
  }
  if (isRefunded(ticket)) {
    return { ok: false, error: 'Ingresso já está reembolsado', code: 409 };
  }
  if (ticket.status === 'cancelled') {
    return { ok: false, error: 'Ingresso cancelado não pode ser reembolsado', code: 409 };
  }
  if (!REFUNDABLE_STATUSES.includes(ticket.status)) {
    return { ok: false, error: `Ingresso com status "${ticket.status}" não pode ser reembolsado`, code: 409 };
  }
  return { ok: true };
}

/**
 * @returns {{ ok: true } | { ok: false, error: string, code: number }}
 */
function canRevertRefund(ticket) {
  if (!ticket) {
    return { ok: false, error: 'Ingresso não encontrado', code: 404 };
  }
  if (!isRefunded(ticket)) {
    return { ok: false, error: 'Ingresso não está reembolsado', code: 409 };
  }
  return { ok: true };
}

/** Status que o ingresso recupera ao desfazer o reembolso. */
function statusAfterRevert(ticket) {
  const previous = ticket && ticket.refund_previous_status;
  return REFUNDABLE_STATUSES.includes(previous) ? previous : 'valid';
}

function normalizeRefundReason(raw) {
  const reason = String(raw == null ? '' : raw).trim();
  if (!reason) return null;
  return reason.slice(0, REFUND_REASON_MAX_LENGTH);
}

function normalizeRefundSource(raw) {
  return REFUND_SOURCES.includes(raw) ? raw : 'admin';
}

function normalizeRefundScope(raw) {
  return REFUND_SCOPES.includes(raw) ? raw : 'ticket';
}

/** Reembolso feito pelo admin no painel devolve a vaga ao lote só se pedido. */
function shouldReleaseStock(raw, source = 'admin') {
  if (normalizeRefundSource(source) === 'mercadopago') return true;
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

const REFUND_SOURCE_LABELS = {
  admin: 'Reembolso registrado no painel',
  mercadopago: 'Reembolso confirmado pelo Mercado Pago'
};

function describeRefundSource(source) {
  return REFUND_SOURCE_LABELS[normalizeRefundSource(source)];
}

module.exports = {
  TICKET_STATUSES,
  REFUNDABLE_STATUSES,
  REFUND_SOURCES,
  REFUND_SCOPES,
  REFUND_REASON_MAX_LENGTH,
  isRefunded,
  canRefundTicket,
  canRevertRefund,
  statusAfterRevert,
  normalizeRefundReason,
  normalizeRefundSource,
  normalizeRefundScope,
  shouldReleaseStock,
  describeRefundSource
};
