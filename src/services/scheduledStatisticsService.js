import { getSameOriginAuthHeaders } from './authFetchService.js';
import { isContributorDemoModeEnabled, isContributorDemoSessionActive } from '../dev/contributorDemoMode.js';
import { fetchPublicApiJson } from './publicResourceClient.js';
import { checkSnapshotVersions } from './snapshotChangeService.js';
import { readPersonalSnapshot, waitForPersonalSnapshot } from './personalSnapshotCache.js';

export async function loadPublicStatistics(type, signal, scope = null, { forceRefresh = false } = {}) {
  if (import.meta.env.DEV && isContributorDemoModeEnabled()) {
    const { getContributorDemoPublicStatistics } = await import('../dev/contributorDemoStatistics.js');
    return getContributorDemoPublicStatistics(type, scope);
  }
  const params = new URLSearchParams({ type });
  if (scope?.kind === 'pool') params.set('poolId', scope.poolId);
  if (scope?.kind === 'group') params.set('groupKey', scope.groupKey);
  return fetchPublicApiJson('/api/stats', { params, signal, forceRefresh,
    label: 'public statistics', usePublicApiInDev: true, memoryTtlMs: import.meta.env.DEV ? 0 : undefined });
}

export async function loadPersonalStatistics(signal, { ownerId = '', checkVersion = false, forceRefresh = false } = {}) {
  if (import.meta.env.DEV && isContributorDemoModeEnabled()) {
    if (!isContributorDemoSessionActive()) throw new Error('Sandbox login required');
    const { getContributorDemoPersonalStatistics } = await import('../dev/contributorDemoStatistics.js');
    return getContributorDemoPersonalStatistics();
  }
  const versions = ownerId ? await checkSnapshotVersions(ownerId, { force: checkVersion || forceRefresh }) : null;
  return waitForPersonalSnapshot(readPersonalSnapshot({ ownerId, key: 'statistics', version: versions?.personal?.statistics, forceRefresh, fetcher: async () => {
    const { headers } = await getSameOriginAuthHeaders({ Accept: 'application/json' }, { syncSiteSession: false, useSiteSessionCache: true, allowSiteSessionToken: false });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Personal statistics timed out', 'TimeoutError')), 25000);
    const abort = () => controller.abort(signal.reason);
    if (!ownerId) {
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    }
    let response, result;
    try {
      response = await fetch('/api/stats?type=personal_statistics', { signal: controller.signal, headers, credentials: 'same-origin', ...(forceRefresh ? { cache: 'no-store' } : {}) });
      result = await response.json();
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
    if (!response.ok || result.success === false) throw new Error('Personal statistics unavailable');
    return result;
  } }), signal);
}
