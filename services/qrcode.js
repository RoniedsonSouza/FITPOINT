const QRCode = require('qrcode');

/**
 * Gera QR Code PNG em Buffer a partir do código do ingresso.
 * @param {string} code
 * @returns {Promise<Buffer>}
 */
async function generateTicketQrPng(code) {
  return QRCode.toBuffer(String(code), {
    type: 'png',
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M'
  });
}

/**
 * Gera QR Code como data URL (útil para pré-visualização).
 * @param {string} code
 * @returns {Promise<string>}
 */
async function generateTicketQrDataUrl(code) {
  return QRCode.toDataURL(String(code), {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M'
  });
}

module.exports = {
  generateTicketQrPng,
  generateTicketQrDataUrl
};
