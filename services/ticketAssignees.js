function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAssignees(assignees, quantity) {
  const qty = parseInt(quantity, 10);
  if (!qty || qty < 1 || qty > 10) {
    return { ok: false, error: 'Quantidade deve ser entre 1 e 10' };
  }

  let list = assignees;
  if (list == null) list = [];
  if (!Array.isArray(list)) {
    return { ok: false, error: 'assignees inválido' };
  }
  if (list.length > qty) {
    return { ok: false, error: 'Há mais destinatários do que ingressos' };
  }

  const value = [];
  for (let i = 0; i < qty; i++) {
    const raw = i < list.length ? list[i] : null;
    if (raw == null) {
      value.push(null);
      continue;
    }
    if (typeof raw !== 'object') {
      return { ok: false, error: `Destinatário ${i + 1} inválido` };
    }
    const name = raw.name != null ? String(raw.name).trim() : '';
    const email = raw.email != null ? String(raw.email).trim().toLowerCase() : '';
    const phone = raw.phone != null && String(raw.phone).trim() ? String(raw.phone).trim() : null;
    if (!name) return { ok: false, error: `Nome do destinatário ${i + 1} é obrigatório` };
    if (!email || !isValidEmail(email)) {
      return { ok: false, error: `E-mail do destinatário ${i + 1} é inválido` };
    }
    value.push({ name, email, phone });
  }
  return { ok: true, value };
}

function resolveHolders(order) {
  const qty = Number(order.quantity);
  const assignees = Array.isArray(order.assignees) ? order.assignees : [];
  const buyer = {
    name: order.buyer_name,
    email: String(order.buyer_email).trim().toLowerCase(),
    phone: order.buyer_phone || null
  };
  const holders = [];
  for (let i = 0; i < qty; i++) {
    const a = i < assignees.length ? assignees[i] : null;
    if (a && a.name && a.email) {
      holders.push({
        name: String(a.name).trim(),
        email: String(a.email).trim().toLowerCase(),
        phone: a.phone || null
      });
    } else {
      holders.push({ ...buyer });
    }
  }
  return holders;
}

module.exports = { normalizeAssignees, resolveHolders, isValidEmail };
