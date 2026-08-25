import { resolvePoolCapabilities } from './poolCapabilities.js';
import { buildScopedPaidHistoryTimeline, calculatePaidTimelinePity } from './poolScopedHistory.js';

function isGiftPull(item) {
  return item?.specialType === 'gift' || item?.special_type === 'gift';
}

function isFreePull(item) {
  return item?.isFree === true || item?.is_free === true;
}

function calculatePity(history = [], rarityThreshold = 6) {
  let pity = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (isGiftPull(item) || isFreePull(item)) {
      continue;
    }

    if (Number(item?.rarity) >= rarityThreshold) {
      break;
    }

    pity += 1;
  }

  return pity;
}

export function getPoolAnalysisPityState(currentPool, stats = {}, effectivePity = null) {
  const capabilities = resolvePoolCapabilities(currentPool);
  const normalizedType = capabilities.basePoolType;
  const isLimited = normalizedType === 'limited';
  const isExtra = capabilities.rawPoolType === 'extra';
  const isWeapon = normalizedType === 'weapon';
  const usesInheritedPity = capabilities.pityScope === 'shared' || capabilities.pityScope === 'series';
  const maxPity6 = Number(capabilities.rules.sixStarPity || 80);
  const maxPity5 = Number(capabilities.rules.fiveStarPity || 10);
  const displayPity6 = usesInheritedPity ? (effectivePity?.pity6 ?? stats.currentPity ?? 0) : (stats.currentPity ?? 0);
  const displayPity5 = usesInheritedPity ? (effectivePity?.pity5 ?? stats.currentPity5 ?? 0) : (stats.currentPity5 ?? 0);

  return {
    normalizedType,
    isLimited,
    isExtra,
    isWeapon,
    maxPity6,
    maxPity5,
    displayPity6,
    displayPity5,
    isInherited6: Boolean(effectivePity?.isInherited && usesInheritedPity && displayPity6 > 0),
    isInherited5: Boolean(effectivePity?.isInherited && usesInheritedPity && displayPity5 > 0),
    capabilities
  };
}

export function buildOverviewPoolAnalysisPityMap({
  pools = [],
  history = [],
  allLimitedHistory = []
}) {
  const historyByPoolId = new Map();
  history.forEach((item) => {
    const poolId = item?.poolId || item?.pool_id || null;
    if (!poolId) {
      return;
    }

    if (!historyByPoolId.has(poolId)) {
      historyByPoolId.set(poolId, []);
    }
    historyByPoolId.get(poolId).push(item);
  });

  const scopeHistory = history.length > 0 ? history : allLimitedHistory;

  return new Map(
    (Array.isArray(pools) ? pools : []).map((pool) => {
      const poolHistory = historyByPoolId.get(pool.id) || [];
      const stats = {
        currentPity: calculatePity(poolHistory, 6),
        currentPity5: calculatePity(poolHistory, 5)
      };
      const capabilities = resolvePoolCapabilities(pool);
      const scopedPity = capabilities.pityScope === 'shared' || capabilities.pityScope === 'series'
        ? calculatePaidTimelinePity(buildScopedPaidHistoryTimeline({
            history: scopeHistory,
            pools,
            pool,
            scopeType: 'pity',
          }))
        : null;

      return [
        pool.id,
        getPoolAnalysisPityState(
          pool,
          scopedPity
            ? {
              currentPity: scopedPity.sixStarPity,
              currentPity5: scopedPity.fiveStarPity
            }
            : stats,
          null
        )
      ];
    })
  );
}

export default {
  getPoolAnalysisPityState,
  buildOverviewPoolAnalysisPityMap
};
