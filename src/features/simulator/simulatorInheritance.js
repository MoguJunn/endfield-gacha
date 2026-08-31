import { LIMITED_POOL_RULES, STANDARD_POOL_RULES, WEAPON_POOL_RULES } from '../../constants/index.js';
import { isGameAccountSelectionMatch } from '../../utils/gameAccountMetadata.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import {
  buildOneTimeTargetGuaranteeState,
  buildScopedPaidHistoryTimeline,
  calculatePaidTimelinePity,
  isTargetSixStarHistoryRecord,
} from '../../utils/poolScopedHistory.js';
import { buildSimulatorSeriesState } from './simulatorSeriesState.js';

function getHistoryPoolId(item) {
  return item?.poolId || item?.pool_id || null;
}

function getHistorySeqId(item) {
  return parseInt(item?.seqId || item?.seq_id || '0', 10) || 0;
}

function getHistoryTimestamp(item) {
  if (typeof item?.timestamp === 'number') {
    return item.timestamp;
  }

  const value = new Date(item?.timestamp || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function getHistoryName(item) {
  return item?.character_name || item?.characterName || item?.item_name || item?.name || '未知对象';
}

function isGiftRecord(item) {
  return item?.specialType === 'gift' || item?.special_type === 'gift';
}

function isFreeRecord(item) {
  return item?.isFree === true || item?.is_free === true;
}

function normalizeRecordRarity(item) {
  return Number(item?.rarity) || 0;
}

function normalizeHistoryIsStandard(record, pool) {
  if (normalizeRecordRarity(record) !== 6) {
    return false;
  }
  return !isTargetSixStarHistoryRecord(record, pool);
}

function calculatePityFromPaidHistory(records) {
  let pity = 0;

  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (normalizeRecordRarity(records[index]) === 6) {
      break;
    }
    pity += 1;
  }

  return pity;
}

function calculatePity5FromPaidHistory(records) {
  let pity = 0;

  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (normalizeRecordRarity(records[index]) >= 5) {
      break;
    }
    pity += 1;
  }

  return pity;
}

function matchesSelectedGameAccount(item, currentGameUid) {
  if (!currentGameUid) {
    return true;
  }

  return isGameAccountSelectionMatch(item, currentGameUid);
}

function matchesCurrentUser(item, currentUserId) {
  if (!currentUserId) {
    return true;
  }

  if (!item?.user_id) {
    return true;
  }

  return item.user_id === currentUserId;
}

function sortByTimeline(left, right) {
  const timeDiff = getHistoryTimestamp(left) - getHistoryTimestamp(right);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const seqDiff = getHistorySeqId(left) - getHistorySeqId(right);
  if (seqDiff !== 0) {
    return seqDiff;
  }

  return String(left?.id || left?.record_id || '').localeCompare(String(right?.id || right?.record_id || ''));
}

function getPaidPulls(records) {
  return (records || [])
    .filter((item) => !isGiftRecord(item) && !isFreeRecord(item))
    .sort(sortByTimeline);
}

function getWeaponGiftCount(totalPulls) {
  let standardGifts = 0;
  let limitedGifts = 0;

  if (totalPulls >= WEAPON_POOL_RULES.firstStandardGift) {
    standardGifts += 1;
  }

  if (totalPulls >= WEAPON_POOL_RULES.firstLimitedGift) {
    limitedGifts += 1;
    const cycleGifts = Math.floor((totalPulls - WEAPON_POOL_RULES.firstLimitedGift) / WEAPON_POOL_RULES.giftAlternateInterval);
    standardGifts += Math.ceil(cycleGifts / 2);
    limitedGifts += Math.floor(cycleGifts / 2);
  }

  return standardGifts + limitedGifts;
}

function countPaidPullsByPool(records) {
  return records.reduce((accumulator, item) => {
    const poolId = getHistoryPoolId(item);
    if (!poolId) {
      return accumulator;
    }

    accumulator.set(poolId, (accumulator.get(poolId) || 0) + 1);
    return accumulator;
  }, new Map());
}

function toSimulatorPullHistory(records, pool) {
  return records.map((item, index) => {
    const rarity = normalizeRecordRarity(item);
    const isUp = rarity === 6
      ? !normalizeHistoryIsStandard(item, pool)
      : false;

    return {
      pullNumber: index + 1,
      rarity,
      isUp,
      isLimited: isUp,
      characterName: getHistoryName(item),
      timestamp: item?.timestamp || getHistoryTimestamp(item)
    };
  });
}

function getRelevantHistory(history, currentGameUid, currentUserId) {
  const historyArray = Array.isArray(history) ? history : [];

  return historyArray.filter((item) =>
    matchesCurrentUser(item, currentUserId) &&
    matchesSelectedGameAccount(item, currentGameUid)
  );
}

function getSimulatorPoolId(realPoolId) {
  return realPoolId ? `sim_${realPoolId}` : null;
}

function buildInheritedStateForPool({
  currentPool,
  relevantHistory,
  poolMap,
  limitedPoolPullCounts,
  currentSimPoolId = null,
  includePullHistory = true,
}) {
  const realPoolId = currentPool?.id;
  if (!realPoolId) {
    return null;
  }

  const capabilities = resolvePoolCapabilities(currentPool);
  const normalizedPoolType = capabilities.basePoolType;
  const poolsArray = Array.from(poolMap.values());
  const currentPoolPaidHistory = getPaidPulls(
    relevantHistory.filter((item) => getHistoryPoolId(item) === realPoolId)
  );
  const referenceTimeline = buildScopedPaidHistoryTimeline({
    history: relevantHistory,
    pools: poolsArray,
    pool: currentPool,
    scopeType: 'pity',
  });
  const rewardTimeline = buildScopedPaidHistoryTimeline({
    history: relevantHistory,
    pools: poolsArray,
    pool: currentPool,
    scopeType: 'reward',
  });
  const guaranteedLimitedState = buildOneTimeTargetGuaranteeState({
    history: relevantHistory,
    pools: poolsArray,
    pool: currentPool,
    isTargetPull: isTargetSixStarHistoryRecord,
  });
  const rewardPaidCount = rewardTimeline.length;

  if (
    currentPoolPaidHistory.length === 0
    && referenceTimeline.length === 0
    && rewardTimeline.length === 0
    && guaranteedLimitedState.timeline.length === 0
  ) {
    return null;
  }

  const simulatorPullHistory = toSimulatorPullHistory(currentPoolPaidHistory, currentPool);
  const currentPoolPaidCount = currentPoolPaidHistory.length;
  const sixStarCount = simulatorPullHistory.filter((item) => item.rarity === 6).length;
  const fiveStarCount = simulatorPullHistory.filter((item) => item.rarity === 5).length;
  const upSixStarCount = simulatorPullHistory.filter((item) => item.rarity === 6 && item.isUp).length;
  const currentSimPoolKey = getSimulatorPoolId(realPoolId);
  const inheritedPity = calculatePaidTimelinePity(referenceTimeline);

  const baseState = {
    poolType: normalizedPoolType,
    extraRuleProfile: capabilities.ruleProfile,
    extraSeriesKey: capabilities.seriesKey,
    sixStarPity: inheritedPity.sixStarPity,
    fiveStarPity: inheritedPity.fiveStarPity,
    isGuaranteedUp: false,
    guaranteedLimitedPity: guaranteedLimitedState.pity,
    hasReceivedGuaranteedLimited: guaranteedLimitedState.hasReceivedGuaranteedLimited,
    totalPulls: currentPoolPaidCount,
    seriesRewardPulls: capabilities.rewardScope === 'series' ? rewardPaidCount : 0,
    sixStarCount,
    fiveStarCount,
    upSixStarCount,
    giftsReceived: normalizedPoolType === 'limited'
      ? Math.floor(rewardPaidCount / Number(capabilities.rules.giftInterval || Infinity))
      : normalizedPoolType === 'weapon'
        ? getWeaponGiftCount(rewardPaidCount)
        : 0,
    freeTenPullsReceived: capabilities.freeTenPullMilestones
      .filter((threshold) => (
        capabilities.rewardScope === 'series' ? rewardPaidCount : currentPoolPaidCount
      ) >= threshold).length,
    hasReceivedInfoBook: capabilities.infoBookEnabled
      ? (limitedPoolPullCounts.get(realPoolId) || 0) >= Number(capabilities.rules.infoBookThreshold || Infinity)
      : false,
    hasUnactivatedInfoBook: false,
    infoBookTenPullAvailable: false,
    hasUsedInfoBookTenPull: false,
    hasReceivedSelectGift: normalizedPoolType === 'standard'
      ? currentPoolPaidCount >= STANDARD_POOL_RULES.selectGiftThreshold
      : false,
    pullHistory: includePullHistory ? simulatorPullHistory : []
  };

  if (currentSimPoolKey && currentSimPoolKey === currentSimPoolId) {
    return {
      ...baseState,
      infoBookTenPullAvailable: false
    };
  }

  return baseState;
}

function buildInheritedInfoBookState({
  poolsArray,
  limitedPoolPullCounts,
  currentSimPoolId = null
}) {
  const orderedLimitedPools = [...poolsArray]
    .filter((pool) => resolvePoolCapabilities(pool).infoBookEnabled)
    .sort((left, right) => {
      const leftTime = left.start_time ? new Date(left.start_time).getTime() : 0;
      const rightTime = right.start_time ? new Date(right.start_time).getTime() : 0;
      return leftTime - rightTime;
    });

  return orderedLimitedPools.reduce((accumulator, pool, index) => {
    const paidPullCount = limitedPoolPullCounts.get(pool.id) || 0;
    const nextPool = orderedLimitedPools[index + 1];

    if (paidPullCount < LIMITED_POOL_RULES.infoBookThreshold || !nextPool) {
      return accumulator;
    }

    const targetPoolId = getSimulatorPoolId(nextPool.id);
    accumulator[getSimulatorPoolId(pool.id)] = {
      activated: targetPoolId === currentSimPoolId,
      used: false,
      targetPoolId,
      obtainedAt: 0
    };

    return accumulator;
  }, {});
}

export function normalizeSimulatorPoolType(type) {
  if (type === 'extra') {
    return 'extra';
  }

  if (type === 'limited_character' || type === 'limited') {
    return 'limited';
  }

  if (type === 'limited_weapon' || type === 'weapon') {
    return 'weapon';
  }

  if (type === 'beginner' || type === 'standard' || type === 'standard_pool') {
    return 'standard';
  }

  return type || 'standard';
}

export function buildInheritedSimulatorSnapshot({
  history,
  realPools,
  currentGameUid,
  currentUserId,
  currentSimPoolId = null,
  includePullHistory = true,
}) {
  const poolsArray = Array.isArray(realPools) ? realPools : [];
  const relevantHistory = getRelevantHistory(history, currentGameUid, currentUserId);
  const poolMap = new Map(poolsArray.map((pool) => [pool.id, pool]));
  const limitedPoolIds = new Set(
    poolsArray
      .filter((pool) => normalizeSimulatorPoolType(pool.type) === 'limited')
      .map((pool) => pool.id)
  );
  const limitedPoolPullCounts = countPaidPullsByPool(
    getPaidPulls(
      relevantHistory.filter((item) => limitedPoolIds.has(getHistoryPoolId(item)))
    )
  );

  const statesByPoolId = poolsArray.reduce((accumulator, pool) => {
    const inheritedState = buildInheritedStateForPool({
      currentPool: pool,
      relevantHistory,
      poolMap,
      limitedPoolPullCounts,
      currentSimPoolId,
      includePullHistory,
    });

    if (inheritedState) {
      accumulator[getSimulatorPoolId(pool.id)] = inheritedState;
    }

    return accumulator;
  }, {});

  const limitedReferenceTimeline = getPaidPulls(
    relevantHistory.filter((item) => limitedPoolIds.has(getHistoryPoolId(item)))
  );

  const sharedPityState = limitedReferenceTimeline.length > 0
    ? {
        sixStarPity: calculatePityFromPaidHistory(limitedReferenceTimeline),
        fiveStarPity: calculatePity5FromPaidHistory(limitedReferenceTimeline)
      }
    : null;

  const infoBooks = buildInheritedInfoBookState({
    poolsArray,
    limitedPoolPullCounts,
    currentSimPoolId
  });
  const seriesStates = poolsArray.reduce((accumulator, pool) => {
    const inheritedState = statesByPoolId[getSimulatorPoolId(pool.id)];
    const seriesState = inheritedState ? buildSimulatorSeriesState(pool, inheritedState) : null;
    if (seriesState?.seriesStateKey) {
      accumulator[seriesState.seriesStateKey] = seriesState;
    }
    return accumulator;
  }, {});

  if (currentSimPoolId && Object.values(infoBooks).some((book) => book.targetPoolId === currentSimPoolId && book.activated)) {
    const currentState = statesByPoolId[currentSimPoolId];
    if (currentState) {
      statesByPoolId[currentSimPoolId] = {
        ...currentState,
        infoBookTenPullAvailable: true
      };
    }
  }

  return {
    statesByPoolId,
    sharedPityState,
    seriesStates,
    infoBooks,
    hasAnyData: Object.keys(statesByPoolId).length > 0
  };
}

export function activateInheritedSimulatorSnapshot(snapshot, currentSimPoolId = null) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const statesByPoolId = Object.fromEntries(
    Object.entries(snapshot.statesByPoolId || {}).map(([poolId, state]) => [poolId, { ...state }])
  );
  const infoBooks = Object.fromEntries(
    Object.entries(snapshot.infoBooks || {}).map(([poolId, state]) => [poolId, { ...state }])
  );

  if (currentSimPoolId) {
    Object.values(infoBooks).forEach((book) => {
      if (book?.targetPoolId === currentSimPoolId && book.used !== true) {
        book.activated = true;
        const currentState = statesByPoolId[currentSimPoolId];
        if (currentState) {
          statesByPoolId[currentSimPoolId] = {
            ...currentState,
            infoBookTenPullAvailable: true,
          };
        }
      }
    });
  }

  return {
    ...snapshot,
    statesByPoolId,
    infoBooks,
    seriesStates: Object.fromEntries(
      Object.entries(snapshot.seriesStates || {}).map(([key, state]) => [key, { ...state }])
    ),
    sharedPityState: snapshot.sharedPityState ? { ...snapshot.sharedPityState } : null,
    hasAnyData: Object.keys(statesByPoolId).length > 0,
  };
}

export function buildInheritedSimulatorState({
  history,
  realPools,
  currentSimPool,
  currentGameUid,
  currentUserId
}) {
  const realPoolId = currentSimPool?.id?.replace(/^sim_/, '');
  if (!realPoolId) {
    return null;
  }
  const snapshot = buildInheritedSimulatorSnapshot({
    history,
    realPools,
    currentGameUid,
    currentUserId,
    currentSimPoolId: currentSimPool?.id || null
  });

  return snapshot.statesByPoolId[currentSimPool.id] || null;
}

export default {
  activateInheritedSimulatorSnapshot,
  buildInheritedSimulatorSnapshot,
  buildInheritedSimulatorState,
  normalizeSimulatorPoolType
};
