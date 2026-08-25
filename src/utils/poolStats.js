import { EXTRA_POOL_RULES, RARITY_CONFIG, LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { resolveCharacterRecordByName } from './characterUtils.js';
import { isInfoBookHistoryPull } from './historyInfoBook.js';
import {
  createHitIntervalTracker,
  recordHitIntervalHit,
  recordHitIntervalPull
} from './pityIntervals.js';
import { buildQuotaLedgerFromHistory } from './quotaEconomy.js';
import { buildPoolResourceSummary } from './resourceEconomy.js';
import {
  calculateCurrentProbability,
  calculatePity5FromHistory,
  calculatePityFromHistory
} from './validators.js';

function isGiftPull(pull) {
  return pull?.specialType === 'gift' || pull?.special_type === 'gift';
}

function isFreePull(pull) {
  return pull?.isFree === true
    || pull?.is_free === true
    || pull?.isFreePull === true
    || pull?.is_free_pull === true;
}

function isGuaranteedPull(pull) {
  return pull?.specialType === 'guaranteed'
    || pull?.special_type === 'guaranteed'
    || pull?.isGuaranteed === true
    || pull?.is_guaranteed === true
    || pull?.isSpark === true
    || pull?.is_spark === true;
}

function normalizePoolType(type) {
  if (type === 'limited_character') return 'limited';
  if (type === 'extra') return 'extra';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'beginner') return 'standard';
  return type || 'standard';
}

function getHistoryPoolId(item) {
  return item?.poolId || item?.pool_id || null;
}

function isTargetCapablePool(poolType) {
  return poolType === 'limited' || poolType === 'extra' || poolType === 'weapon';
}

function isLimitedCharacterPool(poolType) {
  return poolType === 'limited' || poolType === 'extra';
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

function isTargetSixStarPull(pull, poolType) {
  return isTargetCapablePool(poolType) && (poolType === 'extra' || !pull.isStandard);
}

function shouldExcludeFromWinRate(pull, poolType) {
  const normalizedType = normalizePoolType(poolType);
  return (normalizedType === 'limited' || normalizedType === 'weapon') && isGuaranteedPull(pull);
}

function isLimitedSixStarPull(pull, poolType, resolveCharacter) {
  if (!isLimitedCharacterPool(poolType)) {
    return false;
  }

  if (poolType === 'extra' || !pull.isStandard) {
    return true;
  }

  return isLimitedCharacterOffrate(pull, resolveCharacter);
}

function getHistoryRecordKey(item) {
  const value = item?.id || item?.record_id || null;
  return value == null ? null : String(value);
}

function buildLimitedSparkRecordKeys(history, getPullPoolType, isGroupMode) {
  const sparkRecordKeys = new Set();
  if (isGroupMode) {
    return sparkRecordKeys;
  }

  let cumulativePullCount = 0;
  let hasGotUpBefore120 = false;

  history.forEach((pull) => {
    if (isGiftPull(pull) || isFreePull(pull)) {
      return;
    }

    cumulativePullCount += 1;
    const pullPoolType = getPullPoolType(pull);
    if (Number(pull?.rarity) !== 6 || pullPoolType !== 'limited') {
      return;
    }

    const isUp = isTargetSixStarPull(pull, pullPoolType);
    if (isUp && cumulativePullCount === 120 && !hasGotUpBefore120) {
      const recordKey = getHistoryRecordKey(pull);
      if (recordKey) {
        sparkRecordKeys.add(recordKey);
      }
    }

    if (isUp && cumulativePullCount < 120) {
      hasGotUpBefore120 = true;
    }
  });

  return sparkRecordKeys;
}

export function buildPoolStats({
  normalizedCurrentPoolHistory,
  currentPool,
  allLimitedHistory = [],
  currentPoolId = currentPool?.id,
  selectedPools = [],
  includeFreePullsInStats = false,
  resolveCharacter = resolveCharacterRecordByName
}) {
  const normalizedPoolType = normalizePoolType(currentPool?.type);
  const isLimitedPool = normalizedPoolType === 'limited';
  const isExtraPool = normalizedPoolType === 'extra';
  const isWeaponPool = normalizedPoolType === 'weapon';
  const isStandardPool = normalizedPoolType === 'standard' || normalizedPoolType === 'beginner';
  const poolTypeById = new Map(
    (Array.isArray(selectedPools) ? selectedPools : [])
      .flatMap((pool) => [pool?.id, pool?.pool_id].map((poolId) => [poolId, normalizePoolType(pool?.type)]))
      .filter(([poolId]) => Boolean(poolId))
  );

  let limitedCrossPoolPityMap = null;
  if (isLimitedPool && Array.isArray(allLimitedHistory) && allLimitedHistory.length > 0) {
    limitedCrossPoolPityMap = new Map();
    let sixPity = 0;

    allLimitedHistory.forEach((item) => {
      if (isGiftPull(item) || isFreePull(item)) {
        return;
      }

      sixPity += 1;
      const recordKey = getHistoryRecordKey(item);
      if (Number(item?.rarity) >= 6 && recordKey) {
        limitedCrossPoolPityMap.set(recordKey, sixPity);
        sixPity = 0;
      }
    });
  }

  const getPullPoolType = (pull) => {
    if (currentPool?.isGroupMode) {
      return poolTypeById.get(getHistoryPoolId(pull)) || normalizePoolType(pull?.poolType || pull?.pool_type);
    }

    return normalizedPoolType;
  };
  const limitedSparkRecordKeys = buildLimitedSparkRecordKeys(
    normalizedCurrentPoolHistory,
    getPullPoolType,
    currentPool?.isGroupMode
  );
  const paidPullsList = normalizedCurrentPoolHistory.filter((item) => !isGiftPull(item) && !isFreePull(item));
  const quotaPullsList = normalizedCurrentPoolHistory.filter((item) => !isGiftPull(item));
  const validPullsList = quotaPullsList.filter((item) => (
    includeFreePullsInStats || !isFreePull(item)
  ));
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

  normalizedCurrentPoolHistory.forEach(pull => {
    let r = pull.rarity;

    if (isGiftPull(pull)) {
      return;
    }

    if (!includeFreePullsInStats && isFreePull(pull)) return;
    const pullPoolType = getPullPoolType(pull);

    if (r === 6) {
      if (isTargetSixStarPull(pull, pullPoolType)) {
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
  const resourceSummary = buildPoolResourceSummary({
    poolType: normalizedPoolType,
    totalPulls: total,
    chargedPulls: chargedPullsList.length,
    counts: { ...counts },
    quotaLedger
  });

  const totalSixStar = counts[6] + counts['6_std'];
  const validSixStar = totalSixStar;

  let realLimited = 0;
  let realStandard = 0;
  let offStandardCount = 0;
  let offLimitedCount = 0;
  normalizedCurrentPoolHistory.forEach(pull => {
    if (pull.rarity === 6 && !isGiftPull(pull) && !isFreePull(pull)) {
      const pullPoolType = getPullPoolType(pull);
      const recordKey = getHistoryRecordKey(pull);
      if (shouldExcludeFromWinRate(pull, pullPoolType) || (recordKey && limitedSparkRecordKeys.has(recordKey))) {
        return;
      }
      if (isTargetSixStarPull(pull, pullPoolType)) {
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
  const winRate = realTotalSix > 0 ? (realLimited / realTotalSix * 100).toFixed(1) : 0;

  let bonusGiftsLimited = 0;
  let bonusGiftsStandard = 0;

  if (!currentPool.isGroupMode) {
    if (isLimitedPool) {
      bonusGiftsLimited = Math.floor(paidTotal / 240);
    } else if (isExtraPool) {
      bonusGiftsLimited = 0;
    } else if (isWeaponPool) {
      if (paidTotal >= 100) bonusGiftsStandard++;
      if (paidTotal >= 180) {
        bonusGiftsLimited++;
        const extraPulls = paidTotal - 180;
        const extraCycles = Math.floor(extraPulls / 80);
        bonusGiftsStandard += Math.ceil(extraCycles / 2);
        bonusGiftsLimited += Math.floor(extraCycles / 2);
      }
    } else if (isStandardPool) {
      if (paidTotal >= 300) {
        bonusGiftsStandard++;
      }
    }
  }

  const gifts = {
    count: bonusGiftsLimited + bonusGiftsStandard,
    limitedCount: bonusGiftsLimited,
    standardCount: bonusGiftsStandard
  };

  const sixStarPulls = [];
  const upSixStarHits = [];
  const limitedSixStarHits = [];
  const limitedSixStarIntervalTracker = createHitIntervalTracker();
  const targetSixStarIntervalTracker = createHitIntervalTracker();
  let tempCounter = 0;
  let targetScopeTotal = 0;
  let limitedScopeTotal = 0;

  validPullsList.forEach(pull => {
    const isFree = isFreePull(pull);
    const pullPoolType = getPullPoolType(pull);
    if (!isFree) {
      tempCounter++;
      recordHitIntervalPull(targetSixStarIntervalTracker);
      recordHitIntervalPull(limitedSixStarIntervalTracker);
    }
    if (isTargetCapablePool(pullPoolType)) {
      targetScopeTotal++;
    }
    if (isLimitedCharacterPool(pullPoolType)) {
      limitedScopeTotal++;
    }
    if (pull.rarity === 6) {
      const isUp = isTargetSixStarPull(pull, pullPoolType);
      const recordKey = getHistoryRecordKey(pull);
      const isSpark = recordKey ? limitedSparkRecordKeys.has(recordKey) : false;
      const isActuallyLimited = isLimitedSixStarPull(pull, pullPoolType, resolveCharacter);

      const inheritedSixStarCount = isLimitedPool
        ? limitedCrossPoolPityMap?.get(getHistoryRecordKey(pull))
        : null;
      const fallbackSixStarCount = isFree ? 30 : tempCounter;
      const effectiveSixStarCount = Number.isFinite(inheritedSixStarCount) && inheritedSixStarCount > 0
        ? inheritedSixStarCount
        : fallbackSixStarCount;
      const pullRecord = {
        count: effectiveSixStarCount,
        isStandard: pull.isStandard,
        isGuaranteed: isGuaranteedPull(pull),
        isSpark
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

  const pullCounts = sixStarPulls.map(s => s.count);
  const maxPityRecorded = pullCounts.length > 0 ? Math.max(...pullCounts) : 0;
  const minPityRecorded = pullCounts.length > 0 ? Math.min(...pullCounts) : 0;
  const avgPityRecorded = pullCounts.length > 0
    ? (pullCounts.reduce((a, b) => a + b, 0) / pullCounts.length).toFixed(1)
    : 0;

  const avgAllSixStar = pullCounts.length > 0
    ? (pullCounts.reduce((sum, value) => sum + value, 0) / pullCounts.length).toFixed(2)
    : '0';

  const sparkCount = upSixStarHits.filter(p => p.isSpark).length;
  const upHitCount = upSixStarHits.length;
  const nonSparkUpHitCount = upSixStarHits.filter((pull) => !pull.isSpark).length;
  const limitedSixStarHitCount = limitedSixStarHits.length;
  const nonSparkLimitedSixStarHitCount = limitedSixStarHits.filter((pull) => !pull.isSpark).length;

  const avgUpSixStar = upHitCount > 0
    ? ((targetScopeTotal || total) / upHitCount).toFixed(2)
    : '0';
  const avgUpSixStarExcludingSpark = nonSparkUpHitCount > 0
    ? ((targetScopeTotal || total) / nonSparkUpHitCount).toFixed(2)
    : '0';
  const avgLimitedSixStar = nonSparkLimitedSixStarHitCount > 0
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
    ...(!isStandardPool ? [{ name: '6星(限定)', kind: 'target-six', value: counts[6], color: RARITY_CONFIG[6].color, originalValue: counts[6] }] : []),
    { name: '6星(常驻)', kind: 'offrate-six', value: counts['6_std'], color: RARITY_CONFIG['6_std'].color, originalValue: counts['6_std'] },
    { name: '5星', kind: 'five-star', value: counts[5], color: RARITY_CONFIG[5].color, originalValue: counts[5] },
    { name: '4星', kind: 'four-star', value: counts[4], color: RARITY_CONFIG[4].color, originalValue: counts[4] },
  ].filter(item => item.value > 0);

  const chartData = rawChartData.map(item => {
    const totalValue = rawChartData.reduce((sum, d) => sum + d.value, 0);
    const currentPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
    let minPercent = 0;
    if (item.name.includes('6星')) minPercent = 15;
    else if (item.name.includes('5星')) minPercent = 20;

    if (currentPercent < minPercent && totalValue > 0) {
      return { ...item, displayValue: Math.ceil(totalValue * minPercent / 100) };
    }
    return { ...item, displayValue: item.value };
  });

  const hardPityLimit = isWeaponPool
    ? WEAPON_POOL_RULES.sixStarPity
    : isExtraPool
      ? EXTRA_POOL_RULES.sixStarPity
      : LIMITED_POOL_RULES.sixStarPity;
  const distributionData = [];
  if (sixStarPulls.length > 0) {
    const numBuckets = Math.ceil(hardPityLimit / 10);
    for (let i = 0; i < numBuckets; i++) {
      const rangeStart = i * 10 + 1;
      const rangeEnd = (i + 1) * 10;
      const isLast = i === numBuckets - 1;
      const items = sixStarPulls.filter(p =>
        isLast ? p.count >= rangeStart : p.count >= rangeStart && p.count <= rangeEnd
      );
      distributionData.push({
        range: `${rangeStart}-${rangeEnd}`,
        count: items.length,
        limited: items.filter(p => !p.isStandard).length,
        standard: items.filter(p => p.isStandard).length,
        guaranteed: items.filter(p => p.isGuaranteed).length
      });
    }
  }

  const probabilityInfo = currentPool.isGroupMode ? null : calculateCurrentProbability(currentPity, normalizedPoolType);

  const infoBookThreshold = LIMITED_POOL_RULES.infoBookThreshold;
  const hasInfoBook = !currentPool.isGroupMode && isLimitedPool && paidTotal >= infoBookThreshold;
  const pullsUntilInfoBook = !currentPool.isGroupMode && isLimitedPool && !hasInfoBook
    ? infoBookThreshold - paidTotal
    : 0;

  const stats = {
    total,
    paidTotal,
    freePullCount,
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
      distribution: distributionData
    },
    probabilityInfo,
    hasInfoBook,
    pullsUntilInfoBook,
    gifts,
    bonusGifts: {
      limited: bonusGiftsLimited,
      standard: bonusGiftsStandard
    },
    resourceSummary
  };

  let inheritedPityInfo;
  if (!currentPool || !isLimitedPool) {
    inheritedPityInfo = { inheritedPity: 0, inheritedPity5: 0, hasInheritedPity: false };
  } else {
    const validLimitedPulls = allLimitedHistory.filter(item =>
      item.specialType !== 'gift' &&
      item.special_type !== 'gift' &&
      item.isFree !== true &&
      item.is_free !== true
    );

    if (validLimitedPulls.length === 0) {
      inheritedPityInfo = { inheritedPity: 0, inheritedPity5: 0, hasInheritedPity: false };
    } else {
      const inheritedPity = calculatePityFromHistory(validLimitedPulls);
      const inheritedPity5 = calculatePity5FromHistory(validLimitedPulls);

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
        hasInheritedPity: inheritedPity > 0 && lastSixStarPoolId !== currentPoolId
      };
    }
  }

  const effectivePity = isLimitedPool
    ? {
        pity6: inheritedPityInfo.inheritedPity,
        pity5: inheritedPityInfo.inheritedPity5,
        isInherited: inheritedPityInfo.hasInheritedPity
      }
    : {
        pity6: stats.currentPity,
        pity5: stats.currentPity5,
        isInherited: false
      };

  return {
    stats,
    inheritedPityInfo,
    effectivePity
  };
}

export default buildPoolStats;
