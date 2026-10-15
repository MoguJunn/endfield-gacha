import {
  fetchCharacterRanking,
  fetchCharacters,
  fetchGlobalSummary,
  fetchVisiblePools,
  toPublicPoolDto,
} from './publicCatalog.js';

const HEAVY_PAGE_DEFAULT = 20;
const HEAVY_PAGE_MAX = 50;

function normalizeQueryValue(value) {
  return String(value || '').trim();
}

function normalizeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLimit(value, {
  defaultValue = 50,
  max = 100,
} = {}) {
  const parsed = normalizeInteger(value);
  if (!parsed || parsed < 1) {
    return defaultValue;
  }

  return Math.min(parsed, max);
}

function encodeCursor(offset) {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) {
    return 0;
  }

  const decoded = Number.parseInt(Buffer.from(String(cursor), 'base64url').toString('utf8'), 10);
  return Number.isFinite(decoded) && decoded > 0 ? decoded : 0;
}

function paginateArray(items, query = {}, options = {}) {
  const limit = normalizeLimit(query.limit, options);
  const offset = decodeCursor(query.cursor);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;

  return {
    items: pageItems,
    page: {
      limit,
      nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
      hasMore: nextOffset < items.length,
      total: items.length,
    },
  };
}

function parseDateMs(value) {
  if (!value) {
    return NaN;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getPoolStatus(pool, nowMs = Date.now()) {
  const startMs = parseDateMs(pool?.start_time);
  const endMs = parseDateMs(pool?.end_time);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 'permanent';
  }

  if (nowMs < startMs) {
    return 'upcoming';
  }

  if (nowMs >= endMs) {
    return 'ended';
  }

  return 'active';
}

function normalizePoolType(type, poolId = '') {
  if (type === 'all') return 'all';
  if (type === 'limited_character' || type === 'limited') return 'limited';
  if (type === 'limited_weapon' || type === 'weapon') return 'weapon';
  if (type === 'extra') return 'extra';
  if (type === 'beginner' || type === 'standard') return 'standard';
  if (String(poolId).startsWith('joint_') || String(poolId).startsWith('extra_')) return 'extra';
  if (String(poolId).startsWith('special_')) return 'limited';
  if (String(poolId).startsWith('weapon') || String(poolId).startsWith('wepon')) return 'weapon';
  return 'standard';
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDistribution(distribution = []) {
  if (!Array.isArray(distribution)) {
    return [];
  }

  return distribution.map((bucket) => {
    const bucketName = bucket.bucket || bucket.range || 'unknown';
    const count = Object.entries(bucket)
      .filter(([key, value]) => key !== 'bucket' && key !== 'range' && Number.isFinite(Number(value)))
      .reduce((total, [, value]) => total + Number(value), 0);

    return {
      bucket: bucketName,
      count,
      segments: Object.fromEntries(
        Object.entries(bucket).filter(([key]) => key !== 'bucket' && key !== 'range')
      ),
    };
  });
}

function normalizeSummaryCounter(raw = {}) {
  const counts = raw.counts || {};
  const sixStarTotal = toNumber(raw.six ?? raw.sixStarTotal ?? counts[6] ?? raw.sixStarLimited, 0)
    + toNumber(counts['6_std'], 0);

  return {
    totalPulls: toNumber(raw.chargedPulls ?? raw.total ?? raw.totalPulls, 0),
    totalPullsWithFree: toNumber(raw.total ?? raw.totalPullsWithFree ?? raw.chargedPulls ?? raw.totalPulls, 0),
    freePullCount: toNumber(raw.freePullCount, 0),
    rarityCounts: {
      4: toNumber(counts[4] ?? raw.fourStar, 0),
      5: toNumber(counts[5] ?? raw.fiveStar, 0),
      6: sixStarTotal,
    },
    targetSixStar: toNumber(raw.sixStarLimited ?? counts[6] ?? raw.six, 0),
    offrateSixStar: toNumber(raw.sixStarStandard ?? counts['6_std'], 0),
    averagePity: {
      sixStar: raw.avgPity ?? null,
      fiveStar: raw.avgPityFiveStar ?? null,
      targetSixStar: raw.avgPityTarget ?? raw.avgPityUp ?? null,
    },
    distribution: normalizeDistribution(raw.distribution),
  };
}

function isUnavailablePreaggregateError(error) {
  if (!error) {
    return false;
  }

  const code = String(error.code || '').trim();
  const message = String(error.message || error.details || '').toLowerCase();
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)
    || message.includes('public_pool_analytics_cache')
    || message.includes('public_pool_trend_cache')
    || message.includes('relation')
    || message.includes('schema cache');
}

function buildAnalyticsMeta({
  source,
  partial,
  poolId = null,
  cacheScope = 'public_pool_analytics',
  updatedAt = null,
  sourceVersion = null,
  warning = null,
  missingFields = [],
} = {}) {
  const cacheVersion = sourceVersion || updatedAt || null;
  return {
    source,
    partial: partial === true,
    missingFields,
    cacheKey: cacheVersion && poolId ? `${cacheScope}:${poolId}:${cacheVersion}` : null,
    cacheVersion,
    updatedAt,
    ...(warning ? { warning } : {}),
  };
}

function buildTrendAnalyticsMeta({
  source,
  partial,
  metric,
  granularity,
  days,
  poolType = 'all',
  poolId = null,
  updatedAt = null,
  sourceVersion = null,
  warning = null,
} = {}) {
  const scopeId = poolId || poolType || 'all';
  return buildAnalyticsMeta({
    source,
    partial,
    poolId: `${metric}:${granularity}:${days}:${scopeId}`,
    cacheScope: 'public_pool_trends',
    updatedAt,
    sourceVersion,
    warning,
    missingFields: partial ? ['points'] : [],
  });
}

function normalizePreaggregatedPoolStats(row = {}) {
  const rarityCounts = row.rarity_counts || row.rarityCounts || {};
  const updatedAt = row.updated_at || row.updatedAt || null;
  const sourceVersion = row.source_version || row.sourceVersion || null;
  const poolId = row.pool_id || row.poolId || null;

  return {
    firstPullAt: row.first_pull_at || row.firstPullAt || null,
    lastPullAt: row.last_pull_at || row.lastPullAt || null,
    stats: {
      totalPulls: toNumber(row.total_pulls ?? row.totalPulls, 0),
      totalPullsWithFree: toNumber(row.total_pulls_with_free ?? row.totalPullsWithFree ?? row.total_pulls ?? row.totalPulls, 0),
      freePullCount: toNumber(row.free_pull_count ?? row.freePullCount, 0),
      rarityCounts: {
        4: toNumber(rarityCounts[4] ?? rarityCounts['4'], 0),
        5: toNumber(rarityCounts[5] ?? rarityCounts['5'], 0),
        6: toNumber(rarityCounts[6] ?? rarityCounts['6'], 0),
      },
      targetSixStar: toNumber(row.target_six_star ?? row.targetSixStar, 0),
      offrateSixStar: toNumber(row.offrate_six_star ?? row.offrateSixStar, 0),
      averagePity: {
        sixStar: row.avg_pity_six_star ?? row.averagePity?.sixStar ?? null,
        fiveStar: row.avg_pity_five_star ?? row.averagePity?.fiveStar ?? null,
        targetSixStar: row.avg_pity_target_six_star ?? row.averagePity?.targetSixStar ?? null,
      },
      distribution: normalizeDistribution(row.distribution),
      source: 'preaggregated_pool_cache',
      analyticsMeta: buildAnalyticsMeta({
        source: 'preaggregated_pool_cache',
        partial: false,
        poolId,
        updatedAt,
        sourceVersion,
      }),
    },
  };
}

function buildMissingPreaggregateMeta({
  poolId,
  warning = null,
} = {}) {
  return buildAnalyticsMeta({
    source: 'bounded_count_queries',
    partial: true,
    poolId,
    warning,
    missingFields: [
      'targetSixStar',
      'offrateSixStar',
      'averagePity.sixStar',
      'averagePity.fiveStar',
      'averagePity.targetSixStar',
      'distribution',
    ],
  });
}

async function fetchPoolAnalyticsCache(adminClient, poolIds = []) {
  const ids = [...new Set((poolIds || []).map(normalizeQueryValue).filter(Boolean))];
  if (ids.length === 0) {
    return {
      available: true,
      rowsByPoolId: new Map(),
    };
  }

  const { data, error } = await adminClient
    .from('public_pool_analytics_cache')
    .select('pool_id, pool_type, total_pulls, total_pulls_with_free, free_pull_count, rarity_counts, target_six_star, offrate_six_star, avg_pity_six_star, avg_pity_five_star, avg_pity_target_six_star, distribution, first_pull_at, last_pull_at, updated_at, source_version')
    .in('pool_id', ids);

  if (error) {
    if (isUnavailablePreaggregateError(error)) {
      return {
        available: false,
        rowsByPoolId: new Map(),
        warning: 'public_pool_analytics_cache_unavailable',
      };
    }

    throw error;
  }

  return {
    available: true,
    rowsByPoolId: new Map((data || []).map(row => [normalizeQueryValue(row?.pool_id), row])),
  };
}

function normalizeTrendMetric(metric) {
  const normalizedMetric = normalizeQueryValue(metric).toLowerCase();
  return ['pulls', 'six_star', 'five_star'].includes(normalizedMetric) ? normalizedMetric : 'pulls';
}

function normalizeTrendGranularity(granularity) {
  return normalizeQueryValue(granularity).toLowerCase() === 'week' ? 'week' : 'day';
}

function normalizeTrendDays(days) {
  const numericDays = Number(days);
  return [7, 30, 90].includes(numericDays) ? numericDays : 30;
}

function normalizeTrendScope(query = {}) {
  const poolId = normalizeQueryValue(query.poolId || query.pool_id);
  const rawPoolType = normalizeQueryValue(query.poolType || query.pool_type || 'all').toLowerCase();
  const poolType = ['all', 'limited', 'extra', 'standard', 'weapon'].includes(rawPoolType)
    ? rawPoolType
    : 'all';

  return {
    poolId: poolId || null,
    poolType: poolId ? (poolType || 'all') : poolType,
  };
}

function normalizeTrendPoint(row = {}) {
  const period = row.period_start || row.periodStart || null;
  const updatedAt = row.updated_at || row.updatedAt || null;
  const sourceVersion = row.source_version || row.sourceVersion || null;

  return {
    period,
    value: toNumber(row.value, 0),
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function pickLatestTrendVersion(rows = []) {
  const sortedRows = [...rows].sort((left, right) => {
    const leftUpdated = parseDateMs(left?.updated_at || left?.updatedAt);
    const rightUpdated = parseDateMs(right?.updated_at || right?.updatedAt);
    return rightUpdated - leftUpdated;
  });
  const latest = sortedRows[0] || null;
  return {
    updatedAt: latest?.updated_at || latest?.updatedAt || null,
    sourceVersion: latest?.source_version || latest?.sourceVersion || null,
  };
}

async function fetchPublicTrendCache(adminClient, {
  metric,
  granularity,
  days,
  poolType = 'all',
  poolId = null,
} = {}) {
  let query = adminClient
    .from('public_pool_trend_cache')
    .select('metric, granularity, period_start, pool_type, pool_id, value, source_version, updated_at')
    .eq('metric', metric)
    .eq('granularity', granularity);

  if (poolId) {
    query = query.eq('pool_id', poolId);
  } else if (poolType && poolType !== 'all') {
    query = query.eq('pool_type', poolType).eq('pool_id', 'all');
  } else {
    query = query.eq('pool_type', 'all').eq('pool_id', 'all');
  }

  const { data, error } = await query
    .order('period_start', { ascending: false })
    .limit(days);

  if (error) {
    if (isUnavailablePreaggregateError(error)) {
      return {
        available: false,
        rows: [],
        warning: 'public_pool_trend_cache_unavailable',
      };
    }

    throw error;
  }

  return {
    available: true,
    rows: Array.isArray(data) ? data : [],
  };
}

function buildTypeSummary(globalSummary = {}) {
  return Object.fromEntries(
    Object.entries(globalSummary.byType || {}).map(([type, value]) => [
      normalizePoolType(type),
      normalizeSummaryCounter(value),
    ])
  );
}

function applyPublicHistoryBaseFilters(query) {
  return query
    .or('special_type.is.null,special_type.neq.gift')
    .or('is_free.is.null,is_free.eq.false');
}

async function countHistory(adminClient, applyFilters) {
  let query = adminClient
    .from('statistics_history')
    .select('id', { count: 'exact', head: true });

  query = applyPublicHistoryBaseFilters(query);
  query = applyFilters(query);

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  return count || 0;
}

async function fetchBoundaryTimestamp(adminClient, applyFilters, ascending) {
  let query = adminClient
    .from('statistics_history')
    .select('timestamp')
    .order('timestamp', { ascending, nullsFirst: false })
    .limit(1);

  query = applyPublicHistoryBaseFilters(query);
  query = applyFilters(query);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return Array.isArray(data) && data[0]?.timestamp ? data[0].timestamp : null;
}

async function buildScopedCounter(adminClient, applyFilters) {
  const [
    totalPulls,
    fourStar,
    fiveStar,
    sixStar,
    firstPullAt,
    lastPullAt,
  ] = await Promise.all([
    countHistory(adminClient, applyFilters),
    countHistory(adminClient, (query) => applyFilters(query).eq('rarity', 4)),
    countHistory(adminClient, (query) => applyFilters(query).eq('rarity', 5)),
    countHistory(adminClient, (query) => applyFilters(query).eq('rarity', 6)),
    fetchBoundaryTimestamp(adminClient, applyFilters, true),
    fetchBoundaryTimestamp(adminClient, applyFilters, false),
  ]);

  return {
    firstPullAt,
    lastPullAt,
    stats: {
      totalPulls,
      totalPullsWithFree: totalPulls,
      freePullCount: 0,
      rarityCounts: {
        4: fourStar,
        5: fiveStar,
        6: sixStar,
      },
      targetSixStar: null,
      offrateSixStar: null,
      averagePity: {
        sixStar: null,
        fiveStar: null,
        targetSixStar: null,
      },
      distribution: [],
      source: 'bounded_count_queries',
      analyticsMeta: buildMissingPreaggregateMeta(),
    },
  };
}

async function buildPoolCounter(adminClient, poolId, preaggregateState) {
  const normalizedPoolId = normalizeQueryValue(poolId);
  const preaggregatedRow = preaggregateState?.rowsByPoolId?.get(normalizedPoolId);
  if (preaggregatedRow) {
    return normalizePreaggregatedPoolStats(preaggregatedRow);
  }

  const counter = await buildScopedCounter(
    adminClient,
    (historyQuery) => historyQuery.eq('pool_id', normalizedPoolId)
  );

  return {
    ...counter,
    stats: {
      ...counter.stats,
      analyticsMeta: buildMissingPreaggregateMeta({
        poolId: normalizedPoolId,
        warning: preaggregateState?.available === false ? preaggregateState.warning : 'public_pool_analytics_cache_miss',
      }),
    },
  };
}

function flattenRankingItems(characterRanking = {}) {
  const itemMap = new Map();

  Object.entries(characterRanking || {}).forEach(([poolType, group]) => {
    Object.entries(group || {}).forEach(([bucket, rows]) => {
      if (!Array.isArray(rows)) {
        return;
      }

      rows.forEach((row) => {
        const name = normalizeQueryValue(row?.name);
        if (!name) {
          return;
        }

        const key = `${poolType}:${name}`;
        const current = itemMap.get(key) || {
          id: name,
          name,
          type: poolType === 'weapon' ? 'weapon' : 'character',
          rarity: bucket.toLowerCase().includes('six') ? 6 : bucket.toLowerCase().includes('five') ? 5 : null,
          isLimited: poolType === 'limited' || poolType === 'extra',
          totalPulls: 0,
          poolTypes: {},
          pools: [],
          sourceBuckets: [],
        };

        const count = toNumber(row.count, 0);
        current.totalPulls += count;
        current.poolTypes[poolType] = (current.poolTypes[poolType] || 0) + count;
        current.sourceBuckets.push({ poolType, bucket, count });
        itemMap.set(key, current);
      });
    });
  });

  return Array.from(itemMap.values())
    .sort((left, right) => right.totalPulls - left.totalPulls);
}

export async function fetchPublicAnalytics(adminClient) {
  const [globalSummary, characterRanking] = await Promise.all([
    fetchGlobalSummary(adminClient),
    fetchCharacterRanking(adminClient),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    rowCount: toNumber(globalSummary?.totalPullsWithFree ?? globalSummary?.totalPulls, 0),
    capped: false,
    source: 'cached_rpc',
    summary: normalizeSummaryCounter(globalSummary || {}),
    byPoolType: buildTypeSummary(globalSummary || {}),
    workbench: globalSummary?.workbench || null,
    items: flattenRankingItems(characterRanking || {}),
    rankings: characterRanking || {},
    trends: {},
  };
}

export async function buildPublicGlobalStats(adminClient) {
  const globalSummary = await fetchGlobalSummary(adminClient);
  const analytics = {
    summary: normalizeSummaryCounter(globalSummary || {}),
    byPoolType: buildTypeSummary(globalSummary || {}),
    workbench: globalSummary?.workbench || null,
    rowCount: toNumber(globalSummary?.totalPullsWithFree ?? globalSummary?.totalPulls, 0),
    capped: false,
    source: 'cached_rpc',
  };

  return {
    global: globalSummary || {},
    analytics,
  };
}

export async function buildPublicRankings(adminClient) {
  const characterRanking = await fetchCharacterRanking(adminClient);

  return {
    rankings: characterRanking || {},
    itemTop: flattenRankingItems(characterRanking || {}).slice(0, 30),
  };
}

export async function buildPublicPoolStats(adminClient, query = {}) {
  const pools = await fetchVisiblePools(adminClient);
  const nowMs = Date.now();
  const type = normalizeQueryValue(query.type).toLowerCase();
  const status = normalizeQueryValue(query.status).toLowerCase();
  const fromMs = parseDateMs(query.from);
  const toMs = parseDateMs(query.to);

  const filtered = (pools || [])
    .map((pool) => ({
      pool,
      poolType: normalizePoolType(pool.type, pool.id || pool.pool_id),
      status: getPoolStatus(pool, nowMs),
    }))
    .filter((item) => {
      if (type && item.poolType !== type) return false;
      if (status && item.status !== status) return false;

      const startMs = parseDateMs(item.pool.start_time);
      const endMs = parseDateMs(item.pool.end_time);
      if (Number.isFinite(fromMs) && Number.isFinite(endMs) && endMs < fromMs) return false;
      if (Number.isFinite(toMs) && Number.isFinite(startMs) && startMs > toMs) return false;

      return true;
    })
    .sort((left, right) => parseDateMs(right.pool.start_time) - parseDateMs(left.pool.start_time));

  const { items, page } = paginateArray(filtered, query, {
    defaultValue: HEAVY_PAGE_DEFAULT,
    max: HEAVY_PAGE_MAX,
  });
  const poolIds = items.map(item => item.pool.id || item.pool.pool_id).filter(Boolean);
  const preaggregateState = await fetchPoolAnalyticsCache(adminClient, poolIds);

  const poolStats = await Promise.all(items.map(async (item) => {
    const poolId = item.pool.id || item.pool.pool_id;
    const counter = await buildPoolCounter(adminClient, poolId, preaggregateState);

    return {
      pool: toPublicPoolDto(item.pool, { nowMs }),
      poolType: item.poolType,
      status: item.status,
      ...counter,
    };
  }));

  return {
    pools: poolStats,
    page,
  };
}

export async function buildPublicSinglePoolStats(adminClient, {
  id,
} = {}) {
  const pools = await fetchVisiblePools(adminClient);
  const normalizedId = normalizeQueryValue(id);
  const nowMs = Date.now();
  const pool = (pools || []).find((item) => String(item.id || item.pool_id) === normalizedId);

  if (!pool) {
    return null;
  }

  const poolId = pool.id || pool.pool_id;
  const preaggregateState = await fetchPoolAnalyticsCache(adminClient, [poolId]);
  const counter = await buildPoolCounter(adminClient, poolId, preaggregateState);

  return {
    pool: {
      pool: toPublicPoolDto(pool, { nowMs }),
      poolType: normalizePoolType(pool.type, pool.id || pool.pool_id),
      status: getPoolStatus(pool, nowMs),
      ...counter,
    },
  };
}

export async function buildPublicItemStats(adminClient, query = {}) {
  const [characters, characterRanking] = await Promise.all([
    fetchCharacters(adminClient),
    fetchCharacterRanking(adminClient),
  ]);
  const type = normalizeQueryValue(query.type).toLowerCase();
  const poolType = normalizeQueryValue(query.poolType).toLowerCase();
  const rarity = normalizeInteger(query.rarity);
  const rankedItems = flattenRankingItems(characterRanking || {});

  const rankedByName = new Map(rankedItems.map((item) => [item.name, item]));
  const catalogItems = (characters || [])
    .map((character) => rankedByName.get(character.name) || {
      id: character.id || character.name,
      name: character.name,
      type: character.type || 'character',
      rarity: character.rarity || null,
      isLimited: character.is_limited === true,
      totalPulls: null,
      poolTypes: {},
      pools: [],
      sourceBuckets: [],
    })
    .filter((item) => {
      if (type && item.type !== type) return false;
      if (rarity && Number(item.rarity) !== rarity) return false;
      if (poolType && !item.poolTypes?.[poolType]) return false;
      return true;
    })
    .sort((left, right) => toNumber(right.totalPulls, -1) - toNumber(left.totalPulls, -1));

  const { items, page } = paginateArray(catalogItems, query, {
    defaultValue: HEAVY_PAGE_DEFAULT,
    max: HEAVY_PAGE_MAX,
  });

  return {
    items,
    page,
  };
}

export async function buildPublicSingleItemStats(adminClient, {
  id,
  type = '',
} = {}) {
  const [characters, characterRanking] = await Promise.all([
    fetchCharacters(adminClient),
    fetchCharacterRanking(adminClient),
  ]);
  const normalizedId = normalizeQueryValue(id).toLowerCase();
  const normalizedType = normalizeQueryValue(type).toLowerCase();

  if (!normalizedId) {
    return null;
  }

  const rankedItems = flattenRankingItems(characterRanking || {});
  const matches = rankedItems.filter((item) => {
    if (normalizedType && item.type !== normalizedType) {
      return false;
    }

    return [item.id, item.name]
      .map((value) => normalizeQueryValue(value).toLowerCase())
      .includes(normalizedId);
  });

  if (matches.length > 0) {
    return { item: matches[0] };
  }

  const character = (characters || []).find((item) => {
    if (normalizedType && item.type !== normalizedType) {
      return false;
    }

    return [item.id, item.name]
      .map((value) => normalizeQueryValue(value).toLowerCase())
      .includes(normalizedId);
  });

  if (!character) {
    return null;
  }

  const counter = await buildScopedCounter(
    adminClient,
    (historyQuery) => historyQuery.eq('item_name', character.name)
  );

  return {
    item: {
      id: character.id || character.name,
      name: character.name,
      type: character.type || 'character',
      rarity: character.rarity || null,
      isLimited: character.is_limited === true,
      totalPulls: counter.stats.totalPulls,
      rarityCounts: counter.stats.rarityCounts,
      firstPullAt: counter.firstPullAt,
      lastPullAt: counter.lastPullAt,
      poolTypes: {},
      pools: [],
      source: counter.stats.source,
    },
  };
}

export async function buildPublicTrends(adminClient, query = {}) {
  const metric = normalizeTrendMetric(query.metric);
  const granularity = normalizeTrendGranularity(query.granularity);
  const days = normalizeTrendDays(query.days);
  const { poolType, poolId } = normalizeTrendScope(query);
  const trendState = await fetchPublicTrendCache(adminClient, {
    metric,
    granularity,
    days,
    poolType,
    poolId,
  });

  if (trendState.available === false) {
    return {
      metric,
      granularity,
      days,
      poolType,
      poolId,
      points: [],
      source: 'trend_cache_unavailable',
      analyticsMeta: buildTrendAnalyticsMeta({
        source: 'trend_cache_unavailable',
        partial: true,
        metric,
        granularity,
        days,
        poolType,
        poolId,
        warning: trendState.warning,
      }),
    };
  }

  const points = trendState.rows
    .map(normalizeTrendPoint)
    .filter((point) => point.period)
    .sort((left, right) => parseDateMs(left.period) - parseDateMs(right.period));
  const version = pickLatestTrendVersion(trendState.rows);
  const source = points.length > 0 ? 'preaggregated_trend_cache' : 'trend_cache_miss';

  return {
    metric,
    granularity,
    days,
    poolType,
    poolId,
    points,
    source,
    analyticsMeta: buildTrendAnalyticsMeta({
      source,
      partial: points.length === 0,
      metric,
      granularity,
      days,
      poolType,
      poolId,
      updatedAt: version.updatedAt,
      sourceVersion: version.sourceVersion,
      warning: points.length === 0 ? 'public_pool_trend_cache_miss' : null,
    }),
  };
}

export async function buildPublicDistributions(adminClient, query = {}) {
  const globalSummary = await fetchGlobalSummary(adminClient);
  const byPoolType = buildTypeSummary(globalSummary || {});
  const summary = normalizeSummaryCounter(globalSummary || {});
  const poolType = normalizeQueryValue(query.poolType || 'all').toLowerCase();

  if (poolType === 'all') {
    return {
      poolType,
      distribution: summary.distribution,
    };
  }

  if (poolType === 'character') {
    const bucketMap = new Map();
    ['limited', 'extra', 'standard'].forEach((type) => {
      (byPoolType[type]?.distribution || []).forEach(({ bucket, count }) => {
        bucketMap.set(bucket, (bucketMap.get(bucket) || 0) + count);
      });
    });

    return {
      poolType,
      distribution: Array.from(bucketMap.entries()).map(([bucket, count]) => ({ bucket, count })),
    };
  }

  return {
    poolType,
    distribution: byPoolType[poolType]?.distribution || [],
  };
}

export default {
  buildPublicDistributions,
  buildPublicGlobalStats,
  buildPublicItemStats,
  buildPublicSingleItemStats,
  buildPublicPoolStats,
  buildPublicRankings,
  buildPublicSinglePoolStats,
  buildPublicTrends,
  fetchPublicAnalytics,
};
