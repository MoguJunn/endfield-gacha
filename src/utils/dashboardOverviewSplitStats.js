import { RARITY_CONFIG } from '../constants/index.js';
import { isInfoBookHistoryPull } from './historyInfoBook.js';
import { buildResourceSummaryFromAggregates } from './resourceEconomy.js';
import { buildQuotaLedgerFromHistory } from './quotaEconomy.js';
import { resolveCharacterRecordByName } from './characterUtils.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import {
  buildPaidTimelinePityMap,
  buildScopedPaidHistoryTimeline,
  getHistoryRecordKey,
  isTargetSixStarHistoryRecord,
} from './poolScopedHistory.js';

function getBucketFromCapabilities(capabilities) {
  if (capabilities.entityType === 'weapon') return 'weapon';
  if (capabilities.entityType === 'character') return 'character';
  return null;
}

function isGuaranteedPull(item) {
  return item?.specialType === 'guaranteed' || item?.special_type === 'guaranteed';
}

function shouldExcludeFromWinRate(item, capabilities) {
  return capabilities.basePoolType === 'limited' && isGuaranteedPull(item);
}

function buildPoolFromHistoryRecord(poolId, record) {
  return {
    id: poolId,
    type: record?.poolType || record?.pool_type || record?.type,
    up_character: record?.up_character ?? record?.upCharacter,
    extra_subtype: record?.extra_subtype ?? record?.extraSubtype,
    extra_rule_profile: record?.extra_rule_profile ?? record?.extraRuleProfile,
    extra_series_key: record?.extra_series_key ?? record?.extraSeriesKey,
    extra_series_phase: record?.extra_series_phase ?? record?.extraSeriesPhase,
  };
}

function isTargetScope(capabilities) {
  return capabilities.isResolved && capabilities.targetMode !== 'none';
}

function isLimitedCharacterScope(capabilities) {
  return capabilities.entityType === 'character' && isTargetScope(capabilities);
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
  const poolById = new Map(
    selectedPools.flatMap((pool) => (
      [pool?.id, pool?.pool_id].map((poolId) => [poolId, pool])
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
      _pityLimits: new Set(),
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
      _pityLimits: new Set(),
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
    const sourcePool = poolById.get(poolId) || buildPoolFromHistoryRecord(poolId, firstItem);
    const capabilities = resolvePoolCapabilities(sourcePool);
    const bucketKey = getBucketFromCapabilities(capabilities);
    if (!bucketKey) {
      continue;
    }
    const bucket = buckets[bucketKey];
    const scopedPityMap = buildPaidTimelinePityMap(buildScopedPaidHistoryTimeline({
      history,
      pools: selectedPools,
      pool: sourcePool,
      scopeType: 'pity',
    }));
    const pityLimit = Number(capabilities.rules?.sixStarPity);
    if (Number.isFinite(pityLimit) && pityLimit > 0) {
      bucket._pityLimits.add(pityLimit);
    }

    let tempCounter = 0;

    sortedPulls.forEach((item) => {
      const isGift = item?.specialType === 'gift' || item?.special_type === 'gift';
      const isFree = item?.isFree === true || item?.is_free === true;
      if (isGift) return;

      bucket._quotaHistory.push(item);
      if (!includeFreePullsInStats && isFree) return;

      bucket.total += 1;
      if (!isFree) {
        tempCounter += 1;
      }
      if (isTargetScope(capabilities)) {
        bucket._targetScopePulls += 1;
      }
      if (isLimitedCharacterScope(capabilities)) {
        bucket._limitedScopePulls += 1;
      }

      if (capabilities.entityType === 'weapon') {
        bucket._weaponPulls += 1;
        if (!isFree && !isInfoBookHistoryPull(item)) bucket._chargedWeaponPulls += 1;
      } else if (capabilities.entityType === 'character') {
        bucket._characterPulls += 1;
        if (!isFree && !isInfoBookHistoryPull(item)) bucket._chargedCharacterPulls += 1;
      }

      const rarity = Number(item?.rarity) || 0;

      if (rarity >= 6) {
        const isTargetSixStar = isTargetSixStarHistoryRecord(item, sourcePool);
        const isLimitedSixStar = isLimitedCharacterScope(capabilities)
          && (isTargetSixStar || isLimitedCharacterOffrate(item));

        if (isTargetSixStar) {
          bucket.counts[6] += 1;
        } else {
          bucket.counts['6_std'] += 1;
        }

        if (capabilities.entityType === 'character') {
          bucket._arsenalGainCounts[isTargetSixStar ? 6 : '6_std'] += 1;
        }

        if (!shouldExcludeFromWinRate(item, capabilities)) {
          bucket._winRateTotalCount += 1;
          if (isTargetSixStar) {
            bucket._winRateTargetCount += 1;
          }
        }

        bucket._allSixStarPulls.push({
          count: isFree
            ? 30
            : scopedPityMap.get(getHistoryRecordKey(item))?.sixStarPity || tempCounter,
          isStandard: !isTargetSixStar
        });

        if (isTargetSixStar) bucket._upCount += 1;
        if (isLimitedSixStar) bucket._limitedSixCount += 1;

        if (!isFree) {
          tempCounter = 0;
        }
        return;
      }

      const normalizedRarity = rarity === 5 ? 5 : 4;
      bucket.counts[normalizedRarity] += 1;
      if (capabilities.entityType === 'character') {
        bucket._arsenalGainCounts[normalizedRarity] += 1;
      }
    });
  }

  // 汇总每个 bucket
  Object.entries(buckets).forEach(([key, bucket]) => {
    const fallbackCapabilities = resolvePoolCapabilities(key === 'weapon' ? 'weapon' : 'limited');
    const pityLimit = Math.max(
      Number(fallbackCapabilities.rules.sixStarPity),
      ...bucket._pityLimits
    );

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
    delete bucket._pityLimits;
    delete bucket._quotaHistory;
  });

  return buckets;
}

export default buildDashboardOverviewSplitStats;
