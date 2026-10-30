import { fetchJsonWithTimeout, fetchWithTimeout } from './supabaseRequest.js';
import { readStorageValue, writeStorageValue } from '../utils/storageUtils.js';

const PUBLIC_CACHE_VERSION_TIMEOUT_MS = 8000;
const PUBLIC_CACHE_VERSION_MEMORY_TTL = 30 * 1000;
const PUBLIC_RESOURCE_MEMORY_TTL = 60 * 1000;
const PUBLIC_RESOURCE_SNAPSHOT_PREFIX = 'public_resource_snapshot_v1:';

const IS_LOCAL_DEV = Boolean(import.meta.env?.DEV);
const ALLOW_EMERGENCY_PUBLIC_SUPABASE_FALLBACK = ['1', 'true', 'yes']
  .includes(String(import.meta.env?.VITE_PUBLIC_DATA_DIRECT_SUPABASE_FALLBACK || '').toLowerCase());

const versionState = {
  value: null,
  fetchedAt: 0,
  promise: null,
};
const resourceMemoryCache = new Map();

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

  if (isFreshVersion(forceRefresh)) {
    return versionState.value;
  }

  if (!forceRefresh && versionState.promise) {
    return versionState.promise;
  }

  versionState.promise = (async () => {
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
    versionState.value = version;
    versionState.fetchedAt = Date.now();
    return version;
  })();

  try {
    return await versionState.promise;
  } finally {
    versionState.promise = null;
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
} = {}) {
  const usePublicApi = shouldUsePublicApi() || usePublicApiInDev;
  if (!usePublicApi) {
    return useSnapshotFallback ? readPublicResourceSnapshot(snapshotKey) : null;
  }

  const cacheVersion = shouldUsePublicApi()
    ? await getPublicCacheVersion(forceRefresh).catch(() => null)
    : 'dev';
  const url = buildPublicApiUrl(path, {
    params,
    cacheVersion,
    forceRefresh,
  });

  const cachedPayload = readMemoryCache(url, memoryTtlMs, forceRefresh);
  if (cachedPayload) {
    return cachedPayload;
  }

  try {
    const { response, data } = await fetchJsonWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }, {
      label,
      timeoutMs,
      retries,
    });

    if (!response.ok) {
      throw new Error(`${label} failed with ${response.status}`);
    }

    if (!data?.success) {
      throw new Error(data?.error || `${label} returned failure`);
    }

    if (data?.meta?.cacheVersion) {
      versionState.value = String(data.meta.cacheVersion);
      versionState.fetchedAt = Date.now();
    }

    resourceMemoryCache.set(url, {
      payload: data,
      fetchedAt: Date.now(),
    });
    writePublicResourceSnapshot(snapshotKey, data);
    return data;
  } catch (error) {
    const snapshot = useSnapshotFallback ? readPublicResourceSnapshot(snapshotKey) : null;
    if (snapshot) {
      return snapshot;
    }
    throw error;
  }
}

export default {
  buildPublicApiUrl,
  fetchPublicApiJson,
  getPublicResourceDiagnostics,
  getPublicCacheVersion,
  shouldAllowPublicSupabaseFallback,
  shouldUsePublicApi,
};
