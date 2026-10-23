// scripts/test-list-dates.js — datas na importação de lista + detecção de duplicados
const {
  resolveListDate,
  parseDateText,
  normalizeExtractedSections
} = require('../services/listVisionParse');
const { findDuplicates, sectionStatus } = require('../js/admin/list-review-dedupe');

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

const TODAY = '2026-10-23';

// --- Datas ---
eq('dia/mês no ano atual', resolveListDate(21, 10, null, TODAY), '2026-10-21');
eq('hoje é aceito', resolveListDate(23, 10, null, TODAY), '2026-10-23');
eq('data futura sem ano vai para o ano anterior', resolveListDate(28, 12, null, '2026-01-05'), '2025-12-28');
eq('ano com 2 dígitos', resolveListDate(21, 10, 26, TODAY), '2026-10-21');
eq('data inexistente', resolveListDate(31, 2, null, TODAY), null);
eq('mês inválido', resolveListDate(10, 13, null, TODAY), null);
eq('sem dia', resolveListDate(null, 10, null, TODAY), null);

eq('texto "Seg 21/10"', parseDateText('Seg 21/10'), { day: 21, month: 10, year: null });
eq('texto "21-10-2026"', parseDateText('21-10-2026'), { day: 21, month: 10, year: 2026 });
eq('texto "21 de outubro"', parseDateText('21 de outubro'), { day: 21, month: 10, year: null });
eq('texto "3 março"', parseDateText('3 março'), { day: 3, month: 3, year: null });
eq('texto sem data', parseDateText('Lista do dia'), null);

// --- Seções ---
const line = (p, v = 10) => ({ quantity: 1, product: p, customer_name: '', value: v });
const sections = normalizeExtractedSections({
  sections: [
    { date_text: '21/10', day: 21, month: 10, year: null, lines: [line('Shake'), line('Hype')] },
    { date_text: '22/10', day: 22, month: 10, year: null, lines: [line('Detox')] },
    { date_text: '21/10', day: null, month: null, year: null, lines: [line('Chá')] },
    { date_text: '23/10', day: 23, month: 10, year: null, lines: [] }
  ]
}, { today: TODAY });
eq('datas iguais são unidas e seções vazias descartadas',
  sections.map((s) => [s.date, s.lines.map((l) => l.product_text)]),
  [['2026-10-21', ['Shake', 'Hype', 'Chá']], ['2026-10-22', ['Detox']]]);

const legacy = normalizeExtractedSections({ lines: [line('Shake')] }, { today: TODAY });
eq('formato antigo vira uma seção sem data', legacy.map((s) => [s.date, s.lines.length]), [[null, 1]]);

// --- Duplicados ---
const existing = [
  { id: 1, product_id: 'shake', loyalty_customer_id: 5, quantity: 1, unit_price: 18 },
  { id: 2, product_id: 'hype', loyalty_customer_id: null, quantity: 2, unit_price: 15 }
];
const rl = (product_id, loyalty_customer_id, quantity, unit_price) =>
  ({ product_id, loyalty_customer_id, quantity, unit_price });

eq('match exato', findDuplicates([rl('shake', 5, 1, 18)], existing), [1]);
eq('cliente diferente não é duplicado', findDuplicates([rl('shake', 6, 1, 18)], existing), [null]);
eq('quantidade diferente não é duplicado', findDuplicates([rl('hype', null, 1, 15)], existing), [null]);
eq('tolerância de 1 centavo', findDuplicates([rl('hype', null, 2, 15.01)], existing), [2]);
eq('valor diferente não é duplicado', findDuplicates([rl('hype', null, 2, 16)], existing), [null]);
eq('sem produto não é duplicado', findDuplicates([rl(null, 5, 1, 18)], existing), [null]);
eq('cliente "5" (string) casa com 5', findDuplicates([rl('shake', '5', 1, 18)], existing), [1]);
eq('2 iguais na lista e 1 registrado → só 1 marcado',
  findDuplicates([rl('shake', 5, 1, 18), rl('shake', 5, 1, 18)], existing), [1, null]);

eq('status novo', sectionStatus([{ duplicate_of: null }]), 'new');
eq('status parcial', sectionStatus([{ duplicate_of: 1 }, { duplicate_of: null }]), 'partial');
eq('status completo', sectionStatus([{ duplicate_of: 1 }, { duplicate_of: 2 }]), 'complete');
eq('status sem linhas', sectionStatus([]), 'new');

if (failures) {
  console.error(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log('\nTodos ok');
