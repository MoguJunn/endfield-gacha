// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readStatisticsPreviewDataset, readStatisticsScopeAggregate, statisticsDatasetCoversScope } from '../_lib/statisticsScopeAggregate.js';
import { statisticsHistory } from '../../shared/statisticsEligibility.js';

const pools = [{ pool_id: 'p', type: 'limited', up_character: 'A' }, { pool_id: 's', type: 'standard' }, { pool_id: 'w', type: 'weapon' }];
const directory = [{ id: 'a', name: 'A', rarity: 6, type: 'character', is_limited: true }];
const row = (id, pool = 'p', extra = {}) => ({ id, record_id: String(id), user_id: 'owner', game_uid: 'uid', server_scope: 'cn',
  pool_id: pool, character_id: 'a', character_name: 'untrusted user label', rarity: 6, timestamp: new Date(1700000000000 + id * 1000).toISOString(), ...extra });
function client(history, { shortPage = false, pageCap = 1000, gaps = [] } = {}) {
  return {
    rpc: vi.fn((name, params) => ({ abortSignal: async () => ({
      data: name === 'read_statistics_history_compact_page'
        ? shortPage ? [] : statisticsHistory(history).filter((row) => params.p_pool_ids.includes(row.pool_id)
          && row.id > params.p_after && row.id <= params.p_upper).sort((a, b) => a.id - b.id)
          .slice(0, Math.min(params.p_limit, pageCap)).map(row => [row.id,row.record_id,row.user_id,row.game_uid,
            row.server_scope,row.pool_id,row.pool_version,row.character_id,row.character_name,row.rarity,row.timestamp,
            row.seq_id,row.is_new,row.is_free,row.is_info_book,row.special_type])
        : name === 'read_statistics_history_count'
          ? statisticsHistory(history).filter(row => params.p_pool_ids.includes(row.pool_id) && row.id <= params.p_upper).length : pools,
    }) })),
    from: vi.fn((table) => {
      const state = { filters: [], start: 0, end: Infinity, ascending: true, head: false };
      const query = {
        select: (fields, options) => {
          if (table === 'history') expect(fields).toBe('id');
          state.head = options?.head; return query;
        },
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
          if (table === 'history') {
            expect(state.ascending).toBe(false);
            expect(state.end).toBe(0);
            return { data: history.length ? [{ id: Math.max(...history.map(row => row.id)) }] : [] };
          }
          expect(table).toBe('statistics_history');
          const selected = statisticsHistory(history).filter((row) => state.filters.every((filter) => filter(row))).sort((a, b) => state.ascending ? a.id - b.id : b.id - a.id);
          return state.head ? { count: selected.length } : { data: shortPage && state.filters.length ? []
            : selected.slice(state.start, Math.min(state.end + 1, state.start + pageCap)) };
        },
      };
      return query;
    }),
  };
}
describe('scope worker context', () => {
  it('loads only a weapon scope or complete character context and produces the same statistics as full history', async () => {
    const db = client([row(1, 's'), row(2, 'p'), row(3, 'w')]);
    const full = await readStatisticsPreviewDataset(db);
    const character = await readStatisticsPreviewDataset(db, { scope: 'pool:p' });
    const weapon = await readStatisticsPreviewDataset(db, { scope: 'pool:w' });
    expect(character.history.map(row => row.id)).toEqual([1, 2]);
    expect(weapon.history.map(row => row.id)).toEqual([3]);
    for (const [scope, dataset] of [['pool:p', character], ['pool:w', weapon]]) {
      const expected = await readStatisticsScopeAggregate(null, scope, { dataset: full });
      const actual = await readStatisticsScopeAggregate(null, scope, { dataset });
      expect(actual.legacy).toEqual(expected.legacy);
      expect(actual.observations).toEqual(expected.observations);
    }
    expect(statisticsDatasetCoversScope(character, 'group:limited')).toBe(true);
    expect(statisticsDatasetCoversScope(weapon, 'pool:p')).toBe(false);
    expect(statisticsDatasetCoversScope(character, 'pool:w')).toBe(false);
    expect(statisticsDatasetCoversScope({ ...character, coveredPoolIds: ['p'] }, 'pool:p')).toBe(false);
  });

  it('loads compact 10000-row pages serially and checks for interactive work between pages', async () => {
    const db = client(Array.from({ length: 10001 }, (_, i) => row(i + 1, 'p', { rarity: 4 })), { pageCap: 10000 });
    const beforeRead = vi.fn();
    const dataset = await readStatisticsPreviewDataset(db, { beforeRead });
    expect(dataset.history).toHaveLength(10001);
    expect(db.rpc.mock.calls.filter(([name]) => name === 'read_statistics_history_compact_page').map(([, p]) => p.p_after)).toEqual([0, 10000]);
    expect(beforeRead).toHaveBeenCalledTimes(3);
    expect(db.from).not.toHaveBeenCalledWith('statistics_history');
  });

  it('uses an excluded newest ID only as a bound without admitting excluded outcomes', async () => {
    const trusted = [row(1)];
    const history = [...trusted, row(999, 'p', { user_id: 'excluded-owner', statistics_excluded: true }),
      row(1000, 'p', { user_id: 'manual-owner', record_id: 'manual_1000' })];
    const expected = await readStatisticsScopeAggregate(client(trusted), 'pool:p');
    const db = client(history);
    const actual = await readStatisticsScopeAggregate(db, 'pool:p');
    const dataset = await readStatisticsPreviewDataset(db);
    expect(actual.observations).toEqual(expected.observations);
    expect(actual.legacy).toEqual(expected.legacy);
    expect(dataset.history.map(row => row.id)).toEqual([1]);
    expect(JSON.stringify(actual)).not.toMatch(/excluded-owner|manual-owner/);
  });

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
  it('reads a smaller server page cap completely and reuses an equivalent dataset without further database reads', async () => {
    const db = client([row(1, 's'), row(2), row(3), row(4, 's')], { pageCap: 1 });
    const expected = await readStatisticsScopeAggregate(db, 'pool:p');
    const dataset = await readStatisticsPreviewDataset(db);
    const reads = db.from.mock.calls.length;
    const actual = await readStatisticsScopeAggregate(db, 'pool:p', { dataset });
    expect(dataset.history).toHaveLength(4);
    expect(actual.observations).toEqual(expected.observations);
    expect(actual.legacy).toEqual(expected.legacy);
    expect(db.from).toHaveBeenCalledTimes(reads);
  });
  it('excludes manual samples from observations and inherited account context', async () => {
    const db = client([row(1, 's', { statistics_excluded: true }), row(2, 'p'),
      row(3, 'p', { statistics_excluded: true }), row(4, 'p', { record_id: 'manual_4' }), row(5, 'p', { game_uid: 'healthy' })]);
    const result = await readStatisticsScopeAggregate(db, 'group:limited');
    expect(result.observations.total).toBe(1);
    expect(result.meta).toMatchObject({ storedRows: 1, contextRows: 1 });
    expect(result.legacy.regularTotal).toBe(1);
    expect(db.from).toHaveBeenCalledWith('history'); // Strict mock allows only a one-ID upper bound.
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
    expect(db.from).toHaveBeenCalledWith('history'); // Outcomes still come from the filtered RPC.
    expect(JSON.stringify(result)).not.toContain('previous');
  });
});
