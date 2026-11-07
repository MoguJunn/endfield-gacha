import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ read: vi.fn(), stored: new Map() }));
vi.mock('../publicResourceClient.js', () => ({ fetchPublicApiJson: backend.read }));
vi.mock('../snapshotChangeService.js', () => ({ checkSnapshotVersions: async () => ({ public: {
  global_summary: 'summary-1', character_catalog: 'catalog-1', character_ranking: 'ranking-1',
} }) }));
vi.mock('../../dev/contributorDemoMode.js', () => ({ isContributorDemoModeEnabled: () => false }));
vi.mock('../../utils/storageUtils.js', () => ({
  STORAGE_KEYS: { GLOBAL_SUMMARY_STATS_SNAPSHOT: 'summary', CHARACTER_CATALOG_SNAPSHOT: 'catalog', CHARACTER_RANKING_SNAPSHOT: 'ranking' },
  readStorageValue: key => backend.stored.get(key) || null,
  writeStorageValue: (key, value) => backend.stored.set(key, value),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('PROD', true);
  backend.stored.clear();
  backend.read.mockReset().mockImplementation(async (_, { params }) => ({ data: {
    global_summary: { globalSummary: { totalPulls: 10 } },
    character_catalog: { characterCatalog: { totalContributors: 2, characters: [{ id: 'a', name: 'A', rarity: 6 }],
      meta: { updatedAt: '2026-11-06T12:00:00Z', stale: false } } },
    character_ranking: { characterRanking: { limited: { sixStarUp: [] } } },
  }[params.type] }));
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ['getGlobalSummaryStats', 'global_summary'],
  ['getCharacterCatalogStats', 'character_catalog'],
  ['getCharacterRankingStats', 'character_ranking'],
])('forces an API read despite an unchanged published revision: %s', async (method, type) => {
  const service = await import('../statsService.js');
  const calls = () => backend.read.mock.calls.filter(([, options]) => options.params.type === type);
  const initial = await service[method]();
  expect(await service[method]()).toBe(initial);
  expect(calls()).toHaveLength(1);
  await service[method](true);
  expect(calls()).toHaveLength(2);
  expect(calls()[1][1].forceRefresh).toBe(true);
});

it('preserves independent catalog freshness even when the overview cannot load', async () => {
  const read = backend.read.getMockImplementation();
  backend.read.mockImplementation((url, options) => options.params.type === 'global_summary' ? null : read(url, options));
  const { getGlobalSummaryStats } = await import('../statsService.js');
  const result = await getGlobalSummaryStats(true);
  expect(result.meta.status).toBe('unavailable');
  expect(result.characterCatalog.rows[0].id).toBe('a');
  expect(result.characterCatalog.meta).toMatchObject({ updatedAt: '2026-11-06T12:00:00Z', status: 'ready' });
});

it('keeps a stale server snapshot marked stale and retries instead of freezing its revision', async () => {
  const read = backend.read.getMockImplementation();
  backend.read.mockImplementation((url, options) => options.params.type === 'global_summary'
    ? { data: { globalSummary: { totalPulls: 10, meta: { stale: true, updatedAt: '2026-10-17T12:00:00Z' } } } }
    : read(url, options));
  const { getGlobalSummaryStats } = await import('../statsService.js');
  expect((await getGlobalSummaryStats()).meta).toMatchObject({ status: 'stale', updatedAt: '2026-10-17T12:00:00Z' });
  await getGlobalSummaryStats();
  expect(backend.read.mock.calls.filter(([, options]) => options.params.type === 'global_summary')).toHaveLength(2);
});
