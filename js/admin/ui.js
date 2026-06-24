// Utilitários de UI — botões, toasts

function setButtonLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.originalHtml) {
      btn.dataset.originalHtml = btn.innerHTML;
    }
    btn.disabled = true;
    btn.classList.add('is-loading');
    const text = label || 'Aguarde…';
    btn.innerHTML = `<span class="btn-spinner"></span><span>${text}</span>`;
  } else {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
    if (window.lucide) window.lucide.createIcons();
  }
}

async function withButtonLoading(btn, asyncFn, loadingLabel) {
  setButtonLoading(btn, true, loadingLabel);
  try {
    return await asyncFn();
  } finally {
    setButtonLoading(btn, false);
  }
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

function handleAuthError(error) {
  if (error.message && (error.message.includes('401') || error.message.includes('403'))) {
    showToast('Sessão expirada. Faça login novamente.', 'error');
    if (typeof logout === 'function') logout();
    return true;
  }
  return false;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

const MONEY_DECIMALS = 2;
const NUTRITION_DECIMALS = 1;

function parseLooseInt(raw) {
  const str = String(raw ?? '').trim();
  if (str === '') return null;
  const num = parseInt(str, 10);
  return Number.isInteger(num) ? num : null;
}

function restrictDecimalString(raw, maxDecimals = MONEY_DECIMALS) {
  let str = String(raw ?? '').replace(',', '.');
  if (str === '') return '';

  const dotIdx = str.indexOf('.');
  if (dotIdx === -1) {
    return str.replace(/\D/g, '');
  }

  const intPart = str.slice(0, dotIdx).replace(/\D/g, '');
  let fracPart = str.slice(dotIdx + 1).replace(/\D/g, '');
  if (maxDecimals >= 0) fracPart = fracPart.slice(0, maxDecimals);

  if (fracPart === '' && str.endsWith('.')) {
    return `${intPart}.`;
  }
  return fracPart === '' ? intPart : `${intPart}.${fracPart}`;
}

function parseLooseDecimal(raw, maxDecimals = MONEY_DECIMALS) {
  const str = String(raw ?? '').trim().replace(',', '.');
  if (str === '' || str === '.') return null;
  const num = parseFloat(str);
  if (!Number.isFinite(num)) return null;
  const factor = Math.pow(10, maxDecimals);
  return Math.round(num * factor) / factor;
}

function clampInt(value, min, fallback) {
  const floor = min != null ? min : 0;
  const fb = fallback != null ? fallback : floor;
  if (value == null || !Number.isInteger(value)) return fb;
  return Math.max(floor, value);
}

function clampDecimal(value, min, max, fallback, decimals = MONEY_DECIMALS) {
  const floor = min != null ? min : 0;
  const fb = fallback != null ? fallback : floor;
  if (value == null || !Number.isFinite(value)) return fb;
  let out = Math.max(floor, value);
  if (max != null && out > max) out = max;
  const factor = Math.pow(10, decimals);
  return Math.round(out * factor) / factor;
}

function formatDecimalInput(value, decimals = MONEY_DECIMALS) {
  const num = Number(value);
  if (!Number.isFinite(num)) return decimals <= 0 ? '0' : (0).toFixed(decimals);
  if (decimals <= 0) return String(Math.round(num));
  return num.toFixed(decimals);
}

function bindDecimalInput(input, options = {}) {
  if (!input || input.dataset.decimalBound === '1') return;
  const {
    decimals = MONEY_DECIMALS,
    min = 0,
    max = null,
    allowEmpty = false,
    onInput
  } = options;

  input.dataset.decimalBound = '1';

  input.addEventListener('input', () => {
    const restricted = restrictDecimalString(input.value, decimals);
    if (input.value !== restricted) input.value = restricted;
    if (typeof onInput === 'function') onInput(input);
  });

  input.addEventListener('blur', () => {
    if (allowEmpty && input.value.trim() === '') return;
    const parsed = parseLooseDecimal(input.value, decimals);
    const clamped = clampDecimal(parsed, min, max, min, decimals);
    input.value = formatDecimalInput(clamped, decimals);
    if (typeof onInput === 'function') onInput(input);
  });
}
