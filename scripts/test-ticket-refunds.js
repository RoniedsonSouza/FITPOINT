// scripts/test-ticket-refunds.js
const {
  canRefundTicket,
  canRevertRefund,
  statusAfterRevert,
  normalizeRefundReason,
  normalizeRefundSource,
  normalizeRefundScope,
  shouldReleaseStock,
  describeRefundSource,
  REFUND_REASON_MAX_LENGTH
} = require('../services/ticketRefunds');

let failures = 0;
function eq(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures++;
    console.log(`FAIL ${desc}: esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${desc}`);
  }
}

// canRefundTicket
eq('ingresso válido pode ser reembolsado', canRefundTicket({ status: 'valid' }).ok, true);
eq('ingresso usado pode ser reembolsado', canRefundTicket({ status: 'used' }).ok, true);
eq('ingresso já reembolsado não repete', canRefundTicket({ status: 'refunded' }).ok, false);
eq(
  'reembolso repetido responde 409',
  canRefundTicket({ status: 'refunded' }).code,
  409
);
eq('ingresso cancelado não reembolsa', canRefundTicket({ status: 'cancelled' }).ok, false);
eq('ingresso inexistente responde 404', canRefundTicket(null).code, 404);
eq(
  'status desconhecido não reembolsa',
  canRefundTicket({ status: 'whatever' }).ok,
  false
);

// canRevertRefund
eq('só desfaz reembolso de ingresso reembolsado', canRevertRefund({ status: 'refunded' }).ok, true);
eq('não desfaz reembolso de ingresso válido', canRevertRefund({ status: 'valid' }).ok, false);
eq('desfazer em ingresso inexistente responde 404', canRevertRefund(null).code, 404);

// statusAfterRevert
eq(
  'desfazer devolve o status anterior (used)',
  statusAfterRevert({ status: 'refunded', refund_previous_status: 'used' }),
  'used'
);
eq(
  'desfazer devolve valid quando não há status anterior',
  statusAfterRevert({ status: 'refunded', refund_previous_status: null }),
  'valid'
);
eq(
  'status anterior inválido cai em valid',
  statusAfterRevert({ status: 'refunded', refund_previous_status: 'refunded' }),
  'valid'
);

// normalizeRefundReason
eq('motivo vazio vira null', normalizeRefundReason('   '), null);
eq('motivo undefined vira null', normalizeRefundReason(undefined), null);
eq('motivo é aparado', normalizeRefundReason('  desistiu  '), 'desistiu');
eq(
  'motivo longo é truncado',
  normalizeRefundReason('x'.repeat(REFUND_REASON_MAX_LENGTH + 50)).length,
  REFUND_REASON_MAX_LENGTH
);

// normalizeRefundSource / describeRefundSource
eq('origem desconhecida cai em admin', normalizeRefundSource('sei-la'), 'admin');
eq('origem mercadopago é mantida', normalizeRefundSource('mercadopago'), 'mercadopago');
eq(
  'rótulo do reembolso do MP',
  describeRefundSource('mercadopago'),
  'Reembolso confirmado pelo Mercado Pago'
);

// normalizeRefundScope
eq('escopo inválido cai em ticket', normalizeRefundScope('tudo'), 'ticket');
eq('escopo order é mantido', normalizeRefundScope('order'), 'order');

// shouldReleaseStock
eq('admin sem pedir não devolve estoque', shouldReleaseStock(undefined, 'admin'), false);
eq('admin pedindo devolve estoque', shouldReleaseStock(true, 'admin'), true);
eq('checkbox enviado como string', shouldReleaseStock('true', 'admin'), true);
eq('valor falso não devolve estoque', shouldReleaseStock('false', 'admin'), false);
eq('reembolso do MP sempre devolve estoque', shouldReleaseStock(false, 'mercadopago'), true);

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log('\nTodos ok');
