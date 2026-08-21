import { RARITY_CONFIG, LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { isInfoBookHistoryPull } from './historyInfoBook.js';
import { buildResourceSummaryFromAggregates } from './resourceEconomy.js';
import { buildQuotaLedgerFromHistory } from './quotaEconomy.js';
import { resolveCharacterRecordByName } from './characterUtils.js';
import { getHardPityFloor } from './forcedUpDetection.js';

const CHAR_PITY_LIMIT = LIMITED_POOL_RULES.sixStarPity;
const WEAPON_PITY_LIMIT = WEAPON_POOL_RULES.sixStarPity;

function normalizePoolType(type) {
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'beginner') return 'standard';
  return type || 'standard';
}

function getBucketFromPoolType(type) {
  return normalizePoolType(type) === 'weapon' ? 'weapon' : 'character';
}

function isTargetCapablePool(type) {
  const normalizedType = normalizePoolType(type);
  return normalizedType === 'limited' || normalizedType === 'extra' || normalizedType === 'weapon';
}

function isLimitedCharacterPool(type) {
  const normalizedType = normalizePoolType(type);
  return normalizedType === 'limited' || normalizedType === 'extra';
}

function isTargetSixStarPull(item, poolType) {
  return isTargetCapablePool(poolType) && (normalizePoolType(poolType) === 'extra' || !item?.isStandard);
}

function isGuaranteedPull(item) {
  return item?.specialType === 'guaranteed' || item?.special_type === 'guaranteed';
}

function shouldExcludeFromWinRate(item, poolType) {
  return normalizePoolType(poolType) === 'limited' && isGuaranteedPull(item);
}

function readExplicitLimitedFlag(item) {
  const value = item?.item_is_limited
    ?? item?.itemIsLimited
    ?? item?.character_is_limited
    ?? item?.characterIsLimited
    ?? item?.char_is_limited
    ?? item?.charIsLimited
    ?? item?.is_limited
    ?? item?.metadata?.item_is_limited
    ?? item?.metadata?.character_is_limited
    ?? null;

  return typeof value === 'boolean' ? value : null;
}

function getHistoryItemLookupValues(item) {
  return [
    item?.character_id,
    item?.characterId,
    item?.item_id,
    item?.itemId,
    item?.character_name,
    item?.characterName,
    item?.item_name,
    item?.itemName,
    item?.name
  ]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);
}

function isLimitedCharacterOffrate(item) {
  const explicitFlag = readExplicitLimitedFlag(item);
  if (explicitFlag !== null) {
    return explicitFlag;
  }

  const lookupValues = getHistoryItemLookupValues(item);
  for (const value of lookupValues) {
    const itemInfo = resolveCharacterRecordByName(value, { fuzzy: true });
    if (itemInfo) {
      return itemInfo.type !== 'weapon' && itemInfo.is_limited === true;
    }
  }

  return false;
}

function createBucketAccumulator() {
  return {
    total: 0,
    chargedPulls: 0,
    counts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
    totalSixStar: 0,
    winRate: '0.0',
    avgPullCost: { 6: '0', '6_all': '0', '6_limited': '0', '6_with_spark': '0', 5: '0' },
    chartData: [],
    pityStats: { history: [], distribution: [], max: 0, min: 0, avg: 0 },
    resourceSummary: null
  };
}

function toChartData(counts, includeTargetSix) {
  const rawChartData = [
    ...(includeTargetSix ? [{ name: '6星(目标)', kind: 'target-six', value: counts[6], color: RARITY_CONFIG[6].color }] : []),
    { name: '6星(常驻/偏移)', kind: 'offrate-six', value: counts['6_std'], color: RARITY_CONFIG['6_std'].color },
    { name: '5星', kind: 'five-star', value: counts[5], color: RARITY_CONFIG[5].color },
    { name: '4星', kind: 'four-star', value: counts[4], color: RARITY_CONFIG[4].color }
  ].filter((item) => item.value > 0);

  return rawChartData.map((item) => {
    const totalValue = rawChartData.reduce((sum, entry) => sum + entry.value, 0);
    const currentPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
    let minPercent = 0;
    if (item.name.includes('6星')) minPercent = 15;
    else if (item.name.includes('5星')) minPercent = 20;

    if (currentPercent < minPercent && totalValue > 0) {
      return { ...item, displayValue: Math.ceil((totalValue * minPercent) / 100) };
    }
    return { ...item, displayValue: item.value };
  });
}

function buildDistributionData(sixStarPulls, hardPityLimit) {
  const numBuckets = Math.ceil(hardPityLimit / 10);
  const distribution = [];

  for (let i = 0; i < numBuckets; i++) {
    const rangeStart = i * 10 + 1;
    const rangeEnd = (i + 1) * 10;
    const isLast = i === numBuckets - 1;
    const items = sixStarPulls.filter((e) =>
      isLast ? e.count >= rangeStart : e.count >= rangeStart && e.count <= rangeEnd
    );
    distribution.push({
      range: `${rangeStart}-${rangeEnd}`,
      count: items.length,
      limited: items.filter((e) => !e.isStandard).length,
      standard: items.filter((e) => e.isStandard).length
    });
  }

  return distribution;
}

export function buildDashboardOverviewSplitStats({
  history = [],
  selectedPools = [],
  includeFreePullsInStats = false
} = {}) {
  const poolTypeById = new Map(
    selectedPools.flatMap((pool) => (
      [pool?.id, pool?.pool_id].map((poolId) => [poolId, normalizePoolType(pool?.type)])
    )).filter(([poolId]) => Boolean(poolId))
  );

  const buckets = {
    character: {
      ...createBucketAccumulator(),
      label: '角色池汇总',
      poolType: 'limited',
      _allSixStarPulls: [],
      _upCount: 0,
      _limitedSixCount: 0,
      _targetScopePulls: 0,
      _limitedScopePulls: 0,
      _characterPulls: 0,
      _weaponPulls: 0,
      _chargedCharacterPulls: 0,
      _chargedWeaponPulls: 0,
      _arsenalGainCounts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
      _winRateTargetCount: 0,
      _winRateTotalCount: 0,
      _quotaHistory: []
    },
    weapon: {
      ...createBucketAccumulator(),
      label: '武器池汇总',
      poolType: 'weapon',
      _allSixStarPulls: [],
      _upCount: 0,
      _limitedSixCount: 0,
      _targetScopePulls: 0,
      _limitedScopePulls: 0,
      _characterPulls: 0,
      _weaponPulls: 0,
      _chargedCharacterPulls: 0,
      _chargedWeaponPulls: 0,
      _arsenalGainCounts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
      _winRateTargetCount: 0,
      _winRateTotalCount: 0,
      _quotaHistory: []
    }
  };

  // 按池分组
  const pullsByPool = {};
  history.forEach((item) => {
    const poolId = item?.poolId || item?.pool_id || '__unknown__';
    if (!pullsByPool[poolId]) pullsByPool[poolId] = [];
    pullsByPool[poolId].push(item);
  });

  // 按池独立处理保底计数，与时间线视图一致
  for (const [poolId, pulls] of Object.entries(pullsByPool)) {
    const sortedPulls = pulls.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0));
    const firstItem = sortedPulls[0];
    const poolType = poolTypeById.get(poolId)
      || normalizePoolType(firstItem?.poolType || firstItem?.pool_type);
    const bucketKey = getBucketFromPoolType(poolType);
    const bucket = buckets[bucketKey];

    let tempCounter = 0;
    // 硬保底强制 UP（spark）按「期」累计：每池(期)独立，不计入免费/赠送抽。
    let cumulativePullCount = 0;
    let hasGotUpBefore = false;

    sortedPulls.forEach((item) => {
      const isGift = item?.specialType === 'gift' || item?.special_type === 'gift';
      const isFree = item?.isFree === true || item?.is_free === true;
      if (isGift) return;

      bucket._quotaHistory.push(item);
      if (!includeFreePullsInStats && isFree) return;

      bucket.total += 1;
      if (!isFree) {
        tempCounter += 1;
        cumulativePullCount += 1;
      }
      if (isTargetCapablePool(poolType)) {
        bucket._targetScopePulls += 1;
      }
      if (isLimitedCharacterPool(poolType)) {
        bucket._limitedScopePulls += 1;
      }

      if (bucketKey === 'weapon') {
        bucket._weaponPulls += 1;
        if (!isFree && !isInfoBookHistoryPull(item)) bucket._chargedWeaponPulls += 1;
      } else {
        bucket._characterPulls += 1;
        if (!isFree && !isInfoBookHistoryPull(item)) bucket._chargedCharacterPulls += 1;
      }

      const rarity = Number(item?.rarity) || 0;

      if (rarity >= 6) {
        const isTargetSixStar = isTargetSixStarPull(item, poolType);
        const isLimitedSixStar = isLimitedCharacterPool(poolType)
          && (isTargetSixStar || isLimitedCharacterOffrate(item));

        // 硬保底强制 UP（限定 120 / 武器 71~80）：不是独立判定，需剔除出不歪率与「排除保底」均值。
        // 此前总览分栏页完全没算 spark（连限定 120 都没算、武器 80 更没算）。
        const hardPityFloor = getHardPityFloor(poolType);
        let isSpark = false;
        if (isTargetSixStar && !hasGotUpBefore && Number.isFinite(hardPityFloor) && cumulativePullCount >= hardPityFloor) {
          isSpark = true;
        }
        if (isTargetSixStar && Number.isFinite(hardPityFloor) && cumulativePullCount < hardPityFloor) {
          hasGotUpBefore = true;
        }

        if (isTargetSixStar) {
          bucket.counts[6] += 1;
        } else {
          bucket.counts['6_std'] += 1;
        }

        if (bucketKey === 'character') {
          bucket._arsenalGainCounts[isTargetSixStar ? 6 : '6_std'] += 1;
        }

        if (!shouldExcludeFromWinRate(item, poolType) && !isSpark) {
          bucket._winRateTotalCount += 1;
          if (isTargetSixStar) {
            bucket._winRateTargetCount += 1;
          }
        }

        bucket._allSixStarPulls.push({
          count: isFree ? 30 : tempCounter,
          isStandard: !isTargetSixStar,
          isSpark
        });

        if (isTargetSixStar && !isSpark) bucket._upCount += 1;
        if (isLimitedSixStar && !isSpark) bucket._limitedSixCount += 1;

        if (!isFree) {
          tempCounter = 0;
        }
        return;
      }

      const normalizedRarity = rarity === 5 ? 5 : 4;
      bucket.counts[normalizedRarity] += 1;
      if (bucketKey === 'character') {
        bucket._arsenalGainCounts[normalizedRarity] += 1;
      }
    });
  }

  // 汇总每个 bucket
  Object.entries(buckets).forEach(([key, bucket]) => {
    const pityLimit = key === 'weapon' ? WEAPON_PITY_LIMIT : CHAR_PITY_LIMIT;

    bucket.totalSixStar = bucket.counts[6] + bucket.counts['6_std'];
    bucket.winRate = bucket._winRateTotalCount > 0
      ? ((bucket._winRateTargetCount / bucket._winRateTotalCount) * 100).toFixed(1)
      : '0.0';
    bucket.winRateTargetCount = bucket._winRateTargetCount;
    bucket.winRateTotalCount = bucket._winRateTotalCount;

    const avgFiveStar = bucket.counts[5] > 0 ? (bucket.total / bucket.counts[5]).toFixed(2) : '0';
    const avgAllSixStar = bucket.totalSixStar > 0 ? (bucket.total / bucket.totalSixStar).toFixed(2) : '0';
    const avgTargetSixStar = bucket._upCount > 0 ? ((bucket._targetScopePulls || bucket.total) / bucket._upCount).toFixed(2) : '0';
    const avgLimitedSixStar = bucket._limitedSixCount > 0 ? ((bucket._limitedScopePulls || bucket.total) / bucket._limitedSixCount).toFixed(2) : '0';

    bucket.avgPullCost = {
      6: avgTargetSixStar,
      '6_all': avgAllSixStar,
      '6_limited': avgLimitedSixStar,
      '6_with_spark': avgTargetSixStar,
      5: avgFiveStar
    };

    bucket.chartData = toChartData(bucket.counts, true);

    const pullCounts = bucket._allSixStarPulls.map((e) => e.count);
    bucket.pityStats = {
      history: bucket._allSixStarPulls,
      distribution: buildDistributionData(bucket._allSixStarPulls, pityLimit),
      max: pullCounts.length > 0 ? Math.max(...pullCounts) : 0,
      min: pullCounts.length > 0 ? Math.min(...pullCounts) : 0,
      avg: pullCounts.length > 0
        ? (pullCounts.reduce((sum, v) => sum + v, 0) / pullCounts.length).toFixed(1)
        : 0
    };

    bucket.resourceSummary = buildResourceSummaryFromAggregates({
      characterPulls: bucket._characterPulls,
      weaponPulls: bucket._weaponPulls,
      chargedCharacterPulls: bucket._chargedCharacterPulls,
      chargedWeaponPulls: bucket._chargedWeaponPulls,
      counts: bucket.counts,
      arsenalGainCounts: bucket._arsenalGainCounts,
      quotaLedger: buildQuotaLedgerFromHistory(bucket._quotaHistory, {
        pools: selectedPools,
      })
    });

    delete bucket._allSixStarPulls;
    delete bucket._upCount;
    delete bucket._limitedSixCount;
    delete bucket._targetScopePulls;
    delete bucket._limitedScopePulls;
    delete bucket._characterPulls;
    delete bucket._weaponPulls;
    delete bucket._chargedCharacterPulls;
    delete bucket._chargedWeaponPulls;
    delete bucket._arsenalGainCounts;
    delete bucket._winRateTargetCount;
    delete bucket._winRateTotalCount;
    delete bucket._quotaHistory;
  });

  return buckets;
}

export default buildDashboardOverviewSplitStats;
