const DEFAULT_VISITS_PER_REWARD = 10;

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function maskDisplayName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Cliente';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
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

function mapCustomerRow(row, { includePhone = false, maskName = false, visitsPerReward = DEFAULT_VISITS_PER_REWARD } = {}) {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  const totalVisits = Number(row.total_visits) || 0;
  const totalRewards = Number(row.total_rewards) || 0;
  const rawProgress = getProgress(totalVisits, n);
  const cycleComplete = isCycleComplete(totalVisits, n);
  const displayProgress = getDisplayProgress(totalVisits, n);

  const out = {
    id: row.id,
    name: row.name,
    display_name: maskName ? maskDisplayName(row.name) : row.name,
    avatar: row.avatar || null,
    total_visits: totalVisits,
    total_rewards: totalRewards,
    progress: rawProgress,
    display_progress: displayProgress,
    cycle_complete: cycleComplete,
    visits_per_reward: n,
    visits_to_reward: getVisitsToReward(totalVisits, n),
    active: row.active !== false
  };
  if (includePhone) {
    out.phone = row.phone;
  }
  return out;
}

function applyVisitDelta(currentVisits, currentRewards, delta, visitsPerReward = DEFAULT_VISITS_PER_REWARD) {
  const n = Math.max(2, Number(visitsPerReward) || DEFAULT_VISITS_PER_REWARD);
  let visits = Number(currentVisits) || 0;
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

  return { visits, rewards, rewards_earned: rewardsEarned };
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

module.exports = {
  DEFAULT_VISITS_PER_REWARD,
  normalizePhone,
  maskDisplayName,
  getProgress,
  getDisplayProgress,
  isCycleComplete,
  getVisitsToReward,
  mapCustomerRow,
  applyVisitDelta,
  parseNonNegativeInt,
  parseVisitsPerReward
};
