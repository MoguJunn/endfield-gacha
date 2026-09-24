import { describe, expect, it } from 'vitest';
import { buildPoolObservations, observationRange } from '../poolObservationStats.js';

const row = (sequence, extra = {}) => ({
  id: `r${sequence}`, accountKey: 'owner:uid:cn', poolId: 'p1', itemId: 'low', rarity: 4,
  timestamp: sequence, sequence, kind: 'pull', newItem: null, ...extra,
});
const stats = (records, options = {}) => buildPoolObservations({
  records, poolId: 'p1', completeAccounts: ['owner:uid:cn'], ...options,
});

describe('pool observation samples', () => {
  it('uses only the selected banner period even when the item was previously owned', () => {
    const records = [row(1, { poolId: 'old', itemId: 'up', rarity: 6 }), row(2), row(3, { itemId: 'up', rarity: 6 }), row(4, { itemId: 'up', rarity: 6 })];
    const perPool = stats(records).items.find((item) => item.itemId === 'up');
    expect(perPool.first.mean).toBe(2);
    expect(perPool.repeat.mean).toBe(1);
    expect(stats(records).firstMode).toBe('pool');
  });
  it('counts free and intel pulls while gifts do not change first acquisition', () => {
    const records = [row(1, { kind: 'gift', itemId: 'up', rarity: 6 }), row(2, { kind: 'infoBook' }), row(3, { kind: 'free', itemId: 'up', rarity: 6 }), row(4, { itemId: 'up', rarity: 6 })];
    const result = stats(records);
    expect(result).toMatchObject({ total: 3, free: 1, infoBook: 1, resources: 1 });
    expect(result.items.find((item) => item.itemId === 'up').first.mean).toBe(2);
    expect(result.items.find((item) => item.itemId === 'up').repeat.mean).toBe(1);
    expect(result.rarities.reduce((sum, item) => sum + item.rate, 0)).toBeCloseTo(1);
  });
  it('does not fabricate a cost from a truncated prefix; later complete intervals still work', () => {
    const result = stats([row(1, { itemId: 'up', rarity: 6, newItem: true }), row(2), row(3, { itemId: 'up', rarity: 6 }), row(4)], { completeAccounts: [] });
    const up = result.items.find((item) => item.itemId === 'up');
    expect(up).toMatchObject({ unknownCost: 1, repeatUnfinished: 1 });
    expect(up.first.mean).toBeNull();
    expect(up.repeat.mean).toBe(2);
    expect(result.incompleteAccounts).toBe(1);
  });
  it('uses recorded banner acquisitions even when historical new flags disagree', () => {
    const result = stats([row(1, { itemId: 'up', rarity: 6, newItem: false }), row(2, { itemId: 'up', rarity: 6, newItem: true })]);
    expect(result.items[0]).toMatchObject({ unknownClassification: 0 });
    expect(result.items[0].first.sampleCount).toBe(1);
    expect(result.items[0].repeat.sampleCount).toBe(1);
  });
  it('counts unidentified pulls without shortening intervals or inventing same-rarity hits', () => {
    const result = stats([row(1, { itemId: 'up', rarity: 6 }), row(2), row(3, { itemId: null }), row(4), row(5, { itemId: 'up', rarity: 6 })]);
    expect(result.total).toBe(5);
    expect(result.rarities.find((item) => item.rarity === 4).count).toBe(3);
    expect(result.items.find((item) => item.itemId === 'up').repeat.mean).toBe(4);
    expect(result.items.find((item) => item.itemId === 'low')).toMatchObject({ unknownCost: 1, repeat: { sampleCount: 0 } });
    expect(stats([row(1, { itemId: null }), row(2)]).items[0].unknownClassification).toBe(1);
  });
  it('partitions identical UIDs by full account key before combining distributions', () => {
    const records = [row(1, { itemId: 'up', rarity: 6, newItem: true }), row(1, { accountKey: 'owner:uid:intl' }), row(2, { accountKey: 'owner:uid:intl', itemId: 'up', rarity: 6, newItem: true })];
    const result = stats(records, { completeAccounts: ['owner:uid:cn', 'owner:uid:intl'] });
    expect(result.participatingAccounts).toBe(2);
    expect(result.items.find((item) => item.itemId === 'up').first.mean).toBe(1.5);
    expect(stats(records, { accountKey: 'owner:uid:cn' }).total).toBe(1);
  });
  it('range selection preserves the original CDF denominator and zero frequencies', () => {
    const series = { points: [{ cost: 2, count: 1, cumulativeRate: 0.25 }, { cost: 5, count: 3, cumulativeRate: 1 }] };
    expect(observationRange(series, 3, 5)).toEqual([
      { cost: 3, count: 0, cumulativeRate: 0.25 }, { cost: 4, count: 0, cumulativeRate: 0.25 }, { cost: 5, count: 3, cumulativeRate: 1 },
    ]);
  });
  it('rejects duplicate or unnormalized records and handles empty history', () => {
    expect(() => stats([row(1), row(1)])).toThrow('Duplicate');
    expect(() => stats([row(1, { kind: 'unknown' })])).toThrow('normalized');
    for (const newItem of [undefined, 'false', 0]) {
      expect(() => stats([row(1, { newItem })])).toThrow('normalized');
    }
    expect(stats([])).toMatchObject({ total: 0, items: [], rarities: [] });
  });
});
