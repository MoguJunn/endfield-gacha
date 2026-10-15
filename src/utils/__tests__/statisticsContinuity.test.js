// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { prepareStatisticsContinuity } from '../statisticsContinuity.js';
import { buildScopedLegacyStatistics } from '../scopedLegacyStatistics.js';
import { buildPoolStats } from '../poolStats.js';
import { buildSummaryStats } from '../summaryStats.js';
import { buildQuotaLedgerFromHistory } from '../quotaEconomy.js';
import { getPoolAnalysisPityState } from '../poolAnalysisPity.js';
import { readStatisticsScopeAggregate } from '../../../api/_lib/statisticsScopeAggregate.js';
import { buildSinglePoolTimelineSection } from '../poolTimelineView.js';
import { buildOneTimeTargetGuaranteeState } from '../poolScopedHistory.js';

const pools = [{ id: 'a', type: 'limited', up_character: 'Six' }, { id: 'b', type: 'limited', up_character: 'Six' },
  { id: 's', type: 'standard' }, { id: 'w', type: 'weapon' }];
const characters = [{ id: 'six', name: 'Six', type: 'character', rarity: 6 }, { id: 'four', name: 'Four', type: 'character', rarity: 4 }];
const row = (id, pool_id = 'b', rarity = 4, extra = {}) => ({ id, record_id: String(id), seq_id: String(id),
  user_id: 'owner', game_uid: 'uid', server_scope: '1', server_id: '1', pool_id, poolId: pool_id, rarity,
  character_id: rarity === 6 ? 'six' : 'four', character_name: rarity === 6 ? 'Six' : 'Four', name: rarity === 6 ? 'Six' : 'Four',
  timestamp: new Date(1790812800000 + id * 1000).toISOString(), ...extra });
const gap = (start = 1, end = 70, extra = {}) => ({ user_id: 'owner', game_uid: 'uid', server_scope: '1', pool_id: 'a',
  history_start_at: row(start).timestamp, history_end_at: row(end).timestamp, ...extra });
const history80 = () => Array.from({ length: 80 }, (_, i) => row(i + 1, i < 70 ? 'a' : 'b', i === 79 ? 6 : 4));
const legacy = (history, exclusions = []) => buildScopedLegacyStatistics({ history, pools, characters, exclusions, memberPoolIds: ['b'] });
const annotate = (history, exclusions = [gap()], catalog = pools) => prepareStatisticsContinuity({ history, pools: catalog, exclusions }).history;

describe('statistics after an excluded history interval', () => {
  it('retains B’s ten results and six-star, omits its unknown interval, then recovers the next complete interval', async () => {
    expect(legacy(history80()).avgSixStarInterval).toBe(80);
    const history = history80().map(row => row.pool_id === 'a' ? { ...row, statistics_excluded: true } : row);
    const result = await readStatisticsScopeAggregate(null, 'pool:b', { dataset: { pools, contextPools: pools, directory: characters, history } });
    expect(result.observations.total).toBe(10);
    expect(result.legacy).toMatchObject({ regularTotal: 10, sixStarCount: 1, avgSixStarInterval: null,
      intervalDistribution: [], meta: { intervalCount: 0, unknownInheritedIntervalCount: 1 } });
    const recovered = legacy([...history, ...Array.from({ length: 5 }, (_, i) => row(81 + i, 'b', i === 4 ? 6 : 4))]);
    expect(recovered).toMatchObject({ regularTotal: 15, sixStarCount: 2, avgSixStarInterval: 5,
      meta: { intervalCount: 1, unknownInheritedIntervalCount: 1 } });
  });

  it('uses persistent boundaries when the manual rows were deleted, including later padding in A', () => {
    const history = [...history80().slice(70), row(85, 'b', 6), row(95, 'b', 6)];
    expect(legacy(history, [gap()]).meta.intervalCount).toBe(2);
    const laterGap = gap(1, 90);
    expect(legacy(history, [laterGap])).toMatchObject({ regularTotal: 12, sixStarCount: 3,
      avgSixStarInterval: null, meta: { unknownInheritedIntervalCount: 3 } });
    expect(legacy([...history, row(100, 'b', 6)], [laterGap]).avgSixStarInterval).toBe(1);
  });

  it('recovers five-star and six-star state independently; free batches and gifts do not reset pity', () => {
    const records = annotate([row(71, 'b', 6, { is_free: true }), row(72, 'b', 6, { special_type: 'gift' }),
      row(73, 'b', 5), row(74), row(75, 'b', 6, { is_info_book: true }), row(76)]);
    expect(records[1].statisticsContinuity.currentPity6).toBeNull();
    expect(records[2].statisticsContinuity).toMatchObject({ sixStarKnownAfter: false, fiveStarKnownAfter: true, currentPity5: 0 });
    expect(records[3].statisticsContinuity).toMatchObject({ currentPity6: null, currentPity5: 1 });
    expect(records[4].statisticsContinuity).toMatchObject({ sixStarKnown: false, currentPity6: 0 });
    expect(records[5].statisticsContinuity).toMatchObject({ sixStarPity: 1, fiveStarPity: 1 });
  });

  it('does not accept a reset during an overlapping excluded pool period', () => {
    const catalog = pools.map(pool => pool.id === 'a' ? { ...pool, end_time: row(90).timestamp } : pool);
    const records = annotate([row(80, 'b', 6), row(85), row(95, 'b', 6), row(96)], [gap()], catalog);
    expect(records[0].statisticsContinuity.currentPity6).toBeNull();
    expect(records[1].statisticsContinuity.currentPity6).toBeNull();
    expect(records[2].statisticsContinuity).toMatchObject({ sixStarKnown: false, currentPity6: 0 });
    expect(records[3].statisticsContinuity.sixStarPity).toBe(1);
  });

  it('isolates owners, game accounts, servers and pool-local pity', () => {
    const records = annotate([row(80, 'b', 6), row(80, 'b', 6, { user_id: 'another' }),
      row(80, 'b', 6, { game_uid: 'another' }), row(80, 'b', 6, { server_scope: '2' }), row(80, 's', 6), row(80, 'w', 6)]);
    expect(records[0].statisticsContinuity.sixStarKnown).toBe(false);
    expect(records.slice(1, 4).every(row => !row.statisticsContinuity)).toBe(true);
    expect(records[4].statisticsContinuity).toMatchObject({ sixStarKnown: true, copyHistoryKnown: false });
    expect(records[5].statisticsContinuity).toBeUndefined();
  });

  it('keeps unknown state when no timestamp or pool period can establish the missing interval’s end', () => {
    const records = annotate([row(80, 'b', 6), row(90, 'b', 6)], [gap(1, 70, { history_start_at: null, history_end_at: null })]);
    expect(records.every(row => row.statisticsContinuity.sixStarKnownAfter === false)).toBe(true);
  });

  it('omits copy-dependent quota even after pity recovered, while keeping independent costs and counts', () => {
    const records = annotate([row(80, 'b', 6), row(85, 'b', 6)]);
    const result = legacy(records);
    expect(result).toMatchObject({ regularTotal: 2, sixStarCount: 2, meta: { unknownCopyHistoryCount: 2, resourceHistoryComplete: false } });
    expect(result.resources.aicQuotaDirect).toBe(0);
    const ledger = buildQuotaLedgerFromHistory(records, { pools, characters });
    expect(ledger.quota.aicQuotaDirect).toBe(0);
    expect(ledger.characterRows[0]).toMatchObject({ acquisitionCount: 2, historyIncomplete: true, potentialLevel: null,
      trustTokensGained: null, excessTrustTokens: null });
  });

  it('keeps summary and dashboard unknowns consistent with public intervals', () => {
    const records = annotate([row(71), row(72, 'b', 5), row(73)]);
    const poolResult = buildPoolStats({ normalizedCurrentPoolHistory: records, accountHistory: records, poolCatalog: pools, currentPool: pools[1] });
    expect(poolResult.stats.total).toBe(3);
    expect(poolResult.effectivePity).toMatchObject({ pity6: null, pity5: 1 });
    expect(getPoolAnalysisPityState(pools[1], poolResult.stats, poolResult.effectivePity).displayPity6).toBeNull();
    const recovered = annotate([row(80, 'b', 6), row(81), row(82, 'b', 6)]);
    const summary = buildSummaryStats({ history: recovered, pools, user: { id: 'owner' }, characters });
    expect(summary).toMatchObject({ total: 3, sixStar: 2, statisticsContinuity: { unknownInheritedIntervalCount: 1 } });
    expect(summary.byType.limited.pityList).toHaveLength(1);
    expect(summary.byType.limited.pityList[0].count).toBe(2);
  });

  it('shows unknown timeline intervals without losing the local result count', () => {
    const records = annotate(history80().slice(70));
    const section = buildSinglePoolTimelineSection({ pool: pools[1], history: records, locale: 'zh-CN' });
    expect(section).toMatchObject({ totalPulls: 10, sixStarCount: 1 });
    expect(section.avgSixStarPulls).toBeNaN();
    expect(section.entries.find(entry => !entry.isCurrentStage)).toMatchObject({ pulls: null, localPulls: 10, unknownInheritedPity: true });
    const current = buildSinglePoolTimelineSection({ pool: pools[1], history: annotate([row(71)]), locale: 'zh-CN' });
    expect(current.currentPity).toBeNull();
    expect(current.entries.find(entry => entry.isCurrentStage)).toMatchObject({ pulls: null, unknownInheritedPity: true });
  });

  it('isolates series and keeps cumulative rewards unknown after ordinary pity recovers', () => {
    const catalog = ['a','b','c'].map(id => ({ id, type: 'extra', up_character: 'Six',
      extra_rule_profile: 'reconstruction_character_v1', extra_series_key: id === 'c' ? 'other' : 'same' }));
    const records = annotate([row(71,'b',6), row(72,'b'), row(80,'c',6)], [gap()], catalog);
    expect(records[0].statisticsContinuity).toMatchObject({ sixStarKnown: false, cumulativeHistoryKnown: false });
    expect(records[1].statisticsContinuity).toMatchObject({ sixStarKnown: true, cumulativeHistoryKnown: false });
    expect(records[2].statisticsContinuity).toMatchObject({ sixStarKnown: true, cumulativeHistoryKnown: true });
    const state = buildOneTimeTargetGuaranteeState({ history: records, pools: catalog, pool: catalog[1] });
    expect(state).toMatchObject({ pity: null, hasReceivedGuaranteedLimited: true, historyIncomplete: true });
    const result = buildPoolStats({ normalizedCurrentPoolHistory: records.slice(0,2), accountHistory: records,
      currentPool: catalog[1], poolCatalog: catalog });
    expect(result.stats).toMatchObject({ total: 2, rewardPaidTotal: null, statisticsContinuity: { cumulativeHistoryKnown: false } });
  });
});
