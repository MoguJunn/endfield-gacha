import { describe, expect, it } from 'vitest';
import { buildStoredPoolObservations, prepareStoredPoolObservations, getStoredObservationAccounts, storedAccountKey } from '../storedPoolObservations.js';

const row = (id, extra = {}) => ({ id, record_id: id, user_id: 'owner', game_uid: 'uid', server_scope: 'cn',
  pool_id: 'p', character_id: 'a', rarity: 6, timestamp: 1700000000000 + id * 1000, seq_id: String(id), is_new: false, ...extra });

describe('stored observation adapter', () => {
  it('reuses sorted buckets without losing cross-pool duplicate precedence or account isolation', () => {
    const history = [row(5), row(4, { pool_id: 'q', record_id: 1 }), row(3, { server_scope: 'intl' }),
      row(2, { timestamp: 'invalid' }), row(1), row(6, { pool_id: 'q', character_id: 'low', rarity: 4 }),
      row(7, { pool_id: 'q' }), row(8, { pool_id: 'q', special_type: 'gift' })];
    const before = structuredClone(history);
    const read = prepareStoredPoolObservations({ history });
    const cn = storedAccountKey(history[0]);
    expect(read('p')).toMatchObject({ total: 3, participatingAccounts: 2, meta: { exclusions: { invalidTime: 1 } } });
    expect(read('p', cn).items[0]).toMatchObject({ first: { mean: 1, sampleCount: 1 }, repeat: { mean: 1, sampleCount: 1 } });
    expect(read('q')).toMatchObject({ total: 2, participatingAccounts: 1, meta: { exclusions: { duplicate: 1 } } });
    expect(read('q').items.find((item) => item.itemId === 'a').first.mean).toBe(2);
    expect(read('missing')).toMatchObject({ total: 0, items: [], meta: { firstRecordAt: null } });
    const first = read('q');
    first.items[0].first.points.length = 0;
    expect(read('q').items[0].first.points).not.toHaveLength(0);
    expect(history).toEqual(before);
  });
  it('computes first and repeat costs within imported banner records without claiming complete history', () => {
    const stats = buildStoredPoolObservations({ poolId: 'p', history: [row(1, { is_new: true }), row(2, { character_id: 'b', rarity: 4 }), row(3)] });
    const a = stats.items.find((item) => item.itemId === 'a');
    expect(a.first.sampleCount).toBe(1);
    expect(a.first.mean).toBe(1);
    expect(a.unknownCost).toBe(0);
    expect(a.repeat.mean).toBe(2);
    expect(stats.meta.prefixVerified).toBe(false);
    expect(stats.costUnit).toBe('stored-results');
  });
  it('does not treat false defaults as proof of an earlier acquisition in this banner', () => {
    const stats = buildStoredPoolObservations({ poolId: 'p', history: [row(1), row(2)] });
    expect(stats.items[0].unknownClassification).toBe(0);
    expect(stats.items[0].first.mean).toBe(1);
    expect(stats.items[0].repeat.mean).toBe(1);
  });
  it('keeps owners and regions separate and filters the selected account', () => {
    const history = [row(1), row(2), row(1, { server_scope: 'intl' }), row(1, { user_id: 'another' })];
    expect(getStoredObservationAccounts(history)).toHaveLength(3);
    expect(buildStoredPoolObservations({ history, poolId: 'p', accountKey: storedAccountKey(history[0]) }).total).toBe(2);
    expect(buildStoredPoolObservations({ history, poolId: 'p' }).participatingAccounts).toBe(3);
  });
  it('keeps record-derived names local to the selected account when no directory exists', () => {
    const history = [row(1, { character_name: 'CN name' }), row(2, { server_scope: 'intl', character_name: 'Global name' })];
    const read = prepareStoredPoolObservations({ history });
    expect(read('p').items[0].name).toBe('CN name');
    expect(read('p', storedAccountKey(history[1])).items[0].name).toBe('Global name');
  });
  it('reports excluded rows and includes known catalog items with zero hits', () => {
    const stats = buildStoredPoolObservations({ poolId: 'p', history: [row(1), row(2, { character_id: '' }), row(3, { game_uid: '' })],
      catalog: [{ id: 'a', name: 'A', rarity: 6 }, { id: 'b', name: 'B', rarity: 6 }] });
    expect(stats.total).toBe(2);
    expect(stats.meta.excludedRecords).toBe(1);
    expect(stats.meta.unidentifiedRecords).toBe(1);
    expect(stats.items.find((item) => item.itemId === 'b')).toMatchObject({ count: 0, rate: 0, nonObtainingAccounts: 1 });
  });
  it('recovers only unique exact catalog names with matching rarity and type', () => {
    const directory = [{ id: 'a', name: 'A', aliases: ['Alias A'], rarity: 6, type: 'character' },
      { id: 'w', name: 'A', rarity: 6, type: 'weapon' },
      { id: 'b', name: 'Ambiguous', rarity: 4, type: 'character' }, { id: 'c', name: 'Ambiguous', rarity: 4, type: 'character' }];
    const stats = buildStoredPoolObservations({ poolId: 'p', directory, entityType: 'character', history: [
      row(1, { character_id: null, character_name: 'A' }), row(2, { character_id: null, character_name: 'Alias A' }),
      row(3, { character_id: null, character_name: 'A', rarity: 4 }), row(4, { character_id: null, character_name: 'Ambiguous', rarity: 4 }),
      row(5, { character_id: null, character_name: null, rarity: 4 }),
    ] });
    expect(stats).toMatchObject({ total: 5, meta: { excludedRecords: 0, matchedByName: 2, unidentifiedRecords: 3 } });
    expect(stats.items).toHaveLength(1);
    expect(stats.items[0]).toMatchObject({ itemId: 'a', count: 2, rate: 0.4 });
  });
});
