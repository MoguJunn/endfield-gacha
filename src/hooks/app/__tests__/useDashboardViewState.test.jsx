import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analysisState: {
    availability: 'idle',
    scope: null
  },
  currentGameUid: 'game-1::server:1',
  currentPoolId: '__group_all',
  currentPoolData: null,
  poolStats: null
}));

vi.mock('../../../stores/index.js', () => ({
  useAuthStore: (selector) => selector({ user: { id: 'user-1' } }),
  usePersonalAnalysisStore: (selector) => selector(mocks.analysisState),
  usePoolStore: (selector) => selector({
    currentGameUid: mocks.currentGameUid,
    currentPoolId: mocks.currentPoolId,
  })
}));

vi.mock('../useCurrentPoolData.js', () => ({
  useCurrentPoolData: () => mocks.currentPoolData
}));

vi.mock('../usePoolStats.js', () => ({
  usePoolStats: () => mocks.poolStats
}));

vi.mock('../../../utils/storageUtils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readBooleanStorageValue: () => false,
    writeBooleanStorageValue: vi.fn()
  };
});

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({ locale: 'zh-CN' })
}));

import { useDashboardViewState } from '../useDashboardViewState.js';

function createAllPoolsData(overrides = {}) {
  const selectedPools = [
    { id: 'limited-a', type: 'limited' },
    { id: 'weapon-a', type: 'weapon', isLimitedWeapon: true }
  ];

  return {
    poolsArray: selectedPools,
    selectedPools,
    annotatedAccountHistoryArray: [],
    currentPool: {
      id: '__group_all',
      name: '全部卡池',
      type: 'all',
      isGroupMode: true,
      isAllPoolsOverview: true
    },
    currentPoolHistory: [],
    normalizedCurrentPoolHistory: [],
    allLimitedHistory: [],
    crossPoolPityMap: null,
    hasMergedAccountView: false,
    groupType: 'all',
    ...overrides
  };
}

describe('useDashboardViewState', () => {
  beforeEach(() => {
    mocks.analysisState = { availability: 'idle', scope: null };
    mocks.currentGameUid = 'game-1::server:1';
    mocks.currentPoolId = '__group_all';
    mocks.currentPoolData = createAllPoolsData();
    mocks.poolStats = {
      stats: {
        total: 0,
        paidTotal: 0,
        resourceSummary: { source: 'raw-empty' }
      },
      effectivePity: { pity6: 0, pity5: 0, isInherited: false },
      groupedHistory: []
    };
  });

  it('raw history 为空时用当前 view 的分析快照覆盖主分析字段', () => {
    const snapshotVariant = {
      stats: { total: 37, paidTotal: 37, marker: 'snapshot-stats' },
      inheritedPityInfo: { inheritedPity: 7, inheritedPity5: 2, hasInheritedPity: true },
      effectivePity: { pity6: 7, pity5: 2, isInherited: true },
      characterStats: [{ name: '快照角色', rarity: 6, count: 2 }],
      checkLimitedInFirstN: {
        firstLimitedIndex120: 37,
        firstLimitedIndex80: 37,
        validPullCount: 37
      },
      hasReceivedFreeTen: true,
      splitOverviewStats: {
        character: { total: 30 },
        weapon: { total: 7 }
      },
      dashboardResourceSummary: {
        characterPulls: 30,
        weaponPulls: 7,
        marker: 'snapshot-resource'
      }
    };
    mocks.analysisState = {
      availability: 'ready',
      scope: {
        account: { accountKey: 'game-1::server:1' },
        dashboard: {
          timelineViews: {
            'zh-CN': {
              __group_all: [{ id: 'snapshot-timeline' }]
            }
          },
          views: {
            __group_all: {
              excludeFree: snapshotVariant,
              includeFree: { ...snapshotVariant, stats: { total: 47 } }
            }
          }
        }
      }
    };

    const { result } = renderHook(() => useDashboardViewState());

    expect(result.current.isAnalysisBacked).toBe(true);
    expect(result.current.stats).toBe(snapshotVariant.stats);
    expect(result.current.effectivePity).toBe(snapshotVariant.effectivePity);
    expect(result.current.characterStats).toBe(snapshotVariant.characterStats);
    expect(result.current.checkLimitedInFirstN).toBe(snapshotVariant.checkLimitedInFirstN);
    expect(result.current.hasReceivedFreeTen).toBe(true);
    expect(result.current.dashboardResourceSummary).toBe(snapshotVariant.dashboardResourceSummary);
    expect(result.current.snapshotSplitOverviewStats).toBe(snapshotVariant.splitOverviewStats);
    expect(result.current.snapshotTimelineSections).toEqual([{ id: 'snapshot-timeline' }]);

    expect(result.current.accountHistory).toEqual([]);
    expect(result.current.currentPoolHistory).toEqual([]);
    expect(result.current.normalizedPoolHistory).toEqual([]);
    expect(result.current.groupedHistory).toEqual([]);
  });

  it('分析不可用时保持原有 raw history 计算路径', () => {
    const rawHistory = [{
      id: 'raw-five',
      pool_id: 'standard-main',
      rarity: 5,
      character_name: 'Raw 五星',
      timestamp: '2026-01-01T00:00:00.000Z',
      isStandard: true
    }];
    const rawStats = {
      total: 1,
      paidTotal: 1,
      marker: 'raw-stats',
      resourceSummary: { marker: 'raw-resource' }
    };
    const rawEffectivePity = { pity6: 1, pity5: 0, isInherited: false };
    mocks.currentPoolData = createAllPoolsData({
      poolsArray: [{ id: 'standard-main', type: 'standard' }],
      selectedPools: [{ id: 'standard-main', type: 'standard' }],
      annotatedAccountHistoryArray: rawHistory,
      currentPool: { id: 'standard-main', name: '常驻池', type: 'standard' },
      currentPoolHistory: rawHistory,
      normalizedCurrentPoolHistory: rawHistory,
      groupType: null
    });
    mocks.poolStats = {
      stats: rawStats,
      effectivePity: rawEffectivePity,
      groupedHistory: [rawHistory]
    };

    const { result } = renderHook(() => useDashboardViewState());

    expect(result.current.isAnalysisBacked).toBe(false);
    expect(result.current.stats).toBe(rawStats);
    expect(result.current.effectivePity).toBe(rawEffectivePity);
    expect(result.current.characterStats).toEqual([
      expect.objectContaining({ name: 'Raw 五星', count: 1, rarity: 5 })
    ]);
    expect(result.current.dashboardResourceSummary).toBe(rawStats.resourceSummary);
    expect(result.current.snapshotSplitOverviewStats).toBeNull();
    expect(result.current.accountHistory).toBe(rawHistory);
    expect(result.current.currentPoolHistory).toBe(rawHistory);
    expect(result.current.normalizedPoolHistory).toBe(rawHistory);
  });

  it('账号切换期间不会把旧账号 scope 当成当前统计', () => {
    mocks.analysisState = {
      availability: 'ready',
      scope: {
        account: { accountKey: 'old-account::server:1' },
        dashboard: {
          views: {
            __group_all: {
              excludeFree: {
                stats: { total: 999 },
                effectivePity: { pity6: 70, pity5: 9 },
              },
            },
          },
        },
      },
    };

    const { result } = renderHook(() => useDashboardViewState());

    expect(result.current.isAnalysisBacked).toBe(false);
    expect(result.current.stats.total).toBe(0);
  });

  it('区服修正后用 owner manifest 将旧账号键归一化到新 scope', () => {
    mocks.currentGameUid = 'game-1::server:1';
    mocks.analysisState = {
      availability: 'ready',
      owner: {
        accounts: [{ accountKey: 'game-1::server:2', gameUid: 'game-1', serverId: '2' }],
      },
      scope: {
        account: { accountKey: 'game-1::server:2' },
        dashboard: {
          timelineViews: {
            'zh-CN': {
              __group_all: [{ id: 'corrected-timeline', totalPulls: 130 }],
            },
          },
          views: {
            __group_all: {
              excludeFree: {
                stats: { total: 130, paidTotal: 130 },
                effectivePity: { pity6: 39, pity5: 0 },
              },
            },
          },
        },
      },
    };

    const { result } = renderHook(() => useDashboardViewState());

    expect(result.current.isAnalysisBacked).toBe(true);
    expect(result.current.stats.total).toBe(130);
    expect(result.current.snapshotTimelineSections).toEqual([
      expect.objectContaining({ id: 'corrected-timeline', totalPulls: 130 }),
    ]);
  });

  it('移动端当前池对象短暂回退时仍按 store 选择键读取快照', () => {
    mocks.currentPoolId = 'limited-selected';
    mocks.currentPoolData = createAllPoolsData({
      currentPool: { id: 'limited-fallback', name: '回退池', type: 'limited' },
      selectedPools: [{ id: 'limited-selected', name: '当前池', type: 'limited' }],
    });
    mocks.analysisState = {
      availability: 'ready',
      owner: {
        accounts: [{ accountKey: 'game-1::server:1', gameUid: 'game-1', serverId: '1' }],
      },
      scope: {
        account: { accountKey: 'game-1::server:1' },
        dashboard: {
          timelineViews: {
            'zh-CN': {
              'limited-selected': [{ id: 'selected-timeline', totalPulls: 120 }],
            },
          },
          views: {
            'limited-selected': {
              excludeFree: {
                stats: { total: 130, paidTotal: 120 },
                effectivePity: { pity6: 39, pity5: 0 },
              },
            },
          },
        },
      },
    };

    const { result } = renderHook(() => useDashboardViewState());

    expect(result.current.isAnalysisBacked).toBe(true);
    expect(result.current.stats.total).toBe(130);
    expect(result.current.snapshotTimelineSections).toEqual([
      expect.objectContaining({ id: 'selected-timeline', totalPulls: 120 }),
    ]);
  });
});
