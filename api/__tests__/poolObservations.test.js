import { describe, expect, it, vi } from 'vitest';
import { handlePoolObservations, readPoolObservationAggregate } from '../_lib/poolObservations.js';

function client(rows, { failPage = false } = {}) {
  return { from: vi.fn((table) => {
    const state = { start: 0, end: 999, pool: null, head: false, newest: false };
    const query = { select: (_fields, options) => { state.head = options?.head; return query; }, eq: (_key, value) => { state.pool = value; return query; },
      order: (_key, options) => { state.newest = options.ascending === false; return query; }, limit: () => query, maybeSingle: () => query,
      lte: () => query, range: (start, end) => { state.start = start; state.end = end; return query; },
      abortSignal: async () => {
        if (table === 'pools') return { data: { pool_id: state.pool, name: 'Public pool', type: 'limited' } };
        if (table === 'characters') return { data: [{ id: 'a', name: 'Public item', rarity: 6, type: 'character' }] };
        if (state.newest) return { data: rows.slice(-1) };
        if (state.head) return { count: rows.length };
        if (failPage && state.start) return { error: new Error('later page failed') };
        return { data: rows.slice(state.start, state.end + 1) };
      } };
    return query;
  }) };
}
const records = (count) => Array.from({ length: count }, (_, index) => ({ id: index + 1, record_id: `private-record-${index}`, user_id: 'private-owner',
  game_uid: 'private-uid', server_scope: 'cn', pool_id: 'p', character_id: 'a', rarity: 6, timestamp: 1700000000000 + index * 1000,
  seq_id: index, character_name: 'PRIVATE LABEL', is_new: index === 0 }));

describe('public pool observations', () => {
  it('aggregates every page without disclosing raw account identities or private labels', async () => {
    const result = await readPoolObservationAggregate(client(records(1001)), 'p');
    expect(result.observations.total).toBe(1001);
    expect(result.observations.items[0].repeat.sampleCount).toBe(1000);
    expect(result.observations.items[0].name).toBe('Public item');
    expect(JSON.stringify(result)).not.toMatch(/private-owner|private-uid|private-record|PRIVATE LABEL/);
    expect(result.observations.items[0].first.sampleCount).toBe(1);
    expect(result.observations.firstMode).toBe('pool');
    expect(result).not.toHaveProperty('modes');
  });
  it('keeps unnamed rows in totals and resolves named rows without publishing private labels', async () => {
    const rows = records(4);
    rows[1] = { ...rows[1], character_id: null, character_name: 'Public item' };
    rows[2] = { ...rows[2], character_id: null, character_name: 'PRIVATE UNMATCHED LABEL', rarity: 4 };
    const result = await readPoolObservationAggregate(client(rows), 'p');
    expect(result.observations).toMatchObject({ total: 4, meta: { excludedRecords: 0, matchedByName: 1, unidentifiedRecords: 1 } });
    expect(result.observations.items[0]).toMatchObject({ count: 3, repeat: { mean: 1.5, sampleCount: 2 } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private-owner|private-uid|private-record/);
  });
  it('rejects a failed later page instead of returning a truncated distribution', async () => {
    await expect(readPoolObservationAggregate(client(records(1001), { failPage: true }), 'p')).rejects.toThrow('later page failed');
  });
  it('does not silently sample a scope exceeding the configured limit', async () => {
    await expect(readPoolObservationAggregate(client(records(1001)), 'p', { maxRows: 1000 })).rejects.toThrow('scope too large');
  });
  it('validates the scope before accessing the database', async () => {
    const supabase = client([]);
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handlePoolObservations({ query: { poolId: 'limited' } }, res, supabase);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
