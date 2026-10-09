import { getSameOriginAuthHeaders } from './authFetchService.js';
import { isContributorDemoModeEnabled, isContributorDemoSessionActive } from '../dev/contributorDemoMode.js';

export async function loadPublicStatistics(type, signal, scope = null) {
  if (import.meta.env.DEV && isContributorDemoModeEnabled()) {
    const { getContributorDemoPublicStatistics } = await import('../dev/contributorDemoStatistics.js');
    return getContributorDemoPublicStatistics(type, scope);
  }
  const params = new URLSearchParams({ type });
  if (scope?.kind === 'pool') params.set('poolId', scope.poolId);
  if (scope?.kind === 'group') params.set('groupKey', scope.groupKey);
  const response = await fetch(`/api/stats?${params}`, { signal });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error(result.error || 'statistics_unavailable');
  return result;
}

export async function loadPersonalStatistics(signal) {
  if (import.meta.env.DEV && isContributorDemoModeEnabled()) {
    if (!isContributorDemoSessionActive()) throw new Error('Sandbox login required');
    const { getContributorDemoPersonalStatistics } = await import('../dev/contributorDemoStatistics.js');
    return getContributorDemoPersonalStatistics();
  }
  const { headers } = await getSameOriginAuthHeaders({ Accept: 'application/json' }, { syncSiteSession: false, useSiteSessionCache: true, allowSiteSessionToken: false });
  const response = await fetch('/api/stats?type=personal_statistics', { signal, headers, credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error('Personal statistics unavailable');
  return result;
}
