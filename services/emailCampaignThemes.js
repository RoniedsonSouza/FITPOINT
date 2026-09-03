const EMAIL_CAMPAIGN_THEMES = Object.freeze({
  EVENTO: 'evento',
  CLIENTE: 'cliente',
  PRODUTO: 'produto'
});

const EMAIL_CAMPAIGN_THEME_VALUES = Object.freeze(
  Object.values(EMAIL_CAMPAIGN_THEMES)
);

const EMAIL_CAMPAIGN_THEME_LABELS = Object.freeze({
  [EMAIL_CAMPAIGN_THEMES.EVENTO]: 'Evento',
  [EMAIL_CAMPAIGN_THEMES.CLIENTE]: 'Cliente',
  [EMAIL_CAMPAIGN_THEMES.PRODUTO]: 'Produto'
});

function isValidEmailCampaignTheme(theme) {
  return EMAIL_CAMPAIGN_THEME_VALUES.includes(theme);
}

module.exports = {
  EMAIL_CAMPAIGN_THEMES,
  EMAIL_CAMPAIGN_THEME_VALUES,
  EMAIL_CAMPAIGN_THEME_LABELS,
  isValidEmailCampaignTheme
};
