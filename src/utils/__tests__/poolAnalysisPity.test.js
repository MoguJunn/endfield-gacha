import { describe, expect, it } from 'vitest';

import { buildOverviewPoolAnalysisPityMap, getPoolAnalysisPityState } from '../poolAnalysisPity.js';

describe('getPoolAnalysisPityState capabilities', () => {
  it('uses limited pity for reconstruction characters', () => {
    expect(getPoolAnalysisPityState({
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'series-c',
    }, { currentPity: 12 }, { pity6: 18, pity5: 3, isInherited: true })).toMatchObject({
      normalizedType: 'limited',
      isExtra: true,
      isWeapon: false,
      maxPity6: 80,
      displayPity6: 18,
      isInherited6: true,
    });
  });

  it('uses 40-pull pool-local pity for reconstruction weapons', () => {
    expect(getPoolAnalysisPityState({
      type: 'extra',
      extra_rule_profile: 'reconstruction_weapon_v1',
    }, { currentPity: 12 }, { pity6: 30, pity5: 4, isInherited: true })).toMatchObject({
      normalizedType: 'weapon',
      isExtra: true,
      isWeapon: true,
      maxPity6: 40,
      displayPity6: 12,
      isInherited6: false,
    });
  });

  it('builds overview pity independently for every selected reconstruction series', () => {
    const pools = [
      { id: 's1-a', type: 'extra', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 's1' },
      { id: 's1-b', type: 'extra', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 's1' },
      { id: 's2-a', type: 'extra', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 's2' },
      { id: 'w1-a', type: 'extra', extra_rule_profile: 'reconstruction_weapon_v1', extra_series_key: 's1' },
    ];
    const history = [
      ...Array.from({ length: 5 }, (_, index) => ({ id: `a-${index}`, poolId: 's1-a', rarity: 4, timestamp: index })),
      ...Array.from({ length: 7 }, (_, index) => ({ id: `b-${index}`, poolId: 's1-b', rarity: 4, timestamp: index + 10 })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `s2-${index}`, poolId: 's2-a', rarity: 4, timestamp: index + 20 })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: `w-${index}`, poolId: 'w1-a', rarity: 4, timestamp: index + 30 })),
    ];

    const map = buildOverviewPoolAnalysisPityMap({ pools, history });

    expect(map.get('s1-a').displayPity6).toBe(12);
    expect(map.get('s1-b').displayPity6).toBe(12);
    expect(map.get('s2-a').displayPity6).toBe(4);
    expect(map.get('w1-a').displayPity6).toBe(3);
  });
});
