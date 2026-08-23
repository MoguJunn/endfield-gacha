import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePoolStats } from '../usePoolStats.js';
import { buildPoolStats } from '../../../utils/poolStats.js';
import { buildPoolResourceSummary } from '../../../utils/resourceEconomy.js';

vi.mock('../../../stores/useHistoryStore.js', () => ({
  default: (selector) => selector({
    manualPityLimit: null,
    historyFilter: 'all',
  }),
}));

vi.mock('../useCurrentPoolGroupedHistory.js', () => ({
  useCurrentPoolGroupedHistory: (history) => ({
    groupedHistory: history.length ? [history] : [],
    filteredGroupedHistory: history.length ? [history] : [],
  }),
}));

vi.mock('../../../utils/resourceEconomy.js', () => ({
  buildPoolResourceSummary: vi.fn(({ totalPulls, chargedPulls }) => ({
    totalPulls,
    chargedPulls,
  })),
}));

vi.mock('../../../utils/characterUtils.js', () => ({
  resolveCharacterRecordByName: vi.fn((value) => {
    if (value === '歪限定角色' || value === 'chr_off_limited') {
      return { id: 'chr_off_limited', name: '歪限定角色', type: 'character', is_limited: true };
    }
    return null;
  }),
}));

describe('usePoolStats', () => {
  it('computes current pool stats while excluding free and gift pulls from core counts', () => {
    const normalizedCurrentPoolHistory = [
      {
        id: 'r1',
        rarity: 6,
        isStandard: false,
        poolId: 'pool_current',
        timestamp: '2026-04-15T10:00:00.000Z',
        seqId: '1',
        character_name: '洛茜',
      },
      {
        id: 'r2',
        rarity: 4,
        poolId: 'pool_current',
        timestamp: '2026-04-15T10:01:00.000Z',
        seqId: '2',
      },
      {
        id: 'r3',
        rarity: 5,
        poolId: 'pool_current',
        timestamp: '2026-04-15T10:02:00.000Z',
        seqId: '3',
      },
      {
        id: 'r4',
        rarity: 4,
        poolId: 'pool_current',
        timestamp: '2026-04-15T10:03:00.000Z',
        seqId: '4',
        isFree: true,
      },
      {
        id: 'r5',
        rarity: 6,
        poolId: 'pool_current',
        timestamp: '2026-04-15T10:04:00.000Z',
        seqId: '5',
        specialType: 'gift',
      },
    ];

    const { result } = renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'pool_current',
        type: 'limited',
        isGroupMode: false,
      },
      allLimitedHistory: normalizedCurrentPoolHistory,
      currentPoolId: 'pool_current',
    }));

    expect(result.current.stats.total).toBe(3);
    expect(result.current.stats.counts).toMatchObject({
      6: 1,
      5: 1,
      4: 1,
      '6_std': 0,
    });
    expect(result.current.stats.currentPity).toBe(2);
    expect(result.current.stats.currentPity5).toBe(0);
    expect(result.current.stats.resourceSummary).toEqual({
      totalPulls: 3,
      chargedPulls: 3,
    });
    expect(result.current.effectivePity).toEqual({
      pity6: 2,
      pity5: 0,
      isInherited: false,
    });
  });

  it('passes current-pool quota ledger into resource summary', () => {
    vi.mocked(buildPoolResourceSummary).mockClear();

    const normalizedCurrentPoolHistory = [
      {
        id: 'e1',
        rarity: 4,
        poolId: 'pool_extra',
        timestamp: '2026-05-01T10:00:00.000Z',
        seqId: '1',
        character_name: '四星A',
      },
      {
        id: 'e2',
        rarity: 5,
        poolId: 'pool_extra',
        timestamp: '2026-05-01T10:01:00.000Z',
        seqId: '2',
        character_name: '五星A',
      },
      {
        id: 'e3',
        rarity: 4,
        poolId: 'pool_extra',
        timestamp: '2026-05-01T10:02:00.000Z',
        seqId: '3',
        character_name: '免费四星',
        isFree: true,
      },
    ];

    renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'pool_extra',
        type: 'extra',
        isGroupMode: false,
      },
      selectedPools: [
        { id: 'pool_extra', type: 'extra' },
      ],
    }));

    expect(buildPoolResourceSummary).toHaveBeenCalledWith(expect.objectContaining({
      poolType: 'extra',
      totalPulls: 2,
      chargedPulls: 2,
      quotaLedger: expect.objectContaining({
        quota: expect.objectContaining({
          aicQuotaDirect: 90,
          bondQuotaDirect: 3,
        }),
      }),
    }));
  });

  it('counts extra banner six stars as target hits even when legacy records are marked standard', () => {
    const normalizedCurrentPoolHistory = [
      {
        id: 'e1',
        rarity: 4,
        poolId: 'pool_extra',
        timestamp: '2026-05-14T10:00:00.000Z',
        seqId: '1',
      },
      {
        id: 'e2',
        rarity: 6,
        isStandard: true,
        poolId: 'pool_extra',
        timestamp: '2026-05-14T10:01:00.000Z',
        seqId: '2',
        character_name: '莱万汀',
      },
    ];

    const { result } = renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'pool_extra',
        type: 'extra',
        isGroupMode: false,
      },
      selectedPools: [
        { id: 'pool_extra', type: 'extra' },
      ],
    }));

    expect(result.current.stats.counts).toMatchObject({
      6: 1,
      '6_std': 0,
      4: 1,
    });
    expect(result.current.stats.upSixStarCount).toBe(1);
    expect(result.current.stats.stdSixStarCount).toBe(0);
    expect(result.current.stats.avgPullCost[6]).toBe('2.00');
    expect(result.current.stats.avgPullCost['6_limited']).toBe('2.00');
  });

  it('uses cross-pool limited history when inherited pity should carry over', () => {
    const allLimitedHistory = [
      {
        id: 'a1',
        rarity: 6,
        isStandard: false,
        poolId: 'pool_old',
        timestamp: '2026-04-10T10:00:00.000Z',
        seqId: '1',
      },
      {
        id: 'a2',
        rarity: 4,
        poolId: 'pool_new',
        timestamp: '2026-04-10T10:01:00.000Z',
        seqId: '2',
      },
      {
        id: 'a3',
        rarity: 4,
        poolId: 'pool_new',
        timestamp: '2026-04-10T10:02:00.000Z',
        seqId: '3',
      },
    ];

    const { result } = renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory: [],
      currentPool: {
        id: 'pool_new',
        type: 'limited',
        isGroupMode: false,
      },
      allLimitedHistory,
      currentPoolId: 'pool_new',
    }));

    expect(result.current.inheritedPityInfo).toEqual({
      inheritedPity: 2,
      inheritedPity5: 2,
      hasInheritedPity: true,
    });
    expect(result.current.effectivePity).toEqual({
      pity6: 2,
      pity5: 2,
      isInherited: true,
    });
  });

  it('does not count standard-pool six stars as target six stars in grouped overview stats', () => {
    const normalizedCurrentPoolHistory = [
      {
        id: 'l1',
        rarity: 4,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:00:00.000Z',
        seqId: '1',
      },
      {
        id: 'l2',
        rarity: 6,
        isStandard: false,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:01:00.000Z',
        seqId: '2',
      },
      {
        id: 's1',
        rarity: 4,
        poolId: 'pool_standard',
        timestamp: '2026-04-15T10:02:00.000Z',
        seqId: '3',
      },
      {
        id: 's2',
        rarity: 6,
        isStandard: false,
        poolId: 'pool_standard',
        timestamp: '2026-04-15T10:03:00.000Z',
        seqId: '4',
      },
    ];

    const { result } = renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory,
      currentPool: {
        id: '__group_all',
        type: 'all',
        isGroupMode: true,
      },
      selectedPools: [
        { id: 'pool_limited', type: 'limited' },
        { id: 'pool_standard', type: 'standard' },
      ],
    }));

    expect(result.current.stats.counts).toMatchObject({
      6: 1,
      '6_std': 1,
    });
    expect(result.current.stats.avgPullCost[6]).toBe('2.00');
    expect(result.current.stats.avgPullCost['6_limited']).toBe('2.00');
  });

  it('includes off-rate limited characters in limited six-star averages', () => {
    const normalizedCurrentPoolHistory = [
      {
        id: 'l1',
        rarity: 4,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:00:00.000Z',
        seqId: '1',
      },
      {
        id: 'l2',
        rarity: 6,
        isStandard: false,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:01:00.000Z',
        seqId: '2',
        character_name: '当期UP',
      },
      {
        id: 'l3',
        rarity: 6,
        isStandard: true,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:02:00.000Z',
        seqId: '3',
        character_id: 'chr_off_limited',
        character_name: '歪限定角色',
      },
      {
        id: 'l4',
        rarity: 6,
        isStandard: true,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:03:00.000Z',
        seqId: '4',
        character_name: '常驻角色',
      },
    ];

    const { result } = renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'pool_limited',
        type: 'limited',
        isGroupMode: false,
      },
      selectedPools: [
        { id: 'pool_limited', type: 'limited' },
      ],
    }));

    expect(result.current.stats.counts).toMatchObject({
      6: 1,
      '6_std': 2,
    });
    expect(result.current.stats.avgPullCost[6]).toBe('4.00');
    expect(result.current.stats.avgPullCost['6_limited']).toBe('2.00');
  });

  it('excludes limited 120-pull guarantee hits from win-rate stats only', () => {
    const normalizedCurrentPoolHistory = [
      {
        id: 'l1',
        rarity: 6,
        isStandard: false,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:00:00.000Z',
        seqId: '1',
        character_name: '当期UP',
      },
      {
        id: 'l2',
        rarity: 6,
        isStandard: false,
        isGuaranteed: true,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:01:00.000Z',
        seqId: '2',
        character_name: '保底UP',
      },
      {
        id: 'l3',
        rarity: 6,
        isStandard: true,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:02:00.000Z',
        seqId: '3',
        character_name: '常驻角色',
      },
    ];

    const { result } = renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'pool_limited',
        type: 'limited',
        isGroupMode: false,
      },
      selectedPools: [
        { id: 'pool_limited', type: 'limited' },
      ],
    }));

    expect(result.current.stats.counts).toMatchObject({
      6: 2,
      '6_std': 1,
    });
    expect(result.current.stats.totalSixStar).toBe(3);
    expect(result.current.stats.winRate).toBe('50.0');
    expect(result.current.stats.sixStarCount).toBe(2);
    expect(result.current.stats.upSixStarCount).toBe(1);
    expect(result.current.stats.stdSixStarCount).toBe(1);
  });

  it('detects legacy 120th paid limited UP hits as guarantee records for win-rate', () => {
    const normalizedCurrentPoolHistory = Array.from({ length: 120 }, (_, index) => ({
      id: `heat-${index + 1}`,
      rarity: 4,
      isStandard: false,
      poolId: 'special_1_0_2',
      timestamp: new Date(Date.UTC(2026, 1, 25, 10, index, 0)).toISOString(),
      seqId: String(index + 1),
      character_name: '四星角色',
    }));

    normalizedCurrentPoolHistory[62] = {
      ...normalizedCurrentPoolHistory[62],
      rarity: 6,
      isStandard: true,
      character_name: '余烬',
    };
    normalizedCurrentPoolHistory[114] = {
      ...normalizedCurrentPoolHistory[114],
      rarity: 6,
      isStandard: true,
      character_name: '别礼',
    };
    normalizedCurrentPoolHistory[119] = {
      ...normalizedCurrentPoolHistory[119],
      rarity: 6,
      isStandard: false,
      character_name: '伊冯',
    };

    const { result } = renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'special_1_0_2',
        type: 'limited',
        up_character: '伊冯',
        isGroupMode: false,
      },
      currentPoolId: 'special_1_0_2',
      selectedPools: [
        { id: 'special_1_0_2', type: 'limited', up_character: '伊冯' },
      ],
    }));

    expect(result.current.stats.counts).toMatchObject({
      6: 1,
      '6_std': 2,
    });
    expect(result.current.stats.winRate).toBe('0.0');
    expect(result.current.stats.sixStarCount).toBe(2);
    expect(result.current.stats.upSixStarCount).toBe(0);
    expect(result.current.stats.stdSixStarCount).toBe(2);
    expect(result.current.stats.sparkCount).toBe(1);
    expect(result.current.stats.pityStats.history.map(({ count, isSpark }) => ({ count, isSpark }))).toEqual([
      { count: 63, isSpark: false },
      { count: 52, isSpark: false },
      { count: 5, isSpark: true },
    ]);
  });

  it('includes free ten pulls in stats only when the toggle is enabled', () => {
    const normalizedCurrentPoolHistory = [
      {
        id: 'r1',
        rarity: 4,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:00:00.000Z',
        seqId: '1',
      },
      {
        id: 'r2',
        rarity: 6,
        isStandard: false,
        isFreePull: true,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:01:00.000Z',
        seqId: '2',
      },
      {
        id: 'r3',
        rarity: 6,
        isStandard: false,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:02:00.000Z',
        seqId: '3',
      },
      {
        id: 'r4',
        rarity: 6,
        isStandard: true,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:03:00.000Z',
        seqId: '4',
      },
    ];

    const baseProps = {
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'pool_limited',
        type: 'limited',
        isGroupMode: false,
      },
      currentPoolId: 'pool_limited',
    };

    const excluded = renderHook(() => usePoolStats(baseProps));
    const included = renderHook(() => usePoolStats({
      ...baseProps,
      includeFreePullsInStats: true,
    }));

    expect(excluded.result.current.stats).toMatchObject({
      total: 3,
      paidTotal: 3,
      freePullCount: 1,
      counts: {
        6: 1,
        '6_std': 1,
        5: 0,
        4: 1,
      },
      resourceSummary: {
        totalPulls: 3,
        chargedPulls: 3,
      },
    });
    expect(included.result.current.stats).toMatchObject({
      total: 4,
      paidTotal: 3,
      freePullCount: 1,
      counts: {
        6: 2,
        '6_std': 1,
        5: 0,
        4: 1,
      },
      resourceSummary: {
        totalPulls: 4,
        chargedPulls: 3,
      },
    });
    expect(included.result.current.stats.winRate).toBe('50.0');
    expect(included.result.current.stats.upSixStarCount).toBe(1);
    expect(included.result.current.stats.stdSixStarCount).toBe(1);
    expect(included.result.current.stats.pityStats.history.map(({ count }) => count)).toEqual([30, 2, 1]);
    expect(included.result.current.stats.pityStats.distribution[2]).toMatchObject({
      range: '21-30',
      count: 1,
      limited: 1,
    });
    expect(included.result.current.stats.pityStats.distribution[0]).toMatchObject({
      range: '1-10',
      count: 2,
      limited: 1,
    });
  });

  it('includes free ten pulls in all-pool grouped stats when the toggle is enabled', () => {
    const normalizedCurrentPoolHistory = [
      {
        id: 'l1',
        rarity: 4,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:00:00.000Z',
        seqId: '1',
      },
      {
        id: 'l2',
        rarity: 6,
        isStandard: false,
        isFree: true,
        poolId: 'pool_limited',
        timestamp: '2026-04-15T10:01:00.000Z',
        seqId: '2',
      },
      {
        id: 'w1',
        rarity: 5,
        poolId: 'pool_weapon',
        timestamp: '2026-04-15T10:02:00.000Z',
        seqId: '3',
      },
    ];

    const props = {
      normalizedCurrentPoolHistory,
      currentPool: {
        id: '__group_all',
        type: 'all',
        isGroupMode: true,
      },
      selectedPools: [
        { id: 'pool_limited', type: 'limited' },
        { id: 'pool_weapon', type: 'weapon' },
      ],
    };

    const excluded = renderHook(() => usePoolStats(props));
    const included = renderHook(() => usePoolStats({
      ...props,
      includeFreePullsInStats: true,
    }));

    expect(excluded.result.current.stats.total).toBe(2);
    expect(excluded.result.current.stats.counts).toMatchObject({
      6: 0,
      5: 1,
      4: 1,
    });
    expect(included.result.current.stats.total).toBe(3);
    expect(included.result.current.stats.paidTotal).toBe(2);
    expect(included.result.current.stats.counts).toMatchObject({
      6: 1,
      5: 1,
      4: 1,
    });
  });

  it('keeps limited gift rewards out of core six-star counts', () => {
    const normalizedCurrentPoolHistory = Array.from({ length: 240 }, (_, index) => ({
      id: `p${index + 1}`,
      rarity: 4,
      poolId: 'pool_limited',
      timestamp: new Date(Date.UTC(2026, 3, 15, 10, index, 0)).toISOString(),
      seqId: String(index + 1),
    }));

    const { result } = renderHook(() => usePoolStats({
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'pool_limited',
        type: 'limited',
        isGroupMode: false,
      },
      currentPoolId: 'pool_limited',
    }));

    expect(result.current.stats.counts[6]).toBe(0);
    expect(result.current.stats.counts['6_std']).toBe(0);
    expect(result.current.stats.gifts).toMatchObject({
      count: 1,
      limitedCount: 1,
      standardCount: 0,
    });
  });

  it('keeps pure and hook outputs identical for inherited, free, gift, and guarantee rules', () => {
    const paidFourStars = Array.from({ length: 238 }, (_, index) => ({
      id: `paid-${index + 1}`,
      rarity: 4,
      poolId: 'pool_new',
      timestamp: new Date(Date.UTC(2026, 4, 20, 10, index, 0)).toISOString(),
      seqId: String(index + 5),
    }));
    const normalizedCurrentPoolHistory = [
      {
        id: 'gift-six',
        rarity: 6,
        isStandard: false,
        specialType: 'gift',
        poolId: 'pool_new',
        seqId: '1',
      },
      {
        id: 'free-six',
        rarity: 6,
        isStandard: false,
        isFreePull: true,
        poolId: 'pool_new',
        seqId: '2',
      },
      {
        id: 'off-limited-six',
        rarity: 6,
        isStandard: true,
        character_id: 'chr_off_limited',
        character_name: '歪限定角色',
        poolId: 'pool_new',
        seqId: '3',
      },
      {
        id: 'guaranteed-up-six',
        rarity: 6,
        isStandard: false,
        isGuaranteed: true,
        poolId: 'pool_new',
        seqId: '4',
      },
      ...paidFourStars,
    ];
    const props = {
      normalizedCurrentPoolHistory,
      currentPool: {
        id: 'pool_new',
        type: 'limited',
        isGroupMode: false,
      },
      allLimitedHistory: [
        {
          id: 'old-six',
          rarity: 6,
          isStandard: false,
          poolId: 'pool_old',
          seqId: 'old-1',
        },
        {
          id: 'new-four-1',
          rarity: 4,
          poolId: 'pool_new',
          seqId: 'new-1',
        },
        {
          id: 'new-four-2',
          rarity: 4,
          poolId: 'pool_new',
          seqId: 'new-2',
        },
      ],
      currentPoolId: 'pool_new',
      selectedPools: [
        { id: 'pool_new', type: 'limited' },
      ],
      includeFreePullsInStats: true,
    };

    const pureResult = buildPoolStats(props);
    const { result } = renderHook(() => usePoolStats(props));

    expect({
      stats: result.current.stats,
      inheritedPityInfo: result.current.inheritedPityInfo,
      effectivePity: result.current.effectivePity,
    }).toEqual(pureResult);
    expect(pureResult.inheritedPityInfo).toEqual({
      inheritedPity: 2,
      inheritedPity5: 2,
      hasInheritedPity: true,
    });
    expect(pureResult.stats).toMatchObject({
      total: 241,
      paidTotal: 240,
      freePullCount: 1,
      counts: {
        6: 2,
        '6_std': 1,
        5: 0,
        4: 238,
      },
      offLimitedCount: 1,
      offStandardCount: 0,
      gifts: {
        count: 1,
        limitedCount: 1,
        standardCount: 0,
      },
    });
    expect(pureResult.stats.pityStats.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: 30 }),
      expect.objectContaining({ isGuaranteed: true }),
    ]));
  });

  it('uses an explicitly injected character resolver', () => {
    const resolveCharacter = vi.fn(() => ({
      id: 'worker-character',
      type: 'character',
      is_limited: true,
    }));

    const result = buildPoolStats({
      normalizedCurrentPoolHistory: [{
        id: 'offrate-six',
        rarity: 6,
        isStandard: true,
        character_name: 'Worker 角色',
        poolId: 'pool_limited',
      }],
      currentPool: {
        id: 'pool_limited',
        type: 'limited',
        isGroupMode: false,
      },
      resolveCharacter,
    });

    expect(resolveCharacter).toHaveBeenCalledWith('Worker 角色', { fuzzy: true });
    expect(result.stats.offLimitedCount).toBe(1);
  });
});
