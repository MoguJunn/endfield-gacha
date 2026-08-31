import { describe, expect, it } from 'vitest';
import {
  activateInheritedSimulatorSnapshot,
  buildInheritedSimulatorSnapshot,
} from '../simulatorInheritance.js';

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
      realPools: [{ id: 'limited-a', type: 'limited', up_character: '目标角色' }],
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
  });

  it('activates a pending info book for the selected simulator pool without mutating the snapshot', () => {
    const source = {
      statesByPoolId: {
        sim_limited_b: { infoBookTenPullAvailable: false },
      },
      sharedPityState: { sixStarPity: 3, fiveStarPity: 1 },
      seriesStates: {},
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
  });
});
