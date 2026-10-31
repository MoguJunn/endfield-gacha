import { describe, expect, it } from 'vitest';
import { aggregateMergedUpAverage, buildMergedUpAverage } from '../mergedUpAverage.js';

const characters = [
  { id: 'a', name: '甲', aliases: ['Alpha'], rarity: 6, type: 'character' },
  { id: 'b', name: '乙', rarity: 6, type: 'character' },
  { id: 'w', name: '武器甲', rarity: 6, type: 'weapon' },
];
const pools = [
  { id: 'limited', name: '限定甲', type: 'limited', up_character: '甲' },
  { id: 'rerun', name: '复刻甲', type: 'extra', extra_subtype: 'reconstruction',
    extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'r', up_character: '甲' },
  { id: 'weapon', type: 'weapon', isLimitedWeapon: true, up_character: '武器甲' },
  { id: 'claim', type: 'extra', extra_subtype: 'reconstruction_claim',
    extra_rule_profile: 'reconstruction_weapon_v1', extra_series_key: 'w', up_character: '武器甲' },
  { id: 'standard', type: 'standard' },
  { id: 'weapon-standard', type: 'weapon', isLimitedWeapon: false },
  { id: 'festival', type: 'extra', extra_subtype: 'special', featured_characters: ['甲', '乙'] },
];
function draws(poolId, count, upAt = [], entity = 'a') {
  return Array.from({ length: count }, (_, index) => ({ id: `${poolId}-${index}`, poolId, seqId: String(index + 1),
    gameUid: 'game-1', serverScope: 'bilibili', rarity: upAt.includes(index) ? 6 : 4,
    ...(upAt.includes(index) ? { character_id: entity } : {}), isStandard: false }));
}
function build(history, options = {}) { return buildMergedUpAverage({ history, pools, characters, ...options }); }
const aggregate = (data, options = {}) => aggregateMergedUpAverage(data, { entityType: 'character', ...options });

describe('merged UP averages', () => {
  it('adds pull and UP counts across limited/rerun periods, including the unfinished tail', () => {
    const history = [...draws('limited', 100, [49]), ...draws('rerun', 20, [0, 9])];
    const data = build(history);
    expect(aggregate(data)).toMatchObject({ pulls: 120, upCount: 3, average: 40, poolIds: ['limited', 'rerun'] });
    expect(aggregate(data, { categories: ['limited'] })).toMatchObject({ pulls: 100, upCount: 1, average: 100 });
    expect(aggregate(data, { categories: ['reconstruction'] })).toMatchObject({ pulls: 20, upCount: 2, average: 10 });
  });

  it('separates operators and weapons and excludes standard and special banners', () => {
    const data = build([...draws('limited', 100, [10]), ...draws('weapon', 80, [60], 'w'),
      ...draws('claim', 40, [10], 'w'), ...draws('standard', 100, [10]), ...draws('festival', 500, [10]),
      ...draws('weapon-standard', 200, [10], 'w')]);
    expect(aggregate(data)).toMatchObject({ pulls: 100, upCount: 1 });
    expect(aggregate(data, { entityType: 'weapon' })).toMatchObject({ pulls: 120, upCount: 2, average: 60 });
    expect(data.pools).toHaveLength(4);
  });

  it('counts free pulls only with the toggle and never counts gifts or exchanges', () => {
    const history = [...draws('limited', 100, [10]),
      ...draws('rerun', 10, [1]).map(row => ({ ...row, is_free: true })),
      { id: 'gift', poolId: 'limited', rarity: 6, character_id: 'a', special_type: 'gift' },
      { id: 'book', poolId: 'limited', rarity: 4, is_info_book: true }];
    const data = build(history);
    expect(aggregate(data)).toMatchObject({ pulls: 101, upCount: 1, average: 101 });
    expect(aggregate(data, { includeFree: true })).toMatchObject({ pulls: 111, upCount: 2, average: 55.5 });
  });

  it('uses each period target rather than the union of all featured entities', () => {
    const data = build([...draws('limited', 10, [1]), ...draws('rerun', 10, [1])], {
      pools: pools.map(pool => pool.id === 'rerun' ? { ...pool, up_character: '乙' } : pool),
    });
    expect(aggregate(data)).toMatchObject({ pulls: 20, upCount: 1, unknownSixCount: 0, average: 20 });
  });

  it('infers B-server imported UPs from unique names and aliases without rate-up flags', () => {
    const data = build([{ poolId: 'limited', rarity: 6, name: 'Alpha', isStandard: true },
      { poolId: 'limited', rarity: 6, name: '乙', isStandard: false }]);
    expect(aggregate(data)).toMatchObject({ pulls: 2, upCount: 1, unknownSixCount: 0, average: 2 });
  });

  it.each([
    { character_id: 'unknown', name: '甲' },
    { character_id: 'a', name: '乙' },
    { name: '甲的一部分' },
    { isUp: true, isStandard: false },
  ])('does not turn missing or conflicting identities into UP evidence: %j', identity => {
    expect(aggregate(build([{ poolId: 'limited', rarity: 6, ...identity }])))
      .toMatchObject({ pulls: 1, upCount: 0, unknownSixCount: 1, average: null });
  });

  it('keeps ambiguous catalog names and missing targets unknown', () => {
    const row = { poolId: 'limited', rarity: 6, name: '甲' };
    expect(aggregate(build([row], { characters: [...characters, { id: 'other', name: '甲', rarity: 6, type: 'character' }] })).average).toBeNull();
    expect(aggregate(build([row], { pools: [{ id: 'limited', type: 'limited' }] })).unknownSixCount).toBe(1);
  });

  it('deduplicates pool selections and official sequence identities without collapsing different periods', () => {
    const history = [...draws('limited', 2, [0]), ...draws('limited', 2, [0]), ...draws('rerun', 2, [0])];
    const data = build(history, { pools: [...pools, pools[0]] });
    expect(aggregate(data, { categories: ['limited', 'limited', 'reconstruction'] })).toMatchObject({ pulls: 4, upCount: 2, average: 2 });
  });

  it('shows no average for zero UPs, empty selection, old snapshots or incomplete supplements', () => {
    expect(aggregate(build(draws('limited', 5)))).toMatchObject({ pulls: 5, upCount: 0, average: null });
    expect(aggregate(build(draws('limited', 5)), { categories: [] })).toMatchObject({ pulls: 0, average: null });
    expect(aggregate({ version: 0, pools: [] })).toBeNull();
    const data = build(draws('limited', 5, [0]), { entries: [{ poolId: 'limited', kind: 'pool-summary', values: { totalPulls: 10 } }] });
    expect(aggregate(data)).toMatchObject({ incomplete: true, average: null });
    expect(aggregate(data, { categories: ['reconstruction'] }).incomplete).toBe(false);
  });

  it('does not let free-only supplementary data block the paid-only average', () => {
    const data = build(draws('limited', 5, [0]), { entries: [{ poolId: 'limited', kind: 'batch-summary', values: { drawMethod: 'free', totalPulls: 10 } }] });
    expect(aggregate(data)).toMatchObject({ incomplete: false, average: 5 });
    expect(aggregate(data, { includeFree: true })).toMatchObject({ incomplete: true, average: null });
  });
});
