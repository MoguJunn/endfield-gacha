import { describe, expect, it } from 'vitest';
import { buildGroupPoolObservations } from '../groupPoolObservations.js';
import { getStatisticsGroupPools, STATISTICS_GROUPS, statisticsItemCategory } from '../../../shared/statisticsScopes.js';

const pools = [{ id: 'p1', type: 'limited', up_character: 'Alpha' }, { id: 'p2', type: 'limited', up_character: 'Beta' }];
const directory = [
  { id: 'a', name: 'Alpha', rarity: 6, type: 'character', is_limited: true },
  { id: 'b', name: 'Beta', rarity: 6, type: 'character', is_limited: true },
  { id: 'c', name: 'Gamma', rarity: 6, type: 'character', is_limited: false },
  { id: 'd', name: 'Delta', rarity: 6, type: 'character', is_limited: true },
  { id: 'low', name: 'Low', rarity: 4, type: 'character', is_limited: false },
];
const row = (id, item = 'low', pool = 'p1', options = {}) => ({ id, record_id: String(id), user_id: 'owner', game_uid: 'uid', server_scope: 'cn', pool_id: pool,
  character_id: item, rarity: item === 'low' ? 4 : 6, timestamp: new Date(1700000000000 + id * 1000).toISOString(), ...options });
const build = (history, rest = {}) => buildGroupPoolObservations({ history, pools, directory, groupKey: 'limited', ...rest });
const category = (stats, id) => stats.items.find((item) => item.itemId === id);

describe('six-star scope aggregation', () => {
  it('retains six-star counts when recorded rarity conflicts with the canonical item', () => {
    const stats = build([row(1, 'low'), row(2, 'low', 'p1', { rarity: 6 }), row(3, 'a', 'p1', { rarity: 4 }), row(4, 'a')]);
    expect(stats.total).toBe(4);
    expect(category(stats, 'unknown').count).toBe(1);
    expect(category(stats, 'featured').count).toBe(1);
    expect(stats.items.reduce((sum, item) => sum + item.count, 0)).toBe(stats.rarities.find((item) => item.rarity === 6).count);
    expect(stats.meta.unidentifiedByRarity).toEqual({ 4: 1, 5: 0, 6: 1 });
  });
  it('classifies the same item per period and deduplicates account coverage across periods and objects', () => {
    const stats = build([row(1), row(2, 'a'), row(3, 'b'), row(4, 'd'), row(5, 'a', 'p2'), row(6, 'b', 'p2'), row(7, 'c', 'p2')]);
    expect(stats.total).toBe(7);
    expect(stats.participatingAccounts).toBe(1);
    expect(category(stats, 'featured').count).toBe(2);
    expect(category(stats, 'featured').first).toMatchObject({ sampleCount: 2, mean: 2, points: [{ cost: 2, count: 2, cumulativeRate: 1 }] });
    expect(category(stats, 'limited')).toMatchObject({ count: 3, nonObtainingAccounts: 0, first: { sampleCount: 3, mean: 8 / 3 } });
    expect(category(stats, 'standard')).toMatchObject({ count: 1, rate: 1 / 7 });
    expect(stats.items.every((item) => item.rarity === 6)).toBe(true);
    expect(JSON.stringify(stats)).not.toContain('uid');
    expect(JSON.stringify(stats.items)).not.toContain('Alpha');
  });
  it('merges weighted frequencies and keeps per-item repeats, instead of synthetic-category repeats', () => {
    const stats = build([row(1, 'a'), row(2, 'b'), row(3, 'd'), row(4, 'b'), row(5, 'a'), row(6, 'a', 'p2')]);
    expect(category(stats, 'limited').first).toMatchObject({ sampleCount: 3, mean: 2,
      points: [{ cost: 1, count: 1, cumulativeRate: 1 / 3 }, { cost: 2, count: 1, cumulativeRate: 2 / 3 }, { cost: 3, count: 1, cumulativeRate: 1 }] });
    expect(category(stats, 'limited').repeat).toMatchObject({ sampleCount: 1, mean: 2 });
    expect(category(stats, 'featured').repeat).toMatchObject({ sampleCount: 1, mean: 4 });
  });
  it('isolates owner, UID and region and supports personal account selection', () => {
    const history = [row(1, 'a'), row(2, 'a', 'p2'), row(3, 'c', 'p1', { user_id: 'other' }), row(4, 'a', 'p1', { server_scope: 'global' })];
    expect(build(history).participatingAccounts).toBe(3);
    expect(category(build(history), 'featured').nonObtainingAccounts).toBe(1);
    expect(build(history, { accountKey: JSON.stringify(['owner', 'uid', 'cn']) }).participatingAccounts).toBe(1);
  });
  it('keeps unknown identity and cost separate, includes free/intel results and excludes gifts', () => {
    const stats = build([row(1, 'a', 'p1', { special_type: 'gift' }), row(2, 'a', 'p1', { is_free: true }),
      row(3, 'missing'), row(4, 'a', 'p1', { is_info_book: true }), row(5, 'a'), row(6, 'low')]);
    expect(stats).toMatchObject({ total: 5, free: 1, infoBook: 1, resources: 3 });
    expect(category(stats, 'featured')).toMatchObject({ first: { sampleCount: 1, mean: 1 }, repeat: { sampleCount: 1, mean: 1 }, unknownCost: 1 });
    expect(category(stats, 'unknown')).toMatchObject({ count: 1, unknownClassification: 1, first: { sampleCount: 0, mean: null }, nonObtainingAccounts: 0 });
  });
  it('reports exclusions without adding invalid records or duplicate accounts', () => {
    const stats = build([row(1, 'a'), row(1, 'a'), row(2, 'a', 'p1', { game_uid: '' }), row(3, 'a', 'p1', { timestamp: 'invalid' })]);
    expect(stats.total).toBe(1);
    expect(stats.meta.exclusions).toMatchObject({ duplicate: 1, missingIdentity: 1, invalidTime: 1 });
  });
  it('resolves exactly five groups from catalog metadata, excluding standard and celebration', () => {
    const catalog = [...pools, { id: 'standard', type: 'standard' }, { id: 'beginner', type: 'standard' },
      { id: 'wl', type: 'limited_weapon' }, { id: 'ws', type: 'weapon', is_limited_weapon: false },
      { id: 'rc', type: 'extra', extra_subtype: 'reconstruction', extra_rule_profile: 'reconstruction_character_v1' },
      { id: 'rw', type: 'extra', extra_subtype: 'reconstruction_claim', extra_rule_profile: 'reconstruction_weapon_v1' },
      { id: 'festival', type: 'extra', extra_subtype: 'special', extra_rule_profile: 'brilliance_festival_v1' }];
    expect(STATISTICS_GROUPS.map((group) => getStatisticsGroupPools(catalog, group.key).map((pool) => pool.id)))
      .toEqual([['p1', 'p2'], ['wl'], ['ws'], ['rc'], ['rw']]);
    expect(() => build([], { groupKey: 'standard' })).toThrow('Unknown statistics group');
    expect(build([])).toMatchObject({ total: 0, participatingAccounts: 0 });
  });
  it('uses exact period targets and does not assume missing metadata means standard', () => {
    const index = new Map(directory.map((item) => [item.id, item]));
    expect(statisticsItemCategory({ itemId: 'a' }, { type: 'limited', up_character: 'Alpha Plus' }, index)).toBe('limited');
    expect(statisticsItemCategory({ itemId: 'a' }, { type: 'limited' }, index)).toBe('unknown');
    expect(statisticsItemCategory({ itemId: 'missing' }, pools[0], index)).toBe('unknown');
    expect(statisticsItemCategory({ itemId: 'a' }, { type: 'extra', extra_subtype: 'reconstruction', extra_rule_profile: 'reconstruction_character_v1',
      six_star_entities: [{ id: 'a', name: 'Alpha', is_up: true }] }, index)).toBe('featured');
  });
});
