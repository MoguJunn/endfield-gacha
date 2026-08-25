import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildHistoryIndex,
  clearHistoryIndexCache,
  getCachedHistoryIndex,
} from '../historyIndex.js';

function createPull({
  id,
  poolId,
  seqId,
  timestamp,
  userId = 'user-a',
  gameUid = 'uid-a',
  rarity = 4,
}) {
  return {
    id,
    poolId,
    seqId: String(seqId),
    timestamp,
    user_id: userId,
    game_uid: gameUid,
    rarity,
  };
}

describe('historyIndex', () => {
  beforeEach(() => {
    clearHistoryIndexCache();
  });

  it('builds owner, account, annotation, pool and limited-history derivations once', () => {
    const pools = [
      { id: 'limited-1', type: 'limited', start_time: '2026-01-01T00:00:00.000Z' },
      { id: 'limited-2', type: 'limited_character', start_time: '2026-02-01T00:00:00.000Z' },
      { id: 'standard-1', type: 'standard', start_time: '2026-01-01T00:00:00.000Z' },
    ];
    const firstPoolPulls = Array.from({ length: 60 }, (_, index) => createPull({
      id: `limited-1-${index + 1}`,
      poolId: 'limited-1',
      seqId: index + 1,
      timestamp: `2026-01-01T00:${String(index).padStart(2, '0')}:00.000Z`,
    })).reverse();
    const history = [
      createPull({
        id: 'limited-2-later',
        poolId: 'limited-2',
        seqId: 62,
        timestamp: '2026-02-01T00:02:00.000Z',
        rarity: 6,
      }),
      createPull({
        id: 'other-owner',
        poolId: 'limited-2',
        seqId: 1,
        timestamp: '2026-02-01T00:00:00.000Z',
        userId: 'user-b',
      }),
      createPull({
        id: 'other-account',
        poolId: 'limited-2',
        seqId: 1,
        timestamp: '2026-02-01T00:00:30.000Z',
        gameUid: 'uid-b',
      }),
      ...firstPoolPulls,
      createPull({
        id: 'standard-current-account',
        poolId: 'standard-1',
        seqId: 63,
        timestamp: '2026-02-01T00:03:00.000Z',
      }),
      createPull({
        id: 'limited-2-earlier',
        poolId: 'limited-2',
        seqId: 61,
        timestamp: '2026-02-01T00:01:00.000Z',
        rarity: 5,
      }),
    ];
    const originalHistoryOrder = history.map((item) => item.id);

    const index = buildHistoryIndex({
      history,
      pools,
      userId: 'user-a',
      currentGameUid: 'uid-a',
    });

    expect(index.effectiveGameUid).toBe('uid-a');
    expect(index.ownedHistoryArray).toHaveLength(64);
    expect(index.accountHistoryArray).toHaveLength(63);
    expect(index.historyByPoolId.get('limited-2').map((item) => item.id)).toEqual([
      'limited-2-earlier',
      'limited-2-later',
    ]);
    expect(index.historyByPoolId.get('limited-2').every((item) => item.isInfoBook)).toBe(true);
    expect(index.allLimitedHistory).toHaveLength(62);
    expect(index.allLimitedHistory.at(-1).id).toBe('limited-2-later');
    expect(index.poolById.get('standard-1')).toBe(pools[2]);
    expect(history.map((item) => item.id)).toEqual(originalHistoryOrder);
  });

  it('reuses only matching references and account scope', () => {
    const pools = [{ id: 'limited-1', type: 'limited' }];
    const history = [createPull({
      id: 'a-1',
      poolId: 'limited-1',
      seqId: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
    })];
    const options = {
      history,
      pools,
      userId: 'user-a',
      currentGameUid: 'uid-a',
    };

    const first = getCachedHistoryIndex(options);
    const second = getCachedHistoryIndex(options);
    const otherAccount = getCachedHistoryIndex({ ...options, currentGameUid: 'uid-b' });
    const otherPoolsReference = getCachedHistoryIndex({ ...options, pools: [...pools] });
    const otherHistoryReference = getCachedHistoryIndex({ ...options, history: [...history] });

    expect(second).toBe(first);
    expect(otherAccount).not.toBe(first);
    expect(otherPoolsReference).not.toBe(first);
    expect(otherHistoryReference).not.toBe(first);
  });
});
