import { describe, expect, it } from 'vitest';

import { isPoolSelectorGroupCollapsed } from '../poolGroupCardRailState.js';

describe('PoolGroupCardRail collapse state', () => {
  it('temporarily expands a user-collapsed group during search and restores it afterwards', () => {
    const collapsedGroupTypes = new Set(['limited']);

    expect(isPoolSelectorGroupCollapsed({
      group: { type: 'limited', disableCollapse: false },
      collapsedGroupTypes,
    })).toBe(true);
    expect(isPoolSelectorGroupCollapsed({
      group: { type: 'limited', disableCollapse: true },
      collapsedGroupTypes,
    })).toBe(false);
    expect(isPoolSelectorGroupCollapsed({
      group: { type: 'limited', disableCollapse: false },
      collapsedGroupTypes,
    })).toBe(true);
  });
});
