import {
  filterHistoryForEffectiveGameUid,
  resolveEffectiveGameUid,
} from './accountScopeUtils.js';
import { annotateInfoBookPulls } from './historyInfoBook.js';
import { compareHistoryTimelineAsc } from './historyTimelineSort.js';

const EMPTY_ARRAY = Object.freeze([]);
const LIMITED_POOL_TYPES = new Set(['limited', 'limited_character']);

let historyIndexCache = new WeakMap();

function getPoolId(pool) {
  return pool?.id || pool?.pool_id || null;
}

function getHistoryPoolId(item) {
  return item?.poolId || item?.pool_id || null;
}

function getHistorySeqId(item) {
  return parseInt(item?.seqId || item?.seq_id || '0', 10) || 0;
}

function sortByTimeline(left, right) {
  const timelineDiff = compareHistoryTimelineAsc(left, right);
  if (timelineDiff !== 0) {
    return timelineDiff;
  }

  return getHistorySeqId(left) - getHistorySeqId(right);
}

function asArray(value) {
  return Array.isArray(value) ? value : EMPTY_ARRAY;
}

/**
 * 为当前用户和游戏账号构建一次可复用的历史派生索引。
 * 该函数不缓存，便于独立测试和在一次性数据处理中使用。
 */
export function buildHistoryIndex({
  history = EMPTY_ARRAY,
  pools = EMPTY_ARRAY,
  userId = null,
  currentGameUid = null,
} = {}) {
  const historyArray = asArray(history);
  const poolsArray = asArray(pools);
  const ownedHistoryArray = userId
    ? historyArray.filter((item) => item?.user_id === userId)
    : [];
  const effectiveGameUid = resolveEffectiveGameUid({
    currentGameUid,
    historyRecords: ownedHistoryArray,
  });
  const accountHistoryArray = userId
    ? filterHistoryForEffectiveGameUid(ownedHistoryArray, effectiveGameUid)
    : [];
  const annotatedAccountHistoryArray = annotateInfoBookPulls(accountHistoryArray, poolsArray);
  const sortedAccountHistoryArray = annotatedAccountHistoryArray.slice().sort(sortByTimeline);
  const historyByPoolId = new Map();

  sortedAccountHistoryArray.forEach((item) => {
    const poolId = getHistoryPoolId(item);
    if (!poolId) {
      return;
    }

    const poolHistory = historyByPoolId.get(poolId);
    if (poolHistory) {
      poolHistory.push(item);
    } else {
      historyByPoolId.set(poolId, [item]);
    }
  });

  const poolById = new Map(
    poolsArray
      .map((pool) => [getPoolId(pool), pool])
      .filter(([poolId]) => Boolean(poolId))
  );
  const limitedPoolIds = new Set(
    poolsArray
      .filter((pool) => LIMITED_POOL_TYPES.has(pool?.type))
      .map(getPoolId)
      .filter(Boolean)
  );
  const allLimitedHistory = sortedAccountHistoryArray.filter((item) => (
    limitedPoolIds.has(getHistoryPoolId(item))
  ));

  return {
    historyArray,
    poolsArray,
    ownedHistoryArray,
    effectiveGameUid,
    accountHistoryArray,
    annotatedAccountHistoryArray,
    sortedAccountHistoryArray,
    historyByPoolId,
    poolById,
    allLimitedHistory,
  };
}

/**
 * 按 history/pools 引用及账号范围复用派生结果。
 */
export function getCachedHistoryIndex(options = {}) {
  const history = asArray(options.history);
  const pools = asArray(options.pools);
  const userId = options.userId ?? null;
  const currentGameUid = options.currentGameUid ?? null;

  let poolsCache = historyIndexCache.get(history);
  if (!poolsCache) {
    poolsCache = new WeakMap();
    historyIndexCache.set(history, poolsCache);
  }

  let userCache = poolsCache.get(pools);
  if (!userCache) {
    userCache = new Map();
    poolsCache.set(pools, userCache);
  }

  let gameUidCache = userCache.get(userId);
  if (!gameUidCache) {
    gameUidCache = new Map();
    userCache.set(userId, gameUidCache);
  }

  if (gameUidCache.has(currentGameUid)) {
    return gameUidCache.get(currentGameUid);
  }

  const index = buildHistoryIndex({
    history,
    pools,
    userId,
    currentGameUid,
  });
  gameUidCache.set(currentGameUid, index);
  return index;
}

export function clearHistoryIndexCache() {
  historyIndexCache = new WeakMap();
}

export default getCachedHistoryIndex;
