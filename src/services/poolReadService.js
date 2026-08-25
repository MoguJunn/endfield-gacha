import { supabase } from '../supabaseClient';
import { executeSupabaseRead, executeSupabaseRpc } from './supabaseRequest';
import {
  fetchPublicApiJson,
  shouldAllowPublicSupabaseFallback,
} from './publicResourceClient';
import { getCanonicalExtraPoolSubtype } from '../../shared/extraPoolSubtype.js';
import { isContributorDemoModeEnabled } from '../dev/contributorDemoMode.js';
import {
  getContributorDemoSandboxSnapshot,
  initializeContributorDemoSandbox,
} from '../dev/contributorDemoSandboxStore.js';
import { sanitizePublicPoolRecord } from '../../shared/publicCatalogDto.js';
import { APPROVED_PUBLIC_RESOURCE_HOSTS } from '../utils/publicResourceUrl.js';

const PUBLIC_STATS_API_TIMEOUT_MS = 25000;
const PUBLIC_DATA_CACHE_TTL = 60 * 1000;

const requestState = {
  visiblePools: {
    data: null,
    fetchedAt: 0,
    promise: null
  },
  poolCatalog: {
    data: null,
    fetchedAt: 0,
    promise: null
  }
};

function getPoolRecordId(record) {
  return record?.pool_id || record?.id || null;
}

function isFreshRequest(state, forceRefresh = false) {
  if (forceRefresh) {
    return false;
  }

  return state.data !== null && Date.now() - state.fetchedAt < PUBLIC_DATA_CACHE_TTL;
}

async function runCachedCollectionRequest(state, fetcher, { forceRefresh = false } = {}) {
  if (isFreshRequest(state, forceRefresh)) {
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

async function fetchPublicPoolCollection(type) {
  const result = await fetchPublicApiJson('/api/stats', {
    params: { type },
    label: `public ${type} api`,
    timeoutMs: PUBLIC_STATS_API_TIMEOUT_MS,
    retries: 1
  });

  return Array.isArray(result?.data?.pools) ? result.data.pools : null;
}

function getSortTimestamp(record) {
  const source = record.start_time || record.created_at || record.updated_at || 0;
  const value = new Date(source).getTime();
  return Number.isFinite(value) ? value : 0;
}

function sortVisiblePoolRecords(left, right) {
  const diff = getSortTimestamp(right) - getSortTimestamp(left);
  if (diff !== 0) return diff;
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

async function loadPoolRowsByIds(poolIds) {
  const normalizedIds = [...new Set(
    (Array.isArray(poolIds) ? poolIds : [])
      .filter(id => typeof id === 'string')
      .map(id => id.trim())
      .filter(Boolean)
  )];

  if (normalizedIds.length === 0) {
    return [];
  }

  if (!supabase) {
    return [];
  }

  const { data: poolRows, error } = await executeSupabaseRead(
    () => supabase
      .from('pools')
      .select('pool_id, name, name_en, type, extra_subtype, extra_rule_profile, extra_series_key, extra_series_phase, locked, is_limited_weapon, created_at, updated_at, up_character, description, banner_url, start_time, end_time, featured_characters')
      .in('pool_id', normalizedIds),
    {
      label: 'loadPoolRowsByIds',
      retries: 1
    }
  );

  if (error) {
    throw error;
  }

  return poolRows || [];
}

async function loadAllPoolRows() {
  if (!supabase) {
    return [];
  }

  const { data: poolRows, error } = await executeSupabaseRead(
    () => supabase
      .from('pools')
      .select('pool_id, name, name_en, type, extra_subtype, extra_rule_profile, extra_series_key, extra_series_phase, locked, is_limited_weapon, created_at, updated_at, up_character, description, banner_url, start_time, end_time, featured_characters'),
    {
      label: 'loadAllPoolRows',
      retries: 1
    }
  );

  if (error) {
    throw error;
  }

  return poolRows || [];
}

export function normalizeRemotePoolType(type, isLimitedWeaponFlag) {
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'weapon' && isLimitedWeaponFlag === false) return 'weapon';
  return type || 'standard';
}

function normalizeSixStarEntities(record) {
  const input = record?.six_star_entities ?? record?.sixStarEntities;
  if (!Array.isArray(input)) return [];

  const seen = new Set();
  return input.flatMap((entity) => {
    const id = String(entity?.id || entity?.entity_id || entity?.entityId || '').trim();
    const name = String(entity?.name || '').trim();
    const type = entity?.type === 'weapon' ? 'weapon' : entity?.type === 'character' ? 'character' : null;
    if (!id || !name || !type || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      type,
      is_up: Boolean(entity?.is_up ?? entity?.isUp),
    }];
  });
}

export function formatVisiblePoolRecord(record) {
  const limitedWeaponFlag = record?.is_limited_weapon ?? record?.isLimitedWeapon;
  const sixStarEntities = normalizeSixStarEntities(record);

  return sanitizePublicPoolRecord({
    id: record.pool_id || record.id || null,
    name: record.name,
    name_en: record.name_en || null,
    type: normalizeRemotePoolType(record.type, limitedWeaponFlag),
    extra_subtype: getCanonicalExtraPoolSubtype(record),
    extra_rule_profile: record.extra_rule_profile || record.extraRuleProfile || null,
    extra_series_key: record.extra_series_key || record.extraSeriesKey || null,
    extra_series_phase: record.extra_series_phase ?? record.extraSeriesPhase ?? null,
    locked: record.locked || false,
    isLimitedWeapon: limitedWeaponFlag !== false,
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    up_character: record.up_character || null,
    description: record.description || null,
    banner_url: record.banner_url || null,
    start_time: record.start_time || null,
    end_time: record.end_time || null,
    featured_characters: record.featured_characters || record.featuredCharacters || null,
    six_star_entities: sixStarEntities,
    six_star_roster_complete: Boolean(
      (record?.six_star_roster_complete ?? record?.sixStarRosterComplete) === true
      && sixStarEntities.length > 0
    )
  }, { allowedHosts: APPROVED_PUBLIC_RESOURCE_HOSTS });
}

export function mergePoolCollections(primaryPools = [], fallbackPools = []) {
  const merged = new Map();

  [...fallbackPools, ...primaryPools].forEach((pool) => {
    if (!pool?.id) {
      return;
    }

    const existing = merged.get(pool.id) || {};
    merged.set(pool.id, {
      ...existing,
      ...pool
    });
  });

  return Array.from(merged.values()).sort(sortVisiblePoolRecords);
}

export async function loadVisiblePools(options = {}) {
  if (isContributorDemoModeEnabled()) {
    await initializeContributorDemoSandbox();
    return getContributorDemoSandboxSnapshot().pools;
  }
  const { forceRefresh = false } = options;

  return runCachedCollectionRequest(requestState.visiblePools, async () => {
    const apiPools = await fetchPublicPoolCollection('pools').catch(() => null);
    if (Array.isArray(apiPools) && apiPools.length > 0) {
      return dedupeVisiblePoolRecords(apiPools).map(formatVisiblePoolRecord);
    }

    if (!shouldAllowPublicSupabaseFallback() || !supabase) {
      return [];
    }

    const { data, error } = await executeSupabaseRpc(
      () => supabase.rpc('get_app_visible_pools'),
      {
        label: 'get_app_visible_pools',
        retries: 2
      }
    );
    if (error) {
      throw error;
    }

    return dedupeVisiblePoolRecords(data || []).map(formatVisiblePoolRecord);
  }, { forceRefresh });
}

export async function loadPoolsByIds(poolIds) {
  const normalizedIds = [...new Set(
    (Array.isArray(poolIds) ? poolIds : [])
      .filter(id => typeof id === 'string')
      .map(id => id.trim())
      .filter(Boolean)
  )];

  if (normalizedIds.length === 0) {
    return [];
  }

  if (isContributorDemoModeEnabled()) {
    await initializeContributorDemoSandbox();
    const ids = new Set(normalizedIds);
    return getContributorDemoSandboxSnapshot().pools.filter((pool) => ids.has(pool.id));
  }

  const cachedPoolCatalog = Array.isArray(requestState.poolCatalog.data)
    ? requestState.poolCatalog.data
    : [];
  const cachedPoolMap = new Map(
    cachedPoolCatalog
      .filter((pool) => pool?.id)
      .map((pool) => [pool.id, pool])
  );
  const cachedPools = normalizedIds
    .map((poolId) => cachedPoolMap.get(poolId))
    .filter(Boolean);
  const missingIds = normalizedIds.filter((poolId) => !cachedPoolMap.has(poolId));

  if (missingIds.length === 0) {
    return cachedPools.sort(sortVisiblePoolRecords);
  }

  if (!shouldAllowPublicSupabaseFallback() || !supabase) {
    return cachedPools.sort(sortVisiblePoolRecords);
  }

  const poolRows = await loadPoolRowsByIds(missingIds);
  if (poolRows.length === 0) {
    return cachedPools.sort(sortVisiblePoolRecords);
  }

  const hydratedPools = poolRows
    .sort(sortVisiblePoolRecords)
    .map(formatVisiblePoolRecord);

  return mergePoolCollections(hydratedPools, cachedPools);
}

export async function loadAllPoolsForCatalog(options = {}) {
  if (isContributorDemoModeEnabled()) {
    await initializeContributorDemoSandbox();
    return getContributorDemoSandboxSnapshot().pools;
  }
  const { forceRefresh = false } = options;

  return runCachedCollectionRequest(requestState.poolCatalog, async () => {
    const apiPools = await fetchPublicPoolCollection('pool_catalog').catch(() => null);
    if (Array.isArray(apiPools) && apiPools.length > 0) {
      return dedupeVisiblePoolRecords(apiPools).map(formatVisiblePoolRecord);
    }

    if (!shouldAllowPublicSupabaseFallback() || !supabase) {
      return [];
    }

    const poolRows = await loadAllPoolRows();
    if (poolRows.length === 0) {
      return [];
    }

    return poolRows
      .sort(sortVisiblePoolRecords)
      .map(formatVisiblePoolRecord);
  }, { forceRefresh });
}

export default {
  loadVisiblePools,
  loadPoolsByIds,
  loadAllPoolsForCatalog,
  mergePoolCollections,
  normalizeRemotePoolType,
  formatVisiblePoolRecord
};
