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
