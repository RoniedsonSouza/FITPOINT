// scripts/test-ticket-assignees.js
const { normalizeAssignees, resolveHolders } = require('../services/ticketAssignees');

let failures = 0;
function eq(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${desc}: esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${desc}`);
  }
}

eq('pads nulls to quantity', normalizeAssignees(undefined, 3), {
  ok: true,
  value: [null, null, null]
});
eq('rejects too many', normalizeAssignees([null, null, null], 2).ok, false);
eq('normalizes email', normalizeAssignees([{ name: 'A', email: 'A@X.COM', phone: '11999998888' }], 1), {
  ok: true,
  value: [{ name: 'A', email: 'a@x.com', phone: '11999998888' }]
});
eq('rejects bad email', normalizeAssignees([{ name: 'A', email: 'x' }], 1).ok, false);
eq('rejects missing name', normalizeAssignees([{ name: ' ', email: 'a@b.com' }], 1).ok, false);
eq('rejects missing phone', normalizeAssignees([{ name: 'A', email: 'a@b.com' }], 1).ok, false);

const holders = resolveHolders({
  quantity: 3,
  buyer_name: 'Comprador',
  buyer_email: 'c@c.com',
  buyer_phone: '11',
  assignees: [null, { name: 'Maria', email: 'm@m.com', phone: '11988887777' }, null]
});
eq('resolve holders', holders, [
  { name: 'Comprador', email: 'c@c.com', phone: '11' },
  { name: 'Maria', email: 'm@m.com', phone: '11988887777' },
  { name: 'Comprador', email: 'c@c.com', phone: '11' }
]);

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log('\nTodos ok');
