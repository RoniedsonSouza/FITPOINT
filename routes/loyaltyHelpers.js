const DEFAULT_VISITS_PER_REWARD = 10;
const DEFAULT_ACCESS_VALUE = 27;
const INACTIVE_VISIT_DAYS = 3;
const { table } = require('../config/database');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function getProgress(totalVisits, visitsPerReward = DEFAULT_VISITS_PER_REWARD) {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  const visits = Number(totalVisits) || 0;
  return visits % n;
}

function isCycleComplete(totalVisits, visitsPerReward = DEFAULT_VISITS_PER_REWARD) {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  const visits = Number(totalVisits) || 0;
  return visits > 0 && visits % n === 0;
}

function getDisplayProgress(totalVisits, visitsPerReward = DEFAULT_VISITS_PER_REWARD) {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  const visits = Number(totalVisits) || 0;
  if (visits === 0) return 0;
  if (isCycleComplete(visits, n)) return n;
  return getProgress(visits, n);
}

function getVisitsToReward(totalVisits, visitsPerReward = DEFAULT_VISITS_PER_REWARD) {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  const visits = Number(totalVisits) || 0;
  if (visits === 0) return n;
  if (isCycleComplete(visits, n)) return 0;
  const progress = getProgress(visits, n);
  return n - progress;
}

function isInactiveVisit(row) {
  const totalVisits = Number(row.total_visits) || 0;
  const lastPositive = row.last_positive_visit_at ? new Date(row.last_positive_visit_at) : null;
  if (lastPositive && !Number.isNaN(lastPositive.getTime())) {
    return Date.now() - lastPositive.getTime() > INACTIVE_VISIT_DAYS * 24 * 60 * 60 * 1000;
  }
  return totalVisits > 0;
}

function mapCustomerRow(row, { includePhone = false, visitsPerReward = DEFAULT_VISITS_PER_REWARD } = {}) {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  const totalVisits = Number(row.total_visits) || 0;
  const totalRewards = Number(row.total_rewards) || 0;
  const rawProgress = getProgress(totalVisits, n);
  const cycleComplete = isCycleComplete(totalVisits, n);
  const displayProgress = getDisplayProgress(totalVisits, n);
  const lastPositive = row.last_positive_visit_at
    ? new Date(row.last_positive_visit_at).toISOString()
    : null;

  const out = {
    id: row.id,
    name: row.name,
    display_name: row.name,
    avatar: row.avatar || null,
    total_visits: totalVisits,
    total_rewards: totalRewards,
    progress: rawProgress,
    display_progress: displayProgress,
    cycle_complete: cycleComplete,
    visits_per_reward: n,
    visits_to_reward: getVisitsToReward(totalVisits, n),
    last_visit_at: row.last_visit_at ? new Date(row.last_visit_at).toISOString() : null,
    last_positive_visit_at: lastPositive,
    inactive_visit: isInactiveVisit(row),
    active: row.active !== false
  };
  if (includePhone) {
    out.phone = row.phone;
  }
  return out;
}

function applyVisitDelta(currentVisits, currentRewards, delta, visitsPerReward = DEFAULT_VISITS_PER_REWARD) {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  const startVisits = Number(currentVisits) || 0;
  let visits = startVisits;
  let rewards = Number(currentRewards) || 0;
  const steps = Math.abs(Math.trunc(Number(delta) || 0));
  const sign = Number(delta) >= 0 ? 1 : -1;
  let rewardsEarned = 0;

  for (let i = 0; i < steps; i++) {
    if (sign > 0) {
      visits += 1;
      if (visits % n === 0) {
        rewards += 1;
        rewardsEarned += 1;
      }
    } else {
      if (visits <= 0) break;
      if (visits % n === 0 && rewards > 0) {
        rewards -= 1;
      }
      visits -= 1;
    }
  }

  return {
    visits,
    rewards,
    rewards_earned: rewardsEarned,
    delta_applied: visits - startVisits
  };
}

async function insertVisitEvents(db, customerId, appliedDelta, source) {
  const steps = Math.abs(Math.trunc(Number(appliedDelta) || 0));
  if (steps === 0) return;
  const sign = Number(appliedDelta) > 0 ? 1 : -1;
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  const placeholders = [];
  const values = [];
  for (let i = 0; i < steps; i++) {
    const base = i * 3;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    values.push(customerId, sign, source);
  }
  await run(
    `INSERT INTO ${table('loyalty_visit_events')} (customer_id, delta, source)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

function mapVisitEventRow(row) {
  return {
    id: row.id,
    delta: Number(row.delta),
    source: row.source,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

function parseNonNegativeInt(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const num = parseInt(String(value), 10);
  if (Number.isNaN(num) || num < 0) {
    return { error: `${fieldName} deve ser um número >= 0` };
  }
  return { value: num };
}

function parseVisitsPerReward(value) {
  const num = parseInt(String(value), 10);
  if (Number.isNaN(num) || num < 2 || num > 100) {
    return { error: 'Visitas por prêmio deve ser um número entre 2 e 100' };
  }
  return { value: num };
}

function parseAccessValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1 || num > 10000) {
    return { error: 'Valor do acesso deve ser um número entre R$ 1 e R$ 10.000' };
  }
  return { value: Math.round(num * 100) / 100 };
}

function computeLoyaltyVisitsFromAmount(totalAmount, accessValue = DEFAULT_ACCESS_VALUE) {
  const total = Number(totalAmount) || 0;
  const access = Number(accessValue) || DEFAULT_ACCESS_VALUE;
  if (total <= 0 || access <= 0) return 0;
  return Math.floor(total / access);
}

function parsePaginationQuery(query) {
  let page = parseInt(String(query?.page), 10);
  let limit = parseInt(String(query?.limit), 10);
  if (Number.isNaN(page) || page < 1) page = 1;
  if (Number.isNaN(limit) || limit < 1) limit = 10;
  if (limit > 50) limit = 50;
  return { page, limit, offset: (page - 1) * limit };
}

function parseSearchQuery(query) {
  const q = String(query?.q || '').trim();
  return q || null;
}

function buildNamePhoneSearchClause(search, startIndex, alias = '') {
  if (!search) {
    return { clause: '', values: [], nextIndex: startIndex };
  }
  const col = alias ? `${alias}.` : '';
  const escaped = search.replace(/[%_\\]/g, '\\$&');
  const namePattern = `%${escaped}%`;
  const phoneDigits = normalizePhone(search);
  const values = [namePattern];
  let clause = ` AND (${col}name ILIKE $${startIndex}`;
  let nextIndex = startIndex + 1;
  if (phoneDigits) {
    clause += ` OR ${col}phone LIKE $${nextIndex}`;
    values.push(`%${phoneDigits}%`);
    nextIndex += 1;
  }
  clause += ')';
  return { clause, values, nextIndex };
}

function participantOrderSql(visitsPerReward, alias = '') {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  const col = alias ? `${alias}.` : '';
  return `CASE
    WHEN ${col}total_visits = 0 THEN 0
    WHEN ${col}total_visits % ${n} = 0 THEN ${n}
    ELSE ${col}total_visits % ${n}
  END DESC, ${col}total_visits DESC, ${col}name ASC`;
}

function computeTotalPages(total, limit) {
  return Math.max(1, Math.ceil(total / limit) || 1);
}

module.exports = {
  DEFAULT_VISITS_PER_REWARD,
  DEFAULT_ACCESS_VALUE,
  INACTIVE_VISIT_DAYS,
  normalizePhone,
  getProgress,
  getDisplayProgress,
  isCycleComplete,
  getVisitsToReward,
  isInactiveVisit,
  mapCustomerRow,
  applyVisitDelta,
  insertVisitEvents,
  mapVisitEventRow,
  parseNonNegativeInt,
  parseVisitsPerReward,
  parseAccessValue,
  computeLoyaltyVisitsFromAmount,
  parsePaginationQuery,
  parseSearchQuery,
  buildNamePhoneSearchClause,
  participantOrderSql,
  computeTotalPages
};
