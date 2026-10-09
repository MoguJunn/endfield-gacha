import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPersonalStatistics, loadPublicStatistics } from '../scheduledStatisticsService.js';

const state = vi.hoisted(() => ({ demo: true, active: true, revision: 0 }));
vi.mock('../../dev/contributorDemoMode.js', () => ({
  CONTRIBUTOR_DEMO_USER: { id: 'demo:contributor-admin' },
  isContributorDemoModeEnabled: () => state.demo,
  isContributorDemoSessionActive: () => state.active,
}));
vi.mock('../authFetchService.js', () => ({ getSameOriginAuthHeaders: async () => ({ headers: { Accept: 'application/json' } }) }));
vi.mock('../../dev/contributorDemoSandboxStore.js', () => ({
  getContributorDemoSandboxSnapshot: () => ({ revision: state.revision,
    pools: [{ id: 'p', name: '演示限定池', type: 'limited', up_character: 'A' }],
    characters: [{ id: 'a', name: 'A', rarity: 6, type: 'character' }],
    poolCharacters: { p: [{ characters: { id: 'a', name: 'A', rarity: 6, type: 'character' }, is_up: true }] },
  }),
}));
vi.mock('../../dev/contributorDemoRuntimeData.js', () => ({
  getContributorDemoRuntimeHistory: () => [
    { id: '1', user_id: 'demo:contributor-admin', game_uid: 'same', server_scope: 'cn', pool_id: 'p', character_id: 'a', rarity: 6, timestamp: 1700000000000 },
    { id: '2', user_id: 'demo:contributor-admin', game_uid: 'same', server_scope: 'intl', pool_id: 'p', character_id: 'a', rarity: 6, timestamp: 1700000001000, is_free: true },
    { id: '3', user_id: 'demo:contributor-admin', game_uid: 'same', server_scope: 'cn', pool_id: 'p', character_id: 'a', rarity: 6, timestamp: 1700000002000, special_type: 'gift' },
  ],
}));

beforeEach(() => {
  state.demo = true;
  state.active = true;
  state.revision++;
  vi.stubEnv('DEV', true);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('scheduled statistics data source', () => {
  it('keeps sandbox public pool and group reads local and excludes gifts from results', async () => {
    const pools = await loadPublicStatistics('pools');
    const counts = await loadPublicStatistics('pool_counts');
    const single = await loadPublicStatistics('pool_observations', undefined, { kind: 'pool', poolId: 'p' });
    const group = await loadPublicStatistics('group_statistics', undefined, { kind: 'group', groupKey: 'limited' });
    expect(pools.data.pools).toHaveLength(1);
    expect(counts.data.counts.p).toBe(2);
    expect(single.data.observations.total).toBe(2);
    expect(group.data.observations.total).toBe(2);
    expect(group.data.observations.participatingAccounts).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps personal account regions distinct and rejects signed-out sandbox reads', async () => {
    const result = await loadPersonalStatistics();
    expect(result.meta.ownerId).toBe('demo:contributor-admin');
    expect(result.data.accounts).toHaveLength(2);
    expect(result.data.scopes[''].p.total).toBe(2);
    for (const account of result.data.accounts) expect(result.data.scopes[account.key].p.total).toBe(1);
    state.active = false;
    await expect(loadPersonalStatistics()).rejects.toThrow('Sandbox login required');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rebuilds sandbox results after catalog revisions and does not share mutable DTOs', async () => {
    const first = await loadPublicStatistics('pools');
    first.data.pools.length = 0;
    expect((await loadPublicStatistics('pools')).data.pools).toHaveLength(1);
    state.revision++;
    expect((await loadPersonalStatistics()).data.accounts).toHaveLength(2);
  });

  it('uses same-origin APIs outside the development sandbox', async () => {
    vi.stubEnv('DEV', false);
    fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const controller = new AbortController();
    await loadPublicStatistics('group_statistics', controller.signal, { kind: 'group', groupKey: 'extra:reconstruction' });
    expect(fetch).toHaveBeenCalledWith('/api/stats?type=group_statistics&groupKey=extra%3Areconstruction', { signal: controller.signal });
    await loadPersonalStatistics(controller.signal);
    expect(fetch).toHaveBeenLastCalledWith('/api/stats?type=personal_statistics', expect.objectContaining({ credentials: 'same-origin', signal: controller.signal }));
  });
});
