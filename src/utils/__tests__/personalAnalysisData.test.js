import { describe, expect, it } from 'vitest';
import { buildPersonalAnalysisSnapshots } from '../personalAnalysisSnapshot.js';
import { statisticsHistory } from '../../../shared/statisticsEligibility.js';

const pool = { id: 'special_a', pool_id: 'special_a', type: 'limited', name: '测试池', up_character: '甲',
  start_time: '2026-01-01T00:00:00Z', end_time: '2026-01-31T23:59:59Z' };
const entities = [{ id: 'six', name: '甲', rarity: 6, type: 'character', is_limited: true },
  { id: 'five', name: '乙', rarity: 5, type: 'character' }];
const pull = (id, extra = {}) => ({ id, record_id: id, user_id: 'owner', game_uid: 'uid', server_id: '1', server_scope: '1',
  pool_id: pool.id, rarity: 4, timestamp: '2026-01-20T00:00:00Z', ...extra });
const acquisition = (id, extra = {}) => ({ id, entityId: 'six', rarity: 6, quantity: 1,
  drawMethod: 'normal', timePrecision: 'second', timestamp: '2026-01-02T00:00:00Z', intervalPulls: 72, ...extra });
const ledger = (extra = {}) => ({ entry_id: 'ledger', user_id: 'owner', game_uid: 'uid', server_scope: '1', pool_id: pool.id,
  kind: 'pool-ledger', source: 'file', time_precision: 'range', values: { drawMethod: 'normal', complete: false,
    coverageMode: 'range', rangeStart: '2026-01-01T00:00:00Z', rangeEnd: '2026-01-15T00:00:00Z',
    acquisitions: [acquisition('win'), acquisition('five-win', { entityId: 'five', rarity: 5, intervalPulls: null })], ...extra } });
const build = (history, entries, extra = {}) => buildPersonalAnalysisSnapshots({ history, pools: [pool], characters: entities,
  userId: 'owner', workbenchEntries: entries, ...extra });

describe('private analysis with manual data', () => {
  it('shows edited results, known supplemental acquisitions and pool counts without changing public eligibility', () => {
    const history = [pull('edited', { rarity: 5, character_id: 'five', statistics_excluded: true, edit_version: 2 })];
    const entry = ledger();
    const model = build(history, [entry]);
    const scope = model.scopes[0].payload;
    expect(scope.selector.poolPullCounts[pool.id]).toBe(3);
    const view = scope.dashboard.views[pool.id].excludeFree;
    expect(view.stats).toMatchObject({ total: 3, totalSixStar: 1, counts: { 5: 2, 6: 1 },
      personalData: { totalKnown: false }, winRate: '--' });
    expect(view.characterStats.some(row => JSON.stringify(row).includes('甲'))).toBe(true);
    expect(JSON.stringify(scope.dashboard.timelineViews)).toContain('甲');
    expect(view.stats.avgPullCost['6_all']).toBeNull();
    expect(statisticsHistory(history, { entries: [entry] })).toEqual([]);
    expect(history[0].statistics_excluded).toBe(true);
  });

  it('merges a complete aggregate once and keeps missing outcomes out of the timeline', () => {
    const history = [pull('first', { timestamp: '2026-01-03T00:00:00Z' })];
    const scope = build(history, [ledger({ complete: true, totalPulls: 80, fourStarCount: 70,
      fiveStarCount: 9, sixStarCount: 1 })]).scopes[0].payload;
    expect(scope.selector.totalPulls).toBe(80);
    expect(scope.dashboard.views[pool.id].excludeFree.stats).toMatchObject({ total: 80,
      counts: { 4: 70, 5: 9 }, totalSixStar: 1, personalData: { totalKnown: true } });
    // The high-star list contains only the two named acquisitions, with no fabricated outcomes.
    expect(scope.dashboard.views[pool.id].excludeFree.characterStats.reduce((n, row) => n + row.count, 0)).toBe(2);
  });

  it('deduplicates known acquisitions already present in the same account and respects deleted entries', () => {
    const history = [pull('same', { rarity: 6, character_id: 'six', timestamp: acquisition('win').timestamp })];
    const model = build(history, [ledger({ acquisitions: [acquisition('win')] }), { ...ledger(), deleted_at: '2026-02-01' }]);
    expect(model.scopes[0].payload.dashboard.views[pool.id].excludeFree.stats.totalSixStar).toBe(1);
    expect(model.scopes[0].payload.selector.totalPulls).toBe(1);
  });

  it('retains a second identical acquisition in the same ten-pull when only one is already imported', () => {
    const history = [pull('one-imported', { rarity: 6, character_id: 'six', timestamp: acquisition('one').timestamp })];
    const scope = build(history, [ledger({ acquisitions: [acquisition('one'), acquisition('two')] })]).scopes[0].payload;
    expect(scope.selector.totalPulls).toBe(2);
    expect(scope.dashboard.views[pool.id].excludeFree.stats.totalSixStar).toBe(2);
  });

  it('keeps free-ten summaries out of paid counts and never makes summary gifts normal pulls', () => {
    const free = { ...ledger(), entry_id: 'free', kind: 'batch-summary', values: { drawMethod: 'free', totalPulls: 10,
      batchIndex: 1, rangeStart: '2026-01-04T00:00:00Z', rangeEnd: '2026-01-05T00:00:00Z' } };
    const gift = { ...ledger(), entry_id: 'gift', values: { ...ledger().values, drawMethod: 'gift', acquisitions: [acquisition('gift', { drawMethod: 'gift' })] } };
    const scope = build([pull('paid')], [free, gift]).scopes[0].payload;
    expect(scope.dashboard.views[pool.id].excludeFree.stats.total).toBe(1);
    expect(scope.dashboard.views[pool.id].includeFree.stats.total).toBe(11);
    expect(scope.dashboard.views[pool.id].includeFree.stats.totalSixStar).toBe(0);
  });

  it('isolates identical game UIDs on different servers and ignores another owner', () => {
    const other = { ...ledger(), entry_id: 'other', user_id: 'someone' };
    const scope = build([pull('other-server', { server_id: '2', server_scope: '2' })], [ledger(), other]).scopes;
    expect(scope.find(s => s.sourceServerScope === '2').payload.selector.totalPulls).toBe(1);
    expect(scope.find(s => s.sourceServerScope === '1').payload.selector.totalPulls).toBe(2);
    expect(scope).toHaveLength(2);
  });
});
