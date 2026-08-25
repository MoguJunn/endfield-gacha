import { describe, expect, it } from 'vitest';

import { resolvePoolGroupExpanded } from '../mobilePoolRailSelectorState.js';

const extraGroup = {
  type: 'extra',
  groupId: 'group:extra',
  pools: [],
  subgroups: [
    {
      groupId: 'group:extra:reconstruction',
      pools: [],
      allPools: [{ id: 'extra-reconstruction-phase-1' }],
    },
    {
      groupId: 'group:extra:special',
      pools: [{ id: 'extra-special' }],
    },
  ],
};

describe('mobile pool rail parent expansion', () => {
  it('forces a manually collapsed extra parent open for its selected concrete pool', () => {
    expect(resolvePoolGroupExpanded(extraGroup, 'extra-reconstruction-phase-1', false)).toBe(true);
  });

  it('forces a manually collapsed extra parent open for its selected subgroup', () => {
    expect(resolvePoolGroupExpanded(extraGroup, 'group:extra:special', false)).toBe(true);
  });

  it('preserves manual collapse when selection is outside the group', () => {
    expect(resolvePoolGroupExpanded(extraGroup, 'limited-pool', false)).toBe(false);
  });
});
