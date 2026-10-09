import { describe, expect, it } from 'vitest';
import { activateInheritedSimulatorSnapshot, buildInheritedSimulatorSnapshot } from '../simulatorInheritance.js';

describe('simulator inheritance analysis snapshot', () => {
  it('builds a lightweight snapshot without full pull history', () => {
    const snapshot = buildInheritedSimulatorSnapshot({
      history: Array.from({ length: 12 }, (_, index) => ({
        id: `pull-${index + 1}`,
        user_id: 'user-1',
        game_uid: 'game-1',
        pool_id: 'limited-a',
        rarity: index === 4 ? 6 : 4,
        character_name: index === 4 ? '目标角色' : `角色-${index + 1}`,
        timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
      realPools: [
        { id: 'limited-a', type: 'limited', up_character: '目标角色' },
        { id: 'limited-b', type: 'limited', up_character: '下期目标' },
      ],
      currentUserId: 'user-1',
      includePullHistory: false,
    });

    expect(snapshot.statesByPoolId['sim_limited-a']).toMatchObject({
      totalPulls: 12,
      sixStarPity: 7,
      sixStarCount: 1,
      upSixStarCount: 1,
      pullHistory: [],
    });
    expect(snapshot.statesByPoolId['sim_limited-b']).toMatchObject({
      totalPulls: 0,
      sixStarPity: 7,
      pullHistory: [],
    });
    expect(snapshot.sharedPityState).toEqual({ sixStarPity: 7, fiveStarPity: 7 });
  });

  it('activates a pending info book for the selected simulator pool without mutating the snapshot', () => {
    const source = {
      statesByPoolId: {
        sim_limited_b: { infoBookTenPullAvailable: false },
      },
      sharedPityState: { sixStarPity: 3, fiveStarPity: 1 },
      seriesStates: { 'profile::series': { seriesRewardPulls: 10 } },
      infoBooks: {
        sim_limited_a: {
          activated: false,
          used: false,
          targetPoolId: 'sim_limited_b',
        },
      },
      hasAnyData: true,
    };

    const activated = activateInheritedSimulatorSnapshot(source, 'sim_limited_b');

    expect(activated.statesByPoolId.sim_limited_b.infoBookTenPullAvailable).toBe(true);
    expect(activated.infoBooks.sim_limited_a.activated).toBe(true);
    expect(source.statesByPoolId.sim_limited_b.infoBookTenPullAvailable).toBe(false);
    expect(source.infoBooks.sim_limited_a.activated).toBe(false);
    expect(activated.statesByPoolId.sim_limited_b).not.toBe(source.statesByPoolId.sim_limited_b);
    expect(activated.sharedPityState).not.toBe(source.sharedPityState);
    expect(activated.seriesStates['profile::series']).not.toBe(source.seriesStates['profile::series']);
  });

  it('does not reactivate an already used info book', () => {
    const source = {
      statesByPoolId: { sim_limited_b: { infoBookTenPullAvailable: false, hasUsedInfoBookTenPull: true } },
      infoBooks: { sim_limited_a: { activated: false, used: true, targetPoolId: 'sim_limited_b' } },
      hasAnyData: true,
    };
    const activated = activateInheritedSimulatorSnapshot(source, 'sim_limited_b');

    expect(activated.statesByPoolId.sim_limited_b.infoBookTenPullAvailable).toBe(false);
    expect(activated.infoBooks.sim_limited_a).toEqual(source.infoBooks.sim_limited_a);
    expect(activated.infoBooks.sim_limited_a).not.toBe(source.infoBooks.sim_limited_a);
  });

  it('keeps catalog-only snapshots empty after activation', () => {
    const snapshot = buildInheritedSimulatorSnapshot({
      history: [],
      realPools: [{ id: 'limited-a', type: 'limited' }],
      includePullHistory: false,
    });

    expect(snapshot.statesByPoolId['sim_limited-a'].totalPulls).toBe(0);
    expect(snapshot.hasAnyData).toBe(false);
    expect(activateInheritedSimulatorSnapshot(snapshot, 'sim_limited-a').hasAnyData).toBe(false);
  });
});
