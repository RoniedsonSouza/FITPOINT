// Câmera em tela cheia com opções "Foto" e "Escolher da galeria".
// Uso: PhotoCapture.open({ title, onFile(file), galleryInputId, fallbackInputId })
//  - onFile: recebe o File capturado pela câmera
//  - galleryInputId: <input type="file"> nativo da galeria (mantém o handler de change existente)
//  - fallbackInputId: <input capture> nativo usado se a câmera do navegador não abrir

const PhotoCapture = (() => {
  let stream = null;
  let opts = null;
  let busy = false;

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

  function close() {
    stopStream();
    busy = false;
    const overlay = el('photo-capture-overlay');
    overlay?.classList.add('hidden');
    overlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('photo-capture-open');
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
      const insecure = !window.isSecureContext;
      setError(insecure
        ? 'Câmera exige HTTPS. Toque em Foto para usar a câmera do aparelho ou escolha da galeria.'
        : 'Não foi possível abrir a câmera. Toque em Foto para usar a câmera do aparelho ou escolha da galeria.');
    } finally {
      el('photo-capture-loading')?.classList.add('hidden');
    }
  }

  function open(options) {
    opts = options || {};
    const overlay = el('photo-capture-overlay');
    if (!overlay) return;
    el('photo-capture-title').textContent = opts.title || 'Tirar foto';
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
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const onFile = opts.onFile;
    canvas.toBlob((blob) => {
      close();
      if (!blob || typeof onFile !== 'function') return;
      const file = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
      onFile(file);
    }, 'image/jpeg', 0.92);
  }

  function pickFromGallery() {
    if (!opts) return;
    const galleryId = opts.galleryInputId;
    close();
    clickNativeInput(galleryId);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opts) close();
  });
  // Libera a câmera se o app for para segundo plano
  window.addEventListener('pagehide', () => { if (opts) close(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && opts) close();
  });

  return { open, close, shoot, pickFromGallery };
})();
