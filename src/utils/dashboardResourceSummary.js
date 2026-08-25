import { isInfoBookHistoryPull } from './historyInfoBook.js';
import { buildQuotaLedgerFromHistory } from './quotaEconomy.js';
import { buildResourceSummaryFromAggregates } from './resourceEconomy.js';

function normalizePoolType(type) {
  if (type === 'extra') return 'extra';
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'beginner') return 'standard';
  return type;
}

/**
 * 构建 Dashboard 当前视图的资源汇总。所有输入均显式传入，便于 Hook 与分析快照复用。
 */
export function buildDashboardResourceSummary({
  isAllPoolsOverview = false,
  pools = [],
  history = [],
  includeFreePullsInStats = false,
  stats = null
} = {}) {
  if (!isAllPoolsOverview) {
    return stats?.resourceSummary ?? null;
  }

  const poolTypeById = new Map(
    pools.flatMap((pool) => (
      [pool?.id, pool?.pool_id].map((poolId) => [poolId, normalizePoolType(pool?.type)])
    )).filter(([poolId]) => Boolean(poolId))
  );
  const counts = { 6: 0, '6_std': 0, 5: 0, 4: 0 };
  const arsenalGainCounts = { 6: 0, '6_std': 0, 5: 0, 4: 0 };
  const quotaHistory = [];
  let characterPulls = 0;
  let weaponPulls = 0;
  let chargedCharacterPulls = 0;
  let chargedWeaponPulls = 0;

  history.forEach((item) => {
    const isGift = item?.specialType === 'gift' || item?.special_type === 'gift';
    const isFree = item?.isFree === true || item?.is_free === true;
    if (isGift) {
      return;
    }

    quotaHistory.push(item);
    if (!includeFreePullsInStats && isFree) {
      return;
    }

    const poolId = item?.poolId || item?.pool_id || null;
    const poolType = poolTypeById.get(poolId) || 'standard';
    const rarity = Number(item?.rarity) || 0;
    const targetCounts = poolType === 'weapon' ? counts : arsenalGainCounts;

    if (poolType === 'weapon') {
      weaponPulls += 1;
      if (!isFree && !isInfoBookHistoryPull(item)) {
        chargedWeaponPulls += 1;
      }
    } else {
      characterPulls += 1;
      if (!isFree && !isInfoBookHistoryPull(item)) {
        chargedCharacterPulls += 1;
      }
    }

    if (rarity >= 6) {
      if (item?.isStandard) {
        targetCounts['6_std'] += 1;
      } else {
        targetCounts[6] += 1;
      }
    } else if (rarity === 5) {
      targetCounts[5] += 1;
    } else if (rarity >= 1) {
      targetCounts[4] += 1;
    }
  });

  return buildResourceSummaryFromAggregates({
    characterPulls,
    weaponPulls,
    chargedCharacterPulls,
    chargedWeaponPulls,
    counts: {
      6: arsenalGainCounts[6] + counts[6],
      '6_std': arsenalGainCounts['6_std'] + counts['6_std'],
      5: arsenalGainCounts[5] + counts[5],
      4: arsenalGainCounts[4] + counts[4]
    },
    arsenalGainCounts,
    quotaLedger: buildQuotaLedgerFromHistory(quotaHistory, { pools })
  });
}

export default buildDashboardResourceSummary;
