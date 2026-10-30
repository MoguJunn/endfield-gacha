import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const backend = vi.hoisted(() => ({ request: vi.fn(), statistics: 's1', analysis: 'a1' }));
vi.mock('../supabaseRequest.js', () => ({ fetchJsonWithTimeout: backend.request }));
vi.mock('../authFetchService.js', () => ({ getSameOriginAuthHeaders: async () => ({ headers: {} }) }));
vi.mock('../../dev/contributorDemoMode.js', () => ({ isContributorDemoModeEnabled: () => false, isContributorDemoSessionActive: () => false }));
beforeEach(() => {
  vi.resetModules(); sessionStorage.clear(); backend.statistics = 's1'; backend.analysis = 'a1';
  backend.request.mockReset().mockImplementation(async url => ({ response: { ok: true }, data: String(url).includes('snapshot_versions')
    ? { success: true, data: { catalogVersion: 'c1', public: {}, personal: { ownerId: 'owner', statistics: backend.statistics, analysis: backend.analysis } } }
    : { success: true, availability: 'ready', meta: { ownerId: 'owner' }, scope: {}, owner: { accounts: [] } } }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { accounts: [] }, meta: { ownerId: 'owner' } }) })));
});
afterEach(() => vi.unstubAllGlobals());

it('checks personal statistics revisions without downloading the same snapshot again', async () => {
  const { loadPersonalStatistics } = await import('../scheduledStatisticsService.js');
  const options = { ownerId: 'owner', checkVersion: true };
  const first = await loadPersonalStatistics(undefined, options);
  expect(await loadPersonalStatistics(undefined, options)).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(1);
  backend.statistics = 's2';
  expect(await loadPersonalStatistics(undefined, options)).not.toBe(first);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('reuses card analysis by revision and selected account/view instead of elapsed time', async () => {
  const { loadAccountGachaAnalysis } = await import('../accountGachaDataService.js');
  const options = { ownerId: 'owner', checkVersion: true, accountKey: 'uid::server:1', viewKey: 'p' };
  const first = await loadAccountGachaAnalysis(options);
  expect(await loadAccountGachaAnalysis(options)).toBe(first);
  const payloadReads = () => backend.request.mock.calls.filter(([url]) => String(url).includes('mode=analysis')).length;
  expect(payloadReads()).toBe(1);
  await loadAccountGachaAnalysis({ ...options, viewKey: 'q' }); expect(payloadReads()).toBe(2);
  backend.analysis = 'a2'; await loadAccountGachaAnalysis(options); expect(payloadReads()).toBe(3);
});
