import { compareHistoryTimelineAsc } from './historyTimelineSort.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import {
  collectForcedUpRecordKeysFromTimeline,
  getForcedUpFloor,
  isFreeHistoryRecord,
  isGiftHistoryRecord,
  isPaidHistoryRecord,
} from './gachaRuleContracts.js';

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
  return isPaidHistoryRecord(record);
}

export function isFreeHistoryPull(record) {
  return !isGiftHistoryRecord(record) && isFreeHistoryRecord(record);
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
 * 计算一次性目标保障。目标在阈值前命中后即永久完成；
 * 首个目标命中的累计付费抽数达到硬保底 floor（限定 120 / 武器 71 起）时，
 * 该记录进入 guaranteedRecordKeys，供统计排除“不歪率”和继承状态避免重复发放。
 * floor 口径统一来自 gachaRuleContracts.getForcedUpFloor。
 */
export function buildOneTimeTargetGuaranteeState({
  history = [],
  pools = [],
  pool,
  isTargetPull = isTargetSixStarHistoryRecord,
} = {}) {
  const capabilities = resolvePoolCapabilities(pool);
  const threshold = Number(capabilities?.rules?.guaranteedLimitedPity || 0);
  const forcedUpFloor = getForcedUpFloor(capabilities?.rules);
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
  let cumulativePaidPulls = 0;
  let hasReceivedGuaranteedLimited = false;

  for (const record of timeline) {
    if (hasReceivedGuaranteedLimited) {
      break;
    }

    cumulativePaidPulls += 1;
    pity = Math.min(cumulativePaidPulls, threshold);
    const sourcePool = resolveRecordPool(record, poolLookup, pool) || pool;
    if (!isTargetPull(record, sourcePool)) {
      continue;
    }

    if (cumulativePaidPulls >= forcedUpFloor) {
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

/**
 * 卡池规则作用域的稳定键。系列作用域按 profile+seriesKey 合并，
 * 共享作用域按规则集合并，其余按单池；用于跨池去重，避免重复扫描。
 */
export function getPoolRuleScopeKey(pool, scopeType = 'pity') {
  const capabilities = resolvePoolCapabilities(pool);
  const scopeKind = scopeType === 'reward'
    ? capabilities.rewardScope
    : scopeType === 'target'
      ? capabilities.targetScope
      : capabilities.pityScope;
  if (scopeKind === 'series') {
    const seriesStateKey = getPoolSeriesStateKey(capabilities);
    return seriesStateKey ? `${scopeType}:series:${seriesStateKey}` : null;
  }
  if (scopeKind === 'shared') {
    return `${scopeType}:shared:${capabilities.rulesKey}`;
  }
  const poolId = getPoolRecordId(pool);
  return poolId ? `${scopeType}:pool:${poolId}` : null;
}

/**
 * 收集单个卡池（按其目标作用域）的硬保底强制 UP（吃井）记录键。
 * 口径统一由 gachaRuleContracts 提供；无硬保底或未解析的池返回空集。
 */
export function collectForcedUpRecordKeysForPool({ history = [], pools = [], pool } = {}) {
  const capabilities = resolvePoolCapabilities(pool);
  const floor = getForcedUpFloor(capabilities?.rules);
  if (!capabilities.isResolved || capabilities.targetMode !== 'single-up' || !Number.isFinite(floor)) {
    return new Set();
  }

  const timeline = buildScopedPaidHistoryTimeline({
    history,
    pools,
    pool,
    scopeType: 'target',
  });
  const poolLookup = buildPoolLookup(pools, pool);
  return collectForcedUpRecordKeysFromTimeline(timeline, {
    floor,
    isTargetRecord: (record) =>
      isTargetSixStarHistoryRecord(record, resolveRecordPool(record, poolLookup, pool) || pool),
  });
}

/**
 * 收集一组卡池的硬保底强制 UP 记录键（池组 / 聚合视图使用）。
 * 逐池按目标作用域判定再合并；共享同一目标作用域的池（如同一系列的分期）
 * 只判定一次，避免重复或跨期混算。
 */
export function collectForcedUpRecordKeysForPools({ history = [], pools = [], targetPools = [] } = {}) {
  const mergedKeys = new Set();
  const processedScopes = new Set();

  for (const pool of Array.isArray(targetPools) ? targetPools : []) {
    if (!pool) {
      continue;
    }
    const scopeKey = getPoolRuleScopeKey(pool, 'target');
    if (scopeKey) {
      if (processedScopes.has(scopeKey)) {
        continue;
      }
      processedScopes.add(scopeKey);
    }
    collectForcedUpRecordKeysForPool({ history, pools, pool })
      .forEach((key) => mergedKeys.add(key));
  }

  return mergedKeys;
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
  collectForcedUpRecordKeysForPool,
  collectForcedUpRecordKeysForPools,
  getPoolRuleScopeKey,
  getPoolSeriesStateKey,
  isFreeHistoryPull,
  isPaidHistoryPull,
  isTargetSixStarHistoryRecord,
};
