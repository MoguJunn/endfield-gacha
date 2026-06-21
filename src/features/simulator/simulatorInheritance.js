import {
  EXTRA_POOL_RULES,
  LIMITED_POOL_RULES,
  STANDARD_POOL_RULES,
  WEAPON_POOL_RULES
} from '../../constants/index.js';
import { isGameAccountSelectionMatch } from '../../utils/gameAccountMetadata.js';

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

function normalizeHistoryIsStandard(record, poolType, upCharacter) {
  if (normalizeRecordRarity(record) !== 6) {
    return false;
  }

  if (poolType === 'extra') {
    return false;
  }

  if (poolType === 'standard' || poolType === 'beginner') {
    return true;
  }

  if (poolType === 'limited' || poolType === 'limited_character' || poolType === 'weapon' || poolType === 'limited_weapon') {
    if (upCharacter) {
      const characterName = getHistoryName(record);
      return !characterName.includes(upCharacter) && !upCharacter.includes(characterName);
    }

    if (record?.isLimited !== undefined) {
      return !record.isLimited;
    }

    return false;
  }

  return false;
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

function calculateGuaranteedLimitedState(records, rules) {
  const threshold = Number(rules?.guaranteedLimitedPity || 0);
  if (threshold <= 0 || records.length === 0) {
    return {
      pity: 0,
      hasReceivedGuaranteedLimited: false
    };
  }

  let pity = 0;
  let hasReceivedGuaranteedLimited = false;

  records.some((item) => {
    pity = Math.min(pity + 1, threshold);

    if (item.__simulatorIsUp) {
      hasReceivedGuaranteedLimited = true;
      return true;
    }

    return false;
  });

  return {
    pity,
    hasReceivedGuaranteedLimited
  };
}

function toSimulatorPullHistory(records, pool) {
  return records.map((item, index) => {
    const rarity = normalizeRecordRarity(item);
    const isUp = rarity === 6
      ? !normalizeHistoryIsStandard(item, pool?.type, pool?.up_character)
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

function buildReferenceTimeline(records, poolIds, currentPoolId, normalizedPoolType) {
  if (normalizedPoolType === 'limited') {
    return getPaidPulls(records.filter((item) => poolIds.has(getHistoryPoolId(item))));
  }

  return getPaidPulls(records.filter((item) => getHistoryPoolId(item) === currentPoolId));
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
  limitedPoolIds,
  limitedPoolPullCounts,
  currentSimPoolId = null
}) {
  const realPoolId = currentPool?.id;
  if (!realPoolId) {
    return null;
  }

  const normalizedPoolType = normalizeSimulatorPoolType(currentPool.type);
  const currentPoolPaidHistory = getPaidPulls(
    relevantHistory.filter((item) => getHistoryPoolId(item) === realPoolId)
  );
  const currentPoolTimeline = currentPoolPaidHistory.map((item) => ({
    ...item,
    __simulatorIsUp: normalizeRecordRarity(item) === 6
      ? !normalizeHistoryIsStandard(item, currentPool.type, currentPool.up_character)
      : false
  }));

  const referenceTimeline = buildReferenceTimeline(relevantHistory, limitedPoolIds, realPoolId, normalizedPoolType)
    .map((item) => {
      const sourcePool = poolMap.get(getHistoryPoolId(item)) || currentPool;

      return {
        ...item,
        __simulatorIsUp: normalizeRecordRarity(item) === 6
          ? !normalizeHistoryIsStandard(item, sourcePool.type, sourcePool.up_character)
          : false
      };
    });

  if (currentPoolPaidHistory.length === 0 && referenceTimeline.length === 0) {
    return null;
  }

  const simulatorPullHistory = toSimulatorPullHistory(currentPoolPaidHistory, currentPool);
  const currentPoolPaidCount = currentPoolPaidHistory.length;
  const sixStarCount = simulatorPullHistory.filter((item) => item.rarity === 6).length;
  const fiveStarCount = simulatorPullHistory.filter((item) => item.rarity === 5).length;
  const upSixStarCount = simulatorPullHistory.filter((item) => item.rarity === 6 && item.isUp).length;
  const currentSimPoolKey = getSimulatorPoolId(realPoolId);
  const guaranteedLimitedState = normalizedPoolType === 'limited' || normalizedPoolType === 'weapon'
    ? calculateGuaranteedLimitedState(currentPoolTimeline, normalizedPoolType === 'weapon' ? WEAPON_POOL_RULES : LIMITED_POOL_RULES)
    : { pity: 0, hasReceivedGuaranteedLimited: false };

  const baseState = {
    poolType: currentPool.type,
    sixStarPity: calculatePityFromPaidHistory(referenceTimeline),
    fiveStarPity: calculatePity5FromPaidHistory(referenceTimeline),
    isGuaranteedUp: false,
    guaranteedLimitedPity: guaranteedLimitedState.pity,
    hasReceivedGuaranteedLimited: guaranteedLimitedState.hasReceivedGuaranteedLimited,
    totalPulls: currentPoolPaidCount,
    sixStarCount,
    fiveStarCount,
    upSixStarCount,
    giftsReceived: normalizedPoolType === 'limited'
      ? Math.floor(currentPoolPaidCount / LIMITED_POOL_RULES.giftInterval)
      : normalizedPoolType === 'weapon'
        ? getWeaponGiftCount(currentPoolPaidCount)
        : 0,
    freeTenPullsReceived: normalizedPoolType === 'limited'
      ? Math.min(Math.floor(currentPoolPaidCount / LIMITED_POOL_RULES.freeTenPullInterval), 1)
      : normalizedPoolType === 'extra'
        ? Math.min(Math.floor(currentPoolPaidCount / EXTRA_POOL_RULES.freeTenPullInterval), 1)
      : 0,
    hasReceivedInfoBook: normalizedPoolType === 'limited'
      ? (limitedPoolPullCounts.get(realPoolId) || 0) >= LIMITED_POOL_RULES.infoBookThreshold
      : false,
    hasUnactivatedInfoBook: false,
    infoBookTenPullAvailable: false,
    hasUsedInfoBookTenPull: false,
    hasReceivedSelectGift: normalizedPoolType === 'standard'
      ? currentPoolPaidCount >= STANDARD_POOL_RULES.selectGiftThreshold
      : false,
    pullHistory: simulatorPullHistory
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
    .filter((pool) => normalizeSimulatorPoolType(pool.type) === 'limited')
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
  currentSimPoolId = null
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
      limitedPoolIds,
      limitedPoolPullCounts,
      currentSimPoolId
    });

    if (inheritedState) {
      accumulator[getSimulatorPoolId(pool.id)] = inheritedState;
    }

    return accumulator;
  }, {});

  const limitedReferenceTimeline = buildReferenceTimeline(
    relevantHistory,
    limitedPoolIds,
    null,
    'limited'
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
    infoBooks,
    hasAnyData: Object.keys(statesByPoolId).length > 0
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
  buildInheritedSimulatorSnapshot,
  buildInheritedSimulatorState,
  normalizeSimulatorPoolType
};
