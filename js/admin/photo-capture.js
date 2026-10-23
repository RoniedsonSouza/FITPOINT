// Câmera em tela cheia com toggle "Foto" / "Galeria".
// Uso: PhotoCapture.open({ onFile(file), galleryInputId, fallbackInputId })
//  - onFile: recebe o File capturado pela câmera
//  - galleryInputId: <input type="file"> nativo da galeria (mantém o handler de change existente)
//  - fallbackInputId: <input capture> nativo usado se a câmera do navegador não abrir

const PhotoCapture = (() => {
  let stream = null;
  let opts = null;
  let busy = false;
  let galleryCleanup = null;

  const el = (id) => document.getElementById(id);

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    const video = el('photo-capture-video');
    if (video) video.srcObject = null;
  }

  function setError(msg) {
    const err = el('photo-capture-error');
    if (!err) return;
    err.textContent = msg || '';
    err.classList.toggle('hidden', !msg);
  }

  function renderMode(mode) {
    const overlay = el('photo-capture-overlay');
    if (!overlay) return;
    overlay.dataset.mode = mode;
    const modes = overlay.querySelector('.photo-capture-modes');
    if (modes) modes.dataset.mode = mode;
    overlay.querySelectorAll('.photo-capture-mode').forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function clearGalleryListeners() {
    if (galleryCleanup) {
      galleryCleanup();
      galleryCleanup = null;
    }
  }

  function close() {
    clearGalleryListeners();
    stopStream();
    busy = false;
    const overlay = el('photo-capture-overlay');
    overlay?.classList.add('hidden');
    overlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('photo-capture-open');
    renderMode('camera');
    opts = null;
  }

  async function startCamera() {
    setError('');
    el('photo-capture-loading')?.classList.remove('hidden');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
      } catch (e) {
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (!opts) { stopStream(); return; } // fechado enquanto abria
      const video = el('photo-capture-video');
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (error) {
      console.warn('PhotoCapture camera error:', error);
      stopStream();
      setError(!window.isSecureContext
        ? 'A câmera precisa de HTTPS. Toque no botão para usar a câmera do aparelho ou escolha da Galeria.'
        : 'Não foi possível abrir a câmera. Toque no botão para usar a câmera do aparelho ou escolha da Galeria.');
    } finally {
      el('photo-capture-loading')?.classList.add('hidden');
    }
  }

  function open(options) {
    opts = options || {};
    const overlay = el('photo-capture-overlay');
    if (!overlay) return;
    renderMode('camera');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('photo-capture-open');
    if (typeof refreshIcons === 'function') refreshIcons();
    startCamera();
  }

  function clickNativeInput(id) {
    const input = id ? el(id) : null;
    if (!input) return false;
    input.value = '';
    input.click();
    return true;
  }

  function shoot() {
    if (!opts || busy) return;
    const video = el('photo-capture-video');
    // Sem stream ativo: usa a câmera nativa do aparelho (ainda dentro do gesto do usuário)
    if (!stream || !video || !video.videoWidth) {
      const fallbackId = opts.fallbackInputId;
      close();
      clickNativeInput(fallbackId);
      return;
    }
    busy = true;
    const flash = el('photo-capture-flash');
    if (flash) {
      flash.classList.remove('is-on');
      void flash.offsetWidth;
      flash.classList.add('is-on');
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const onFile = opts.onFile;
    canvas.toBlob((blob) => {
      setTimeout(() => {
        close();
        if (!blob || typeof onFile !== 'function') return;
        onFile(new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      }, 180);
    }, 'image/jpeg', 0.92);
  }

  // Abre o seletor nativo da galeria; a câmera continua aberta atrás.
  // Escolheu arquivo → fecha (o handler de change existente processa). Cancelou → volta para Foto.
  function openGallery() {
    const input = opts?.galleryInputId ? el(opts.galleryInputId) : null;
    if (!input) return;
    clearGalleryListeners();
    const onChange = () => { if (input.files?.length) close(); };
    const onCancel = () => { clearGalleryListeners(); if (opts) renderMode('camera'); };
    // 'cancel' não existe em navegadores antigos: ao voltar o foco sem arquivo, retorna para Foto
    const onFocusBack = () => setTimeout(() => {
      if (opts && !input.files?.length) onCancel();
    }, 600);
    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    window.addEventListener('focus', onFocusBack, { once: true });
    galleryCleanup = () => {
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      window.removeEventListener('focus', onFocusBack);
    };
    clickNativeInput(opts.galleryInputId);
  }

  function setMode(mode) {
    if (!opts) return;
    renderMode(mode === 'gallery' ? 'gallery' : 'camera');
    if (mode === 'gallery') openGallery();
  }

  // Compatibilidade com chamadas antigas
  function pickFromGallery() { setMode('gallery'); }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opts) close();
  });
  // Libera a câmera se o app for para segundo plano (exceto enquanto a galeria está aberta)
  window.addEventListener('pagehide', () => { if (opts) close(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && opts && !galleryCleanup) close();
  });

  return { open, close, shoot, setMode, pickFromGallery };
})();
