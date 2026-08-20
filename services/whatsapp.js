const GRAPH_VERSION = 'v21.0';
const DEFAULT_TEMPLATE_NAME = 'reativacao_ausente';
const DEFAULT_TEMPLATE_LANG = 'pt_BR';

function getWhatsAppConfig() {
  const token = String(process.env.WHATSAPP_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const templateName = String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim() || DEFAULT_TEMPLATE_NAME;
  const templateLang = String(process.env.WHATSAPP_TEMPLATE_LANG || '').trim() || DEFAULT_TEMPLATE_LANG;
  return { token, phoneNumberId, templateName, templateLang };
}

function isWhatsAppConfigured() {
  const { token, phoneNumberId } = getWhatsAppConfig();
  return Boolean(token && phoneNumberId);
}

function buildGraphTemplatePayload({ to, name, days, templateName, lang }) {
  const { templateName: defaultName, templateLang } = getWhatsAppConfig();
  const bodyName = String(name || 'Cliente').trim() || 'Cliente';
  const bodyDays = String(Math.max(0, Math.trunc(Number(days) || 0)));
  return {
    messaging_product: 'whatsapp',
    to: String(to),
    type: 'template',
    template: {
      name: templateName || defaultName,
      language: { code: lang || templateLang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: bodyName },
            { type: 'text', text: bodyDays }
          ]
        }
      ]
    }
  };
}

async function sendReactivationTemplate({ to, name, days }) {
  const { token, phoneNumberId, templateName, templateLang } = getWhatsAppConfig();
  if (!token || !phoneNumberId) {
    const err = new Error('WhatsApp Cloud API não configurada');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const payload = buildGraphTemplatePayload({
    to,
    name,
    days,
    templateName,
    lang: templateLang
  });

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Erro WhatsApp HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.details = data?.error || null;
    throw err;
  }

  const messageId = data?.messages?.[0]?.id || null;
  return { id: messageId, payload };
}

module.exports = {
  GRAPH_VERSION,
  DEFAULT_TEMPLATE_NAME,
  DEFAULT_TEMPLATE_LANG,
  getWhatsAppConfig,
  isWhatsAppConfigured,
  buildGraphTemplatePayload,
  sendReactivationTemplate
};
