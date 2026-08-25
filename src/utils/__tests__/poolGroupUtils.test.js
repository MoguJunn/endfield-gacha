import { describe, expect, it } from 'vitest';

import {
  getPoolGroupSubtype,
  getPoolGroupType,
  getPoolsForGroupType,
  normalizeExtraPoolSubtype,
  parsePoolGroupId
} from '../poolGroupUtils.js';

describe('poolGroupUtils extra subtype scopes', () => {
  const pools = [
    { id: 'joint_reconstruction', type: 'extra', extra_subtype: 'reconstruction' },
    {
      id: 'joint_reconstruction_claim',
      type: 'extra',
      extra_subtype: 'reconstruction',
      extra_rule_profile: 'reconstruction_weapon_v1',
    },
    { id: 'joint_special', type: 'extra', extra_subtype: 'special' },
    { id: 'joint_1_2_2', type: 'extra' },
    { id: 'joint_unknown', type: 'extra' },
    { id: 'limited', type: 'limited' },
  ];

  it('parses subtype group ids without treating the colon suffix as a top-level type', () => {
    expect(parsePoolGroupId('__group_extra:special')).toEqual({
      type: 'extra',
      subtype: 'special'
    });
    expect(getPoolGroupType('__group_extra:special')).toBe('extra');
    expect(getPoolGroupSubtype('__group_extra:special')).toBe('special');
  });

  it('keeps the parent extra scope and narrows subtype scopes independently', () => {
    expect(getPoolsForGroupType(pools, 'extra').map((pool) => pool.id)).toEqual([
      'joint_reconstruction',
      'joint_reconstruction_claim',
      'joint_special',
      'joint_1_2_2',
      'joint_unknown',
    ]);
    expect(getPoolsForGroupType(pools, 'extra', 'reconstruction').map((pool) => pool.id)).toEqual([
      'joint_reconstruction',
    ]);
    expect(getPoolsForGroupType(pools, 'extra:reconstruction_claim').map((pool) => pool.id)).toEqual([
      'joint_reconstruction_claim',
    ]);
    expect(getPoolsForGroupType(pools, 'extra:special').map((pool) => pool.id)).toEqual([
      'joint_special',
      'joint_1_2_2',
    ]);
  });

  it('does not classify unknown joint ids as special', () => {
    expect(normalizeExtraPoolSubtype({ id: 'joint_1_2_2', type: 'extra' })).toBe('special');
    expect(normalizeExtraPoolSubtype({ id: 'joint_unknown', type: 'extra' })).toBe('unclassified');
    expect(normalizeExtraPoolSubtype({
      id: 'joint_old_weapon',
      type: 'extra',
      extra_subtype: 'reconstruction',
      extra_rule_profile: 'reconstruction_weapon_v1',
    })).toBe('reconstruction_claim');
    expect(normalizeExtraPoolSubtype({
      id: 'joint_1_2_2',
      type: 'extra',
      extra_subtype: 'unknown'
    })).toBe('unclassified');
  });
});
