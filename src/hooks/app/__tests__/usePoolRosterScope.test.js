import { describe, expect, it } from 'vitest';
import { selectPoolsForRosterScope } from '../useCurrentPoolData.js';
import { getPoolRosterScopeIds } from '../usePoolRoster.js';

describe('current pool roster scope', () => {
  const pools = [
    { id: 'limited-a', name: '限定 A', type: 'limited' },
    { id: 'limited-b', name: '限定 B', type: 'limited_character' },
    { id: 'standard-a', name: '常驻 A', type: 'standard' },
    { id: 'weapon-a', name: '武器 A', type: 'limited_weapon' },
  ];

  it('requests only the selected single pool', () => {
    const selectedPools = selectPoolsForRosterScope({
      pools,
      currentPoolId: 'standard-a',
      locale: 'zh-CN',
    });

    expect(getPoolRosterScopeIds(selectedPools)).toEqual(['standard-a']);
  });

  it('requests only pools in the selected group', () => {
    const selectedPools = selectPoolsForRosterScope({
      pools,
      currentPoolId: '__group_limited',
      locale: 'zh-CN',
    });

    expect(new Set(getPoolRosterScopeIds(selectedPools))).toEqual(new Set([
      'limited-a',
      'limited-b',
    ]));
  });
});
