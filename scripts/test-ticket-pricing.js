// Testes da lógica de promoção por quantidade (services/ticketPricing.js)
// Rodar: node scripts/test-ticket-pricing.js

const { computeOrderTotal, validatePromoConfig } = require('../services/ticketPricing');

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

// Lote base: R$ 50, promo "2 por R$ 75" — simulando strings do pg (DECIMAL vira string)
const mk = (mode) => ({ price: '50.00', promo_enabled: true, promo_qty: 2, promo_price: '75.00', promo_mode: mode });

// repeat: cada pacote completo sai pelo preço promocional
eq('repeat qty=1', computeOrderTotal(mk('repeat'), 1).total, 50);
eq('repeat qty=2', computeOrderTotal(mk('repeat'), 2).total, 75);
eq('repeat qty=3', computeOrderTotal(mk('repeat'), 3).total, 125);
eq('repeat qty=4', computeOrderTotal(mk('repeat'), 4).total, 150);
eq('repeat qty=5', computeOrderTotal(mk('repeat'), 5).total, 200);
eq('repeat qty=2 savings', computeOrderTotal(mk('repeat'), 2).savings, 25);
eq('repeat qty=2 applied', computeOrderTotal(mk('repeat'), 2).promoApplied, true);
eq('repeat qty=1 applied', computeOrderTotal(mk('repeat'), 1).promoApplied, false);

// once: só o primeiro pacote tem desconto
eq('once qty=2', computeOrderTotal(mk('once'), 2).total, 75);
eq('once qty=3', computeOrderTotal(mk('once'), 3).total, 125);
eq('once qty=4', computeOrderTotal(mk('once'), 4).total, 175);

// proportional: a partir do pacote, unitário vira promo_price/promo_qty
eq('proportional qty=2', computeOrderTotal(mk('proportional'), 2).total, 75);
eq('proportional qty=3', computeOrderTotal(mk('proportional'), 3).total, 112.5);
eq('proportional qty=4', computeOrderTotal(mk('proportional'), 4).total, 150);

// promo desligada
eq('disabled qty=2', computeOrderTotal({ price: '50.00', promo_enabled: false }, 2).total, 100);

// promo que encareceria (config ruim) cai no preço base
const bad = { price: '50.00', promo_enabled: true, promo_qty: 2, promo_price: '120.00', promo_mode: 'repeat' };
eq('promo cara ignorada', computeOrderTotal(bad, 2), { total: 100, baseTotal: 100, savings: 0, promoApplied: false });

// pacote de 3
const p3 = { price: '50.00', promo_enabled: true, promo_qty: 3, promo_price: '120.00', promo_mode: 'repeat' };
eq('pacote3 qty=2 (abaixo do min)', computeOrderTotal(p3, 2).total, 100);
eq('pacote3 qty=3', computeOrderTotal(p3, 3).total, 120);
eq('pacote3 qty=7', computeOrderTotal(p3, 7).total, 290); // 2 pacotes (240) + 1 cheio (50)

// arredondamento (dízima)
const dz = { price: '10.00', promo_enabled: true, promo_qty: 3, promo_price: '25.00', promo_mode: 'proportional' };
eq('proporcional dízima qty=4', computeOrderTotal(dz, 4).total, 33.33); // 4 * 8.3333…

// modo desconhecido cai em repeat
eq('modo inválido = repeat', computeOrderTotal({ ...mk('xyz') }, 4).total, 150);

// ===== validatePromoConfig =====
eq('valida: desligada ok', validatePromoConfig({ promo_enabled: false }, 50).ok, true);
eq('valida: qty<2 falha', validatePromoConfig({ promo_enabled: true, promo_qty: 1, promo_price: 75, promo_mode: 'repeat' }, 50).ok, false);
eq('valida: preço 0 falha', validatePromoConfig({ promo_enabled: true, promo_qty: 2, promo_price: 0, promo_mode: 'repeat' }, 50).ok, false);
eq('valida: sem desconto falha', validatePromoConfig({ promo_enabled: true, promo_qty: 2, promo_price: 100, promo_mode: 'repeat' }, 50).ok, false);
eq('valida: modo inválido falha', validatePromoConfig({ promo_enabled: true, promo_qty: 2, promo_price: 75, promo_mode: 'abc' }, 50).ok, false);
const okCase = validatePromoConfig({ promo_enabled: true, promo_qty: '2', promo_price: '75', promo_mode: 'repeat' }, '50');
eq('valida: caso "2 por 75" ok', okCase, { ok: true, value: { promo_enabled: true, promo_qty: 2, promo_price: 75, promo_mode: 'repeat' } });

console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
