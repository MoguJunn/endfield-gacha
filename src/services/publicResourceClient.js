import { fetchJsonWithTimeout, fetchWithTimeout } from './supabaseRequest.js';
import { readStorageValue, writeStorageValue } from '../utils/storageUtils.js';
import { readBrowserPublicCache, writeBrowserPublicCache } from './browserPublicCache.js';
import { checkSnapshotVersions, isPublicStatistic, publicSnapshotScope } from './snapshotChangeService.js';

const PUBLIC_CACHE_VERSION_TIMEOUT_MS = 8000;
const PUBLIC_CACHE_VERSION_MEMORY_TTL = 10 * 60 * 1000;
const PUBLIC_RESOURCE_MEMORY_TTL = 60 * 1000;
const PUBLIC_RESOURCE_SNAPSHOT_PREFIX = 'public_resource_snapshot_v1:';
const VERSION_STORAGE_KEY = 'endfield-public-version-v1';
const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STATISTICS_MAX_AGE_MS = Infinity;
const ANNOUNCEMENTS_MAX_AGE_MS = 5 * 60 * 1000;

const IS_LOCAL_DEV = Boolean(import.meta.env?.DEV);
const ALLOW_EMERGENCY_PUBLIC_SUPABASE_FALLBACK = ['1', 'true', 'yes']
  .includes(String(import.meta.env?.VITE_PUBLIC_DATA_DIRECT_SUPABASE_FALLBACK || '').toLowerCase());

const versionState = {
  value: null,
  fetchedAt: 0,
  promise: null,
  forced: false,
};
const resourceMemoryCache = new Map();
const resourceRequests = new Map();
const resourceGenerations = new Map();

function cachePolicy(path, params) {
  // An explicit allowlist keeps session, owner, admin and import data out of disk.
  if (path === '/api/bootstrap') return { maxAgeMs: CATALOG_MAX_AGE_MS };
  if (path === '/api/pool-rosters') return { maxAgeMs: CATALOG_MAX_AGE_MS };
  if (path === '/api/announcements') return { maxAgeMs: ANNOUNCEMENTS_MAX_AGE_MS };
  if (path === '/api/automation-feed' && new URLSearchParams(params || undefined).get('job') === 'official-announcements') {
    return { maxAgeMs: ANNOUNCEMENTS_MAX_AGE_MS };
  }
  if (path !== '/api/stats') return null;
  const type = new URLSearchParams(params || undefined).get('type');
  if (['characters', 'pools', 'pool_catalog'].includes(type)) return { maxAgeMs: CATALOG_MAX_AGE_MS };
  if (['global_summary', 'character_ranking', 'character_catalog', 'pool_counts', 'pool_observations', 'group_statistics'].includes(type)) {
    return { maxAgeMs: STATISTICS_MAX_AGE_MS };
  }
  return null;
}

function hasCompletePublicPayload(path, payload) {
  if (path === '/api/automation-feed') return Array.isArray(payload.records);
  if (path === '/api/announcements') {
    return ['siteAnnouncements', 'recentGameAnnouncements', 'latestGameAnnouncements', 'versionBriefingAnnouncements']
      .every(key => Array.isArray(payload.data?.[key]));
  }
  return payload.data && Object.values(payload.data).every(value => value !== null)
    && payload.data.meta?.availability !== 'building';
}

function rememberVersion(value, checkedAt = Date.now()) {
  versionState.value = String(value);
  versionState.fetchedAt = checkedAt;
  writeStorageValue(VERSION_STORAGE_KEY, JSON.stringify({ value: versionState.value, checkedAt }), { raw: true });
}

function restoreVersion() {
  if (versionState.value !== null) return;
  try {
    const saved = JSON.parse(readStorageValue(VERSION_STORAGE_KEY, null, { raw: true }));
    if (typeof saved?.value === 'string' && Number.isFinite(saved.checkedAt) && saved.checkedAt <= Date.now()) {
      versionState.value = saved.value;
      versionState.fetchedAt = saved.checkedAt;
    }
  } catch { /* A missing or corrupt version is checked over the network. */ }
}

function waitForResource(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}

export function shouldUsePublicApi() {
  return !IS_LOCAL_DEV;
}

export function shouldAllowPublicSupabaseFallback() {
  return IS_LOCAL_DEV || ALLOW_EMERGENCY_PUBLIC_SUPABASE_FALLBACK;
}

function isFreshVersion(forceRefresh = false) {
  if (forceRefresh) return false;
  return versionState.value !== null && Date.now() - versionState.fetchedAt < PUBLIC_CACHE_VERSION_MEMORY_TTL;
}

export async function getPublicCacheVersion(forceRefresh = false) {
  if (!shouldUsePublicApi()) {
    return 'dev';
  }

  restoreVersion();
  if (isFreshVersion(forceRefresh)) {
    return versionState.value;
  }

  if (versionState.promise && (!forceRefresh || versionState.forced)) {
    return versionState.promise;
  }

  const request = (async () => {
    const query = forceRefresh ? `?ts=${Date.now()}` : '';
    const response = await fetchWithTimeout(`/api/public-cache-version${query}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: forceRefresh ? 'no-store' : 'default',
    }, {
      label: 'public cache version',
      timeoutMs: PUBLIC_CACHE_VERSION_TIMEOUT_MS,
      retries: 1,
    });

    if (!response.ok) {
      throw new Error(`public cache version failed with ${response.status}`);
    }

    const payload = await response.json();
    const version = String(payload?.cacheVersion || payload?.meta?.cacheVersion || '0');
    if (versionState.promise === request) rememberVersion(version);
    return version;
  })();
  versionState.promise = request;
  versionState.forced = forceRefresh;

  try {
    return await request;
  } finally {
    if (versionState.promise === request) versionState.promise = null;
  }
}

export function buildPublicApiUrl(path, {
  params = null,
  cacheVersion = null,
  forceRefresh = false,
} = {}) {
  const searchParams = new URLSearchParams(params || undefined);
  if (cacheVersion) {
    searchParams.set('v', cacheVersion);
  }
  if (forceRefresh) {
    searchParams.set('ts', String(Date.now()));
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

function readPublicResourceSnapshot(snapshotKey) {
  if (!snapshotKey || typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = readStorageValue(`${PUBLIC_RESOURCE_SNAPSHOT_PREFIX}${snapshotKey}`, null, { raw: true });
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.payload || null;
  } catch {
    return null;
  }
}

function writePublicResourceSnapshot(snapshotKey, payload) {
  if (!snapshotKey || typeof window === 'undefined') {
    return;
  }

  try {
    writeStorageValue(`${PUBLIC_RESOURCE_SNAPSHOT_PREFIX}${snapshotKey}`, JSON.stringify({
      payload,
      fetchedAt: Date.now(),
    }), { raw: true });
  } catch {
    // Snapshot persistence is best-effort.
  }
}

function readMemoryCache(cacheKey, memoryTtlMs, forceRefresh) {
  if (forceRefresh || memoryTtlMs <= 0) {
    return null;
  }

  const cached = resourceMemoryCache.get(cacheKey);
  if (!cached || Date.now() - cached.fetchedAt >= memoryTtlMs) {
    return null;
  }

  return cached.payload;
}

export function getPublicResourceDiagnostics() {
  return {
    usePublicApi: shouldUsePublicApi(),
    allowSupabaseFallback: shouldAllowPublicSupabaseFallback(),
    cacheVersion: versionState.value,
    cacheVersionFetchedAt: versionState.fetchedAt,
    memoryEntries: Array.from(resourceMemoryCache.entries()).map(([key, value]) => ({
      key,
      fetchedAt: value.fetchedAt,
      age: Math.max(0, Date.now() - value.fetchedAt),
      cacheVersion: value.payload?.meta?.cacheVersion || null,
    })),
  };
}

export async function fetchPublicApiJson(path, {
  params = null,
  label = 'public api',
  timeoutMs,
  retries = 1,
  forceRefresh = false,
  memoryTtlMs = PUBLIC_RESOURCE_MEMORY_TTL,
  snapshotKey = null,
  useSnapshotFallback = false,
  usePublicApiInDev = false,
  signal,
} = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  const usePublicApi = shouldUsePublicApi() || usePublicApiInDev;
  if (!usePublicApi) {
    return useSnapshotFallback ? readPublicResourceSnapshot(snapshotKey) : null;
  }

  const type = new URLSearchParams(params || undefined).get('type');
  const statistic = !IS_LOCAL_DEV && path === '/api/stats' && isPublicStatistic(type);
  const versioned = statistic || !IS_LOCAL_DEV && path === '/api/stats' && type === 'pools';
  const versions = versioned ? await checkSnapshotVersions('', { force: forceRefresh }) : null;
  const scope = type === 'pool_observations' ? { kind: 'pool', poolId: new URLSearchParams(params).get('poolId') }
    : type === 'group_statistics' ? { kind: 'group', groupKey: new URLSearchParams(params).get('groupKey') } : null;
  const cacheVersion = versioned ? statistic ? versions?.public?.[publicSnapshotScope(type, scope)] : versions?.catalogVersion : shouldUsePublicApi()
    ? await getPublicCacheVersion(forceRefresh).catch(() => versionState.value)
    : 'dev';
  const bypassCache = forceRefresh && !versioned;
  const url = buildPublicApiUrl(path, {
    params,
    cacheVersion,
    forceRefresh: bypassCache,
  });

  const policy = shouldUsePublicApi() ? cachePolicy(path, params) : null;
  const cacheKey = buildPublicApiUrl(path, { params });
  const ttlMs = policy ? policy.maxAgeMs : memoryTtlMs;
  const cachedPayload = readMemoryCache(url, ttlMs, bypassCache);
  if (cachedPayload) {
    return cachedPayload;
  }

  // The shared request has its own network timeout. Aborting one view only
  // cancels that view's wait, never another subscriber's fetch or cache write.
  if (resourceRequests.has(url)) return waitForResource(resourceRequests.get(url), signal);
  if (bypassCache) resourceGenerations.set(cacheKey, (resourceGenerations.get(cacheKey) || 0) + 1);
  const generation = resourceGenerations.get(cacheKey) || 0;
  const request = (async () => {
    if (policy && cacheVersion && !bypassCache) {
      const saved = await readBrowserPublicCache(cacheKey);
      if (saved?.cacheVersion === cacheVersion && saved.payload?.success === true
        && saved.savedAt <= Date.now() && Date.now() - saved.savedAt < ttlMs) {
        if (generation === (resourceGenerations.get(cacheKey) || 0)) resourceMemoryCache.set(url, { payload: saved.payload, fetchedAt: saved.savedAt });
        return saved.payload;
      }
    }
    try {
      const { response, data } = await fetchJsonWithTimeout(url, {
        method: 'GET',
        ...(bypassCache ? { cache: 'no-store' } : {}),
        headers: { 'Content-Type': 'application/json' },
      }, { label, timeoutMs, retries });

      if (!response.ok) throw new Error(`${label} failed with ${response.status}`);
      if (!data?.success) throw new Error(data?.error || `${label} returned failure`);

      // Public data responses must not indefinitely postpone the small version
      // check. Only an actual version response advances its checkedAt timestamp.
      const responseVersion = String(versioned ? cacheVersion || '' : data?.meta?.cacheVersion || cacheVersion || '');
      if (!statistic && responseVersion && responseVersion !== cacheVersion && versionState.value === cacheVersion) {
        rememberVersion(responseVersion, versionState.fetchedAt);
      }

      const complete = response.status !== 202 && !data.partial && !data.stale
        && data.meta?.availability !== 'building' && hasCompletePublicPayload(path, data);
      const stillCurrent = generation === (resourceGenerations.get(cacheKey) || 0);
      const memoryKey = buildPublicApiUrl(path, { params, cacheVersion: responseVersion || cacheVersion });
      if (stillCurrent && (!policy || complete)) resourceMemoryCache.set(memoryKey, { payload: data, fetchedAt: Date.now() });
      if (stillCurrent && policy && complete && responseVersion) {
        await writeBrowserPublicCache({ key: cacheKey, cacheVersion: responseVersion, savedAt: Date.now(), payload: data });
      }
      if (resourceMemoryCache.size > 96) resourceMemoryCache.delete(resourceMemoryCache.keys().next().value);
      writePublicResourceSnapshot(snapshotKey, data);
      return data;
    } catch (error) {
      const snapshot = useSnapshotFallback ? readPublicResourceSnapshot(snapshotKey) : null;
      if (snapshot) return snapshot;
      throw error;
    }
  })().finally(() => { if (resourceRequests.get(url) === request) resourceRequests.delete(url); });
  resourceRequests.set(url, request);
  return waitForResource(request, signal);
}

export default {
  buildPublicApiUrl,
  fetchPublicApiJson,
  getPublicResourceDiagnostics,
  getPublicCacheVersion,
  shouldAllowPublicSupabaseFallback,
  shouldUsePublicApi,
};
