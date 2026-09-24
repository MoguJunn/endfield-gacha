// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readStatisticsScopeAggregate } from '../_lib/statisticsScopeAggregate.js';

const pools = [{ pool_id: 'p', type: 'limited', up_character: 'A' }, { pool_id: 's', type: 'standard' }];
const directory = [{ id: 'a', name: 'A', rarity: 6, type: 'character', is_limited: true }];
const row = (id, pool = 'p', extra = {}) => ({ id, record_id: String(id), user_id: 'owner', game_uid: 'uid', server_scope: 'cn',
  pool_id: pool, character_id: 'a', character_name: 'untrusted user label', rarity: 6, timestamp: new Date(1700000000000 + id * 1000).toISOString(), ...extra });
function client(history, { shortPage = false } = {}) {
  return {
    rpc: vi.fn(() => ({ abortSignal: async () => ({ data: pools }) })),
    from: vi.fn((table) => {
      const state = { filters: [], start: 0, end: Infinity, ascending: true, head: false };
      const query = {
        select: (_fields, options) => { state.head = options?.head; return query; },
        in: (key, values) => { state.filters.push((row) => values.includes(row[key])); return query; },
        gt: (key, value) => { state.filters.push((row) => row[key] > value); return query; },
        lte: (key, value) => { state.filters.push((row) => row[key] <= value); return query; },
        order: (_key, options) => { state.ascending = options?.ascending !== false; return query; },
        limit: (value) => { state.end = value - 1; return query; },
        range: (start, end) => { state.start = start; state.end = end; return query; },
        abortSignal: async () => {
          if (table === 'characters') return { data: directory };
          if (table === 'pools') return { data: pools.map((pool, index) => ({ ...pool, id: `internal-${index}` })) };
          const selected = history.filter((row) => state.filters.every((filter) => filter(row))).sort((a, b) => state.ascending ? a.id - b.id : b.id - a.id);
          return state.head ? { count: selected.length } : { data: shortPage && state.filters.length ? [] : selected.slice(state.start, state.end + 1) };
        },
      };
      return query;
    }),
  };
}
describe('scope worker context', () => {
  it('loads other pools for contributing accounts, without exposing identities or other-account observations', async () => {
    const history = [row(1, 's'), row(2, 'p'), row(3, 's', { game_uid: 'other' }), row(4, 's', { user_id: 'different' })];
    const result = await readStatisticsScopeAggregate(client(history), 'group:limited');
    expect(result.observations).toMatchObject({ total: 1, participatingAccounts: 1 });
    expect(result.meta).toMatchObject({ storedRows: 1, contextRows: 2 });
    expect(result.legacy).toMatchObject({ regularTotal: 1, sixStarCount: 1, targetCount: 1 });
    expect(JSON.stringify(result)).not.toMatch(/untrusted user label|game_uid|user_id|owner|different/);
    expect(result.observations.items[0].first.mean).toBe(1);
  });
  it('also publishes old scoped metrics for a real single pool', async () => {
    const result = await readStatisticsScopeAggregate(client([row(1)]), 'pool:p');
    expect(result).toMatchObject({ poolId: 'p', scopeKind: 'pool', legacy: { regularTotal: 1 }, observations: { total: 1 } });
    expect(result.observations.items[0].name).toBe('A');
  });
  it('rejects incomplete pagination instead of publishing a partial aggregate', async () => {
    await expect(readStatisticsScopeAggregate(client([row(1)], { shortPage: true }), 'group:limited')).rejects.toThrow('context changed');
  });
});
