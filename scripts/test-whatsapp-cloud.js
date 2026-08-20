const {
  formatPhoneForWhatsApp,
  firstNameFromDisplayName,
  inactiveDaysFromRow,
  isWithinCooldown,
  classifyReactivationRecipient,
  REACTIVATION_COOLDOWN_DAYS,
  INACTIVE_VISIT_DAYS
} = require('../routes/loyaltyHelpers');
const { buildGraphTemplatePayload } = require('../services/whatsapp');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(formatPhoneForWhatsApp('(11) 99999-8888') === '5511999998888', 'celular com máscara');
assert(formatPhoneForWhatsApp('1133334444') === '551133334444', 'fixo 10 dígitos');
assert(formatPhoneForWhatsApp('123') === null, 'telefone curto');
assert(formatPhoneForWhatsApp('') === null, 'telefone vazio');

assert(firstNameFromDisplayName('Maria Silva') === 'Maria', 'primeiro nome');
assert(firstNameFromDisplayName('  ') === 'Cliente', 'nome vazio');

const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
assert(inactiveDaysFromRow({ last_positive_visit_at: fourDaysAgo }) === 4, 'dias ausente');
assert(inactiveDaysFromRow({}) === INACTIVE_VISIT_DAYS, 'sem data usa limiar');

const now = Date.parse('2026-08-19T15:00:00.000Z');
assert(isWithinCooldown(new Date(now - 2 * 24 * 60 * 60 * 1000), now) === true, 'dentro do cooldown');
assert(isWithinCooldown(new Date(now - (REACTIVATION_COOLDOWN_DAYS + 1) * 24 * 60 * 60 * 1000), now) === false, 'fora do cooldown');
assert(isWithinCooldown(null, now) === false, 'nunca enviado');

const row = { phone: '11999998888', name: 'Maria Silva' };
assert(classifyReactivationRecipient(row, null, now) === 'eligible', 'elegível');
assert(classifyReactivationRecipient({ phone: '123' }, null, now) === 'skip_phone', 'pula telefone');
assert(
  classifyReactivationRecipient(row, new Date(now - 24 * 60 * 60 * 1000), now) === 'skip_cooldown',
  'pula cooldown'
);

const payload = buildGraphTemplatePayload({
  to: '5511999998888',
  name: 'Maria',
  days: 5,
  templateName: 'reativacao_ausente',
  lang: 'pt_BR'
});
assert(payload.messaging_product === 'whatsapp', 'messaging_product');
assert(payload.to === '5511999998888', 'to E.164');
assert(payload.type === 'template', 'type template');
assert(payload.template.name === 'reativacao_ausente', 'template name');
assert(payload.template.language.code === 'pt_BR', 'lang');
assert(payload.template.components[0].parameters[0].text === 'Maria', 'var nome');
assert(payload.template.components[0].parameters[1].text === '5', 'var dias');

console.log('OK — test-whatsapp-cloud');
