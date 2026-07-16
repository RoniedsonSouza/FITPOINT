// Visualizador fullscreen de imagens (reutilizável)

(function () {
  let overlay = null;
  let previousOverflow = '';
  let keyHandler = null;

  function ensureOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'fp-image-viewer';
    overlay.className = 'fp-image-viewer';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('aria-label', 'Visualização de imagem');
    overlay.innerHTML = `
      <div class="fp-image-viewer-backdrop" data-fp-image-close></div>
      <div class="fp-image-viewer-panel">
        <button type="button" class="fp-image-viewer-close" data-fp-image-close aria-label="Fechar visualização">&times;</button>
        <figure class="fp-image-viewer-body">
          <img class="fp-image-viewer-img" alt="">
          <figcaption class="fp-image-viewer-caption hidden"></figcaption>
        </figure>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('[data-fp-image-close]').forEach((el) => {
      el.addEventListener('click', close);
    });

    return overlay;
  }

  function open(src, alt, caption) {
    const url = String(src || '').trim();
    if (!url) return;

    const el = ensureOverlay();
    const img = el.querySelector('.fp-image-viewer-img');
    const cap = el.querySelector('.fp-image-viewer-caption');
    if (!img || !cap) return;

    img.src = url;
    img.alt = String(alt || '');

    const captionText = String(caption || '').trim();
    if (captionText) {
      cap.textContent = captionText;
      cap.classList.remove('hidden');
    } else {
      cap.textContent = '';
      cap.classList.add('hidden');
    }

    el.classList.add('fp-image-viewer--open');
    el.setAttribute('aria-hidden', 'false');
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', keyHandler);

    el.querySelector('.fp-image-viewer-close')?.focus();
  }

  function close() {
    if (!overlay) return;

    overlay.classList.remove('fp-image-viewer--open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = previousOverflow;

    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }

    const img = overlay.querySelector('.fp-image-viewer-img');
    if (img) {
      img.removeAttribute('src');
      img.alt = '';
    }
  }

  function bindZoomable(root) {
    if (!root) return;
    root.querySelectorAll('[data-zoom-image]').forEach((trigger) => {
      if (trigger.dataset.zoomBound === '1') return;
      trigger.dataset.zoomBound = '1';
      trigger.addEventListener('click', () => {
        open(
          trigger.dataset.zoomImage,
          trigger.dataset.zoomAlt || '',
          trigger.dataset.zoomCaption || ''
        );
      });
    });
  }

  window.FitPointImageViewer = { open, close, bindZoomable };
})();
