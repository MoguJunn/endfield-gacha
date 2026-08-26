import { createClient } from '@supabase/supabase-js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import {
  buildPublicCacheKey,
  PUBLIC_CACHE_CONTROL,
  readRequestCacheVersion,
  resolvePublicCacheVersion,
  sendPublicJson,
} from '../../_lib/publicCache.js';
import {
  resolveSupabaseServerKey,
  resolveSupabaseUrl,
} from '../../_lib/supabaseEnv.js';
import { getCanonicalExtraPoolSubtype } from '../../../shared/extraPoolSubtype.js';

const CACHE_TTL = 60 * 1000;

const cache = {
  payload: null,
  partial: false,
  lastFetch: 0,
  cacheKey: null,
  cacheVersion: null
};

function getSupabaseClient() {
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseKey = resolveSupabaseServerKey();

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
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

function getSortTimestamp(record) {
  const source = record?.start_time || record?.created_at || record?.updated_at || 0;
  const value = new Date(source).getTime();
  return Number.isFinite(value) ? value : 0;
}

function sortVisiblePoolRecords(left, right) {
  const diff = getSortTimestamp(right) - getSortTimestamp(left);
  if (diff !== 0) {
    return diff;
  }

  return String(getPoolRecordId(left) || '').localeCompare(String(getPoolRecordId(right) || ''));
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

  return Array.from(deduped.values()).sort(sortVisiblePoolRecords);
}

function formatVisiblePoolRecord(record) {
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
    featured_characters: record.featured_characters || null
  };
}

function createEmptyBootstrapPayload() {
  return {
    siteConfig: {},
    pools: []
  };
}

function mergeBootstrapPayload(previousPayload, nextPartialPayload) {
  const previous = previousPayload || createEmptyBootstrapPayload();
  const next = nextPartialPayload || {};

  return {
    siteConfig: next.siteConfig ?? previous.siteConfig ?? {},
    pools: next.pools ?? previous.pools ?? []
  };
}

async function fetchSiteConfig(supabase) {
  const { data, error } = await supabase
    .from('site_config')
    .select('key, value');

  if (error) {
    throw error;
  }

  return (data || []).reduce((config, row) => {
    config[row.key] = row.value;
    return config;
  }, {});
}

async function fetchVisiblePools(supabase) {
  const { data, error } = await supabase.rpc('get_app_visible_pools');
  if (error) {
    throw error;
  }

  return dedupeVisiblePoolRecords(data || []).map(formatVisiblePoolRecord);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);

  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, OPTIONS'
  })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const now = Date.now();
  const cachedPayload = cache.payload || createEmptyBootstrapPayload();
  const supabase = getSupabaseClient();
  const cacheVersion = await resolvePublicCacheVersion(supabase, {
    requestVersion: readRequestCacheVersion(req)
  });
  const cacheKey = buildPublicCacheKey(['bootstrap', `v${cacheVersion}`]);

  if (
    cache.payload
    && (cache.cacheKey === cacheKey || !cache.cacheKey)
    && now - cache.lastFetch < CACHE_TTL
  ) {
    return sendPublicJson(res, {
      data: cache.payload,
      cached: true,
      partial: Boolean(cache.partial),
      source: 'memory-cache',
      cacheKey,
      cacheVersion,
      lastFetch: cache.lastFetch
    });
  }

  if (!supabase) {
    return sendPublicJson(res, {
      cached: true,
      partial: Boolean(cache.partial),
      data: cachedPayload,
      source: cache.payload ? 'memory-cache' : 'default',
      stale: Boolean(cache.payload),
      cacheKey,
      cacheVersion,
      lastFetch: cache.lastFetch,
      message: 'Database not configured, returning cached/default data'
    });
  }

  const [siteConfigResult, poolsResult] = await Promise.allSettled([
    fetchSiteConfig(supabase),
    fetchVisiblePools(supabase)
  ]);

  const nextPayload = mergeBootstrapPayload(cachedPayload, {
    siteConfig: siteConfigResult.status === 'fulfilled' ? siteConfigResult.value : undefined,
    pools: poolsResult.status === 'fulfilled' ? poolsResult.value : undefined
  });

  cache.payload = nextPayload;
  const criticalResults = [siteConfigResult, poolsResult];
  const partial = criticalResults.some((result) => result.status === 'rejected');
  cache.partial = partial;
  cache.lastFetch = now;
  cache.cacheKey = cacheKey;
  cache.cacheVersion = cacheVersion;

  return sendPublicJson(res, {
    cached: false,
    partial,
    data: nextPayload,
    source: partial ? 'origin-partial' : 'origin',
    cacheKey,
    cacheVersion,
    lastFetch: cache.lastFetch
  });
}

export const __internal = {
  CACHE_TTL,
  cache,
  createEmptyBootstrapPayload,
  mergeBootstrapPayload
};
