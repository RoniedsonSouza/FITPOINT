// scripts/test-loyalty-rewards.js
const { applyVisitDelta, computeRewardsRemoved } = require('../routes/loyaltyHelpers');

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

const earn = applyVisitDelta(9, 0, 1, 10);
eq('ganha 1 prêmio ao completar o ciclo', { rewards: earn.rewards, earned: earn.rewards_earned }, { rewards: 1, earned: 1 });

const earnMultiple = applyVisitDelta(9, 0, 11, 10);
eq('ganha 2 prêmios cruzando 2 ciclos numa venda só', { rewards: earnMultiple.rewards, earned: earnMultiple.rewards_earned }, { rewards: 2, earned: 2 });

const noCross = applyVisitDelta(9, 0, -1, 10);
eq('remover 1 visita sem cruzar ciclo não mexe no prêmio', computeRewardsRemoved(0, noCross.rewards), 0);

const cross = applyVisitDelta(10, 1, -1, 10);
eq('remover 1 visita no limite do ciclo desfaz o prêmio', cross.rewards, 0);
eq('computeRewardsRemoved detecta a perda', computeRewardsRemoved(1, cross.rewards), 1);

eq('computeRewardsRemoved nunca é negativo', computeRewardsRemoved(1, 2), 0);
eq('computeRewardsRemoved trata undefined como 0', computeRewardsRemoved(undefined, undefined), 0);

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log('\nTodos ok');
