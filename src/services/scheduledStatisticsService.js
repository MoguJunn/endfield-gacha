import { getSameOriginAuthHeaders } from './authFetchService.js';

export async function loadPersonalStatistics(signal) {
  const { headers } = await getSameOriginAuthHeaders({ Accept: 'application/json' }, { syncSiteSession: false, useSiteSessionCache: true, allowSiteSessionToken: false });
  const response = await fetch('/api/stats?type=personal_statistics', { signal, headers, credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error('Personal statistics unavailable');
  return result;
}
