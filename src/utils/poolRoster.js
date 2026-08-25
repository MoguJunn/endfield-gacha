import { supabase } from '../supabaseClient.js';
import { fetchPublicApiJson, shouldAllowPublicSupabaseFallback } from '../services/publicResourceClient.js';
import { characterCache, getLimitedCharacterPoolStatus } from './characterUtils.js';

const POOL_ROSTER_API_CACHE_TTL = 5 * 60 * 1000;
const POOL_ROSTER_API_TIMEOUT_MS = 15000;

const batchRecordsCache = new Map();
const batchRecordsInFlight = new Map();
const directBucketsCache = new Map();
const directBucketsInFlight = new Map();

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePoolId(value) {
  if (value == null) {
    return '';
  }

  return String(value).trim();
}

function inferExpectedPoolKey(expectedType) {
  return expectedType === 'weapon' ? 'weapon' : 'limited';
}

function isCharacterSupportedForPool(character, expectedType) {
  if (!character?.name) {
    return false;
  }

  const cachedCharacter =
    characterCache.searchByName(character.name, false) || characterCache.searchByName(character.name, true);

  if (!cachedCharacter?.pool_config?.pools) {
    return true;
  }

  const pools = cachedCharacter.pool_config.pools;
  const expectedPoolKey = inferExpectedPoolKey(expectedType);
  return pools.includes(expectedPoolKey) || pools.includes('standard');
}

function dedupeNames(items = []) {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    const normalized = normalizeName(item);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function dedupeEntries(items = []) {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    const normalizedName = normalizeName(item?.name);
    if (!normalizedName || seen.has(normalizedName)) {
      return;
    }

    seen.add(normalizedName);
    output.push({
      ...item,
      name: normalizedName,
      id: item?.id || normalizedName,
      avatarUrl: item?.avatarUrl || item?.avatar_url || null,
    });
  });
  return output;
}

function ensureLeadingName(items = [], leadingName = null) {
  const normalizedLeading = normalizeName(leadingName);
  if (!normalizedLeading) {
    return dedupeNames(items);
  }

  const deduped = dedupeNames(items);
  if (!deduped.includes(normalizedLeading)) {
    return [normalizedLeading, ...deduped];
  }

  return [normalizedLeading, ...deduped.filter((item) => item !== normalizedLeading)];
}

export function buildBucketsFromPoolCharacters(
  records = [],
  { expectedType = 'character', currentUpName = null } = {}
) {
  const buckets = {
    up: [],
    offBanner: [],
    sixStar: [],
    fiveStar: [],
    fourStar: [],
    items: [],
  };

  records.forEach((record) => {
    const character = record?.characters;
    if (!character || character.type !== expectedType || !isCharacterSupportedForPool(character, expectedType)) {
      return;
    }

    const normalizedName = normalizeName(character.name);
    if (!normalizedName) {
      return;
    }

    const normalizedCurrentUp = normalizeName(currentUpName);
    const isUp = Boolean(record?.is_up) || (normalizedCurrentUp && normalizedName === normalizedCurrentUp);
    const entry = {
      id: character.id || normalizedName,
      name: normalizedName,
      avatarUrl: character.avatar_url || character.avatarUrl || null,
      rarity: Number(character.rarity) || 0,
      type: character.type,
      isUp,
    };

    buckets.items.push(entry);

    if (entry.rarity === 6) {
      buckets.sixStar.push(entry.name);
      if (isUp) {
        buckets.up.push(entry);
      } else {
        buckets.offBanner.push(entry);
      }
      return;
    }

    if (entry.rarity === 5) {
      buckets.fiveStar.push(entry.name);
      return;
    }

    if (entry.rarity === 4) {
      buckets.fourStar.push(entry.name);
    }
  });

  return {
    ...buckets,
    sixStar: ensureLeadingName(buckets.sixStar, currentUpName),
    fiveStar: dedupeNames(buckets.fiveStar),
    fourStar: dedupeNames(buckets.fourStar),
    up: buckets.up,
    offBanner: buckets.offBanner,
  };
}

function buildBucketsFromCharacters(characters = [], { currentUpName = null } = {}) {
  const normalizedCurrentUp = normalizeName(currentUpName);
  const entries = (Array.isArray(characters) ? characters : [])
    .map((character) => {
      const normalizedName = normalizeName(character?.name);
      if (!normalizedName) {
        return null;
      }

      const isUp = Boolean(normalizedCurrentUp && normalizedName === normalizedCurrentUp);
      return {
        id: character?.id || normalizedName,
        name: normalizedName,
        avatarUrl: character?.avatar_url || character?.avatarUrl || null,
        rarity: Number(character?.rarity) || 0,
        type: character?.type,
        isUp,
      };
    })
    .filter(Boolean);

  return {
    items: dedupeEntries(entries),
    up: dedupeEntries(entries.filter((entry) => entry.rarity === 6 && entry.isUp)),
    offBanner: dedupeEntries(entries.filter((entry) => entry.rarity === 6 && !entry.isUp)),
    sixStar: ensureLeadingName(
      entries.filter((entry) => entry.rarity === 6).map((entry) => entry.name),
      currentUpName
    ),
    fiveStar: dedupeNames(entries.filter((entry) => entry.rarity === 5).map((entry) => entry.name)),
    fourStar: dedupeNames(entries.filter((entry) => entry.rarity === 4).map((entry) => entry.name)),
  };
}

function mergeRosterBuckets(primary, fallback, { currentUpName = null } = {}) {
  const primaryItems = Array.isArray(primary?.items) ? primary.items : [];
  const fallbackItems = Array.isArray(fallback?.items) ? fallback.items : [];
  const mergedItems = dedupeEntries([...primaryItems, ...fallbackItems]);
  const mergedSixStar = ensureLeadingName(
    [
      ...(Array.isArray(primary?.sixStar) ? primary.sixStar : []),
      ...(Array.isArray(fallback?.sixStar) ? fallback.sixStar : []),
    ],
    currentUpName
  );

  return {
    items: mergedItems,
    up: dedupeEntries([
      ...(Array.isArray(primary?.up) ? primary.up : []),
      ...(Array.isArray(fallback?.up) ? fallback.up : []),
    ]),
    offBanner: dedupeEntries([
      ...(Array.isArray(primary?.offBanner) ? primary.offBanner : []),
      ...(Array.isArray(fallback?.offBanner) ? fallback.offBanner : []),
    ]),
    sixStar: mergedSixStar,
    fiveStar: dedupeNames([
      ...(Array.isArray(primary?.fiveStar) ? primary.fiveStar : []),
      ...(Array.isArray(fallback?.fiveStar) ? fallback.fiveStar : []),
    ]),
    fourStar: dedupeNames([
      ...(Array.isArray(primary?.fourStar) ? primary.fourStar : []),
      ...(Array.isArray(fallback?.fourStar) ? fallback.fourStar : []),
    ]),
  };
}

function mergeRosterBucketsByMissingRarity(primary, fallback, { currentUpName = null } = {}) {
  const usePrimarySixStar = Array.isArray(primary?.sixStar) && primary.sixStar.length > 0;
  const usePrimaryFiveStar = Array.isArray(primary?.fiveStar) && primary.fiveStar.length > 0;
  const usePrimaryFourStar = Array.isArray(primary?.fourStar) && primary.fourStar.length > 0;
  const selectedNames = new Set(
    [
      ...(usePrimarySixStar ? primary.sixStar : fallback?.sixStar || []),
      ...(usePrimaryFiveStar ? primary.fiveStar : fallback?.fiveStar || []),
      ...(usePrimaryFourStar ? primary.fourStar : fallback?.fourStar || []),
    ]
      .map(normalizeName)
      .filter(Boolean)
  );

  const mergedItems = dedupeEntries([
    ...(Array.isArray(primary?.items) ? primary.items : []),
    ...(Array.isArray(fallback?.items) ? fallback.items : []).filter((item) =>
      selectedNames.has(normalizeName(item?.name))
    ),
  ]);

  return {
    items: mergedItems,
    up: dedupeEntries(usePrimarySixStar ? primary?.up || [] : fallback?.up || []),
    offBanner: dedupeEntries(usePrimarySixStar ? primary?.offBanner || [] : fallback?.offBanner || []),
    sixStar: ensureLeadingName(usePrimarySixStar ? primary?.sixStar || [] : fallback?.sixStar || [], currentUpName),
    fiveStar: dedupeNames(usePrimaryFiveStar ? primary?.fiveStar || [] : fallback?.fiveStar || []),
    fourStar: dedupeNames(usePrimaryFourStar ? primary?.fourStar || [] : fallback?.fourStar || []),
  };
}

function matchesFallbackPool(character, { expectedType = 'character', poolType = 'limited', poolInfo = null } = {}) {
  if (!character?.name || character?.type !== expectedType) {
    return false;
  }

  const pools = Array.isArray(character?.pool_config?.pools) ? character.pool_config.pools : [];

  if (poolType === 'limited') {
    if (!pools.includes('limited') && !pools.includes('standard')) {
      return false;
    }

    if (expectedType === 'character' && Number(character?.rarity) >= 6 && character?.is_limited) {
      const limitedStatus = getLimitedCharacterPoolStatus(character, poolInfo);
      return limitedStatus.isIntroduced && limitedStatus.isActive;
    }

    return true;
  }

  if (poolType === 'weapon') {
    return pools.includes('weapon') || pools.includes('standard');
  }

  return pools.includes(poolType);
}

export function buildDynamicRosterBuckets({
  expectedType = 'character',
  currentUpName = null,
  poolType = 'limited',
  poolInfo = null,
} = {}) {
  const fallbackCharacters = characterCache.getAll({ type: expectedType }).filter((character) =>
    matchesFallbackPool(character, {
      expectedType,
      poolType,
      poolInfo,
    })
  );

  return buildBucketsFromCharacters(fallbackCharacters, { currentUpName });
}

export async function fetchPoolRosterBuckets(poolId, { expectedType = 'character', currentUpName = null } = {}) {
  if (!shouldAllowPublicSupabaseFallback() || !supabase || !poolId) {
    return null;
  }

  const cacheKey = [normalizePoolId(poolId), expectedType, normalizeName(currentUpName)].join('|');
  const now = Date.now();
  const cached = directBucketsCache.get(cacheKey);
  if (cached && now - cached.lastFetch < POOL_ROSTER_API_CACHE_TTL) {
    return cached.buckets;
  }

  if (directBucketsInFlight.has(cacheKey)) {
    return directBucketsInFlight.get(cacheKey);
  }

  const request = (async () => {
    const { data, error } = await supabase
      .from('pool_characters')
      .select(
        `
        character_id,
        is_up,
        characters (
          id,
          name,
          rarity,
          type,
          avatar_url,
          is_limited,
          aliases,
          pool_config
        )
      `
      )
      .eq('pool_id', poolId);

    if (error || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    const buckets = buildBucketsFromPoolCharacters(data, {
      expectedType,
      currentUpName,
    });
    directBucketsCache.set(cacheKey, {
      buckets,
      lastFetch: Date.now(),
    });
    return buckets;
  })().finally(() => {
    directBucketsInFlight.delete(cacheKey);
  });

  directBucketsInFlight.set(cacheKey, request);
  return request;
}

function createBatchCacheKey(poolIds = []) {
  return Array.from(new Set(poolIds.map(normalizePoolId).filter(Boolean)))
    .sort()
    .join(',');
}

function normalizeBatchPayload(poolIds = [], payload = {}) {
  const requestedPoolIds = Array.from(new Set(poolIds.map(normalizePoolId).filter(Boolean)));
  const recordMap = new Map(requestedPoolIds.map((poolId) => [poolId, []]));
  const poolRosters = payload?.poolRosters && typeof payload.poolRosters === 'object' ? payload.poolRosters : {};

  Object.entries(poolRosters).forEach(([poolId, records]) => {
    const normalizedPoolId = normalizePoolId(poolId);
    if (!normalizedPoolId || !Array.isArray(records)) {
      return;
    }

    recordMap.set(normalizedPoolId, records);
  });

  return recordMap;
}

export async function fetchPoolRosterRecordsBatch(poolIds = [], { forceRefresh = false } = {}) {
  const normalizedPoolIds = Array.from(new Set(poolIds.map(normalizePoolId).filter(Boolean)));
  if (normalizedPoolIds.length === 0) {
    return new Map();
  }

  if (!import.meta.env?.PROD && !forceRefresh) {
    return null;
  }

  const cacheKey = createBatchCacheKey(normalizedPoolIds);
  const now = Date.now();
  const cached = batchRecordsCache.get(cacheKey);
  if (!forceRefresh && cached && now - cached.lastFetch < POOL_ROSTER_API_CACHE_TTL) {
    return cached.recordsByPoolId;
  }

  if (batchRecordsInFlight.has(cacheKey)) {
    return batchRecordsInFlight.get(cacheKey);
  }

  const request = (async () => {
    const searchParams = new URLSearchParams();
    searchParams.set('poolIds', normalizedPoolIds.join(','));

    const data = await fetchPublicApiJson('/api/pool-rosters', {
      params: Object.fromEntries(searchParams.entries()),
      label: 'load pool rosters',
      timeoutMs: POOL_ROSTER_API_TIMEOUT_MS,
      retries: 1,
      forceRefresh,
    });

    const recordsByPoolId = normalizeBatchPayload(normalizedPoolIds, data?.data);
    batchRecordsCache.set(cacheKey, {
      recordsByPoolId,
      lastFetch: Date.now(),
    });

    return recordsByPoolId;
  })()
    .catch(() => null)
    .finally(() => {
      batchRecordsInFlight.delete(cacheKey);
    });

  batchRecordsInFlight.set(cacheKey, request);
  return request;
}

export async function resolvePoolRosterBuckets({
  poolId,
  expectedType = 'character',
  currentUpName = null,
  poolType = expectedType === 'weapon' ? 'weapon' : 'limited',
  poolInfo = null,
  mergeStrategy = 'append',
  explicitRecords = null,
  skipExplicitFetch = false,
} = {}) {
  let explicitBuckets = null;

  if (Array.isArray(explicitRecords)) {
    explicitBuckets = buildBucketsFromPoolCharacters(explicitRecords, {
      expectedType,
      currentUpName,
    });
  } else if (!skipExplicitFetch) {
    const batchRecords = await fetchPoolRosterRecordsBatch([poolId]).catch(() => null);
    const normalizedPoolId = normalizePoolId(poolId);

    if (batchRecords instanceof Map && batchRecords.has(normalizedPoolId)) {
      explicitBuckets = buildBucketsFromPoolCharacters(batchRecords.get(normalizedPoolId) || [], {
        expectedType,
        currentUpName,
      });
    } else {
      explicitBuckets = await fetchPoolRosterBuckets(poolId, {
        expectedType,
        currentUpName,
      });
    }
  }

  const fallbackBuckets = buildDynamicRosterBuckets({
    expectedType,
    currentUpName,
    poolType,
    poolInfo,
  });

  if (explicitBuckets) {
    const shouldFillMissingByRarity = mergeStrategy === 'fill-missing' || expectedType === 'weapon';
    if (shouldFillMissingByRarity) {
      return mergeRosterBucketsByMissingRarity(explicitBuckets, fallbackBuckets, { currentUpName });
    }
    return mergeRosterBuckets(explicitBuckets, fallbackBuckets, { currentUpName });
  }

  return fallbackBuckets.items.length > 0 ? fallbackBuckets : null;
}

/**
 * 解析当前分析范围内的 roster。多池范围只执行一次批量读取；批量读取失败时，
 * 每个池直接使用本地动态 roster，避免继续逐池请求 Supabase。
 */
export async function resolvePoolRosterBucketsBatch(requests = [], { forceRefresh = false } = {}) {
  const requestByPoolId = new Map();
  (Array.isArray(requests) ? requests : []).forEach((request) => {
    const poolId = normalizePoolId(request?.poolId);
    if (!poolId || requestByPoolId.has(poolId)) {
      return;
    }

    requestByPoolId.set(poolId, {
      ...request,
      poolId,
    });
  });

  const normalizedRequests = Array.from(requestByPoolId.values());
  if (normalizedRequests.length === 0) {
    return new Map();
  }

  if (normalizedRequests.length === 1) {
    const request = normalizedRequests[0];
    const roster = await resolvePoolRosterBuckets(request).catch(() => null);
    return new Map([[request.poolId, roster]]);
  }

  const poolIds = normalizedRequests.map((request) => request.poolId);
  const recordsByPoolId = await fetchPoolRosterRecordsBatch(poolIds, { forceRefresh }).catch(() => null);
  const hasBatchRecords = recordsByPoolId instanceof Map;
  const rosterEntries = await Promise.all(normalizedRequests.map(async (request) => {
    const explicitRecords = hasBatchRecords
      ? (recordsByPoolId.get(request.poolId) || [])
      : null;
    const roster = await resolvePoolRosterBuckets({
      ...request,
      explicitRecords,
      skipExplicitFetch: true,
    }).catch(() => null);

    return [request.poolId, roster];
  }));

  return new Map(rosterEntries);
}
