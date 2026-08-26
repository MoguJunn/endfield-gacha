import { RARITY_CONFIG } from '../constants/index.js';
import { resolveCharacterRecordByName } from './characterUtils.js';
import { isInfoBookHistoryPull } from './historyInfoBook.js';
import { createHitIntervalTracker, recordHitIntervalHit, recordHitIntervalPull } from './pityIntervals.js';
import { buildQuotaLedgerFromHistory } from './quotaEconomy.js';
import { buildCapabilityAwarePoolResourceSummary, buildPoolResourceSummary } from './resourceEconomy.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import {
  buildOneTimeTargetGuaranteeState,
  buildPaidTimelinePityMap,
  buildScopedFreeHistoryTimeline,
  buildScopedPaidHistoryTimeline,
  calculatePaidTimelinePity,
} from './poolScopedHistory.js';
import { calculateCurrentProbability } from './validators.js';

function isGiftPull(pull) {
  return pull?.specialType === 'gift' || pull?.special_type === 'gift';
}

function isFreePull(pull) {
  return pull?.isFree === true || pull?.is_free === true || pull?.isFreePull === true || pull?.is_free_pull === true;
}

function isGuaranteedPull(pull) {
  return (
    pull?.specialType === 'guaranteed' ||
    pull?.special_type === 'guaranteed' ||
    pull?.isGuaranteed === true ||
    pull?.is_guaranteed === true ||
    pull?.isSpark === true ||
    pull?.is_spark === true
  );
}

function getHistoryPoolId(item) {
  return item?.poolId || item?.pool_id || null;
}

function isTargetCapablePool(capabilities) {
  return capabilities?.isResolved && capabilities.targetMode !== 'none';
}

function isLimitedCharacterPool(capabilities) {
  return isTargetCapablePool(capabilities) && capabilities.entityType === 'character';
}

function readExplicitLimitedFlag(item) {
  const value =
    item?.item_is_limited ??
    item?.itemIsLimited ??
    item?.character_is_limited ??
    item?.characterIsLimited ??
    item?.char_is_limited ??
    item?.charIsLimited ??
    item?.is_limited ??
    item?.metadata?.item_is_limited ??
    item?.metadata?.character_is_limited ??
    null;

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
    item?.name,
  ]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);
}

function isLimitedCharacterOffrate(pull, resolveCharacter) {
  const explicitFlag = readExplicitLimitedFlag(pull);
  if (explicitFlag !== null) {
    return explicitFlag;
  }

  const lookupValues = getHistoryItemLookupValues(pull);
  for (const value of lookupValues) {
    const charInfo = resolveCharacter(value, { fuzzy: true });
    if (charInfo) {
      return charInfo.type !== 'weapon' && charInfo.is_limited === true;
    }
  }

  return false;
}

function isTargetSixStarPull(pull, capabilities) {
  if (!isTargetCapablePool(capabilities)) {
    return false;
  }

  return capabilities.targetMode === 'four-target-equal' || !pull.isStandard;
}

function shouldExcludeFromWinRate(pull, capabilities) {
  return capabilities?.targetMode === 'single-up' && isGuaranteedPull(pull);
}

function isLimitedSixStarPull(pull, capabilities, resolveCharacter) {
  if (!isLimitedCharacterPool(capabilities)) {
    return false;
  }

  if (capabilities.targetMode === 'four-target-equal' || !pull.isStandard) {
    return true;
  }

  return isLimitedCharacterOffrate(pull, resolveCharacter);
}

function getHistoryRecordKey(item) {
  const value = item?.id || item?.record_id || null;
  return value == null ? null : String(value);
}

export function buildPoolStats({
  normalizedCurrentPoolHistory,
  currentPool,
  allLimitedHistory = [],
  accountHistory = null,
  poolCatalog = [],
  currentPoolId = currentPool?.id,
  selectedPools = [],
  includeFreePullsInStats = false,
  resolveCharacter = resolveCharacterRecordByName,
}) {
  const currentPoolCapabilities = resolvePoolCapabilities(currentPool);
  const isLimitedPool = currentPoolCapabilities.basePoolType === 'limited';
  const isWeaponPool = currentPoolCapabilities.basePoolType === 'weapon';
  const isStandardPool = currentPoolCapabilities.basePoolType === 'standard';
  const usesInheritedPity =
    !currentPool?.isGroupMode &&
    (currentPoolCapabilities.pityScope === 'shared' || currentPoolCapabilities.pityScope === 'series');
  const poolCapabilitiesById = new Map(
    (Array.isArray(selectedPools) ? selectedPools : [])
      .flatMap((pool) => [pool?.id, pool?.pool_id].map((poolId) => [poolId, resolvePoolCapabilities(pool)]))
      .filter(([poolId]) => Boolean(poolId))
  );
  const scopePoolById = new Map();
  [
    ...(Array.isArray(poolCatalog) ? poolCatalog : []),
    ...(Array.isArray(selectedPools) ? selectedPools : []),
    currentPool,
  ]
    .filter(Boolean)
    .forEach((pool) => {
      const poolId = pool?.id || pool?.pool_id;
      if (poolId) {
        scopePoolById.set(String(poolId), pool);
      }
    });
  const scopePools = Array.from(scopePoolById.values());
  const scopedHistorySource = Array.isArray(accountHistory) ? accountHistory : allLimitedHistory;
  const scopedPityTimeline = usesInheritedPity
    ? Array.isArray(accountHistory)
      ? buildScopedPaidHistoryTimeline({
          history: scopedHistorySource,
          pools: scopePools,
          pool: currentPool,
          scopeType: 'pity',
        })
      : allLimitedHistory.filter((item) => !isGiftPull(item) && !isFreePull(item))
    : [];
  const scopedRewardTimeline =
    currentPoolCapabilities.rewardScope === 'series'
      ? Array.isArray(accountHistory)
        ? buildScopedPaidHistoryTimeline({
            history: scopedHistorySource,
            pools: scopePools,
            pool: currentPool,
            scopeType: 'reward',
          })
        : allLimitedHistory.filter((item) => !isGiftPull(item) && !isFreePull(item))
      : [];
  const scopedRewardFreeTimeline =
    currentPoolCapabilities.rewardScope === 'series'
      ? Array.isArray(accountHistory)
        ? buildScopedFreeHistoryTimeline({
            history: scopedHistorySource,
            pools: scopePools,
            pool: currentPool,
            scopeType: 'reward',
          })
        : allLimitedHistory.filter((item) => !isGiftPull(item) && isFreePull(item))
      : [];
  const targetGuaranteeState = buildOneTimeTargetGuaranteeState({
    history: scopedHistorySource.length > 0 ? scopedHistorySource : normalizedCurrentPoolHistory,
    pools: scopePools,
    pool: currentPool,
  });
  const limitedCrossPoolPityMap =
    usesInheritedPity && scopedPityTimeline.length > 0 ? buildPaidTimelinePityMap(scopedPityTimeline) : null;

  const getPullCapabilities = (pull) => {
    if (currentPool?.isGroupMode) {
      return (
        poolCapabilitiesById.get(getHistoryPoolId(pull)) ||
        resolvePoolCapabilities({
          id: getHistoryPoolId(pull),
          type: pull?.poolType || pull?.pool_type,
          extra_rule_profile: pull?.extra_rule_profile ?? pull?.extraRuleProfile,
          extra_series_key: pull?.extra_series_key ?? pull?.extraSeriesKey,
        })
      );
    }

    return currentPoolCapabilities;
  };
  const limitedSparkRecordKeys = currentPool?.isGroupMode ? new Set() : targetGuaranteeState.guaranteedRecordKeys;
  const paidPullsList = normalizedCurrentPoolHistory.filter((item) => !isGiftPull(item) && !isFreePull(item));
  const quotaPullsList = normalizedCurrentPoolHistory.filter((item) => !isGiftPull(item));
  const validPullsList = quotaPullsList.filter((item) => includeFreePullsInStats || !isFreePull(item));
  const chargedPullsList = validPullsList.filter((item) => !isFreePull(item) && !isInfoBookHistoryPull(item));
  const total = validPullsList.length;
  const paidTotal = paidPullsList.length;
  const freePullCount = normalizedCurrentPoolHistory.filter((item) => !isGiftPull(item) && isFreePull(item)).length;

  const counts = { 6: 0, '6_std': 0, 5: 0, 4: 0 };

  let currentPity = 0;
  let currentPity5 = 0;

  for (let i = normalizedCurrentPoolHistory.length - 1; i >= 0; i--) {
    const item = normalizedCurrentPoolHistory[i];
    if (isGiftPull(item) || isFreePull(item)) continue;

    if (item.rarity === 6) {
      break;
    }
    currentPity++;
  }

  for (let i = normalizedCurrentPoolHistory.length - 1; i >= 0; i--) {
    const item = normalizedCurrentPoolHistory[i];
    if (isGiftPull(item) || isFreePull(item)) continue;

    if (item.rarity >= 5) {
      break;
    }
    currentPity5++;
  }

  normalizedCurrentPoolHistory.forEach((pull) => {
    let r = pull.rarity;

    if (isGiftPull(pull)) {
      return;
    }

    if (!includeFreePullsInStats && isFreePull(pull)) return;
    const pullCapabilities = getPullCapabilities(pull);

    if (r === 6) {
      if (isTargetSixStarPull(pull, pullCapabilities)) {
        counts[6]++;
      } else {
        counts['6_std']++;
      }
    } else {
      if (r < 4) r = 4;
      if (counts[r] !== undefined) counts[r]++;
    }
  });

  const quotaPools = currentPool?.isGroupMode
    ? selectedPools
    : [currentPool, ...(Array.isArray(selectedPools) ? selectedPools : [])];
  const quotaLedger = buildQuotaLedgerFromHistory(quotaPullsList, {
    pools: quotaPools,
  });
  const resourceSummary = currentPool?.isGroupMode
    ? buildCapabilityAwarePoolResourceSummary({
        history: normalizedCurrentPoolHistory,
        pools: selectedPools,
        includeFreePulls: includeFreePullsInStats,
        quotaLedger,
      })
    : buildPoolResourceSummary({
        poolType: currentPoolCapabilities.basePoolType,
        totalPulls: total,
        chargedPulls: chargedPullsList.length,
        counts: { ...counts },
        quotaLedger,
      });

  const totalSixStar = counts[6] + counts['6_std'];
  const validSixStar = totalSixStar;

  let realLimited = 0;
  let realStandard = 0;
  let offStandardCount = 0;
  let offLimitedCount = 0;
  normalizedCurrentPoolHistory.forEach((pull) => {
    if (pull.rarity === 6 && !isGiftPull(pull) && !isFreePull(pull)) {
      const pullCapabilities = getPullCapabilities(pull);
      const recordKey = getHistoryRecordKey(pull);
      if (shouldExcludeFromWinRate(pull, pullCapabilities) || (recordKey && limitedSparkRecordKeys.has(recordKey))) {
        return;
      }
      if (isTargetSixStarPull(pull, pullCapabilities)) {
        realLimited++;
      } else {
        realStandard++;
        if (isLimitedCharacterOffrate(pull, resolveCharacter)) {
          offLimitedCount++;
        } else {
          offStandardCount++;
        }
      }
    }
  });
  const realTotalSix = realLimited + realStandard;
  const winRate = realTotalSix > 0 ? ((realLimited / realTotalSix) * 100).toFixed(1) : 0;

  let bonusGiftsLimited = 0;
  let bonusGiftsStandard = 0;
  const rewardPaidTotal = currentPoolCapabilities.rewardScope === 'series' ? scopedRewardTimeline.length : paidTotal;
  const rewardFreePullCount =
    currentPoolCapabilities.rewardScope === 'series' ? scopedRewardFreeTimeline.length : freePullCount;

  if (!currentPool.isGroupMode) {
    if (isLimitedPool) {
      bonusGiftsLimited = Math.floor(rewardPaidTotal / Number(currentPoolCapabilities.rules?.giftInterval || Infinity));
    } else if (isWeaponPool) {
      const firstStandardGift = Number(currentPoolCapabilities.rules?.firstStandardGift || 0);
      const firstLimitedGift = Number(currentPoolCapabilities.rules?.firstLimitedGift || 0);
      const alternateInterval = Number(currentPoolCapabilities.rules?.giftAlternateInterval || 0);
      if (firstStandardGift > 0 && rewardPaidTotal >= firstStandardGift) bonusGiftsStandard++;
      if (firstLimitedGift > 0 && rewardPaidTotal >= firstLimitedGift) {
        bonusGiftsLimited++;
        if (alternateInterval > 0) {
          const extraCycles = Math.floor((rewardPaidTotal - firstLimitedGift) / alternateInterval);
          bonusGiftsStandard += Math.ceil(extraCycles / 2);
          bonusGiftsLimited += Math.floor(extraCycles / 2);
        }
      }
    } else if (isStandardPool) {
      const giftInterval = Number(currentPoolCapabilities.rules?.giftInterval || 300);
      if (rewardPaidTotal >= giftInterval) {
        bonusGiftsStandard++;
      }
    }
  }

  const gifts = {
    count: bonusGiftsLimited + bonusGiftsStandard,
    limitedCount: bonusGiftsLimited,
    standardCount: bonusGiftsStandard,
  };

  const sixStarPulls = [];
  const upSixStarHits = [];
  const limitedSixStarHits = [];
  const limitedSixStarIntervalTracker = createHitIntervalTracker();
  const targetSixStarIntervalTracker = createHitIntervalTracker();
  let tempCounter = 0;
  let targetScopeTotal = 0;
  let limitedScopeTotal = 0;

  validPullsList.forEach((pull) => {
    const isFree = isFreePull(pull);
    const pullCapabilities = getPullCapabilities(pull);
    if (!isFree) {
      tempCounter++;
      recordHitIntervalPull(targetSixStarIntervalTracker);
      recordHitIntervalPull(limitedSixStarIntervalTracker);
    }
    if (isTargetCapablePool(pullCapabilities)) {
      targetScopeTotal++;
    }
    if (isLimitedCharacterPool(pullCapabilities)) {
      limitedScopeTotal++;
    }
    if (pull.rarity === 6) {
      const isUp = isTargetSixStarPull(pull, pullCapabilities);
      const recordKey = getHistoryRecordKey(pull);
      const isSpark = recordKey ? limitedSparkRecordKeys.has(recordKey) : false;
      const isActuallyLimited = isLimitedSixStarPull(pull, pullCapabilities, resolveCharacter);

      const inheritedSixStarCount = usesInheritedPity
        ? limitedCrossPoolPityMap?.get(getHistoryRecordKey(pull))?.sixStarPity
        : null;
      const fallbackSixStarCount = isFree ? 30 : tempCounter;
      const effectiveSixStarCount =
        Number.isFinite(inheritedSixStarCount) && inheritedSixStarCount > 0
          ? inheritedSixStarCount
          : fallbackSixStarCount;
      const pullRecord = {
        count: effectiveSixStarCount,
        isStandard: pull.isStandard,
        isGuaranteed: isGuaranteedPull(pull),
        isSpark,
      };
      sixStarPulls.push(pullRecord);
      if (isUp) {
        upSixStarHits.push(pullRecord);
        recordHitIntervalHit(targetSixStarIntervalTracker, { isSpark });
      }
      if (isActuallyLimited) {
        limitedSixStarHits.push(pullRecord);
        recordHitIntervalHit(limitedSixStarIntervalTracker, { isSpark });
      }
      if (!isFree) {
        tempCounter = 0;
      }
    }
  });

  const pullCounts = sixStarPulls.map((s) => s.count);
  const maxPityRecorded = pullCounts.length > 0 ? Math.max(...pullCounts) : 0;
  const minPityRecorded = pullCounts.length > 0 ? Math.min(...pullCounts) : 0;
  const avgPityRecorded =
    pullCounts.length > 0 ? (pullCounts.reduce((a, b) => a + b, 0) / pullCounts.length).toFixed(1) : 0;

  const avgAllSixStar =
    pullCounts.length > 0 ? (pullCounts.reduce((sum, value) => sum + value, 0) / pullCounts.length).toFixed(2) : '0';

  const sparkCount = upSixStarHits.filter((p) => p.isSpark).length;
  const upHitCount = upSixStarHits.length;
  const nonSparkUpHitCount = upSixStarHits.filter((pull) => !pull.isSpark).length;
  const limitedSixStarHitCount = limitedSixStarHits.length;
  const nonSparkLimitedSixStarHitCount = limitedSixStarHits.filter((pull) => !pull.isSpark).length;

  const avgUpSixStar = upHitCount > 0 ? ((targetScopeTotal || total) / upHitCount).toFixed(2) : '0';
  const avgUpSixStarExcludingSpark =
    nonSparkUpHitCount > 0 ? ((targetScopeTotal || total) / nonSparkUpHitCount).toFixed(2) : '0';
  const avgLimitedSixStar =
    nonSparkLimitedSixStarHitCount > 0
      ? ((limitedScopeTotal || total) / nonSparkLimitedSixStarHitCount).toFixed(2)
      : limitedSixStarHitCount > 0
        ? ((limitedScopeTotal || total) / limitedSixStarHitCount).toFixed(2)
        : '0';

  const avgPullCost = {
    6: avgUpSixStarExcludingSpark !== '0' ? avgUpSixStarExcludingSpark : avgUpSixStar,
    '6_with_spark': avgUpSixStar,
    '6_all': avgAllSixStar,
    '6_limited': avgLimitedSixStar,
    5: counts[5] > 0 ? (total / counts[5]).toFixed(2) : '0',
  };

  const rawChartData = [
    ...(!isStandardPool
      ? [
          {
            name: '6星(限定)',
            kind: 'target-six',
            value: counts[6],
            color: RARITY_CONFIG[6].color,
            originalValue: counts[6],
          },
        ]
      : []),
    {
      name: '6星(常驻)',
      kind: 'offrate-six',
      value: counts['6_std'],
      color: RARITY_CONFIG['6_std'].color,
      originalValue: counts['6_std'],
    },
    { name: '5星', kind: 'five-star', value: counts[5], color: RARITY_CONFIG[5].color, originalValue: counts[5] },
    { name: '4星', kind: 'four-star', value: counts[4], color: RARITY_CONFIG[4].color, originalValue: counts[4] },
  ].filter((item) => item.value > 0);

  const chartData = rawChartData.map((item) => {
    const totalValue = rawChartData.reduce((sum, d) => sum + d.value, 0);
    const currentPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
    let minPercent = 0;
    if (item.name.includes('6星')) minPercent = 15;
    else if (item.name.includes('5星')) minPercent = 20;

    if (currentPercent < minPercent && totalValue > 0) {
      return { ...item, displayValue: Math.ceil((totalValue * minPercent) / 100) };
    }
    return { ...item, displayValue: item.value };
  });

  const hardPityLimit = Number(currentPoolCapabilities.rules?.sixStarPity || 80);
  const distributionData = [];
  if (sixStarPulls.length > 0) {
    const numBuckets = Math.ceil(hardPityLimit / 10);
    for (let i = 0; i < numBuckets; i++) {
      const rangeStart = i * 10 + 1;
      const rangeEnd = (i + 1) * 10;
      const isLast = i === numBuckets - 1;
      const items = sixStarPulls.filter((p) =>
        isLast ? p.count >= rangeStart : p.count >= rangeStart && p.count <= rangeEnd
      );
      distributionData.push({
        range: `${rangeStart}-${rangeEnd}`,
        count: items.length,
        limited: items.filter((p) => !p.isStandard).length,
        standard: items.filter((p) => p.isStandard).length,
        guaranteed: items.filter((p) => p.isGuaranteed).length,
      });
    }
  }

  const probabilityInfo =
    currentPool.isGroupMode || !currentPoolCapabilities.isResolved
      ? null
      : calculateCurrentProbability(currentPity, currentPool);

  const infoBookThreshold = Number(currentPoolCapabilities.rules?.infoBookThreshold || 0);
  const hasInfoBook =
    !currentPool.isGroupMode && currentPoolCapabilities.infoBookEnabled && paidTotal >= infoBookThreshold;
  const pullsUntilInfoBook =
    !currentPool.isGroupMode && currentPoolCapabilities.infoBookEnabled && !hasInfoBook
      ? infoBookThreshold - paidTotal
      : 0;

  const stats = {
    total,
    paidTotal,
    rewardPaidTotal,
    freePullCount,
    rewardFreePullCount,
    includeFreePullsInStats,
    counts,
    totalSixStar,
    validSixStar,
    winRate,
    sixStarCount: realTotalSix,
    upSixStarCount: realLimited,
    stdSixStarCount: realStandard,
    offStandardCount,
    offLimitedCount,
    sparkCount,
    currentPity,
    currentPity5,
    avgPullCost,
    chartData,
    pityStats: {
      history: sixStarPulls,
      max: maxPityRecorded,
      min: minPityRecorded,
      avg: avgPityRecorded,
      distribution: distributionData,
    },
    probabilityInfo,
    hasInfoBook,
    pullsUntilInfoBook,
    gifts,
    bonusGifts: {
      limited: bonusGiftsLimited,
      standard: bonusGiftsStandard,
    },
    resourceSummary,
  };

  let inheritedPityInfo;
  if (!currentPool || !usesInheritedPity) {
    inheritedPityInfo = { inheritedPity: 0, inheritedPity5: 0, hasInheritedPity: false };
  } else {
    const validLimitedPulls = scopedPityTimeline;

    if (validLimitedPulls.length === 0) {
      inheritedPityInfo = { inheritedPity: 0, inheritedPity5: 0, hasInheritedPity: false };
    } else {
      const inheritedPityState = calculatePaidTimelinePity(validLimitedPulls);
      const inheritedPity = inheritedPityState.sixStarPity;
      const inheritedPity5 = inheritedPityState.fiveStarPity;

      let lastSixStarPoolId = null;
      for (let i = validLimitedPulls.length - 1; i >= 0; i--) {
        if (validLimitedPulls[i].rarity === 6) {
          lastSixStarPoolId = validLimitedPulls[i].poolId || validLimitedPulls[i].pool_id || null;
          break;
        }
      }

      inheritedPityInfo = {
        inheritedPity,
        inheritedPity5,
        hasInheritedPity: inheritedPity > 0 && lastSixStarPoolId !== currentPoolId,
      };
    }
  }

  const effectivePity = usesInheritedPity
    ? {
        pity6: inheritedPityInfo.inheritedPity,
        pity5: inheritedPityInfo.inheritedPity5,
        isInherited: inheritedPityInfo.hasInheritedPity,
      }
    : {
        pity6: stats.currentPity,
        pity5: stats.currentPity5,
        isInherited: false,
      };

  return {
    stats,
    inheritedPityInfo,
    effectivePity,
  };
}

export default buildPoolStats;
