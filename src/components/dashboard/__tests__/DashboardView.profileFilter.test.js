import { describe, expect, it } from 'vitest';

import { getOverviewPoolBucket, getOverviewPoolTypeKey } from '../../../utils/dashboardOverviewPoolFilters.js';

describe('DashboardView profile filters', () => {
  it('routes reconstruction weapons into weapon statistics and filters', () => {
    const pool = {
      id: 'recon-weapon',
      type: 'extra',
      extra_subtype: 'reconstruction_claim',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'series-w',
    };

    expect(getOverviewPoolBucket(pool)).toBe('weapon');
    expect(getOverviewPoolTypeKey(pool)).toBe('weapon_limited');
  });

  it('keeps reconstruction characters in the extra character filter', () => {
    const pool = {
      id: 'recon-character',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'series-c',
    };

    expect(getOverviewPoolBucket(pool)).toBe('extra');
    expect(getOverviewPoolTypeKey(pool)).toBe('extra');
  });
});
