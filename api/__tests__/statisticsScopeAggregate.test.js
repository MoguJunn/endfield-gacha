// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readStatisticsScopeAggregate } from '../_lib/statisticsScopeAggregate.js';
import { statisticsHistory } from '../../shared/statisticsEligibility.js';

const pools = [{ pool_id: 'p', type: 'limited', up_character: 'A' }, { pool_id: 's', type: 'standard' }];
const directory = [{ id: 'a', name: 'A', rarity: 6, type: 'character', is_limited: true }];
const row = (id, pool = 'p', extra = {}) => ({ id, record_id: String(id), user_id: 'owner', game_uid: 'uid', server_scope: 'cn',
  pool_id: pool, character_id: 'a', character_name: 'untrusted user label', rarity: 6, timestamp: new Date(1700000000000 + id * 1000).toISOString(), ...extra });
function client(history, { shortPage = false, gaps = [] } = {}) {
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
          if (table === 'statistics_history_gaps') return { data: gaps.slice(state.start, state.end + 1) };
          expect(table).toBe('statistics_history');
          const selected = statisticsHistory(history).filter((row) => state.filters.every((filter) => filter(row))).sort((a, b) => state.ascending ? a.id - b.id : b.id - a.id);
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
  it('excludes manual samples from observations and inherited account context', async () => {
    const db = client([row(1, 's', { statistics_excluded: true }), row(2, 'p'),
      row(3, 'p', { statistics_excluded: true }), row(4, 'p', { record_id: 'manual_4' }), row(5, 'p', { game_uid: 'healthy' })]);
    const result = await readStatisticsScopeAggregate(db, 'group:limited');
    expect(result.observations.total).toBe(1);
    expect(result.meta).toMatchObject({ storedRows: 1, contextRows: 1 });
    expect(result.legacy.regularTotal).toBe(1);
    expect(db.from).not.toHaveBeenCalledWith('history');
  });
  it('applies the same exclusion to a preloaded preview dataset', async () => {
    const result = await readStatisticsScopeAggregate(null, 'pool:p', { dataset: {
      pools: pools.map(pool => ({ ...pool, id: pool.pool_id })),
      contextPools: pools.map(pool => ({ ...pool, id: pool.pool_id })), directory,
      history: [row(1), row(2, 'p', { statistics_excluded: true }), row(3, 's', { record_id: 'manual_3' }), row(4, 'p', { game_uid: 'healthy' })],
    } });
    expect(result.observations.total).toBe(1);
    expect(result.meta.contextRows).toBe(1);
  });
  it('loads persistent gap bounds in production without loading excluded outcomes', async () => {
    const catalog = [{ ...pools[0], pool_id: 'previous' }, ...pools];
    const db = client([row(80, 'p', { rarity: 6 })], { gaps: [{ user_id: 'owner', game_uid: 'uid', server_scope: 'cn',
      pool_id: 'previous', history_start_at: row(1).timestamp, history_end_at: row(70).timestamp }] });
    const originalFrom = db.from;
    db.from = vi.fn(table => table === 'pools'
      ? { select: () => ({ abortSignal: async () => ({ data: catalog }) }) }
      : originalFrom(table));
    const result = await readStatisticsScopeAggregate(db, 'pool:p');
    expect(result.legacy).toMatchObject({ regularTotal: 1, sixStarCount: 1, avgSixStarInterval: null,
      meta: { unknownInheritedIntervalCount: 1 } });
    expect(db.from).not.toHaveBeenCalledWith('history');
    expect(JSON.stringify(result)).not.toContain('previous');
  });
});
