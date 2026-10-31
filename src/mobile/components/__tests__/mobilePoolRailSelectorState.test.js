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
  it('respects manual collapse', () => {
    expect(resolvePoolGroupExpanded(extraGroup, false)).toBe(false);
  });

  it('expands groups by default', () => {
    expect(resolvePoolGroupExpanded(extraGroup)).toBe(true);
  });

  it('temporarily expands during search without changing the manual state', () => {
    expect(resolvePoolGroupExpanded({ ...extraGroup, disableCollapse: true }, false)).toBe(true);
    expect(resolvePoolGroupExpanded(extraGroup, false)).toBe(false);
  });
});
