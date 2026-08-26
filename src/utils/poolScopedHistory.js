import { compareHistoryTimelineAsc } from './historyTimelineSort.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';

function normalizeText(value) {
  return value == null ? '' : String(value).trim();
}

export function getPoolRecordId(pool) {
  return pool?.id || pool?.pool_id || null;
}

export function getHistoryPoolId(record) {
  return record?.poolId || record?.pool_id || null;
}

export function getHistoryRecordKey(record) {
  const value = record?.id || record?.record_id || null;
  return value == null ? null : String(value);
}

export function isPaidHistoryPull(record) {
  const isGift = record?.specialType === 'gift' || record?.special_type === 'gift';
  const isFree = record?.isFree === true
    || record?.is_free === true
    || record?.isFreePull === true
    || record?.is_free_pull === true;
  return !isGift && !isFree;
}

export function isFreeHistoryPull(record) {
  const isGift = record?.specialType === 'gift' || record?.special_type === 'gift';
  const isFree = record?.isFree === true
    || record?.is_free === true
    || record?.isFreePull === true
    || record?.is_free_pull === true;
  return !isGift && isFree;
}

export function getPoolSeriesStateKey(pool) {
  const capabilities = pool?.rulesKey && pool?.rules
    ? pool
    : resolvePoolCapabilities(pool);
  const profile = normalizeText(capabilities?.ruleProfile);
  const seriesKey = normalizeText(capabilities?.seriesKey);

  if (!capabilities?.isResolved || !profile || !seriesKey) {
    return null;
  }

  return `${encodeURIComponent(profile)}::${encodeURIComponent(seriesKey)}`;
}

export function getPoolScopeKind(pool, scopeType = 'pity') {
  const capabilities = resolvePoolCapabilities(pool);
  if (scopeType === 'reward') {
    return capabilities.rewardScope || 'pool';
  }
  if (scopeType === 'target') {
    return capabilities.targetScope || 'pool';
  }
  return capabilities.pityScope || 'pool';
}

function sortPaidTimeline(left, right) {
  const timelineOrder = compareHistoryTimelineAsc(left, right);
  if (timelineOrder !== 0) {
    return timelineOrder;
  }

  const leftSeq = Number(left?.seqId || left?.seq_id || 0);
  const rightSeq = Number(right?.seqId || right?.seq_id || 0);
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }

  return String(getHistoryRecordKey(left) || '').localeCompare(String(getHistoryRecordKey(right) || ''));
}

function buildPoolLookup(pools = [], scopePool = null) {
  const lookup = new Map();
  [...(Array.isArray(pools) ? pools : []), scopePool]
    .filter(Boolean)
    .forEach((pool) => {
      const poolId = getPoolRecordId(pool);
      if (poolId) {
        lookup.set(String(poolId), pool);
      }
    });
  return lookup;
}

function resolveRecordPool(record, poolLookup, scopePool) {
  const recordPoolId = getHistoryPoolId(record);
  if (recordPoolId && poolLookup.has(String(recordPoolId))) {
    return poolLookup.get(String(recordPoolId));
  }

  if (recordPoolId && String(recordPoolId) === String(getPoolRecordId(scopePool))) {
    return scopePool;
  }

  if (
    record?.type
    || record?.pool_type
    || record?.extra_rule_profile
    || record?.extraRuleProfile
  ) {
    return {
      ...record,
      id: recordPoolId || record?.id || null,
      type: record?.poolType || record?.pool_type || record?.type,
    };
  }

  return null;
}

function matchesScope(candidatePool, scopePool, scopeKind, scopeType) {
  if (!candidatePool || !scopePool) {
    return false;
  }

  const scopeCapabilities = resolvePoolCapabilities(scopePool);
  const candidateCapabilities = resolvePoolCapabilities(candidatePool);

  if (scopeKind === 'series') {
    const scopeSeriesKey = getPoolSeriesStateKey(scopeCapabilities);
    return Boolean(scopeSeriesKey) && getPoolSeriesStateKey(candidateCapabilities) === scopeSeriesKey;
  }

  if (scopeKind === 'shared') {
    return scopeType === 'pity' && candidateCapabilities.pityScope === 'shared';
  }

  const scopePoolId = getPoolRecordId(scopePool);
  const candidatePoolId = getPoolRecordId(candidatePool);
  return Boolean(scopePoolId && candidatePoolId) && String(scopePoolId) === String(candidatePoolId);
}

/**
 * 按卡池能力构造付费历史时间线。系列作用域必须同时匹配 profile 与 seriesKey；
 * 缺失 profile、seriesKey 或无法解析来源池的记录不会进入系列时间线。
 */
export function buildScopedPaidHistoryTimeline({
  history = [],
  pools = [],
  pool,
  scopeType = 'pity',
} = {}) {
  if (!pool) {
    return [];
  }

  const scopeKind = getPoolScopeKind(pool, scopeType);
  const poolLookup = buildPoolLookup(pools, pool);

  return (Array.isArray(history) ? history : [])
    .filter(isPaidHistoryPull)
    .filter((record) => matchesScope(
      resolveRecordPool(record, poolLookup, pool),
      pool,
      scopeKind,
      scopeType
    ))
    .sort(sortPaidTimeline);
}

/**
 * 按与付费奖励相同的作用域收集免费记录。重构系列的免费十连领取状态
 * 必须跨阶段统计，不能把系列付费进度与当前池免费记录拼在一起。
 */
export function buildScopedFreeHistoryTimeline({
  history = [],
  pools = [],
  pool,
  scopeType = 'reward',
} = {}) {
  if (!pool) {
    return [];
  }

  const scopeKind = getPoolScopeKind(pool, scopeType);
  const poolLookup = buildPoolLookup(pools, pool);

  return (Array.isArray(history) ? history : [])
    .filter(isFreeHistoryPull)
    .filter((record) => matchesScope(
      resolveRecordPool(record, poolLookup, pool),
      pool,
      scopeKind,
      scopeType
    ))
    .sort(sortPaidTimeline);
}

export function isTargetSixStarHistoryRecord(record, pool) {
  if (Number(record?.rarity) !== 6) {
    return false;
  }

  const capabilities = resolvePoolCapabilities(pool);
  if (!capabilities.isResolved || capabilities.targetMode === 'none') {
    return false;
  }
  if (capabilities.targetMode === 'four-target-equal') {
    return true;
  }
  if (capabilities.targetMode !== 'single-up') {
    return false;
  }

  const upName = normalizeText(pool?.up_character || pool?.upCharacter);
  const itemName = normalizeText(
    record?.character_name
    || record?.characterName
    || record?.item_name
    || record?.itemName
    || record?.name
  );
  if (upName && itemName) {
    return upName.includes(itemName) || itemName.includes(upName);
  }

  if (record?.isUp === true || record?.is_up === true || record?.isLimited === true) {
    return true;
  }

  const standardFlag = record?.isStandard ?? record?.is_standard;
  if (typeof standardFlag === 'boolean') {
    return !standardFlag;
  }
  return false;
}

/**
 * 计算一次性目标保障。目标在阈值前命中后即永久完成；恰好在阈值命中的记录
 * 会进入 guaranteedRecordKeys，供统计排除“不歪率”和继承状态避免重复发放。
 */
export function buildOneTimeTargetGuaranteeState({
  history = [],
  pools = [],
  pool,
  isTargetPull = isTargetSixStarHistoryRecord,
} = {}) {
  const capabilities = resolvePoolCapabilities(pool);
  const threshold = Number(capabilities?.rules?.guaranteedLimitedPity || 0);
  const supported = Boolean(
    capabilities.isResolved
    && capabilities.targetMode === 'single-up'
    && threshold > 0
  );

  if (!supported) {
    return {
      supported: false,
      pity: 0,
      hasReceivedGuaranteedLimited: false,
      guaranteedRecordKeys: new Set(),
      timeline: [],
    };
  }

  const timeline = buildScopedPaidHistoryTimeline({
    history,
    pools,
    pool,
    scopeType: 'target',
  });
  const poolLookup = buildPoolLookup(pools, pool);
  const guaranteedRecordKeys = new Set();
  let pity = 0;
  let hasReceivedGuaranteedLimited = false;

  for (const record of timeline) {
    if (hasReceivedGuaranteedLimited) {
      break;
    }

    pity = Math.min(pity + 1, threshold);
    const sourcePool = resolveRecordPool(record, poolLookup, pool) || pool;
    if (!isTargetPull(record, sourcePool)) {
      continue;
    }

    if (pity === threshold) {
      const recordKey = getHistoryRecordKey(record);
      if (recordKey) {
        guaranteedRecordKeys.add(recordKey);
      }
    }
    hasReceivedGuaranteedLimited = true;
  }

  return {
    supported: true,
    pity,
    hasReceivedGuaranteedLimited,
    guaranteedRecordKeys,
    timeline,
  };
}

export function calculatePaidTimelinePity(timeline = []) {
  let sixStarPity = 0;
  let fiveStarPity = 0;

  (Array.isArray(timeline) ? timeline : []).forEach((record) => {
    const rarity = Number(record?.rarity) || 0;
    sixStarPity = rarity >= 6 ? 0 : sixStarPity + 1;
    fiveStarPity = rarity >= 5 ? 0 : fiveStarPity + 1;
  });

  return { sixStarPity, fiveStarPity };
}

export function buildPaidTimelinePityMap(timeline = []) {
  const pityMap = new Map();
  let sixStarPity = 0;
  let fiveStarPity = 0;

  (Array.isArray(timeline) ? timeline : []).forEach((record) => {
    const rarity = Number(record?.rarity) || 0;
    sixStarPity += 1;
    fiveStarPity += 1;
    const recordKey = getHistoryRecordKey(record);

    if (rarity >= 5 && recordKey) {
      pityMap.set(recordKey, {
        sixStarPity: rarity >= 6 ? sixStarPity : null,
        fiveStarPity,
      });
    }

    if (rarity >= 6) {
      sixStarPity = 0;
    }
    if (rarity >= 5) {
      fiveStarPity = 0;
    }
  });

  return pityMap;
}

export default {
  buildOneTimeTargetGuaranteeState,
  buildPaidTimelinePityMap,
  buildScopedFreeHistoryTimeline,
  buildScopedPaidHistoryTimeline,
  calculatePaidTimelinePity,
  getPoolSeriesStateKey,
  isFreeHistoryPull,
  isPaidHistoryPull,
  isTargetSixStarHistoryRecord,
};
