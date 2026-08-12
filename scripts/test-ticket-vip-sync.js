// scripts/test-ticket-vip-sync.js
const { shouldRefulfillPaidOrder } = require('../routes/tickets');

let failures = 0;
function eq(desc, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures++;
    console.log(`FAIL ${desc}: esperado ${expected}, obtido ${actual}`);
  } else {
    console.log(`ok   ${desc}`);
  }
}

eq(
  'VIP paid com 0 tickets → re-fulfill',
  shouldRefulfillPaidOrder({ status: 'paid', source: 'vip' }, 0),
  true
);
eq(
  'VIP paid com tickets → não re-fulfill',
  shouldRefulfillPaidOrder({ status: 'paid', source: 'vip' }, 2),
  false
);
eq(
  'checkout paid com 0 tickets → não re-fulfill via este helper',
  shouldRefulfillPaidOrder({ status: 'paid', source: 'checkout' }, 0),
  false
);
eq(
  'pending VIP → não',
  shouldRefulfillPaidOrder({ status: 'pending', source: 'vip' }, 0),
  false
);
eq('order null → não', shouldRefulfillPaidOrder(null, 0), false);

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log('\nTodos ok');
