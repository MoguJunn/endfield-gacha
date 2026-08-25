import { describe, expect, it, vi } from 'vitest';

import { buildDashboardOverviewSplitStats } from '../dashboardOverviewSplitStats.js';

vi.mock('../characterUtils.js', () => ({
  resolveCharacterRecordByName: vi.fn((value) => {
    if (value === '歪限定角色' || value === 'chr_off_limited') {
      return { id: 'chr_off_limited', name: '歪限定角色', type: 'character', is_limited: true };
    }
    return null;
  }),
}));

describe('buildDashboardOverviewSplitStats', () => {
  it('counts off-rate limited characters in character split limited six-star averages', () => {
    const stats = buildDashboardOverviewSplitStats({
      selectedPools: [
        { id: 'pool_limited', type: 'limited' },
        { id: 'pool_weapon', type: 'weapon' },
      ],
      history: [
        { id: 1, poolId: 'pool_limited', rarity: 4 },
        { id: 2, poolId: 'pool_limited', rarity: 6, isStandard: false, character_name: '当期UP' },
        { id: 3, poolId: 'pool_limited', rarity: 6, isStandard: true, character_id: 'chr_off_limited' },
        { id: 4, poolId: 'pool_limited', rarity: 6, isStandard: true, character_name: '常驻角色' },
        { id: 5, poolId: 'pool_weapon', rarity: 6, isStandard: false, item_name: 'UP武器' },
      ],
    });

    expect(stats.character.counts).toMatchObject({
      6: 1,
      '6_std': 2,
    });
    expect(stats.character.avgPullCost[6]).toBe('4.00');
    expect(stats.character.avgPullCost['6_limited']).toBe('2.00');
    expect(stats.weapon.avgPullCost['6_limited']).toBe('0');
  });

  it('counts explicit brilliance six stars as character targets even when legacy records are marked standard', () => {
    const stats = buildDashboardOverviewSplitStats({
      selectedPools: [
        { id: 'pool_extra', type: 'extra', extra_rule_profile: 'brilliance_festival_v1' },
      ],
      history: [
        { id: 1, poolId: 'pool_extra', rarity: 4 },
        { id: 2, poolId: 'pool_extra', rarity: 6, isStandard: true, character_name: '莱万汀' },
      ],
    });

    expect(stats.character.counts).toMatchObject({
      6: 1,
      '6_std': 0,
      4: 1,
    });
    expect(stats.character.avgPullCost[6]).toBe('2.00');
    expect(stats.character.avgPullCost['6_limited']).toBe('2.00');
    expect(stats.character.pityStats.distribution[0]).toMatchObject({
      range: '1-10',
      limited: 1,
      standard: 0,
    });
  });

  it('splits extra pools and target results from each source pool capabilities', () => {
    const stats = buildDashboardOverviewSplitStats({
      selectedPools: [
        {
          id: 'recon_character',
          type: 'extra',
          up_character: '重构角色UP',
          extra_rule_profile: 'reconstruction_character_v1',
          extra_series_key: 'recon-character-series',
        },
        {
          id: 'recon_weapon',
          type: 'extra',
          up_character: '重构武器UP',
          extra_rule_profile: 'reconstruction_weapon_v1',
          extra_series_key: 'recon-weapon-series',
        },
        {
          id: 'brilliance',
          type: 'extra',
          extra_rule_profile: 'brilliance_festival_v1',
        },
        {
          id: 'unknown_extra',
          type: 'extra',
          extra_rule_profile: 'future_joint_profile',
        },
      ],
      history: [
        { id: 1, poolId: 'recon_character', rarity: 6, character_name: '重构角色UP', isStandard: true },
        { id: 2, poolId: 'recon_character', rarity: 6, character_name: '角色歪出', isStandard: false, isUp: true },
        { id: 3, poolId: 'recon_weapon', rarity: 4 },
        { id: 4, poolId: 'recon_weapon', rarity: 6, item_name: '重构武器UP', isStandard: true },
        { id: 5, poolId: 'brilliance', rarity: 6, character_name: '辉光目标', isStandard: true },
        { id: 6, poolId: 'unknown_extra', rarity: 6, character_name: '未知目标', isStandard: false },
      ],
    });

    expect(stats.character.total).toBe(3);
    expect(stats.character.counts).toMatchObject({ 6: 2, '6_std': 1 });
    expect(stats.character.resourceSummary).toMatchObject({
      characterPulls: 3,
      weaponPulls: 0,
    });
    expect(stats.weapon.total).toBe(2);
    expect(stats.weapon.counts).toMatchObject({ 6: 1, '6_std': 0, 4: 1 });
    expect(stats.weapon.resourceSummary).toMatchObject({
      characterPulls: 0,
      weaponPulls: 2,
    });
    expect(stats.weapon.pityStats.distribution).toHaveLength(4);
  });

  it('uses the source pool pity scope across reconstruction series phases', () => {
    const selectedPools = [
      {
        id: 'recon_phase_1',
        type: 'extra',
        up_character: '阶段一目标',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'shared-reconstruction-series',
      },
      {
        id: 'recon_phase_2',
        type: 'extra',
        up_character: '阶段二目标',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'shared-reconstruction-series',
      },
    ];
    const stats = buildDashboardOverviewSplitStats({
      selectedPools,
      history: [
        { id: 1, poolId: 'recon_phase_1', rarity: 4, timestamp: '2026-01-01T00:00:00.000Z' },
        { id: 2, poolId: 'recon_phase_2', rarity: 4, timestamp: '2026-01-01T00:01:00.000Z' },
        { id: 3, poolId: 'recon_phase_2', rarity: 6, character_name: '阶段二目标', timestamp: '2026-01-01T00:02:00.000Z' },
      ],
    });

    expect(stats.character.pityStats.history).toEqual([
      { count: 3, isStandard: false },
    ]);
  });

  it('includes free ten-pull results in split stats without advancing paid pity counters', () => {
    const baseInput = {
      selectedPools: [
        { id: 'pool_limited', type: 'limited' },
      ],
      history: [
        { id: 1, poolId: 'pool_limited', rarity: 4 },
        { id: 2, poolId: 'pool_limited', rarity: 6, isStandard: false, isFree: true },
        { id: 3, poolId: 'pool_limited', rarity: 6, isStandard: false },
      ],
    };

    const excluded = buildDashboardOverviewSplitStats(baseInput);
    const included = buildDashboardOverviewSplitStats({
      ...baseInput,
      includeFreePullsInStats: true,
    });

    expect(excluded.character.total).toBe(2);
    expect(excluded.character.counts[6]).toBe(1);
    expect(excluded.character.pityStats.history.map(({ count }) => count)).toEqual([2]);

    expect(included.character.total).toBe(3);
    expect(included.character.counts[6]).toBe(2);
    expect(included.character.pityStats.history.map(({ count }) => count)).toEqual([30, 2]);
    expect(included.character.pityStats.distribution[2]).toMatchObject({
      range: '21-30',
      limited: 1,
    });
  });

  it('keeps limited guarantee hits in six-star counts but out of win-rate stats', () => {
    const stats = buildDashboardOverviewSplitStats({
      selectedPools: [
        { id: 'pool_limited', type: 'limited' },
        { id: 'pool_weapon', type: 'weapon' },
      ],
      history: [
        { id: 1, poolId: 'pool_limited', rarity: 6, isStandard: false },
        { id: 2, poolId: 'pool_limited', rarity: 6, isStandard: false, specialType: 'guaranteed' },
        { id: 3, poolId: 'pool_limited', rarity: 6, isStandard: true },
        { id: 4, poolId: 'pool_weapon', rarity: 6, isStandard: false, specialType: 'guaranteed' },
      ],
    });

    expect(stats.character.counts).toMatchObject({
      6: 2,
      '6_std': 1,
    });
    expect(stats.character.totalSixStar).toBe(3);
    expect(stats.character.winRate).toBe('50.0');
    expect(stats.character.winRateTargetCount).toBe(1);
    expect(stats.character.winRateTotalCount).toBe(2);
    expect(stats.weapon.winRate).toBe('100.0');
    expect(stats.weapon.winRateTargetCount).toBe(1);
    expect(stats.weapon.winRateTotalCount).toBe(1);
  });
});
