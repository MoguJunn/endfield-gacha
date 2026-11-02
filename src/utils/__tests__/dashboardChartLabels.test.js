import { describe, expect, it } from 'vitest';

import { buildDashboardSixStarBreakdown, getDashboardChartItemKind, localizeDashboardChartItems } from '../dashboardChartLabels.js';
import { buildPoolStats } from '../poolStats.js';
import { buildCharacterStats } from '../dashboardCharacterStats.js';

describe('dashboardChartLabels', () => {
  it('prefers explicit kind metadata when present', () => {
    expect(getDashboardChartItemKind({ kind: 'target-six', name: '6星(常驻)' })).toBe('target-six');
  });

  it('localizes shared chart items without depending on Chinese labels only', () => {
    const localized = localizeDashboardChartItems([
      { kind: 'target-six', name: '6星(限定)', value: 3 },
      { kind: 'offrate-six', name: '6星(常驻)', value: 1 },
      { kind: 'five-star', name: '5星', value: 10 },
      { kind: 'four-star', name: '4星', value: 20 },
    ], {
      primarySixStarLabel: 'UP 6★',
      secondarySixStarLabel: 'Standard 6★',
    });

    expect(localized.map((item) => item.name)).toEqual(['UP 6★', 'Standard 6★', '5★', '4★']);
  });
});

describe('single-banner six-star breakdown', () => {
  const pool = { id: 'limited-a', name: '当前限定池', type: 'limited' };
  const catalog = {
    当期角色: { is_limited: true },
    往期限定: { is_limited: true },
    常驻角色: { is_limited: false },
  };
  const resolveCharacter = name => catalog[name] || null;
  const history = [
    { name: '当期角色', rarity: 6, isStandard: false },
    { name: '往期限定', rarity: 6, isStandard: true },
    { name: '常驻角色', rarity: 6, isStandard: true },
    { name: '往期限定', rarity: 6, isStandard: true, isFree: true },
    { name: '当期角色', rarity: 6, isStandard: false, specialType: 'guaranteed' },
    { name: '往期限定', rarity: 6, isStandard: true, specialType: 'gift' },
    { name: '五星角色', rarity: 5 },
    { name: '四星角色', rarity: 4 },
  ].map((row, index) => ({ ...row, id: `r${index}`, poolId: pool.id, timestamp: 1700000000000 + index * 1000 }));

  it.each([false, true])('splits snapshot character counts with includeFree=%s without reusing win-rate-only counts', includeFreePullsInStats => {
    const { stats } = buildPoolStats({
      normalizedCurrentPoolHistory: history, currentPool: pool, poolCatalog: [pool],
      includeFreePullsInStats, resolveCharacter, audience: 'personal',
    });
    const snapshot = JSON.parse(JSON.stringify({ stats, characterStats: buildCharacterStats({ history, includeFreePullsInStats }) }));
    const original = JSON.stringify(snapshot);
    const result = buildDashboardSixStarBreakdown({ ...snapshot, resolveCharacter });
    expect(result.categories.map(category => [category.name, category.value])).toEqual([
      ['歪限定6★', includeFreePullsInStats ? 2 : 1], ['歪常驻6★', 1],
    ]);
    expect(result.categories.reduce((sum, category) => sum + category.value, 0)).toBe(stats.counts['6_std']);
    expect(result.chartData.reduce((sum, item) => sum + item.value, 0)).toBe(stats.total);
    expect(result.chartData.reduce((sum, item) => sum + item.displayValue, 0))
      .toBeCloseTo(stats.chartData.reduce((sum, item) => sum + item.displayValue, 0));
    expect(stats.counts[6]).toBe(2);
    expect(stats.offLimitedCount).toBe(1);
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it('keeps unrecognized imported six-stars separate from confirmed standard items', () => {
    const stats = { counts: { '6_std': 2 }, chartData: [{ kind: 'offrate-six', value: 2, displayValue: 15 }] };
    const result = buildDashboardSixStarBreakdown({ stats, resolveCharacter, characterStats: [
      { name: '往期限定', rarity: 6, isStandard: true, count: 1 },
      { name: '未收录角色', rarity: 6, isStandard: true, count: 1 },
    ] });
    expect(result.categories.map(item => item.value)).toEqual([1, 0, 1]);
    expect(result.chartData.map(item => item.kind)).toEqual(['off-limited-six', 'off-unknown-six']);
  });

  it('preserves the split labels when chart items are localized to English', () => {
    const result = buildDashboardSixStarBreakdown({
      stats: { counts: { '6_std': 1 }, chartData: [{ kind: 'offrate-six', value: 1 }] },
      characterStats: [{ name: '往期限定', rarity: 6, isStandard: true, count: 1 }],
      resolveCharacter, isEnglish: true,
    });
    expect(localizeDashboardChartItems(result.chartData, { secondarySixStarLabel: 'Standard 6★' })[0].name)
      .toBe('Off-banner limited 6★');
  });
});
