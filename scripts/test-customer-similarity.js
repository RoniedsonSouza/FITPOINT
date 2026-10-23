// scripts/test-customer-similarity.js — cadastros parecidos na ficha lida por imagem
const { nameSimilarity, findSimilarCustomers, NAME_SIMILAR_THRESHOLD: T } = require('../services/customerSimilarity');

let failures = 0;
function ok(desc, cond) {
  if (!cond) { failures++; console.log(`FAIL ${desc}`); } else console.log(`ok   ${desc}`);
}

ok('nome igual', nameSimilarity('Maria Silva', 'Maria Silva') === 1);
ok('erro de digitação', nameSimilarity('Mariana Slva', 'Mariana Silva') >= T);
ok('acento e "da"', nameSimilarity('Jose Carlos', 'José Carlos da Costa') >= T);
ok('nome parcial', nameSimilarity('Ana Paula', 'Ana Paula Ferreira') >= T);
ok('primeiro nome diferente não casa', nameSimilarity('Maria Silva', 'João Silva') < T);
ok('nomes diferentes', nameSimilarity('Pedro Henrique', 'Pedro Lucas') < T);

const customers = [
  { id: 1, name: 'Maria Silva', phone: '27911112222' },
  { id: 2, name: 'Joana', phone: '27999998888' },
  { id: 3, name: 'Carla', instagram: 'maria' },
  { id: 4, name: 'Bruno', phone: '27900000000' }
];
const r = findSimilarCustomers({ name: 'Maria Slva', phone: '27999998888', instagram: '@maria' }, customers);
ok('telefone igual vem primeiro', r[0]?.id === 2 && r[0].reasons.includes('phone'));
ok('Instagram igual', r.some((x) => x.id === 3 && x.reasons.includes('instagram')));
ok('nome parecido', r.some((x) => x.id === 1 && x.reasons.includes('name')));
ok('sem relação fica de fora', !r.some((x) => x.id === 4));
ok('excludeId remove o cadastro já aberto', !findSimilarCustomers({ phone: '27999998888' }, customers, { excludeId: 2 }).length);

if (failures) { console.error(`\n${failures} falha(s)`); process.exit(1); }
console.log('\nTodos ok');
