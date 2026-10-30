import { describe, expect, it } from 'vitest';
import { buildPoolStats } from '../poolStats.js';
import { buildDashboardOverviewSplitStats } from '../dashboardOverviewSplitStats.js';
import { buildOverviewTimelineSections } from '../poolTimelineView.js';
import { buildWinRateGuaranteeKeys, isExcludedFromWinRate } from '../winRateEligibility.js';

const pool = { id: 'limited-a', type: 'limited', up_character: '目标' };
const historyFor = (uid = '100', targets = [120, 140]) => Array.from({ length: 140 }, (_, index) => {
  const position = index + 1;
  const target = targets.includes(position);
  return { id: `${uid}-${position}`, poolId: pool.id, gameUid: uid, serverId: 'cn',
    rarity: target || position === 60 ? 6 : 4, isStandard: !target,
    character_name: target ? '目标' : '常驻',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, position)).toISOString(), seqId: String(position) };
});

describe('win-rate guarantee eligibility', () => {
  it('excludes an unflagged first target at 120 in single, group, split overview and timeline statistics', () => {
    const history = historyFor();
    const build = currentPool => buildPoolStats({ normalizedCurrentPoolHistory: history,
      allLimitedHistory: history, accountHistory: history, currentPool, selectedPools: [pool], audience: 'personal' }).stats;
    const single = build(pool), group = build({ id: 'group', type: 'limited', isGroupMode: true });
    expect(Number(single.winRate)).toBe(50);
    expect(Number(group.winRate)).toBe(50);
    expect(single.counts[6]).toBe(2);
    expect(single.totalSixStar).toBe(3);
    expect(single.total).toBe(140);
    const overview = buildDashboardOverviewSplitStats({ history, selectedPools: [pool] }).character;
    expect(overview.winRateTargetCount).toBe(1);
    expect(overview.winRateTotalCount).toBe(2);
    expect(Number(overview.winRate)).toBe(50);
    const [timeline] = buildOverviewTimelineSections({ history, pools: [pool] });
    expect(Number(timeline.winRate)).toBe(50);
  });

  it('retains a natural hit at 120 when an earlier target already fulfilled the one-time guarantee', () => {
    const history = historyFor('100', [30, 120]);
    const keys = buildWinRateGuaranteeKeys({ history, pools: [pool] });
    expect(isExcludedFromWinRate(history[119], pool, keys)).toBe(false);
    expect(keys.size).toBe(0);
  });

  it('keeps guarantees separate between game accounts and preserves uncertain history', () => {
    const a = historyFor('100', [30, 120]), b = historyFor('200');
    const keys = buildWinRateGuaranteeKeys({ history: [...a, ...b], pools: [pool] });
    expect(isExcludedFromWinRate(a[119], pool, keys)).toBe(false);
    expect(isExcludedFromWinRate(b[119], pool, keys)).toBe(true);
    const unknown = b.map(record => ({ ...record, statisticsContinuity: { cumulativeHistoryKnown: false } }));
    expect(buildWinRateGuaranteeKeys({ history: unknown, pools: [pool] }).size).toBe(0);
  });

  it('honors explicit guarantee flags without treating four-target banners as a forced single UP', () => {
    expect(isExcludedFromWinRate({ is_spark: true }, pool)).toBe(true);
    expect(isExcludedFromWinRate({ special_type: 'guaranteed' }, { type: 'standard' })).toBe(false);
  });
});
