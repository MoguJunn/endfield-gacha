import { fetchPublicApiJson } from './publicResourceClient.js';
import {
  readStorageValue,
  removeStorageValue,
  STORAGE_KEYS,
  writeStorageValue,
} from '../utils/storageUtils.js';
import { isContributorDemoModeEnabled } from '../dev/contributorDemoMode.js';
import {
  getContributorDemoSandboxSnapshot,
  initializeContributorDemoSandbox,
} from '../dev/contributorDemoSandboxStore.js';
import { pickPublicSiteConfig } from '../../shared/publicSiteConfig.js';
import { sanitizePublicPoolRecord } from '../../shared/publicCatalogDto.js';
import { APPROVED_PUBLIC_RESOURCE_HOSTS } from '../utils/publicResourceUrl.js';

const BOOTSTRAP_API_TIMEOUT_MS = 25000;
const BOOTSTRAP_MEMORY_TTL = 5 * 60 * 1000;
const BOOTSTRAP_SNAPSHOT_SCHEMA_VERSION = 3;
const bootstrapState = {
  data: null,
  fetchedAt: 0,
  promise: null
};

function normalizeBootstrapPayload(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};

  return {
    siteConfig: pickPublicSiteConfig(data.siteConfig),
    pools: (Array.isArray(data.pools) ? data.pools : [])
      .map((pool) => sanitizePublicPoolRecord(pool, { allowedHosts: APPROVED_PUBLIC_RESOURCE_HOSTS }))
      .filter(Boolean)
  };
}

function readPersistedBootstrapSnapshot() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    removeStorageValue(STORAGE_KEYS.PUBLIC_BOOTSTRAP_SNAPSHOT_V2, { raw: true });
    const raw = readStorageValue(STORAGE_KEYS.PUBLIC_BOOTSTRAP_SNAPSHOT_V3, null, { raw: true });
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== BOOTSTRAP_SNAPSHOT_SCHEMA_VERSION) {
      return null;
    }

    return {
      data: normalizeBootstrapPayload(parsed.data),
      fetchedAt: Number(parsed.fetchedAt) || 0
    };
  } catch {
    return null;
  }
}

function writePersistedBootstrapSnapshot(data) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    removeStorageValue(STORAGE_KEYS.PUBLIC_BOOTSTRAP_SNAPSHOT_V2, { raw: true });
    writeStorageValue(STORAGE_KEYS.PUBLIC_BOOTSTRAP_SNAPSHOT_V3, JSON.stringify({
      schemaVersion: BOOTSTRAP_SNAPSHOT_SCHEMA_VERSION,
      data: normalizeBootstrapPayload(data),
      fetchedAt: Date.now()
    }), { raw: true });
  } catch {
    // 本地快照失败时静默降级
  }
}

function isFreshBootstrapCache(forceRefresh = false) {
  if (forceRefresh) {
    return false;
  }

  return bootstrapState.data !== null && Date.now() - bootstrapState.fetchedAt < BOOTSTRAP_MEMORY_TTL;
}

async function fetchBootstrapFromApi(forceRefresh = false) {
  const result = await fetchPublicApiJson('/api/bootstrap', {
    label: 'public bootstrap api',
    timeoutMs: BOOTSTRAP_API_TIMEOUT_MS,
    retries: 1,
    forceRefresh
  });

  if (!result?.data) {
    throw new Error(result?.error || 'bootstrap api returned failure');
  }

  return normalizeBootstrapPayload(result.data);
}

export async function preloadPublicBootstrap(forceRefresh = false) {
  if (isContributorDemoModeEnabled()) {
    await initializeContributorDemoSandbox();
    const snapshot = getContributorDemoSandboxSnapshot();
    const demoData = { siteConfig: snapshot.siteConfig, pools: snapshot.pools };
    bootstrapState.data = demoData;
    bootstrapState.fetchedAt = Date.now();
    return demoData;
  }

  if (isFreshBootstrapCache(forceRefresh)) {
    return bootstrapState.data;
  }

  if (!forceRefresh && bootstrapState.promise) {
    return bootstrapState.promise;
  }

  bootstrapState.promise = (async () => {
    try {
      const apiData = await fetchBootstrapFromApi(forceRefresh);
      bootstrapState.data = apiData;
      bootstrapState.fetchedAt = Date.now();
      writePersistedBootstrapSnapshot(apiData);
      return apiData;
    } catch {
      const persistedSnapshot = readPersistedBootstrapSnapshot();
      if (persistedSnapshot?.data) {
        bootstrapState.data = persistedSnapshot.data;
        bootstrapState.fetchedAt = persistedSnapshot.fetchedAt;
        return persistedSnapshot.data;
      }

      return null;
    }
  })();

  try {
    return await bootstrapState.promise;
  } finally {
    bootstrapState.promise = null;
  }
}

export function getBootstrapSnapshot() {
  if (bootstrapState.data) {
    return bootstrapState.data;
  }

  return readPersistedBootstrapSnapshot()?.data || null;
}

export async function getBootstrapSiteConfig(forceRefresh = false) {
  return (await preloadPublicBootstrap(forceRefresh))?.siteConfig || null;
}

export async function getBootstrapVisiblePools(forceRefresh = false) {
  return (await preloadPublicBootstrap(forceRefresh))?.pools || null;
}

export default {
  preloadPublicBootstrap,
  getBootstrapSnapshot,
  getBootstrapSiteConfig,
  getBootstrapVisiblePools
};

export const __internal = {
  BOOTSTRAP_SNAPSHOT_SCHEMA_VERSION,
  normalizeBootstrapPayload,
  readPersistedBootstrapSnapshot,
  writePersistedBootstrapSnapshot,
};
