// Detecção de itens já registrados na importação de lista do Diário.
// Funciona no navegador (window.DiarioListDedupe) e no Node (require) para testes.
(function (root) {
  const PRICE_TOLERANCE = 0.01;

  function sameCustomer(a, b) {
    const na = a === undefined || a === null || a === '' ? null : Number(a);
    const nb = b === undefined || b === null || b === '' ? null : Number(b);
    return na === nb;
  }

  function isSameSale(line, sale) {
    if (!line.product_id || !sale) return false;
    if (String(line.product_id) !== String(sale.product_id)) return false;
    if (!sameCustomer(line.loyalty_customer_id, sale.loyalty_customer_id)) return false;
    const qty = Math.max(1, parseInt(String(line.quantity), 10) || 1);
    if (qty !== (Number(sale.quantity) || 1)) return false;
    const price = Number(line.unit_price);
    const salePrice = Number(sale.unit_price);
    if (!Number.isFinite(price) || !Number.isFinite(salePrice)) return false;
    return Math.abs(price - salePrice) <= PRICE_TOLERANCE + 1e-9;
  }

  /**
   * Para cada linha, devolve o id do lançamento existente que ela repete (ou null).
   * Cada lançamento existente cobre no máximo uma linha: 2 itens iguais na lista
   * com 1 já registrado → só 1 marcado.
   */
  function findDuplicates(lines, existingSales) {
    const pool = (Array.isArray(existingSales) ? existingSales : []).slice();
    const used = new Set();
    return (Array.isArray(lines) ? lines : []).map((line) => {
      const idx = pool.findIndex((sale, i) => !used.has(i) && isSameSale(line, sale));
      if (idx < 0) return null;
      used.add(idx);
      return pool[idx].id != null ? pool[idx].id : true;
    });
  }

  /** 'new' (nenhum repetido), 'partial' ou 'complete' (todos repetidos). */
  function sectionStatus(lines) {
    const list = Array.isArray(lines) ? lines : [];
    if (!list.length) return 'new';
    const dup = list.filter((l) => l.duplicate_of != null).length;
    if (dup === 0) return 'new';
    return dup === list.length ? 'complete' : 'partial';
  }

  const api = { findDuplicates, sectionStatus, isSameSale, PRICE_TOLERANCE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiarioListDedupe = api;
})(typeof window !== 'undefined' ? window : this);
