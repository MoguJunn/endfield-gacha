// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../shared/idAliasService.js', async (original) => ({ ...await original(), resolvePoolAliasMap: async () => new Map(), resolveCharacterAliasMap: async () => new Map() }));
import { buildPersonalStatisticsSnapshot } from '../_lib/personalStatisticsSnapshot.js';

function client(rows) {
  const db = { from: vi.fn((table) => {
    const state = { head: false, owner: null, start: 0, end: 999 };
    const query = { select: (_fields, options) => { state.head = options?.head; return query; },
      eq: (key, value) => { if (key === 'user_id') state.owner = value; return query; },
      in: () => query, order: () => query, range: (start, end) => { state.start = start; state.end = end; return query; },
      abortSignal: async () => {
        if (table === 'history') {
          expect(state.owner).toBe('owner');
          const owned = rows.filter((row) => row.user_id === state.owner);
          return state.head ? { count: owned.length } : { data: owned.slice(state.start, state.end + 1) };
        }
        if (table === 'pools') return { data: [{ pool_id: 'p', name: 'Test pool', type: 'limited', up_character: 'A' }] };
        if (table === 'characters') return { data: [{ id: 'a', name: 'A', rarity: 6, type: 'character' }] };
        throw new Error(`Unexpected table ${table}`);
      } };
    return query;
  }), rpc: vi.fn((name) => ({ abortSignal: async () => ({ data: name === 'get_app_visible_pools' ? [] : { limited: { sixStar: [] } } }) })) };
  return db;
}
const row = (id, scope = 'cn', extra = {}) => ({ id, record_id: String(id), user_id: 'owner', game_uid: 'uid',
  server_scope: scope, region: scope, server_id: scope === 'cn' ? '1' : '2', pool_id: 'p', rarity: 6, character_id: 'a', character_name: 'A',
  timestamp: new Date(1700000000000 + id * 1000).toISOString(), seq_id: id, ...extra });

describe('personal scheduled snapshots', () => {
  it('builds separate account observations and catalogs from all owner rows, retaining gifts only in ownership', async () => {
    const db = client([row(1), row(2), row(3, 'intl'), row(4, 'intl', { special_type: 'gift' }), row(5, 'cn', { user_id: 'another' })]);
    const data = await buildPersonalStatisticsSnapshot(db, 'owner');
    expect(data.accounts).toHaveLength(2);
    expect(data.scopes[''].p.total).toBe(3);
    expect(data.scopes[''].p.items[0].first.sampleCount).toBe(2);
    expect(data.scopes[''].p.items[0].repeat.sampleCount).toBe(1);
    expect(data.groupScopes[''].limited.observations).toMatchObject({ total: 3, participatingAccounts: 2 });
    expect(data.legacyScopes[''].p.regularTotal).toBe(3);
    for (const account of data.accounts) {
      expect(data.groupScopes[account.key].limited.observations.participatingAccounts).toBe(1);
    }
    expect(Object.values(data.catalogs)).toHaveLength(2);
    for (const catalogs of Object.values(data.catalogs)) {
      expect(catalogs['zh-CN'].rows.find((item) => item.id === 'a').acquisitionCount).toBe(2);
      expect(catalogs['en-US'].rows.find((item) => item.id === 'a').acquisitionCount).toBe(2);
    }
    expect(data).not.toHaveProperty('history');
    expect(JSON.stringify(data)).not.toContain('another');
    expect(db.rpc).toHaveBeenCalledWith('get_user_ranking_stats', { p_user_id: 'owner' });
  });
  it('publishes an empty owner result without waiting for an import', async () => {
    const result = await buildPersonalStatisticsSnapshot(client([]), 'owner');
    expect(result.accounts).toEqual([]);
    expect(result.scopes['']).toEqual({});
    expect(result.catalogs).toEqual({});
  });
});
