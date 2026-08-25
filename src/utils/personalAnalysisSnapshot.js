import {
  buildGameAccountServerTag,
  getHistoryRecordAccountKey,
  getHistoryRecordGameUid,
  getHistoryRecordTimestampMs,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId
} from './gameAccountMetadata.js';
import {
  annotateInfoBookPulls,
  isFreeHistoryPull,
  isGiftHistoryPull
} from './historyInfoBook.js';
import { compareHistoryTimelineAsc } from './historyTimelineSort.js';
import {
  getPoolsForGroupType,
  GROUP_TYPE_LABELS,
  POOL_GROUP_PREFIX
} from './poolGroupUtils.js';
import { buildPoolStats } from './poolStats.js';
import { normalizeIsStandard } from './poolUtils.js';
import { buildSummaryStats } from './summaryStats.js';
import { buildCharacterStats } from './dashboardCharacterStats.js';
import { buildDashboardOverviewSplitStats } from './dashboardOverviewSplitStats.js';
import { buildDashboardResourceSummary } from './dashboardResourceSummary.js';
import {
  buildOverviewTimelineSections,
  buildSinglePoolTimelineSection
} from './poolTimelineView.js';
import {
  buildOverviewPoolAnalysisPityMap,
  getPoolAnalysisPityState
} from './poolAnalysisPity.js';

const LEGACY_ACCOUNT_KEY = 'legacy';
const GROUP_TYPES = [
  'all',
  'extra',
  'limited',
  'standard',
  'weapon_limited',
  'weapon_standard',
  'beginner'
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function getPoolId(value) {
  return normalizeText(value?.id ?? value?.pool_id ?? value?.poolId);
}

function getHistoryPoolId(record) {
  return normalizeText(record?.poolId ?? record?.pool_id);
}

function getHistoryRecordKey(record) {
  const value = record?.id || record?.record_id || null;
  return value == null ? null : String(value);
}

function getRecordServerScope(record) {
  return normalizeText(record?.server_scope ?? record?.serverScope);
}

function getRecordAccountKey(record) {
  const gameUid = getHistoryRecordGameUid(record);
  if (!gameUid) {
    return LEGACY_ACCOUNT_KEY;
  }

  const serverScope = getRecordServerScope(record);
  const accountRecord = serverScope
    && serverScope !== LEGACY_ACCOUNT_KEY
    && !normalizeText(record?.server_id ?? record?.serverId)
    ? { ...record, server_id: serverScope }
    : record;

  return getHistoryRecordAccountKey(accountRecord) || gameUid;
}

function toIsoTimestamp(record) {
  const timestamp = getHistoryRecordTimestampMs(record);
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function pickLatestText(records, getter) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const value = normalizeText(getter(records[index]));
    if (value) return value;
  }
  return null;
}

function buildAccount(accountKey, records) {
  const sortedRecords = records.slice().sort(compareHistoryTimelineAsc);
  const gameUid = getHistoryRecordGameUid(sortedRecords[0]) || LEGACY_ACCOUNT_KEY;
  const serverScope = pickLatestText(sortedRecords, (record) => (
    record?.server_scope ?? record?.serverScope
  ));
  const rawServerId = pickLatestText(sortedRecords, (record) => (
    record?.server_id ?? record?.serverId
  ));
  const rawRegion = pickLatestText(sortedRecords, (record) => (
    record?.region ?? record?.serverRegion
  ));
  const metadata = {
    gameUid,
    serverId: rawServerId || (serverScope && serverScope !== LEGACY_ACCOUNT_KEY ? serverScope : null),
    serverScope,
    region: rawRegion,
    channelMasterId: pickLatestText(sortedRecords, (record) => (
      record?.channel_master_id ?? record?.channelMasterId
    )),
    channelName: pickLatestText(sortedRecords, (record) => (
      record?.channel_name ?? record?.channelName
    )),
    isOfficial: sortedRecords.reduce((value, record) => (
      record?.is_official ?? record?.isOfficial ?? value
    ), null)
  };
  const serverId = gameUid === LEGACY_ACCOUNT_KEY
    ? rawServerId
    : normalizeGameAccountServerId(metadata);
  const region = gameUid === LEGACY_ACCOUNT_KEY
    ? rawRegion
    : normalizeGameAccountRegion({ ...metadata, serverId });
  const latestRecordAt = sortedRecords.length > 0
    ? toIsoTimestamp(sortedRecords[sortedRecords.length - 1])
    : null;
  const explicitServerTag = pickLatestText(sortedRecords, (record) => (
    record?.server_tag ?? record?.serverTag
  ));

  return {
    accountKey,
    gameUid,
    nickName: pickLatestText(sortedRecords, (record) => (
      record?.nick_name ?? record?.nickName
    )) || gameUid,
    serverId: serverId || null,
    serverScope: serverScope || serverId || region || LEGACY_ACCOUNT_KEY,
    region: region || null,
    serverTag: explicitServerTag || (
      gameUid === LEGACY_ACCOUNT_KEY
        ? null
        : buildGameAccountServerTag({ ...metadata, serverId, serverScope, region })
    ),
    recordCount: sortedRecords.length,
    latestRecordAt,
    records: sortedRecords
  };
}

function buildAccountGroups(history) {
  const recordsByAccount = new Map();
  const firstSeenByAccount = new Map();

  history.forEach((record, index) => {
    const accountKey = getRecordAccountKey(record);
    if (!recordsByAccount.has(accountKey)) {
      recordsByAccount.set(accountKey, []);
      firstSeenByAccount.set(accountKey, index);
    }
    recordsByAccount.get(accountKey).push(record);
  });

  return Array.from(recordsByAccount.entries())
    .map(([accountKey, records]) => ({
      ...buildAccount(accountKey, records),
      firstSeenIndex: firstSeenByAccount.get(accountKey)
    }))
    .sort((left, right) => (
      right.recordCount - left.recordCount
      || left.firstSeenIndex - right.firstSeenIndex
      || left.accountKey.localeCompare(right.accountKey)
    ));
}

function toPublicAccount(account) {
  return {
    accountKey: account.accountKey,
    gameUid: account.gameUid,
    nickName: account.nickName,
    serverId: account.serverId,
    serverScope: account.serverScope,
    region: account.region,
    serverTag: account.serverTag,
    recordCount: account.recordCount,
    latestRecordAt: account.latestRecordAt
  };
}

function inferPoolType(poolId) {
  const normalizedId = String(poolId || '').trim().toLowerCase();

  if (/^(weapon_standard|standard_weapon)/.test(normalizedId)) return 'weapon';
  if (/^(weponbox|weaponbox|weapon|limited_weapon)/.test(normalizedId)) return 'weapon';
  if (/^(joint|extra)/.test(normalizedId)) return 'extra';
  if (/^(special|limited|limited_character)/.test(normalizedId)) return 'limited';
  if (/^(beginner|starter|start)/.test(normalizedId)) return 'beginner';
  if (/^(standard|permanent|normal)/.test(normalizedId)) return 'standard';

  return 'unknown';
}

function cloneJsonData(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return null;

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => cloneJsonData(item, seen));
    seen.delete(value);
    return result;
  }
  if (value instanceof Map) {
    const result = {};
    value.forEach((item, key) => {
      const cloned = cloneJsonData(item, seen);
      if (cloned !== undefined) result[String(key)] = cloned;
    });
    seen.delete(value);
    return result;
  }
  if (value instanceof Set) {
    const result = Array.from(value, (item) => cloneJsonData(item, seen));
    seen.delete(value);
    return result;
  }

  const result = {};
  Object.entries(value).forEach(([key, item]) => {
    const cloned = cloneJsonData(item, seen);
    if (cloned !== undefined) result[key] = cloned;
  });
  seen.delete(value);
  return result;
}

function createPoolPlaceholder(poolId) {
  const type = inferPoolType(poolId);
  const isStandardWeapon = /^(weapon_standard|standard_weapon)/i.test(poolId);

  return {
    id: poolId,
    pool_id: poolId,
    name: poolId,
    type,
    up_character: null,
    isLimitedWeapon: type === 'weapon' ? !isStandardWeapon : undefined,
    isPlaceholder: true,
    locked: true
  };
}

function buildPoolManifest(history, pools) {
  const poolLookup = new Map();
  pools.forEach((pool) => {
    [pool?.id, pool?.pool_id].forEach((value) => {
      const poolId = normalizeText(value);
      if (poolId && !poolLookup.has(poolId)) poolLookup.set(poolId, pool);
    });
  });

  const referencedPoolIds = [];
  const referencedPoolIdSet = new Set();
  history.forEach((record) => {
    const poolId = getHistoryPoolId(record);
    if (poolId && !referencedPoolIdSet.has(poolId)) {
      referencedPoolIdSet.add(poolId);
      referencedPoolIds.push(poolId);
    }
  });

  return referencedPoolIds.map((poolId) => {
    const sourcePool = poolLookup.get(poolId);
    if (!sourcePool) return createPoolPlaceholder(poolId);

    const pool = cloneJsonData(sourcePool);
    return {
      ...pool,
      id: poolId,
      pool_id: pool?.pool_id || poolId,
      type: pool?.type || inferPoolType(poolId),
      isLimitedWeapon: pool?.isLimitedWeapon ?? pool?.is_limited_weapon
    };
  });
}

function buildPoolLookup(poolManifest) {
  const lookup = new Map();
  poolManifest.forEach((pool) => {
    [pool?.id, pool?.pool_id].forEach((value) => {
      const poolId = normalizeText(value);
      if (poolId) lookup.set(poolId, pool);
    });
  });
  return lookup;
}

function buildInfoBookPoolList(pools, poolManifest) {
  const result = [];
  const includedPoolIds = new Set();

  pools.forEach((pool) => {
    const poolId = getPoolId(pool);
    if (!poolId || includedPoolIds.has(poolId)) return;
    includedPoolIds.add(poolId);
    result.push(pool?.id ? pool : { ...pool, id: poolId });
  });
  poolManifest.forEach((pool) => {
    const poolId = getPoolId(pool);
    if (!poolId || includedPoolIds.has(poolId)) return;
    includedPoolIds.add(poolId);
    result.push(pool);
  });

  return result;
}

function normalizeForPoolStats(history, poolLookup, fallbackPool = null) {
  return history.map((record) => {
    const pool = poolLookup.get(getHistoryPoolId(record)) || fallbackPool;
    return {
      ...record,
      isStandard: normalizeIsStandard(record, pool?.type, pool?.up_character)
    };
  });
}

function normalizeCharacterMatchValue(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s_\-·・.]+/g, '');
}

/**
 * 复制 Dashboard 跨限定池保底标注语义。Map 仅用于快照构建过程，不会写入输出。
 */
export function buildCrossPoolPityMap(allLimitedHistory = []) {
  if (!Array.isArray(allLimitedHistory) || allLimitedHistory.length === 0) {
    return null;
  }

  const map = new Map();
  let sixPity = 0;
  let fivePity = 0;

  allLimitedHistory
    .slice()
    .sort(compareHistoryTimelineAsc)
    .filter((item) => !isGiftHistoryPull(item))
    .forEach((item) => {
      const isFree = isFreeHistoryPull(item);
      const recordKey = getHistoryRecordKey(item);

      if (!isFree) {
        sixPity += 1;
        fivePity += 1;
      }

      if (item?.rarity >= 5 && recordKey) {
        map.set(recordKey, {
          sixStarPity: isFree ? 'free' : (item.rarity === 6 ? sixPity : null),
          fiveStarPity: isFree ? 'free' : fivePity
        });
      }

      if (!isFree) {
        if (item?.rarity === 6) {
          sixPity = 0;
        }
        if (item?.rarity >= 5) {
          fivePity = 0;
        }
      }
    });

  return map;
}

export function createSnapshotCharacterResolver(characters = []) {
  const entries = asArray(characters).map((character) => {
    const aliases = Array.isArray(character?.aliases)
      ? character.aliases
      : normalizeText(character?.aliases)
        ? [character.aliases]
        : [];
    const values = [
      character?.id,
      character?.character_id,
      character?.characterId,
      character?.name,
      ...aliases
    ]
      .map(normalizeCharacterMatchValue)
      .filter(Boolean);

    return { character, values: [...new Set(values)] };
  });
  const exactLookup = new Map();
  entries.forEach(({ character, values }) => {
    values.forEach((value) => {
      if (!exactLookup.has(value)) exactLookup.set(value, character);
    });
  });

  return (value, options = {}) => {
    const normalizedValue = normalizeCharacterMatchValue(value);
    if (!normalizedValue) return null;

    const exact = exactLookup.get(normalizedValue);
    if (exact || options?.fuzzy !== true) return exact || null;

    let bestMatch = null;
    let bestLength = -1;
    entries.forEach((entry) => {
      entry.values.forEach((candidate) => {
        if (
          (candidate.includes(normalizedValue) || normalizedValue.includes(candidate))
          && Math.min(candidate.length, normalizedValue.length) > bestLength
        ) {
          bestMatch = entry.character;
          bestLength = Math.min(candidate.length, normalizedValue.length);
        }
      });
    });
    return bestMatch;
  };
}

function buildSelector(history) {
  const poolPullCounts = {};
  const poolLatestRecordAt = {};
  let totalPulls = 0;
  let latestRecordAt = null;

  history.forEach((record) => {
    const poolId = getHistoryPoolId(record);
    const recordAt = toIsoTimestamp(record);
    if (poolId) {
      totalPulls += 1;
      poolPullCounts[poolId] = (poolPullCounts[poolId] || 0) + 1;
      if (recordAt && (!poolLatestRecordAt[poolId] || recordAt > poolLatestRecordAt[poolId])) {
        poolLatestRecordAt[poolId] = recordAt;
      }
    }
    if (recordAt && (!latestRecordAt || recordAt > latestRecordAt)) {
      latestRecordAt = recordAt;
    }
  });

  return {
    totalPulls,
    latestRecordAt,
    poolPullCounts,
    poolLatestRecordAt
  };
}

function buildGroupPool(groupType) {
  const baseType = groupType === 'weapon_limited' || groupType === 'weapon_standard'
    ? 'weapon'
    : groupType;

  return {
    id: `${POOL_GROUP_PREFIX}${groupType}`,
    name: GROUP_TYPE_LABELS[groupType] || groupType,
    type: baseType,
    isGroupMode: true,
    isAllPoolsOverview: groupType === 'all',
    up_character: null,
    locked: true
  };
}

function isLimitedPoolType(type) {
  return type === 'limited' || type === 'limited_character';
}

function buildCheckLimitedInFirstN(history) {
  const sortedHistory = history.slice().sort(compareHistoryTimelineAsc);
  let pullCount = 0;
  let firstLimitedIndex120 = 0;
  let firstLimitedIndex80 = 0;

  for (const item of sortedHistory) {
    if (isGiftHistoryPull(item) || isFreeHistoryPull(item)) {
      continue;
    }

    pullCount += 1;
    if (item?.rarity === 6 && !item?.isStandard) {
      if (firstLimitedIndex120 === 0 && pullCount <= 120) firstLimitedIndex120 = pullCount;
      if (firstLimitedIndex80 === 0 && pullCount <= 80) firstLimitedIndex80 = pullCount;
    }
  }

  return { firstLimitedIndex120, firstLimitedIndex80, validPullCount: pullCount };
}

function buildStatsVariant({
  history,
  rawHistory,
  currentPool,
  selectedPools,
  allLimitedHistory,
  crossPoolPityMap,
  resolveCharacter,
  includeFreePullsInStats
}) {
  const base = buildPoolStats({
    normalizedCurrentPoolHistory: history,
    currentPool,
    allLimitedHistory,
    currentPoolId: currentPool.id,
    selectedPools,
    resolveCharacter,
    includeFreePullsInStats
  });
  const limitedPoolIds = currentPool.isGroupMode
    ? new Set(
        selectedPools
          .filter((pool) => isLimitedPoolType(pool?.type))
          .map(getPoolId)
          .filter(Boolean)
      )
    : null;

  return {
    ...base,
    characterStats: buildCharacterStats({
      history,
      isLimitedPool: isLimitedPoolType(currentPool?.type),
      crossPoolPityMap,
      limitedPoolIds,
      includeFreePullsInStats
    }),
    checkLimitedInFirstN: buildCheckLimitedInFirstN(history),
    hasReceivedFreeTen: history.some((item) => isFreeHistoryPull(item)),
    splitOverviewStats: currentPool.isAllPoolsOverview
      ? buildDashboardOverviewSplitStats({
          history,
          selectedPools,
          includeFreePullsInStats,
          resolveCharacter
        })
      : null,
    dashboardResourceSummary: buildDashboardResourceSummary({
      isAllPoolsOverview: currentPool.isAllPoolsOverview,
      pools: selectedPools,
      history: rawHistory,
      includeFreePullsInStats,
      stats: base.stats
    })
  };
}

function buildStatsView({
  history,
  rawHistory,
  currentPool,
  selectedPools,
  allLimitedHistory,
  crossPoolPityMap,
  resolveCharacter
}) {
  const options = {
    history,
    rawHistory,
    currentPool,
    allLimitedHistory,
    selectedPools,
    crossPoolPityMap,
    resolveCharacter
  };

  return {
    excludeFree: buildStatsVariant({ ...options, includeFreePullsInStats: false }),
    includeFree: buildStatsVariant({ ...options, includeFreePullsInStats: true })
  };
}

function sanitizeTimelineSections(sections = []) {
  return (Array.isArray(sections) ? sections : []).map((section) => ({
    ...section,
    entries: (Array.isArray(section?.entries) ? section.entries : []).map((entry) => {
      const {
        sourceRecordKeys: _sourceRecordKeys,
        sourceBatchKeys: _sourceBatchKeys,
        ...safeEntry
      } = entry;
      return safeEntry;
    })
  }));
}

function buildDashboard(history, pools, poolManifest, resolveCharacter) {
  const poolLookup = buildPoolLookup(poolManifest);
  const annotatedHistory = annotateInfoBookPulls(
    history,
    buildInfoBookPoolList(pools, poolManifest)
  )
    .slice()
    .sort(compareHistoryTimelineAsc);
  const allLimitedHistory = annotatedHistory.filter((record) => {
    const poolType = poolLookup.get(getHistoryPoolId(record))?.type;
    return poolType === 'limited' || poolType === 'limited_character';
  });
  const crossPoolPityMap = buildCrossPoolPityMap(allLimitedHistory);
  const normalizedAnnotatedHistory = normalizeForPoolStats(annotatedHistory, poolLookup);
  const historyByPoolId = new Map();

  annotatedHistory.forEach((record) => {
    const poolId = getHistoryPoolId(record);
    if (!poolId) return;
    if (!historyByPoolId.has(poolId)) historyByPoolId.set(poolId, []);
    historyByPoolId.get(poolId).push(record);
  });

  const views = {};
  poolManifest.forEach((pool) => {
    const poolId = getPoolId(pool);
    const poolHistory = historyByPoolId.get(poolId) || [];
    views[poolId] = buildStatsView({
      history: normalizeForPoolStats(poolHistory, poolLookup, pool),
      rawHistory: poolHistory,
      currentPool: pool,
      selectedPools: [pool],
      allLimitedHistory,
      crossPoolPityMap,
      resolveCharacter
    });
  });

  GROUP_TYPES.forEach((groupType) => {
    const selectedPools = getPoolsForGroupType(poolManifest, groupType);
    const selectedPoolIds = new Set(selectedPools.map(getPoolId).filter(Boolean));
    const groupHistory = annotatedHistory.filter((record) => (
      selectedPoolIds.has(getHistoryPoolId(record))
    ));
    const currentPool = buildGroupPool(groupType);
    views[currentPool.id] = buildStatsView({
      history: normalizeForPoolStats(groupHistory, poolLookup),
      rawHistory: groupHistory,
      currentPool,
      selectedPools,
      allLimitedHistory,
      crossPoolPityMap,
      resolveCharacter
    });
  });

  const timelineViews = Object.fromEntries(['zh-CN', 'en-US'].map((locale) => {
    const localizedViews = {};

    poolManifest.forEach((pool) => {
      const poolId = getPoolId(pool);
      const poolHistory = normalizeForPoolStats(historyByPoolId.get(poolId) || [], poolLookup, pool);
      const variant = views[poolId]?.excludeFree;
      const analysisPity = getPoolAnalysisPityState(pool, variant?.stats, variant?.effectivePity);
      const section = buildSinglePoolTimelineSection({
        pool,
        history: poolHistory,
        currentPityOverride: analysisPity.displayPity6,
        currentPity5Override: analysisPity.displayPity5,
        currentTargetPullsOverride: analysisPity.maxPity6,
        crossPoolPityMap,
        locale,
        resolveCharacter
      });
      localizedViews[poolId] = sanitizeTimelineSections(section ? [section] : []);
    });

    GROUP_TYPES.forEach((groupType) => {
      const selectedPools = getPoolsForGroupType(poolManifest, groupType);
      const groupPool = buildGroupPool(groupType);
      localizedViews[groupPool.id] = sanitizeTimelineSections(buildOverviewTimelineSections({
        pools: selectedPools,
        history: normalizedAnnotatedHistory,
        analysisPityByPoolId: buildOverviewPoolAnalysisPityMap({
          pools: selectedPools,
          history: normalizedAnnotatedHistory,
          allLimitedHistory
        }),
        crossPoolPityMap,
        locale,
        resolveCharacter
      }));
    });

    return [locale, localizedViews];
  }));

  return { views, timelineViews };
}

function buildRecentSixStars(history, poolManifest, resolveCharacter) {
  const poolLookup = buildPoolLookup(poolManifest);

  return history
    .slice()
    .sort(compareHistoryTimelineAsc)
    .filter((record) => Number(record?.rarity) === 6)
    .slice(-6)
    .reverse()
    .map((record) => {
      const poolId = getHistoryPoolId(record);
      const pool = poolLookup.get(poolId);
      const characterId = record?.character_id ?? record?.characterId ?? null;
      const resolvedCharacter = resolveCharacter(
        characterId
          ?? record?.character_name
          ?? record?.item_name
          ?? record?.name,
        { fuzzy: true }
      );

      return {
        id: record?.id ?? record?.record_id ?? null,
        poolId,
        timestamp: cloneJsonData(
          record?.timestamp ?? record?.gacha_time ?? record?.created_at ?? null
        ),
        rarity: Number(record.rarity),
        isStandard: normalizeIsStandard(record, pool?.type, pool?.up_character),
        pity: record?.pity ?? null,
        name: normalizeText(
          record?.character_name ?? record?.item_name ?? record?.name ?? resolvedCharacter?.name
        ),
        character_id: characterId ?? resolvedCharacter?.id ?? null
      };
    });
}

/**
 * 从已加载的数据构建可直接持久化的个人分析快照，不执行任何外部读取。
 */
export function buildPersonalAnalysisSnapshots({
  history = [],
  pools = [],
  characters = [],
  userId
} = {}) {
  const historyArray = asArray(history);
  const poolsArray = asArray(pools);
  const charactersArray = asArray(characters);
  const ownedHistory = historyArray.filter((record) => record?.user_id === userId);
  const accountGroups = buildAccountGroups(ownedHistory);
  const resolveCharacter = createSnapshotCharacterResolver(charactersArray);

  const accounts = accountGroups.map(toPublicAccount);
  const owner = {
    accounts,
    defaultAccountKey: accounts[0]?.accountKey || null,
    summary: buildSummaryStats({
      history: ownedHistory,
      pools: poolsArray,
      user: { id: userId },
      characters: charactersArray
    })
  };
  const scopes = accountGroups.map((accountGroup) => {
    const account = toPublicAccount(accountGroup);
    const poolManifest = buildPoolManifest(accountGroup.records, poolsArray);
    return {
      scopeKey: account.accountKey,
      sourceGameUid: account.gameUid,
      sourceServerScope: account.serverScope,
      payload: {
        account,
        poolManifest,
        selector: buildSelector(accountGroup.records),
        dashboard: buildDashboard(
          accountGroup.records,
          poolsArray,
          poolManifest,
          resolveCharacter
        ),
        recentSixStars: buildRecentSixStars(accountGroup.records, poolManifest, resolveCharacter)
      }
    };
  });

  return { owner, scopes };
}

export default buildPersonalAnalysisSnapshots;
