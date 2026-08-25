import { describe, expect, it } from 'vitest';

import { buildSimulatorCurrentPoolView } from '../useGachaSimulatorController.js';
import { buildDashboardStats, buildPityInfoWithGuarantee } from '../simulatorViewUtils.js';
import { resolvePoolCapabilities } from '../../../utils/poolCapabilities.js';

const reconstructionWeaponPool = {
  id: 'sim_recon-weapon-b',
  source_pool_id: 'recon-weapon-b',
  type: 'extra',
  name: '重构武器二期 [模拟]',
  original_name: '重构武器二期',
  extra_subtype: 'reconstruction_claim',
  extra_rule_profile: 'reconstruction_weapon_v1',
  extra_series_key: 'series-w',
  extra_series_phase: 2,
};

function buildFakeSimulator(stateOverrides = {}) {
  const capabilities = resolvePoolCapabilities(reconstructionWeaponPool);
  return {
    poolType: 'weapon',
    rawPoolType: 'extra',
    poolInfo: reconstructionWeaponPool,
    capabilities,
    rules: capabilities.rules,
    getState: () => ({
      seriesRewardPulls: 170,
      freeTenPullsReceived: 0,
      guaranteedLimitedPity: 70,
      hasReceivedGuaranteedLimited: false,
      ...stateOverrides,
    }),
    getPityInfo: () => ({
      sixStar: { current: 20, max: 40 },
      fiveStar: { current: 0, max: 10 },
      guaranteedUp: {
        current: 70,
        max: 80,
        percentage: '87.5',
        remaining: 10,
        hasReceived: false,
      },
    }),
  };
}

describe('simulator profile view data', () => {
  it('keeps the real extra identity while exposing the effective base type', () => {
    const view = buildSimulatorCurrentPoolView({
      currentSimPool: reconstructionWeaponPool,
      simulator: buildFakeSimulator(),
    });

    expect(view).toMatchObject({
      type: 'extra',
      source_pool_id: 'recon-weapon-b',
      extra_subtype: 'reconstruction_claim',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'series-w',
      extra_series_phase: 2,
      effectivePoolType: 'weapon',
      basePoolType: 'weapon',
    });
  });

  it('exposes series reward totals, available free pulls, and simulator guarantee state', () => {
    const simulator = buildFakeSimulator({ freeTenPullsReceived: 2 });
    const stats = {
      totalPulls: 20,
      sixStarCount: 1,
      fiveStarCount: 2,
      upSixStarCount: 1,
      upRate: '100.0',
      avgPullsPerSixStar: '20.0',
      fiveStarRate: '10.0',
      hasReceivedInfoBook: false,
      freeTenPulls: { count: 3 },
      gifts: { standardCount: 1, limitedCount: 0 },
      sixStarHistory: [
        { isUp: true, pityWhenPulled: 10 },
      ],
    };
    const pityInfo = simulator.getPityInfo();

    const dashboardStats = buildDashboardStats(stats, pityInfo, simulator, 'zh-CN');
    expect(dashboardStats).toMatchObject({
      paidTotal: 20,
      rewardPaidTotal: 170,
      seriesRewardPaidTotal: 170,
      guaranteeState: {
        current: 70,
        max: 80,
        hasReceived: false,
      },
      freeTenPulls: {
        count: 3,
        received: 2,
        available: 1,
      },
    });
    expect(buildPityInfoWithGuarantee(stats, simulator).guaranteedUp).toMatchObject({
      current: 70,
      max: 80,
      hasReceived: false,
    });
  });
});
