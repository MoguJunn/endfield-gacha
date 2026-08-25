import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { attachPoolSixStarRoster, buildPoolSixStarRosterMap } from '../../_lib/poolCatalogRoster.js';
import {
  buildPublicCacheKey,
  PUBLIC_CACHE_CONTROL,
  readRequestCacheVersion,
  resolvePublicCacheVersion,
  sendPublicJson,
} from '../../_lib/publicCache.js';
import { serverLogger } from '../../_lib/serverLogger.js';
import { resolveSupabaseServerKey, resolveSupabaseUrl } from '../../_lib/supabaseEnv.js';
import { buildVersionCalendarPayload, mergeVersionTimelineConfig } from '../../_lib/versionCalendarSnapshot.js';
import { getCanonicalExtraPoolSubtype } from '../../../shared/extraPoolSubtype.js';

// 内存缓存
const cache = {
  pools: null,
  poolsLastFetch: 0,
  poolCatalog: null,
  poolCatalogLastFetch: 0,
  versionCalendar: null,
  versionCalendarLastFetch: 0,
  characters: null,
  charactersLastFetch: 0,
  globalSummary: null,
  globalSummaryLastFetch: 0,
  characterRanking: null,
  characterRankingLastFetch: 0,
  characterCatalog: null,
  characterCatalogLastFetch: 0,
  metaByType: {},
};

const CACHE_TTL = 60 * 1000; // 60秒缓存
const CHARACTER_CATALOG_RPC_TIMEOUT_MS = 8500;
const CHARACTER_RANKING_RPC_TIMEOUT_MS = 8500;
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const PRIVATE_CHARACTER_CATALOG_KEYS = new Set([
  'user_id',
  'game_uid',
  'history_id',
  'record_id',
  'platform_user_id',
  'email',
]);

// 创建 Supabase 客户端
function getSupabaseClient() {
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseKey = resolveSupabaseServerKey();

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

function createServerTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.code = 'SERVER_TIMEOUT';
  return error;
}

function withServerTimeout(promise, timeoutMs, label) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(createServerTimeoutError(label, timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function resolvePublicFilePath(publicPath) {
  const normalizedPath = String(publicPath || '').split(/[?#]/u)[0];
  if (!normalizedPath.startsWith('/avatars/')) {
    return null;
  }

  const relativePath = normalizedPath.replace(/^\/+/u, '').replace(/[\\/]+/gu, path.sep);
  const absolutePath = path.resolve(PUBLIC_DIR, relativePath);
  const publicRoot = `${PUBLIC_DIR}${path.sep}`;
  return absolutePath.startsWith(publicRoot) ? absolutePath : null;
}

function resolveOptimizedLocalAvatarUrl(avatarUrl) {
  const value = String(avatarUrl || '').trim();
  if (!value || !value.startsWith('/avatars/') || !/\.png(?:[?#].*)?$/iu.test(value)) {
    return avatarUrl || null;
  }

  const [pathname, suffix = ''] = value.split(/([?#].*)/u);
  const webpPathname = pathname.replace(/\.png$/iu, '.webp');
  const webpFilePath = resolvePublicFilePath(webpPathname);
  if (webpFilePath && fs.existsSync(webpFilePath)) {
    return `${webpPathname}${suffix}`;
  }

  return value;
}

function normalizeCharacterAvatarRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    ...(record.avatar_url ? { avatar_url: resolveOptimizedLocalAvatarUrl(record.avatar_url) } : {}),
    ...(record.avatarUrl ? { avatarUrl: resolveOptimizedLocalAvatarUrl(record.avatarUrl) } : {}),
  };
}

function normalizeCharacterCatalogAvatars(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    return catalog;
  }

  return {
    ...catalog,
    characters: Array.isArray(catalog.characters)
      ? catalog.characters.map(normalizeCharacterAvatarRecord)
      : catalog.characters,
    rows: Array.isArray(catalog.rows) ? catalog.rows.map(normalizeCharacterAvatarRecord) : catalog.rows,
  };
}

async function fetchVisiblePools(supabase) {
  const { data, error } = await supabase.rpc('get_app_visible_pools');
  if (error) {
    throw error;
  }

  return data || [];
}

function normalizeRemotePoolType(type, isLimitedWeaponFlag) {
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'weapon' && isLimitedWeaponFlag === false) return 'weapon';
  return type || 'standard';
}

function getPoolRecordId(record) {
  return record?.pool_id || record?.id || null;
}

function dedupeVisiblePoolRecords(records) {
  const deduped = new Map();

  (records || []).forEach((record) => {
    const poolId = getPoolRecordId(record);
    if (!poolId) {
      return;
    }

    if (!deduped.has(poolId)) {
      deduped.set(poolId, record);
    }
  });

  return Array.from(deduped.values()).sort(sortPoolCatalogRecords);
}

function formatVisiblePoolRecord(record) {
  const hasSixStarRoster = Array.isArray(record?.six_star_entities);
  return {
    id: record.pool_id,
    name: record.name,
    name_en: record.name_en || null,
    type: normalizeRemotePoolType(record.type, record.is_limited_weapon),
    extra_subtype: getCanonicalExtraPoolSubtype(record),
    extra_rule_profile: record.extra_rule_profile || null,
    extra_series_key: record.extra_series_key || null,
    extra_series_phase: record.extra_series_phase ?? null,
    locked: record.locked || false,
    isLimitedWeapon: record.is_limited_weapon !== false,
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    user_id: record.user_id || null,
    creator_username: record.creator_username || null,
    creator_role: record.creator_role || null,
    up_character: record.up_character || null,
    description: record.description || null,
    banner_url: record.banner_url || null,
    start_time: record.start_time || null,
    end_time: record.end_time || null,
    featured_characters: record.featured_characters || null,
    ...(hasSixStarRoster
      ? {
          six_star_entities: record.six_star_entities,
          six_star_roster_complete: record.six_star_roster_complete === true,
        }
      : {}),
  };
}

function getPoolCatalogSortTimestamp(record) {
  const source = record?.start_time || record?.created_at || record?.updated_at || 0;
  const value = new Date(source).getTime();
  return Number.isFinite(value) ? value : 0;
}

function sortPoolCatalogRecords(left, right) {
  const diff = getPoolCatalogSortTimestamp(right) - getPoolCatalogSortTimestamp(left);
  if (diff !== 0) {
    return diff;
  }

  return String(left?.pool_id || left?.id || '').localeCompare(String(right?.pool_id || right?.id || ''));
}

async function fetchCharactersTable(supabase) {
  const { data, error } = await supabase
    .from('characters')
    .select(
      'id, name, avatar_url, rarity, type, aliases, is_limited, release_date, created_at, updated_at, pool_config'
    )
    .order('name');

  if (error) {
    throw error;
  }

  return (data || []).map(normalizeCharacterAvatarRecord);
}

function buildCharacterCatalogFallback(characters = []) {
  const rows = (Array.isArray(characters) ? characters : [])
    .filter((character) => (character?.type || 'character') === 'character')
    .filter((character) => Number(character?.rarity) >= 4)
    .map((character) => ({
      id: character.id || character.name,
      name: character.name,
      avatarUrl: character.avatar_url || character.avatarUrl || null,
      rarity: Number(character.rarity) || 0,
      type: character.type || 'character',
      isLimited: Boolean(character.is_limited ?? character.isLimited),
      releaseDate: character.release_date || character.releaseDate || null,
      ownerUsers: 0,
      unownedUsers: 0,
      ownershipRate: 0,
      fullPotentialUsers: 0,
      fullPotentialRateOfOwners: 0,
      fullPotentialRateOfContributors: 0,
      totalCopies: 0,
      avgCopiesPerOwner: 0,
      copyDistribution: {},
      quota: {},
    }));

  return {
    totalContributors: 0,
    summary: {
      totalCharacters: rows.length,
      ownedCharacters: 0,
      unownedCharacters: rows.length,
      ownershipRate: 0,
      fullPotentialCharacters: 0,
      quota: {},
      characterQuota: {},
      weaponQuota: {},
      excessTrustTokens: 0,
    },
    characters: rows,
    fallback: true,
    fallbackReason: 'character_catalog_timeout',
  };
}

async function fetchCharacterCatalogStatsCached(supabase) {
  const { data, error } = await withServerTimeout(
    supabase.rpc('get_character_catalog_stats_cached'),
    CHARACTER_CATALOG_RPC_TIMEOUT_MS,
    'get_character_catalog_stats_cached'
  );
  if (error) {
    throw error;
  }

  return normalizeCharacterCatalogAvatars(data);
}

async function fetchCharacterRankingStatsCached(supabase) {
  const { data, error } = await withServerTimeout(
    supabase.rpc('get_character_ranking_stats_cached'),
    CHARACTER_RANKING_RPC_TIMEOUT_MS,
    'get_character_ranking_stats_cached'
  );
  if (error) {
    throw error;
  }

  return data ?? null;
}

async function fetchCharacterCatalogForStats(supabase) {
  try {
    return {
      data: await fetchCharacterCatalogStatsCached(supabase),
      partial: false,
      source: 'origin',
      error: null,
    };
  } catch (error) {
    const fallbackCharacters = await fetchCharactersTable(supabase);
    return {
      data: buildCharacterCatalogFallback(fallbackCharacters),
      partial: true,
      source: 'character-table-fallback',
      error,
    };
  }
}

function stripPrivateCharacterCatalogFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripPrivateCharacterCatalogFields);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_CHARACTER_CATALOG_KEYS.has(key))
      .map(([key, nestedValue]) => [key, stripPrivateCharacterCatalogFields(nestedValue)])
  );
}

function sanitizeCharacterCatalog(catalog) {
  return catalog ? stripPrivateCharacterCatalogFields(catalog) : null;
}

async function fetchPublicProfilesMap(supabase, userIds = []) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase.from('public_profiles').select('id, username, role').in('id', uniqueIds);

  if (error) {
    throw error;
  }

  return new Map((data || []).map((profile) => [profile.id, profile]));
}

async function fetchPoolSixStarRosterMap(supabase, poolIds = []) {
  const normalizedPoolIds = [...new Set((poolIds || []).filter(Boolean).map(String))];
  if (normalizedPoolIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('pool_characters')
    .select(
      `
      pool_id,
      character_id,
      is_up,
      characters (
        id,
        name,
        rarity,
        type
      )
    `
    )
    .in('pool_id', normalizedPoolIds);

  if (error) {
    throw error;
  }

  return buildPoolSixStarRosterMap(data || [], normalizedPoolIds);
}

async function fetchPoolCatalog(supabase) {
  const { data, error } = await supabase
    .from('pools')
    .select(
      'pool_id, name, name_en, type, extra_subtype, extra_rule_profile, extra_series_key, extra_series_phase, locked, is_limited_weapon, created_at, updated_at, user_id, up_character, description, banner_url, start_time, end_time, featured_characters'
    );

  if (error) {
    throw error;
  }

  const poolRows = data || [];
  const poolIds = poolRows.map((row) => row.pool_id).filter(Boolean);
  const [profilesMap, rosterResult] = await Promise.all([
    fetchPublicProfilesMap(
      supabase,
      poolRows.map((row) => row.user_id)
    ),
    fetchPoolSixStarRosterMap(supabase, poolIds)
      .then((rosterMap) => ({ rosterMap, error: null }))
      .catch((rosterError) => ({
        rosterMap: new Map(poolIds.map((poolId) => [poolId, []])),
        error: rosterError,
      })),
  ]);

  if (rosterResult.error) {
    serverLogger.error('stats.pool_catalog.roster_unavailable', {
      message: rosterResult.error?.message || String(rosterResult.error),
    });
  }

  const records = poolRows
    .map((row) => ({
      ...attachPoolSixStarRoster(row, rosterResult.rosterMap),
      creator_username: profilesMap.get(row.user_id)?.username || null,
      creator_role: profilesMap.get(row.user_id)?.role || null,
    }))
    .sort(sortPoolCatalogRecords)
    .map(formatVisiblePoolRecord);

  return {
    data: records,
    partial: Boolean(rosterResult.error),
    error: rosterResult.error,
  };
}

async function fetchVersionCalendarCharacters(supabase) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, avatar_url, aliases, type')
    .in('type', ['character', 'weapon']);

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchActiveVersionCalendar(supabase) {
  const { data: snapshots, error: snapshotError } = await supabase
    .from('version_content_snapshots')
    .select(
      'version_key, version_number, revision, title, starts_at, ends_at, content, pool_bindings, source_meta, published_at, updated_at'
    )
    .eq('is_active', true)
    .order('starts_at', { ascending: true, nullsFirst: false });

  if (snapshotError) {
    throw snapshotError;
  }
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return null;
  }

  let timelineConfig = null;
  try {
    const { data: configRow, error: configError } = await supabase
      .from('site_config')
      .select('value, updated_at')
      .eq('key', 'home_version_timeline')
      .maybeSingle();
    if (configError) {
      throw configError;
    }
    timelineConfig = configRow;
  } catch (error) {
    serverLogger.error('Failed to read version timeline config; using snapshots', error);
  }

  const configuredSnapshots = mergeVersionTimelineConfig(snapshots, timelineConfig?.value, timelineConfig?.updated_at);
  const [visiblePools, characterRows] = await Promise.all([
    fetchVisiblePools(supabase),
    fetchVersionCalendarCharacters(supabase),
  ]);
  return buildVersionCalendarPayload(configuredSnapshots, visiblePools, characterRows);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);

  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { type } = req.query;
  const now = Date.now();
  const supabase = getSupabaseClient();
  const cacheVersion = await resolvePublicCacheVersion(supabase, {
    requestVersion: readRequestCacheVersion(req),
  });
  const cacheKey = getStatsPublicCacheKey(type, cacheVersion);
  const context = { cacheKey, cacheVersion };

  try {
    if (!supabase) {
      // 返回缓存数据或默认值
      return sendPublicJson(res, {
        cached: true,
        data: getCachedData(type),
        source: getAnyCachedLastFetch(type) > 0 ? 'memory-cache' : 'default',
        stale: getAnyCachedLastFetch(type) > 0,
        partial: true,
        cacheKey,
        cacheVersion,
        lastFetch: getAnyCachedLastFetch(type),
        message: 'Database not configured, returning cached/default data',
      });
    }

    switch (type) {
      case 'pools':
        return await handlePools(supabase, res, now, context);
      case 'pool_catalog':
        return await handlePoolCatalog(supabase, res, now, context);
      case 'version_calendar':
        return await handleVersionCalendar(supabase, res, now, context);
      case 'characters':
        return await handleCharacters(supabase, res, now, context);
      case 'global_summary':
        return await handleGlobalSummary(supabase, res, now, context);
      case 'character_ranking':
        return await handleCharacterRanking(supabase, res, now, context);
      case 'character_catalog':
        return await handleCharacterCatalog(supabase, res, now, context);
      case 'all':
        return await handleAll(supabase, res, now, context);
      default:
        return res.status(400).json({ success: false, error: 'Invalid type parameter' });
    }
  } catch (error) {
    serverLogger.error('stats.api.error', {
      message: error?.message || String(error),
      type,
    });
    // 返回缓存数据
    return sendPublicJson(res, {
      cached: true,
      data: getCachedData(type),
      source: getAnyCachedLastFetch(type) > 0 ? 'memory-cache' : 'default',
      stale: getAnyCachedLastFetch(type) > 0,
      partial: true,
      cacheKey,
      cacheVersion,
      lastFetch: getAnyCachedLastFetch(type),
      error: error.message,
    });
  }
}

function getStatsPublicCacheKey(type, cacheVersion) {
  return buildPublicCacheKey(['stats', type || 'unknown', `v${cacheVersion}`]);
}

function getTypeMeta(type) {
  return cache.metaByType?.[type] || null;
}

function setTypeMeta(type, meta) {
  cache.metaByType[type] = {
    ...(cache.metaByType[type] || {}),
    ...meta,
  };
}

function isFreshTypeCache(type, lastFetch, now, cacheKey) {
  const meta = getTypeMeta(type);
  return lastFetch > 0 && now - lastFetch < CACHE_TTL && (!meta?.cacheKey || meta.cacheKey === cacheKey);
}

function sendStatsJson(
  res,
  _type,
  { data, cached = false, partial = false, stale = false, source = null, context, lastFetch = 0, error = null } = {}
) {
  return sendPublicJson(res, {
    data,
    cached,
    partial,
    stale,
    source,
    cacheKey: context?.cacheKey,
    cacheVersion: context?.cacheVersion,
    lastFetch,
    error,
  });
}

function getAnyCachedLastFetch(type) {
  switch (type) {
    case 'pools':
      return cache.poolsLastFetch || 0;
    case 'characters':
      return cache.charactersLastFetch || 0;
    case 'pool_catalog':
      return cache.poolCatalogLastFetch || 0;
    case 'version_calendar':
      return cache.versionCalendarLastFetch || 0;
    case 'global_summary':
      return cache.globalSummaryLastFetch || 0;
    case 'character_ranking':
      return cache.characterRankingLastFetch || 0;
    case 'character_catalog':
      return cache.characterCatalogLastFetch || 0;
    case 'all':
      return Math.max(
        cache.poolsLastFetch || 0,
        cache.poolCatalogLastFetch || 0,
        cache.charactersLastFetch || 0,
        cache.globalSummaryLastFetch || 0,
        cache.characterRankingLastFetch || 0,
        cache.characterCatalogLastFetch || 0
      );
    default:
      return 0;
  }
}

// 获取缓存数据
function getCachedData(type) {
  switch (type) {
    case 'pools':
      return { pools: cache.pools ?? [] };
    case 'characters':
      return { characters: cache.characters ?? [] };
    case 'pool_catalog':
      return { pools: cache.poolCatalog ?? [] };
    case 'version_calendar':
      return { versionCalendar: cache.versionCalendar ?? null };
    case 'global_summary':
      return { globalSummary: cache.globalSummary ?? null };
    case 'character_ranking':
      return { characterRanking: cache.characterRanking ?? null };
    case 'character_catalog':
      return { characterCatalog: sanitizeCharacterCatalog(cache.characterCatalog) };
    case 'all':
      return {
        pools: cache.pools ?? [],
        poolCatalog: cache.poolCatalog ?? [],
        characters: cache.characters ?? [],
        globalSummary: cache.globalSummary ?? null,
        characterRanking: cache.characterRanking ?? null,
        characterCatalog: sanitizeCharacterCatalog(cache.characterCatalog),
      };
    default:
      return {};
  }
}

// 处理卡池列表
async function handlePools(supabase, res, now, context) {
  // 检查缓存
  if (cache.pools !== null && isFreshTypeCache('pools', cache.poolsLastFetch, now, context.cacheKey)) {
    return sendStatsJson(res, 'pools', {
      cached: true,
      data: { pools: cache.pools },
      source: 'memory-cache',
      context,
      lastFetch: cache.poolsLastFetch,
    });
  }

  const data = dedupeVisiblePoolRecords(await fetchVisiblePools(supabase)).map(formatVisiblePoolRecord);

  cache.pools = data || [];
  cache.poolsLastFetch = now;
  setTypeMeta('pools', context);

  return sendStatsJson(res, 'pools', {
    cached: false,
    data: { pools: data || [] },
    source: 'origin',
    context,
    lastFetch: cache.poolsLastFetch,
  });
}

// 处理角色列表
async function handlePoolCatalog(supabase, res, now, context) {
  if (
    cache.poolCatalog !== null &&
    isFreshTypeCache('pool_catalog', cache.poolCatalogLastFetch, now, context.cacheKey)
  ) {
    const catalogMeta = getTypeMeta('pool_catalog');
    return sendStatsJson(res, 'pool_catalog', {
      cached: true,
      partial: Boolean(catalogMeta?.partial),
      data: { pools: cache.poolCatalog },
      source: 'memory-cache',
      context,
      lastFetch: cache.poolCatalogLastFetch,
      error: catalogMeta?.error || null,
    });
  }

  const catalogResult = await fetchPoolCatalog(supabase);
  const data = catalogResult.data;

  cache.poolCatalog = data || [];
  cache.poolCatalogLastFetch = now;
  setTypeMeta('pool_catalog', {
    ...context,
    partial: catalogResult.partial,
    error: catalogResult.partial ? 'pool_catalog_roster_unavailable' : null,
  });

  return sendStatsJson(res, 'pool_catalog', {
    cached: false,
    partial: catalogResult.partial,
    data: { pools: data || [] },
    source: 'origin',
    context,
    lastFetch: cache.poolCatalogLastFetch,
    error: catalogResult.partial ? 'pool_catalog_roster_unavailable' : null,
  });
}

async function handleVersionCalendar(supabase, res, now, context) {
  if (
    cache.versionCalendar !== null &&
    isFreshTypeCache('version_calendar', cache.versionCalendarLastFetch, now, context.cacheKey)
  ) {
    return sendStatsJson(res, 'version_calendar', {
      cached: true,
      data: { versionCalendar: cache.versionCalendar },
      source: 'memory-cache',
      context,
      lastFetch: cache.versionCalendarLastFetch,
    });
  }

  const data = await fetchActiveVersionCalendar(supabase);
  cache.versionCalendar = data;
  cache.versionCalendarLastFetch = now;
  setTypeMeta('version_calendar', context);

  return sendStatsJson(res, 'version_calendar', {
    cached: false,
    data: { versionCalendar: data },
    source: 'origin',
    context,
    lastFetch: cache.versionCalendarLastFetch,
  });
}

// 处理角色列表
async function handleCharacters(supabase, res, now, context) {
  // 检查缓存
  if (cache.characters !== null && isFreshTypeCache('characters', cache.charactersLastFetch, now, context.cacheKey)) {
    return sendStatsJson(res, 'characters', {
      cached: true,
      data: { characters: cache.characters },
      source: 'memory-cache',
      context,
      lastFetch: cache.charactersLastFetch,
    });
  }

  const data = await fetchCharactersTable(supabase);

  cache.characters = data || [];
  cache.charactersLastFetch = now;
  setTypeMeta('characters', context);

  return sendStatsJson(res, 'characters', {
    cached: false,
    data: { characters: data || [] },
    source: 'origin',
    context,
    lastFetch: cache.charactersLastFetch,
  });
}

async function handleGlobalSummary(supabase, res, now, context) {
  if (
    cache.globalSummary !== null &&
    isFreshTypeCache('global_summary', cache.globalSummaryLastFetch, now, context.cacheKey)
  ) {
    return sendStatsJson(res, 'global_summary', {
      cached: true,
      data: { globalSummary: cache.globalSummary },
      source: 'memory-cache',
      context,
      lastFetch: cache.globalSummaryLastFetch,
    });
  }

  const { data, error } = await supabase.rpc('get_global_stats_cached');
  if (error) {
    throw error;
  }

  cache.globalSummary = data ?? null;
  cache.globalSummaryLastFetch = now;
  setTypeMeta('global_summary', context);

  return sendStatsJson(res, 'global_summary', {
    cached: false,
    data: { globalSummary: data ?? null },
    source: 'origin',
    context,
    lastFetch: cache.globalSummaryLastFetch,
  });
}

async function handleCharacterRanking(supabase, res, now, context) {
  if (
    cache.characterRanking !== null &&
    isFreshTypeCache('character_ranking', cache.characterRankingLastFetch, now, context.cacheKey)
  ) {
    return sendStatsJson(res, 'character_ranking', {
      cached: true,
      data: { characterRanking: cache.characterRanking },
      source: 'memory-cache',
      context,
      lastFetch: cache.characterRankingLastFetch,
    });
  }

  let data = null;
  try {
    data = await fetchCharacterRankingStatsCached(supabase);
  } catch (error) {
    return sendStatsJson(res, 'character_ranking', {
      cached: cache.characterRanking !== null,
      partial: true,
      stale: cache.characterRanking !== null,
      data: { characterRanking: cache.characterRanking ?? null },
      source: cache.characterRanking !== null ? 'memory-cache' : 'origin-timeout',
      context,
      lastFetch: cache.characterRankingLastFetch,
      error: error?.message || 'character_ranking_timeout',
    });
  }

  cache.characterRanking = data ?? null;
  cache.characterRankingLastFetch = now;
  setTypeMeta('character_ranking', context);

  return sendStatsJson(res, 'character_ranking', {
    cached: false,
    data: { characterRanking: data ?? null },
    source: 'origin',
    context,
    lastFetch: cache.characterRankingLastFetch,
  });
}

async function handleCharacterCatalog(supabase, res, now, context) {
  if (
    cache.characterCatalog !== null &&
    isFreshTypeCache('character_catalog', cache.characterCatalogLastFetch, now, context.cacheKey)
  ) {
    return sendStatsJson(res, 'character_catalog', {
      cached: true,
      data: { characterCatalog: sanitizeCharacterCatalog(cache.characterCatalog) },
      source: 'memory-cache',
      context,
      lastFetch: cache.characterCatalogLastFetch,
    });
  }

  const catalogResult = await fetchCharacterCatalogForStats(supabase);

  cache.characterCatalog = sanitizeCharacterCatalog(catalogResult.data);
  cache.characterCatalogLastFetch = now;
  setTypeMeta('character_catalog', context);

  return sendStatsJson(res, 'character_catalog', {
    cached: false,
    partial: catalogResult.partial,
    data: { characterCatalog: cache.characterCatalog },
    source: catalogResult.source,
    context,
    lastFetch: cache.characterCatalogLastFetch,
    error: catalogResult.partial ? catalogResult.error?.message || 'character_catalog_fallback' : null,
  });
}

// 处理所有数据（一次性获取）
async function handleAll(supabase, res, now, context) {
  const result = {
    pools: [],
    poolCatalog: [],
    characters: [],
    globalSummary: null,
    characterRanking: null,
    characterCatalog: null,
  };

  // 并行获取所有数据
  const [
    poolsResult,
    poolCatalogResult,
    charactersResult,
    globalSummaryResult,
    characterRankingResult,
    characterCatalogResult,
  ] = await Promise.allSettled([
    fetchVisiblePools(supabase),
    fetchPoolCatalog(supabase),
    fetchCharactersTable(supabase),
    supabase.rpc('get_global_stats_cached'),
    fetchCharacterRankingStatsCached(supabase),
    fetchCharacterCatalogForStats(supabase),
  ]);

  // 处理卡池
  if (poolsResult.status === 'fulfilled') {
    result.pools = dedupeVisiblePoolRecords(poolsResult.value || []).map(formatVisiblePoolRecord);
    cache.pools = result.pools;
    cache.poolsLastFetch = now;
    setTypeMeta('pools', getAllChildContext(context, 'pools'));
  } else if (cache.pools !== null) {
    result.pools = cache.pools;
  }

  if (poolCatalogResult.status === 'fulfilled') {
    result.poolCatalog = poolCatalogResult.value.data || [];
    cache.poolCatalog = result.poolCatalog;
    cache.poolCatalogLastFetch = now;
    setTypeMeta('pool_catalog', {
      ...getAllChildContext(context, 'pool_catalog'),
      partial: poolCatalogResult.value.partial,
      error: poolCatalogResult.value.partial ? 'pool_catalog_roster_unavailable' : null,
    });
  } else if (cache.poolCatalog !== null) {
    result.poolCatalog = cache.poolCatalog;
  }

  // 处理角色
  if (charactersResult.status === 'fulfilled' && !charactersResult.value.error) {
    result.characters = charactersResult.value || [];
    cache.characters = result.characters;
    cache.charactersLastFetch = now;
    setTypeMeta('characters', getAllChildContext(context, 'characters'));
  } else if (cache.characters !== null) {
    result.characters = cache.characters;
  }

  if (globalSummaryResult.status === 'fulfilled' && !globalSummaryResult.value.error) {
    result.globalSummary = globalSummaryResult.value.data ?? null;
    cache.globalSummary = result.globalSummary;
    cache.globalSummaryLastFetch = now;
    setTypeMeta('global_summary', getAllChildContext(context, 'global_summary'));
  } else if (cache.globalSummary !== null) {
    result.globalSummary = cache.globalSummary;
  }

  if (characterRankingResult.status === 'fulfilled' && !characterRankingResult.value.error) {
    result.characterRanking = characterRankingResult.value ?? null;
    cache.characterRanking = result.characterRanking;
    cache.characterRankingLastFetch = now;
    setTypeMeta('character_ranking', getAllChildContext(context, 'character_ranking'));
  } else if (cache.characterRanking !== null) {
    result.characterRanking = cache.characterRanking;
  }

  if (characterCatalogResult.status === 'fulfilled' && !characterCatalogResult.value.error) {
    result.characterCatalog = sanitizeCharacterCatalog(characterCatalogResult.value.data);
    cache.characterCatalog = result.characterCatalog;
    cache.characterCatalogLastFetch = now;
    setTypeMeta('character_catalog', getAllChildContext(context, 'character_catalog'));
  } else if (characterCatalogResult.status === 'fulfilled' && characterCatalogResult.value.data) {
    result.characterCatalog = sanitizeCharacterCatalog(characterCatalogResult.value.data);
    cache.characterCatalog = result.characterCatalog;
    cache.characterCatalogLastFetch = now;
    setTypeMeta('character_catalog', getAllChildContext(context, 'character_catalog'));
  } else if (cache.characterCatalog !== null) {
    result.characterCatalog = sanitizeCharacterCatalog(cache.characterCatalog);
  }

  return sendStatsJson(res, 'all', {
    cached: false,
    partial: [
      poolsResult,
      poolCatalogResult,
      charactersResult,
      globalSummaryResult,
      characterRankingResult,
      characterCatalogResult,
    ].some((resultItem) => resultItem.status === 'rejected' || resultItem.value?.error || resultItem.value?.partial),
    data: result,
    source: 'origin',
    context,
    lastFetch: getAnyCachedLastFetch('all'),
  });
}

function getAllChildContext(context, type) {
  return {
    ...context,
    cacheKey: getStatsPublicCacheKey(type, context.cacheVersion),
  };
}
