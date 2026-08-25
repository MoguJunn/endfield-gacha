import { describe, expect, it } from 'vitest';

import { buildCapabilityAwarePoolResourceSummary } from '../resourceEconomy.js';

describe('capability-aware resource aggregation', () => {
  it('splits mixed reconstruction character and weapon records by their real pools', () => {
    const characterPool = {
      id: 'recon-character',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'series-character',
    };
    const weaponPool = {
      id: 'recon-weapon',
      type: 'extra',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'series-weapon',
    };
    const summary = buildCapabilityAwarePoolResourceSummary({
      pools: [characterPool, weaponPool],
      history: [
        { id: 'c1', poolId: characterPool.id, rarity: 4 },
        { id: 'c2', poolId: characterPool.id, rarity: 6, isStandard: false },
        { id: 'w1', poolId: weaponPool.id, rarity: 4 },
        { id: 'w2', poolId: weaponPool.id, rarity: 6, isStandard: false },
      ],
    });

    expect(summary).toMatchObject({
      characterPulls: 2,
      weaponPulls: 2,
      chargedCharacterPulls: 2,
      chargedWeaponPulls: 2,
      jadeSpent: 1000,
      arsenalSpent: 396,
      arsenalGained: 2020,
    });
  });

  it('does not charge free records in either capability bucket', () => {
    const pools = [
      { id: 'character', type: 'extra', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'c' },
      { id: 'weapon', type: 'extra', extra_rule_profile: 'reconstruction_weapon_v1', extra_series_key: 'w' },
    ];
    const summary = buildCapabilityAwarePoolResourceSummary({
      pools,
      includeFreePulls: true,
      history: [
        { poolId: 'character', rarity: 5, isFree: true },
        { poolId: 'weapon', rarity: 5, isFree: true },
      ],
    });

    expect(summary).toMatchObject({
      characterPulls: 1,
      weaponPulls: 1,
      chargedCharacterPulls: 0,
      chargedWeaponPulls: 0,
      jadeSpent: 0,
      arsenalSpent: 0,
    });
  });

  it('does not charge camelCase or snake_case info-book records', () => {
    const pool = { id: 'limited', type: 'limited' };
    const summary = buildCapabilityAwarePoolResourceSummary({
      pools: [pool],
      history: [
        { poolId: pool.id, rarity: 4, isInfoBook: true },
        { poolId: pool.id, rarity: 4, is_info_book: true },
        { poolId: pool.id, rarity: 4, isInfoBookPull: true },
        { poolId: pool.id, rarity: 4, is_info_book_pull: true },
      ],
    });

    expect(summary).toMatchObject({
      characterPulls: 4,
      chargedCharacterPulls: 0,
      jadeSpent: 0,
    });
  });
});
