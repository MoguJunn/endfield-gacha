import { supabase } from '../supabaseClient.js';
import { RARITY_CONFIG, EXTRA_POOL_RULES, LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { buildResourceSummaryFromAggregates, buildWeaponQuotaSummaryFromCounts } from '../utils/resourceEconomy.js';
import { normalizeGlobalCharacterCatalog } from '../utils/quotaEconomy.js';
import {
  SUPABASE_RPC_TIMEOUT_MS,
  executeSupabaseRpc,
  isRetryableSupabaseError,
} from './supabaseRequest.js';
import {
  fetchPublicApiJson,
  shouldAllowPublicSupabaseFallback,
} from './publicResourceClient.js';
import { appLogger } from '../utils/appLogger.js';
import { readStorageValue, STORAGE_KEYS, writeStorageValue } from '../utils/storageUtils.js';
import { isContributorDemoModeEnabled } from '../dev/contributorDemoMode.js';
import {
  getContributorDemoSandboxSnapshot,
  initializeContributorDemoSandbox,
} from '../dev/contributorDemoSandboxStore.js';
import { sanitizePublicResourceUrl } from '../utils/publicResourceUrl.js';

/**
 * 统计服务
 * 架构说明：
 * - 公共全服数据：Stats API -> Supabase RPC -> localStorage
 * - 个人数据：Supabase RPC -> localStorage
 */

const GLOBAL_STATS_CACHE_TTL = 120 * 1000;
const CHARACTER_RANKING_CACHE_TTL = 120 * 1000;
const CHARACTER_CATALOG_CACHE_TTL = 120 * 1000;
const STATS_API_TIMEOUT_MS = 25000;
const STATS_API_TYPE_TIMEOUT_MS = {
  character_catalog: 12000,
};

export function sanitizeCharacterCatalogMedia(catalog) {
  if (!catalog || typeof catalog !== 'object') return catalog;
  return {
    ...catalog,
    rows: Array.isArray(catalog.rows)
      ? catalog.rows.map(({ avatar_url: legacyAvatarUrl, ...row }) => ({
        ...row,
        avatarUrl: sanitizePublicResourceUrl(row?.avatarUrl || legacyAvatarUrl),
      }))
      : catalog.rows,
  };
}

export function sanitizeGlobalSummaryMedia(summary) {
  if (!summary || typeof summary !== 'object') return summary;
  return {
    ...summary,
    characterCatalog: sanitizeCharacterCatalogMedia(summary.characterCatalog),
  };
}

const EXPECTED_LIMITED_UP_DISPLAY_COUNT = 6;
const globalStatsRequestState = {
  data: null,
  fetchedAt: 0,
  promise: null
};

const characterRankingRequestState = {
  data: null,
  fetchedAt: 0,
  promise: null
};

const characterCatalogRequestState = {
  data: null,
  fetchedAt: 0,
  promise: null
};

const userRankingRequestStates = new Map();

function createContributorSandboxGlobalStats() {
  return {
    totalPulls: 128640,
    totalPullsWithFree: 132480,
    freePullCount: 3840,
    chargedCharacterPulls: 82400,
    chargedWeaponPulls: 46240,
    infoBookPullCount: 1260,
    totalUsers: 2360,
    activeUsers30d: 1180,
    newUsers30d: 184,
    activeUsers90d: 1940,
    newUsers90d: 520,
    totalContributors: 1780,
    contributorsByRegion: { cn: 1450, intl: 330 },
    contributorActivity: null,
    sixStarTotal: 3420,
    sixStarLimited: 2310,
    sixStarStandard: 1110,
    fiveStar: 15480,
    fourStar: 113580,
    counts: { 6: 2310, '6_std': 1110, 5: 15480, 4: 113580 },
    distribution: [],
    chartData: [],
    byType: {
      extra: createEmptyTypeStats(),
      limited: createEmptyTypeStats(),
      weapon: createEmptyTypeStats(),
      standard: createEmptyTypeStats(),
      character: createEmptyTypeStats(),
    },
    avgPity: 37.6,
    charGift: 72,
    weaponGiftLimited: 48,
    weaponGiftStandard: 19,
    giftTotal: 139,
    resources: buildResourceSummaryFromAggregates(),
  };
}

function buildContributorSandboxCatalog() {
  const snapshot = getContributorDemoSandboxSnapshot();
  const totalContributors = 1780;
  const rows = snapshot.characters.filter((item) => Number(item.rarity) >= 4).map((item, index) => {
    const ownerUsers = Math.max(120, 1680 - index * 13);
    const fullPotentialUsers = Math.max(4, 190 - index * 2);
    return {
      id: item.id,
      name: item.name,
      avatarUrl: item.avatar_url || null,
      rarity: Number(item.rarity),
      type: item.type,
      isLimited: Boolean(item.is_limited),
      releaseDate: item.release_date || null,
      ownerUsers,
      unownedUsers: Math.max(totalContributors - ownerUsers, 0),
      ownershipRate: ownerUsers / totalContributors,
      fullPotentialUsers,
      fullPotentialRateOfOwners: fullPotentialUsers / ownerUsers,
      fullPotentialRateOfContributors: fullPotentialUsers / totalContributors,
      totalCopies: ownerUsers + fullPotentialUsers * 2,
      avgCopiesPerOwner: (ownerUsers + fullPotentialUsers * 2) / ownerUsers,
      copyDistribution: { 1: Math.max(ownerUsers - fullPotentialUsers, 0), 6: fullPotentialUsers },
      quota: {},
      dataSource: 'global',
      rankingInfo: [],
    };
  });
  return {
    totalContributors,
    summary: {
      totalCharacters: rows.length,
      ownedCharacters: rows.length,
      unownedCharacters: 0,
      ownershipRate: 1,
      fullPotentialCharacters: rows.length,
      quota: {},
      characterQuota: {},
      weaponQuota: {},
      excessTrustTokens: 620,
    },
    rows,
    meta: { status: 'ready', source: 'contributor-local-sandbox' },
  };
}

function buildContributorSandboxRanking() {
  const entries = getContributorDemoSandboxSnapshot().characters
    .filter((item) => Number(item.rarity) >= 5)
    .map((item, index) => ({ id: item.id, name: item.name, count: Math.max(8, 420 - index * 7), avgPity: 28 + (index % 8) * 2.3 }));
  return {
    extra: { sixStarUp: entries.filter((item) => item.id.startsWith('chr_')).slice(0, 8) },
    limited: { sixStarUp: entries.filter((item) => item.id.startsWith('chr_')).slice(0, 12) },
    standard: { sixStar: entries.filter((item) => item.id.startsWith('chr_')).slice(0, 12) },
    weapon: { sixStarUp: entries.filter((item) => item.id.startsWith('wpn_')).slice(0, 12) },
    meta: { status: 'ready', source: 'contributor-local-sandbox' },
  };
}

function readPersistedSnapshot(key) {
  try {
    const raw = readStorageValue(key, null, { raw: true });
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePersistedSnapshot(key, data) {
  try {
    writeStorageValue(key, JSON.stringify(data), { raw: true });
  } catch {
    // 忽略持久化缓存失败
  }
}

function withStatsMeta(stats, meta = {}) {
  return {
    ...stats,
    meta: {
      ...(stats?.meta || {}),
      ...meta
    }
  };
}

async function fetchStatsApi(type) {
  const result = await fetchPublicApiJson('/api/stats', {
    params: { type },
    label: `stats api ${type}`,
    timeoutMs: STATS_API_TYPE_TIMEOUT_MS[type] || STATS_API_TIMEOUT_MS,
    retries: type === 'character_catalog' ? 0 : 1
  });

  return result?.data || null;
}

async function fetchGlobalSummaryDirect() {
  if (!supabase) {
    return null;
  }

  const { data, error } = await runRpcWithTimeout('get_global_stats_cached');
  if (error) {
    throw error;
  }

  return data ?? null;
}

async function fetchCharacterCatalogDirect() {
  if (!supabase) {
    return null;
  }

  const { data, error } = await runRpcWithTimeout('get_character_catalog_stats_cached');
  if (error) {
    throw error;
  }

  return data ?? null;
}

async function fetchCharacterCatalogUncached() {
  if (!supabase) {
    return null;
  }

  const { data, error } = await runRpcWithTimeout('get_character_catalog_stats');
  if (error) {
    throw error;
  }

  return data ?? null;
}

async function fetchCharacterRankingDirect() {
  if (!supabase) {
    return null;
  }

  const { data, error } = await runRpcWithTimeout('get_character_ranking_stats_cached');
  if (error) {
    throw error;
  }

  return data ?? null;
}

async function fetchCharacterRankingUncached() {
  if (!supabase) {
    return null;
  }

  const { data, error } = await runRpcWithTimeout('get_character_ranking_stats');
  if (error) {
    throw error;
  }

  return data ?? null;
}

async function fetchUserRankingUncached(userId) {
  if (!supabase || !userId) {
    return null;
  }

  const { data, error } = await runRpcWithTimeout('get_user_ranking_stats', { p_user_id: userId });
  if (error) {
    throw error;
  }

  return data ?? null;
}

function createEmptyTypeStats() {
  return {
    total: 0,
    chargedPulls: 0,
    six: 0,
    sixStarLimited: 0,
    sixStarStandard: 0,
    avgPity: null,
    avgPityUp: null,
    avgPityTarget: null,
    sparkCount: 0,
    avgPityExcludingFree: null,
    counts: {},
    distribution: [],
    chartData: [],
    resources: buildResourceSummaryFromAggregates()
  };
}

function getLimitedUpRankingLength(ranking) {
  const entries = ranking?.limited?.sixStarUp || ranking?.limited?.sixStar || [];
  return Array.isArray(entries) ? entries.length : 0;
}

function shouldBypassRankingCache(ranking) {
  return getLimitedUpRankingLength(ranking) === EXPECTED_LIMITED_UP_DISPLAY_COUNT - 1;
}

export function createEmptyGlobalSummaryStats(meta = {}) {
  return {
    totalPulls: 0,
    totalPullsWithFree: 0,
    freePullCount: 0,
    chargedCharacterPulls: 0,
    chargedWeaponPulls: 0,
    infoBookPullCount: 0,
    totalUsers: 0,
    activeUsers30d: 0,
    newUsers30d: 0,
    activeUsers90d: 0,
    newUsers90d: 0,
    totalContributors: 0,
    contributorsByRegion: null,
    contributorActivity: null,
    sixStarTotal: 0,
    sixStarLimited: 0,
    sixStarStandard: 0,
    fiveStar: 0,
    fourStar: 0,
    counts: {},
    distribution: [],
    chartData: [],
    byType: {
      extra: createEmptyTypeStats(),
      limited: createEmptyTypeStats(),
      weapon: createEmptyTypeStats(),
      standard: createEmptyTypeStats(),
      character: createEmptyTypeStats()
    },
    avgPity: null,
    charGift: 0,
    weaponGiftLimited: 0,
    weaponGiftStandard: 0,
    giftTotal: 0,
    characterCatalog: null,
    resources: buildResourceSummaryFromAggregates(),
    meta: {
      status: 'empty',
      source: 'empty',
      ...meta
    }
  };
}

function isFreshCache(state, ttl) {
  return state.data !== null && Date.now() - state.fetchedAt < ttl;
}

async function runCachedRequest(state, fetcher, { cacheTtl = 0, forceRefresh = false } = {}) {
  if (!forceRefresh && cacheTtl > 0 && isFreshCache(state, cacheTtl)) {
    return state.data;
  }

  if (!forceRefresh && state.promise) {
    return state.promise;
  }

  state.promise = (async () => {
    const result = await fetcher();
    state.data = result;
    state.fetchedAt = Date.now();
    return result;
  })();

  try {
    return await state.promise;
  } finally {
    state.promise = null;
  }
}

async function runRpcWithTimeout(rpcName, params = {}, timeoutMs = SUPABASE_RPC_TIMEOUT_MS) {
  return executeSupabaseRpc(
    () => supabase.rpc(rpcName, params),
    {
      label: rpcName,
      timeoutMs,
    }
  );
}

function generateChartData(counts) {
  if (!counts) return [];

  const rawData = [
    { name: '6星(限定)', value: counts['6'] || 0, color: RARITY_CONFIG[6].color },
    { name: '6星(常驻)', value: counts['6_std'] || 0, color: RARITY_CONFIG['6_std'].color },
    { name: '5星', value: counts['5'] || 0, color: RARITY_CONFIG[5].color },
    { name: '4星', value: counts['4'] || 0, color: RARITY_CONFIG[4].color },
  ].filter(item => item.value > 0);

  const totalValue = rawData.reduce((sum, item) => sum + item.value, 0);

  return rawData.map(item => {
    const currentPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
    let minPercent = 0;

    if (item.name.includes('6星')) minPercent = 15;
    else if (item.name.includes('5星')) minPercent = 20;

    if (currentPercent < minPercent && totalValue > 0) {
      return {
        ...item,
        displayValue: Math.ceil(totalValue * minPercent / 100)
      };
    }

    return {
      ...item,
      displayValue: item.value
    };
  });
}

function processDistribution(distribution, hardPityLimit = LIMITED_POOL_RULES.sixStarPity) {
  if (!Array.isArray(distribution)) return [];

  const numBuckets = Math.ceil(hardPityLimit / 10);
  const result = [];

  for (let i = 0; i < numBuckets; i++) {
    const rangeStart = i * 10 + 1;
    const rangeEnd = (i + 1) * 10;
    const range = `${rangeStart}-${rangeEnd}`;
    const isLast = i === numBuckets - 1;

    let limited = 0;
    let standard = 0;

    distribution.forEach(item => {
      const itemStart = parseInt(item.range?.split('-')[0], 10);
      if (isNaN(itemStart)) return;
      const itemBucket = Math.floor((itemStart - 1) / 10);
      if (isLast ? itemBucket >= i : itemBucket === i) {
        limited += Number(item.limited) || 0;
        standard += Number(item.standard) || 0;
      }
    });

    result.push({ range, limited, standard, count: limited + standard });
  }

  return result;
}

function processTypeStats(typeData) {
  if (!typeData) {
    return createEmptyTypeStats();
  }

  const total = typeData.total || 0;
  const chargedPulls = Number(typeData.chargedPulls ?? total) || 0;
  const counts = typeData.counts || {};
  const normalizedType = typeData.poolType || null;
  const quotaSummary = normalizedType === 'weapon'
    ? buildWeaponQuotaSummaryFromCounts(counts)
    : typeData.quotaSummary || typeData.quotaAggregate || null;

  return {
    total,
    chargedPulls,
    six: typeData.six || 0,
    sixStarLimited: typeData.sixStarLimited || 0,
    sixStarStandard: typeData.sixStarStandard || 0,
    avgPity: typeData.avgPity || null,
    avgPityUp: typeData.avgPityUp || null,
    avgPityTarget: typeData.avgPityTarget || typeData.avgPityUp || null,
    sparkCount: typeData.sparkCount || 0,
    avgPityExcludingFree: typeData.avgPityExcludingFree || null,
    counts,
    distribution: processDistribution(
      typeData.distribution,
      normalizedType === 'weapon'
        ? WEAPON_POOL_RULES.sixStarPity
        : normalizedType === 'extra'
          ? EXTRA_POOL_RULES.sixStarPity
          : LIMITED_POOL_RULES.sixStarPity
    ),
    chartData: generateChartData(counts),
    resources: buildResourceSummaryFromAggregates({
      characterPulls: normalizedType === 'weapon' ? 0 : total,
      weaponPulls: normalizedType === 'weapon' ? total : 0,
      chargedCharacterPulls: normalizedType === 'weapon' ? 0 : chargedPulls,
      chargedWeaponPulls: normalizedType === 'weapon' ? chargedPulls : 0,
      counts,
      arsenalGainCounts: normalizedType === 'weapon' ? {} : counts,
      quotaSummary
    })
  };
}

function mergeDistributions(...sources) {
  const hardPityLimit = LIMITED_POOL_RULES.sixStarPity;
  const numBuckets = Math.ceil(hardPityLimit / 10);
  const merged = new Array(numBuckets).fill(null).map((_, i) => ({
    range: `${i * 10 + 1}-${(i + 1) * 10}`,
    limited: 0,
    standard: 0
  }));

  sources.flat().forEach(item => {
    const start = parseInt(item.range?.split('-')[0], 10);
    if (isNaN(start)) return;
    let idx = Math.floor((start - 1) / 10);
    if (idx >= numBuckets) idx = numBuckets - 1;
    merged[idx].limited += item.limited || 0;
    merged[idx].standard += item.standard || 0;
  });

  return merged.map(item => ({ ...item, count: item.limited + item.standard }));
}

function mergeCatalogQuotaIntoSummary(stats, catalog) {
  if (!stats || !catalog?.summary?.quota) {
    return stats;
  }

  const hasQuotaValue = (quota) => [
    'aicQuotaDirect',
    'aicQuotaConvertible',
    'aicQuotaTotalPotential',
    'bondQuotaDirect',
    'endpointQuotaConvertible',
    'trustTokensGained',
    'excessTrustTokens'
  ].some((key) => Number(quota?.[key] || 0) > 0);
  const totalQuota = catalog.summary.quota;
  const weaponQuota = hasQuotaValue(catalog.summary.weaponQuota)
    ? catalog.summary.weaponQuota
    : buildWeaponQuotaSummaryFromCounts(stats.byType?.weapon?.counts || {});
  const characterQuota = hasQuotaValue(catalog.summary.characterQuota) ? catalog.summary.characterQuota : {
    ...totalQuota,
    aicQuotaDirect: Math.max(Number(totalQuota.aicQuotaDirect || 0) - Number(weaponQuota.aicQuotaDirect || 0), 0),
    aicQuotaTotalPotential: Math.max(
      Number(totalQuota.aicQuotaTotalPotential || 0) - Number(weaponQuota.aicQuotaTotalPotential || 0),
      0
    )
  };
  const mergedResources = {
    ...(stats.resources || {}),
    ...totalQuota
  };

  return {
    ...stats,
    characterCatalog: catalog,
    resources: mergedResources,
    byType: {
      ...(stats.byType || {}),
      character: {
        ...(stats.byType?.character || {}),
        resources: {
          ...(stats.byType?.character?.resources || {}),
          ...characterQuota
        }
      },
      weapon: {
        ...(stats.byType?.weapon || {}),
        resources: {
          ...(stats.byType?.weapon?.resources || {}),
          ...weaponQuota
        }
      }
    }
  };
}

export function normalizeGlobalStats(rpcData) {
  if (!rpcData) {
    return createEmptyGlobalSummaryStats();
  }

  const contributorActivity = rpcData.contributorActivity || rpcData.contributor_activity || null;
  const contributorActivityWindowDays = Number(contributorActivity?.windowDays || 0);
  const contributorActivityActiveUsers = Number(contributorActivity?.activeUsers || 0) || 0;
  const contributorActivityNewUsers = Number(contributorActivity?.newUsers || 0) || 0;
  const activeUsers30d = Number(
    rpcData.activeUsers30d ??
    rpcData.active_users_30d ??
    (contributorActivityWindowDays === 30 ? contributorActivityActiveUsers : undefined)
  ) || 0;
  const newUsers30d = Number(
    rpcData.newUsers30d ??
    rpcData.new_users_30d ??
    (contributorActivityWindowDays === 30 ? contributorActivityNewUsers : undefined)
  ) || 0;

  const stats = {
    totalPulls: rpcData.totalPulls || 0,
    totalPullsWithFree: rpcData.totalPullsWithFree || rpcData.totalPulls || 0,
    freePullCount: rpcData.freePullCount || 0,
    chargedCharacterPulls: 0,
    chargedWeaponPulls: 0,
    infoBookPullCount: Number(rpcData.infoBookPullCount) || 0,
    totalUsers: rpcData.totalUsers || 0,
    activeUsers30d,
    newUsers30d,
    activeUsers90d: Number(
      rpcData.activeUsers90d ??
      rpcData.active_users_90d ??
      (contributorActivityWindowDays === 90 ? contributorActivityActiveUsers : undefined)
    ) || activeUsers30d,
    newUsers90d: Number(
      rpcData.newUsers90d ??
      rpcData.new_users_90d ??
      (contributorActivityWindowDays === 90 ? contributorActivityNewUsers : undefined)
    ) || newUsers30d,
    totalContributors: Number(rpcData.totalContributors ?? rpcData.total_contributors ?? rpcData.totalUsers ?? 0) || 0,
    contributorsByRegion: rpcData.contributorsByRegion
      ? {
          cn: Number(rpcData.contributorsByRegion.cn ?? 0) || 0,
          intl: Number(rpcData.contributorsByRegion.intl ?? 0) || 0
        }
      : null,
    contributorActivity,
    sixStarTotal: rpcData.sixStarTotal || 0,
    sixStarLimited: rpcData.sixStarLimited || 0,
    sixStarStandard: rpcData.sixStarStandard || 0,
    fiveStar: rpcData.fiveStar || 0,
    fourStar: rpcData.fourStar || 0,
    counts: rpcData.counts || {},
    distribution: processDistribution(rpcData.distribution),
    chartData: generateChartData(rpcData.counts),
    byType: {
      extra: processTypeStats({ ...rpcData.byType?.extra, poolType: 'extra' }),
      limited: processTypeStats({ ...rpcData.byType?.limited, poolType: 'limited' }),
      weapon: processTypeStats({ ...rpcData.byType?.weapon, poolType: 'weapon' }),
      standard: processTypeStats({ ...rpcData.byType?.standard, poolType: 'standard' })
    },
    avgPity: rpcData.avgPity || null,
    charGift: rpcData.charGift || 0,
    weaponGiftLimited: rpcData.weaponGiftLimited || 0,
    weaponGiftStandard: rpcData.weaponGiftStandard || 0,
    giftTotal: rpcData.giftTotal || 0,
    meta: {
      status: 'ready',
      source: 'rpc',
      fetchedAt: Date.now()
    }
  };

  const extraStats = stats.byType.extra;
  const limitedStats = stats.byType.limited;
  const standardStats = stats.byType.standard;
  const weaponStats = stats.byType.weapon;
  const extraChargedPulls = Number(extraStats.chargedPulls ?? extraStats.total) || 0;
  const limitedChargedPulls = Number(limitedStats.chargedPulls ?? limitedStats.total) || 0;
  const standardChargedPulls = Number(standardStats.chargedPulls ?? standardStats.total) || 0;
  const weaponChargedPulls = Number(weaponStats.chargedPulls ?? weaponStats.total) || 0;
  stats.chargedCharacterPulls = Number(rpcData.chargedCharacterPulls ?? (extraChargedPulls + limitedChargedPulls + standardChargedPulls)) || 0;
  stats.chargedWeaponPulls = Number(rpcData.chargedWeaponPulls ?? weaponChargedPulls) || 0;
  const extraSix = extraStats.six || 0;
  const limitedSix = limitedStats.six || 0;
  const standardSix = standardStats.six || 0;
  const totalSix = extraSix + limitedSix + standardSix;

  let characterAvgPity = null;
  if (totalSix > 0 && (extraStats.avgPity || limitedStats.avgPity || standardStats.avgPity)) {
    const extraAvg = Number(extraStats.avgPity) || 0;
    const limitedAvg = Number(limitedStats.avgPity) || 0;
    const standardAvg = Number(standardStats.avgPity) || 0;
    characterAvgPity = ((extraAvg * extraSix + limitedAvg * limitedSix + standardAvg * standardSix) / totalSix).toFixed(1);
  }

  let characterAvgPityExcludingFree = null;
  if (totalSix > 0 && (extraStats.avgPityExcludingFree || limitedStats.avgPityExcludingFree || standardStats.avgPityExcludingFree)) {
    const extraAvgExcludingFree = Number(extraStats.avgPityExcludingFree) || Number(extraStats.avgPity) || 0;
    const limitedAvgExcludingFree = Number(limitedStats.avgPityExcludingFree) || Number(limitedStats.avgPity) || 0;
    const standardAvgExcludingFree = Number(standardStats.avgPityExcludingFree) || Number(standardStats.avgPity) || 0;
    characterAvgPityExcludingFree = ((extraAvgExcludingFree * extraSix + limitedAvgExcludingFree * limitedSix + standardAvgExcludingFree * standardSix) / totalSix).toFixed(1);
  }

  const extraTargetSix = extraStats.sixStarLimited || 0;
  const limitedTargetSix = limitedStats.sixStarLimited || 0;
  const totalCharacterTargetSix = extraTargetSix + limitedTargetSix;
  let characterAvgPityTarget = null;
  if (totalCharacterTargetSix > 0 && (extraStats.avgPityTarget || extraStats.avgPityUp || limitedStats.avgPityTarget || limitedStats.avgPityUp)) {
    const extraTargetAvg = Number(extraStats.avgPityTarget || extraStats.avgPityUp) || 0;
    const limitedTargetAvg = Number(limitedStats.avgPityTarget || limitedStats.avgPityUp) || 0;
    characterAvgPityTarget = ((extraTargetAvg * extraTargetSix + limitedTargetAvg * limitedTargetSix) / totalCharacterTargetSix).toFixed(1);
  }

  const characterCounts = {
    '6': (extraStats.counts['6'] || 0) + (limitedStats.counts['6'] || 0) + (standardStats.counts['6'] || 0),
    '6_std': (extraStats.counts['6_std'] || 0) + (limitedStats.counts['6_std'] || 0) + (standardStats.counts['6_std'] || 0),
    '5': (extraStats.counts['5'] || 0) + (limitedStats.counts['5'] || 0) + (standardStats.counts['5'] || 0),
    '4': (extraStats.counts['4'] || 0) + (limitedStats.counts['4'] || 0) + (standardStats.counts['4'] || 0)
  };

  stats.byType.character = {
    total: extraStats.total + limitedStats.total + standardStats.total,
    chargedPulls: extraChargedPulls + limitedChargedPulls + standardChargedPulls,
    six: extraStats.six + limitedStats.six + standardStats.six,
    sixStarLimited: extraStats.sixStarLimited + limitedStats.sixStarLimited + standardStats.sixStarLimited,
    sixStarStandard: extraStats.sixStarStandard + limitedStats.sixStarStandard + standardStats.sixStarStandard,
    avgPity: characterAvgPity,
    avgPityUp: characterAvgPityTarget,
    avgPityTarget: characterAvgPityTarget,
    sparkCount: limitedStats.sparkCount || 0,
    avgPityExcludingFree: characterAvgPityExcludingFree,
    counts: characterCounts,
    distribution: mergeDistributions(extraStats.distribution, limitedStats.distribution, standardStats.distribution),
    chartData: generateChartData(characterCounts),
    resources: buildResourceSummaryFromAggregates({
      characterPulls: extraStats.total + limitedStats.total + standardStats.total,
      chargedCharacterPulls: extraChargedPulls + limitedChargedPulls + standardChargedPulls,
      counts: characterCounts,
      arsenalGainCounts: characterCounts
    })
  };

  stats.resources = buildResourceSummaryFromAggregates({
    characterPulls: stats.byType.character.total,
    weaponPulls: stats.byType.weapon.total,
    chargedCharacterPulls: stats.chargedCharacterPulls,
    chargedWeaponPulls: stats.chargedWeaponPulls,
    counts: stats.counts,
    arsenalGainCounts: stats.byType.character.counts
  });

  return stats;
}

function getUserRankingRequestState(userId) {
  if (!userRankingRequestStates.has(userId)) {
    userRankingRequestStates.set(userId, {
      data: null,
      fetchedAt: 0,
      promise: null
    });
  }

  return userRankingRequestStates.get(userId);
}

function isRecoverableStatsError(error) {
  return isRetryableSupabaseError(error);
}

function logStatsFailure(scope, error) {
  if (isRecoverableStatsError(error)) {
    appLogger.warn(`[statsService] ${scope}请求超时，已回退到缓存/空态（跨境网络较慢时可重试）`, error);
    return;
  }

  appLogger.error(`[statsService] ${scope}失败:`, error);
}

/**
 * 获取全服统计概览
 * 单飞 + 短 TTL 缓存，避免统计页和初始化阶段重复打重 RPC
 * @param {boolean} forceRefresh - 是否强制刷新
 * @returns {Promise<Object|null>} 归一化后的全服统计数据
 */
export async function getGlobalSummaryStats(forceRefresh = false) {
  if (isContributorDemoModeEnabled()) {
    await initializeContributorDemoSandbox();
    return {
      ...createContributorSandboxGlobalStats(),
      characterCatalog: buildContributorSandboxCatalog(),
      meta: { status: 'ready', source: 'contributor-local-sandbox', fetchedAt: Date.now() },
    };
  }
  try {
    return await runCachedRequest(
      globalStatsRequestState,
      async () => {
        const [apiPayload, catalogPayload] = await Promise.all([
          fetchStatsApi('global_summary').catch(() => null),
          getCharacterCatalogStats(forceRefresh).catch(() => null)
        ]);
        if (apiPayload?.globalSummary) {
          const normalizedFromApi = sanitizeGlobalSummaryMedia(withStatsMeta(
            mergeCatalogQuotaIntoSummary(
              normalizeGlobalStats(apiPayload.globalSummary),
              catalogPayload
            ),
            {
            source: 'api',
            fetchedAt: Date.now()
            }
          ));
          writePersistedSnapshot(STORAGE_KEYS.GLOBAL_SUMMARY_STATS_SNAPSHOT, normalizedFromApi);
          return normalizedFromApi;
        }

        if (shouldAllowPublicSupabaseFallback()) {
          const directSummary = await fetchGlobalSummaryDirect().catch(() => null);
          if (directSummary) {
            const normalizedFromDirect = sanitizeGlobalSummaryMedia(withStatsMeta(
              mergeCatalogQuotaIntoSummary(
                normalizeGlobalStats(directSummary),
                catalogPayload
              ),
              {
              source: 'supabase-direct',
              fetchedAt: Date.now()
              }
            ));
            writePersistedSnapshot(STORAGE_KEYS.GLOBAL_SUMMARY_STATS_SNAPSHOT, normalizedFromDirect);
            return normalizedFromDirect;
          }
        }

        const persistedSnapshot = sanitizeGlobalSummaryMedia(
          readPersistedSnapshot(STORAGE_KEYS.GLOBAL_SUMMARY_STATS_SNAPSHOT)
        );
        if (persistedSnapshot) {
          writePersistedSnapshot(STORAGE_KEYS.GLOBAL_SUMMARY_STATS_SNAPSHOT, persistedSnapshot);
          return withStatsMeta(persistedSnapshot, {
            status: 'stale',
            source: 'local-cache'
          });
        }

        return createEmptyGlobalSummaryStats({
          status: 'unavailable',
          source: 'missing-stats-api'
        });
      },
      { cacheTtl: GLOBAL_STATS_CACHE_TTL, forceRefresh }
    );
  } catch (error) {
    logStatsFailure('获取全服统计', error);
    const persisted = sanitizeGlobalSummaryMedia(
      readPersistedSnapshot(STORAGE_KEYS.GLOBAL_SUMMARY_STATS_SNAPSHOT)
    );

    if (globalStatsRequestState.data) {
      return withStatsMeta(sanitizeGlobalSummaryMedia(globalStatsRequestState.data), {
        status: 'stale',
        source: 'memory-cache',
        lastErrorCode: error?.code || null
      });
    }

    if (persisted) {
      return withStatsMeta(persisted, {
        status: 'stale',
        source: 'local-cache',
        lastErrorCode: error?.code || null
      });
    }

    return createEmptyGlobalSummaryStats({
      status: 'unavailable',
      source: 'timeout',
      lastErrorCode: error?.code || null
    });
  }
}

export async function getCharacterCatalogStats(forceRefresh = false) {
  if (isContributorDemoModeEnabled()) {
    await initializeContributorDemoSandbox();
    return buildContributorSandboxCatalog();
  }
  try {
    return await runCachedRequest(
      characterCatalogRequestState,
      async () => {
        const apiPayload = await fetchStatsApi('character_catalog').catch(() => null);
        if (apiPayload?.characterCatalog) {
          const normalizedFromApi = sanitizeCharacterCatalogMedia(
            normalizeGlobalCharacterCatalog(apiPayload.characterCatalog)
          );
          writePersistedSnapshot(STORAGE_KEYS.CHARACTER_CATALOG_SNAPSHOT, normalizedFromApi);
          return normalizedFromApi;
        }

        if (shouldAllowPublicSupabaseFallback()) {
          const directCatalog = await fetchCharacterCatalogDirect().catch(() => null);
          if (directCatalog) {
            const normalizedFromDirect = sanitizeCharacterCatalogMedia(
              normalizeGlobalCharacterCatalog(directCatalog)
            );
            writePersistedSnapshot(STORAGE_KEYS.CHARACTER_CATALOG_SNAPSHOT, normalizedFromDirect);
            return normalizedFromDirect;
          }

          const uncachedCatalog = await fetchCharacterCatalogUncached().catch(() => null);
          if (uncachedCatalog) {
            const normalizedFromUncached = sanitizeCharacterCatalogMedia(
              normalizeGlobalCharacterCatalog(uncachedCatalog)
            );
            writePersistedSnapshot(STORAGE_KEYS.CHARACTER_CATALOG_SNAPSHOT, normalizedFromUncached);
            return normalizedFromUncached;
          }
        }

        const persisted = sanitizeCharacterCatalogMedia(
          readPersistedSnapshot(STORAGE_KEYS.CHARACTER_CATALOG_SNAPSHOT)
        );
        if (persisted) writePersistedSnapshot(STORAGE_KEYS.CHARACTER_CATALOG_SNAPSHOT, persisted);
        return persisted;
      },
      { cacheTtl: CHARACTER_CATALOG_CACHE_TTL, forceRefresh }
    );
  } catch (error) {
    logStatsFailure('获取角色图鉴', error);
    return sanitizeCharacterCatalogMedia(
      characterCatalogRequestState.data || readPersistedSnapshot(STORAGE_KEYS.CHARACTER_CATALOG_SNAPSHOT)
    ) || null;
  }
}

/**
 * 获取角色出货排名统计
 * 全服排行榜变化慢，复用短 TTL 缓存避免 StrictMode 和切页重复请求
 * @returns {Promise<Object>} 角色排名数据
 */
export async function getCharacterRankingStats(forceRefresh = false) {
  if (isContributorDemoModeEnabled()) {
    await initializeContributorDemoSandbox();
    return buildContributorSandboxRanking();
  }
  try {
    return await runCachedRequest(
      characterRankingRequestState,
      async () => {
        const apiPayload = await fetchStatsApi('character_ranking').catch(() => null);
        if (apiPayload?.characterRanking && !shouldBypassRankingCache(apiPayload.characterRanking)) {
          writePersistedSnapshot(STORAGE_KEYS.CHARACTER_RANKING_SNAPSHOT, apiPayload.characterRanking);
          return apiPayload.characterRanking;
        }

        if (shouldAllowPublicSupabaseFallback()) {
          const directRanking = await fetchCharacterRankingDirect().catch(() => null);
          if (directRanking && !shouldBypassRankingCache(directRanking)) {
            writePersistedSnapshot(STORAGE_KEYS.CHARACTER_RANKING_SNAPSHOT, directRanking);
            return directRanking;
          }

          const uncachedRanking = await fetchCharacterRankingUncached().catch(() => null);
          if (uncachedRanking) {
            writePersistedSnapshot(STORAGE_KEYS.CHARACTER_RANKING_SNAPSHOT, uncachedRanking);
            return uncachedRanking;
          }
        }

        return readPersistedSnapshot(STORAGE_KEYS.CHARACTER_RANKING_SNAPSHOT);
      },
      { cacheTtl: CHARACTER_RANKING_CACHE_TTL, forceRefresh }
    );
  } catch (error) {
    logStatsFailure('获取角色排名', error);
    return characterRankingRequestState.data || readPersistedSnapshot(STORAGE_KEYS.CHARACTER_RANKING_SNAPSHOT) || null;
  }
}

/**
 * 获取用户个人出货排名统计
 * @param {string} userId - 用户ID
 * @returns {Promise<Object>} 用户个人排名数据
 */
export async function getUserRankingStats(userId) {
  if (isContributorDemoModeEnabled()) {
    await initializeContributorDemoSandbox();
    return buildContributorSandboxRanking();
  }
  try {
    if (!supabase) {
      appLogger.warn('[statsService] Supabase 未配置，无法获取用户排名');
      return readPersistedSnapshot(`${STORAGE_KEYS.USER_RANKING_SNAPSHOT_PREFIX}${userId}`);
    }

    if (!userId) {
      appLogger.warn('[statsService] 未提供用户ID');
      return null;
    }

    const requestState = getUserRankingRequestState(userId);

    return await runCachedRequest(
      requestState,
      async () => {
        const { data, error } = await runRpcWithTimeout('get_user_ranking_stats_cached', { p_user_id: userId });

        if (error) {
          throw error;
        }

        if (shouldBypassRankingCache(data)) {
          const uncachedRanking = await fetchUserRankingUncached(userId).catch(() => null);
          if (uncachedRanking) {
            writePersistedSnapshot(`${STORAGE_KEYS.USER_RANKING_SNAPSHOT_PREFIX}${userId}`, uncachedRanking);
            return uncachedRanking;
          }
        }

        writePersistedSnapshot(`${STORAGE_KEYS.USER_RANKING_SNAPSHOT_PREFIX}${userId}`, data);
        return data;
      }
    );
  } catch (error) {
    logStatsFailure('获取用户排名', error);
    return getUserRankingRequestState(userId).data || readPersistedSnapshot(`${STORAGE_KEYS.USER_RANKING_SNAPSHOT_PREFIX}${userId}`) || null;
  }
}
