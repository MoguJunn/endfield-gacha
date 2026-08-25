// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { toPublicPoolDto } from '../_lib/publicCatalog.js';

describe('public pool DTO extra subtype', () => {
  it('publishes the canonical reconstruction claim subtype for legacy weapon tuples', () => {
    expect(toPublicPoolDto({
      pool_id: 'reclaim_9_0_2',
      name: '点绘申领',
      type: 'extra',
      extra_subtype: 'reconstruction',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'reconstruction-xuesong-youmeng',
      extra_series_phase: 1,
    })).toMatchObject({
      id: 'reclaim_9_0_2',
      type: 'extra',
      extraSubtype: 'reconstruction_claim',
      extraRuleProfile: 'reconstruction_weapon_v1',
    });
  });
});
