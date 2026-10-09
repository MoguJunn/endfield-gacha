import { describe, expect, it } from 'vitest';
import { getPoolState } from '../../../../shared/simulator/engine.js';
import { resolvePoolCapabilities } from '../../../utils/poolCapabilities.js';
import { buildSimulatorCatalogSignature, buildSimulatorInheritanceProjection } from '../inheritanceProjection.js';

const USER = 'user-1';
const ACCOUNT = 'same-uid::server:2';
const pools = [
  { id: 'limited-a', type: 'limited', up_character: '目标甲', start_time: '2026-01-01' },
  { id: 'limited-b', type: 'limited', up_character: '目标乙', start_time: '2026-02-01' },
  { id: 'limited-c', type: 'limited', up_character: '目标丙', start_time: '2026-03-01' },
];
const descriptor = (pool) => ({ id: pool.id, capabilities: resolvePoolCapabilities(pool), pool });
function pull(index, overrides = {}) {
  return {
    id: `record-${index}`,
    user_id: USER,
    game_uid: 'same-uid',
    server_scope: '2',
    pool_id: 'limited-a',
    rarity: 4,
    character_name: '四星',
    character_id: 'four',
    seq_id: String(index),
    timestamp: Date.UTC(2026, 0, 1) + index * 1000,
    ...overrides,
  };
}
function project(history, catalog = pools) {
  return buildSimulatorInheritanceProjection({ history, pools: catalog, currentUserId: USER, accountKey: ACCOUNT });
}

describe('simulator inheritance projection v2', () => {
  it('replays the complete timeline once and preserves redeemed free pulls and gift records', () => {
    const history = [
      ...Array.from({ length: 30 }, (_, index) => pull(index + 1)),
      ...Array.from({ length: 10 }, (_, index) => pull(index + 31, { is_free: true })),
      pull(41, { rarity: 6, special_type: 'gift', character_name: '目标甲' }),
    ];
    const original = structuredClone(history);
    const projection = project(history.slice().reverse());
    expect(history).toEqual(original);
    expect(projection).toMatchObject({ contractVersion: 2, session: { version: 2, scope: ACCOUNT } });
    expect(projection.histories['limited-a']).toHaveLength(41);
    expect(projection.histories['limited-a'].filter((record) => record.kind === 'free')).toHaveLength(10);
    expect(projection.histories['limited-a'].at(-1).kind).toBe('gift');
    expect(getPoolState(projection.session, descriptor(pools[0]))).toMatchObject({
      totalPulls: 30,
      freeTenPullsReceived: 1,
      sixStarPity: 30,
    });
    expect(projection.session.ledger.characterPulls).toBe(30);
    expect(projection.session.pools['limited-a']).not.toHaveProperty('pullHistory');
  });

  it('uses zero-pull adjacent catalog pools as info-book targets', () => {
    const history = Array.from({ length: 60 }, (_, index) => pull(index + 1));
    const projection = project(history);
    expect(projection.session.infoBooks['limited-a']).toMatchObject({ targetPoolId: 'limited-b', used: false });
    expect(projection.histories['limited-b']).toEqual([]);
    expect(getPoolState(projection.session, descriptor(pools[1]))).toMatchObject({
      totalPulls: 0,
      sixStarPity: 60,
      infoBookTenPullAvailable: true,
    });
    expect(projection.catalogSignature).not.toBe(buildSimulatorCatalogSignature({ pools: [pools[0]] }));
  });

  it('numbers sequence indexes per pool so they match the core pool progress', () => {
    const history = [
      pull(1, { pool_id: 'limited-a' }),
      pull(2, { pool_id: 'limited-b' }),
      pull(3, { pool_id: 'limited-a' }),
      pull(4, { pool_id: 'limited-b' }),
      pull(5, { pool_id: 'limited-a', is_free: true }),
    ];
    const projection = project(history);
    expect(projection.histories['limited-a'].map((record) => record.sequenceIndex)).toEqual([1, 2, 3]);
    expect(projection.histories['limited-b'].map((record) => record.sequenceIndex)).toEqual([1, 2]);
    expect(projection.session.pools['limited-a'].sequenceCount).toBe(3);
    expect(projection.session.pools['limited-b'].sequenceCount).toBe(2);
  });

  it('marks the source info book used and retains every info-book result', () => {
    const history = [
      ...Array.from({ length: 60 }, (_, index) => pull(index + 1)),
      ...Array.from({ length: 10 }, (_, index) => pull(index + 61, { pool_id: 'limited-b', is_info_book: true })),
    ];
    const projection = project(history);
    expect(projection.session.infoBooks['limited-a']).toMatchObject({ targetPoolId: 'limited-b', used: true });
    expect(projection.histories['limited-b'].map((record) => record.kind)).toEqual(Array(10).fill('info_book'));
    expect(projection.histories['limited-a'].at(-1).sequenceIndex).toBe(60);
    expect(projection.histories['limited-b'].map((record) => record.sequenceIndex)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1)
    );
    expect(getPoolState(projection.session, descriptor(pools[1]))).toMatchObject({
      totalPulls: 10,
      infoBookTenPullAvailable: false,
      hasUsedInfoBookTenPull: true,
    });
    expect(projection.session.ledger.characterPulls).toBe(60);
  });

  it('reuses the existing annotation only when no record carries an info-book flag', () => {
    const history = [
      ...Array.from({ length: 60 }, (_, index) => pull(index + 1)),
      ...Array.from({ length: 10 }, (_, index) => pull(index + 61, { pool_id: 'limited-b' })),
    ];
    const projection = project(history);
    expect(projection.session.infoBooks['limited-a']).toMatchObject({ targetPoolId: 'limited-b', used: true });
    expect(projection.histories['limited-b'].map((record) => record.kind)).toEqual(Array(10).fill('info_book'));
  });

  it('keeps explicit info-book flags authoritative instead of re-annotating rows', () => {
    const history = [
      ...Array.from({ length: 60 }, (_, index) => pull(index + 1, { is_info_book: false })),
      ...Array.from({ length: 10 }, (_, index) => pull(index + 61, { pool_id: 'limited-b', is_info_book: false })),
    ];
    const projection = project(history);
    expect(projection.session.infoBooks['limited-a']).toMatchObject({ targetPoolId: 'limited-b', used: false });
    expect(projection.histories['limited-b'].every((record) => record.kind === 'paid')).toBe(true);
  });

  it('passes limited-weapon metadata so the core adjusts weapon gifts', () => {
    const weaponPools = [
      {
        id: 'weapon-limited',
        type: 'weapon',
        up_character: '限定武器',
        is_limited_weapon: true,
        start_time: '2026-01-01',
      },
      { id: 'weapon-standard', type: 'weapon', up_character: null, is_limited_weapon: false, start_time: '2026-01-01' },
    ];
    const history = [
      ...Array.from({ length: 100 }, (_, index) => pull(index + 1, { pool_id: 'weapon-limited' })),
      ...Array.from({ length: 100 }, (_, index) => pull(index + 101, { pool_id: 'weapon-standard' })),
    ];
    const projection = project(history, weaponPools);
    expect(projection.session.pools['weapon-standard'].giftsReceived).toBe(0);
    expect(projection.session.pools['weapon-limited'].giftsReceived).toBeGreaterThan(0);
  });

  it('isolates both the owner and the server for identical UIDs', () => {
    const projection = project([pull(1), pull(2, { server_scope: '3' }), pull(3, { user_id: 'user-2' })]);
    expect(projection.histories['limited-a']).toHaveLength(1);
    expect(projection.session.ledger.characterPulls).toBe(1);
    expect(projection.histories['limited-a'][0].eventId).toContain(ACCOUNT);
  });

  it('keeps unresolved catalog history available without inventing simulator rules', () => {
    const projection = project([pull(1, { pool_id: 'unknown' })], [{ id: 'unknown', type: 'unknown' }]);
    expect(projection.histories.unknown).toHaveLength(1);
    expect(projection.session.pools).toEqual({});
  });

  it('builds a stable signature including newly added zero-pull pools', () => {
    expect(buildSimulatorCatalogSignature({ pools })).toBe(
      buildSimulatorCatalogSignature({ pools: pools.slice().reverse() })
    );
    expect(project([]).catalogSignature).not.toBe(project([], pools.slice(0, 1)).catalogSignature);
  });

  it('preserves invalid historical rows without letting them affect valid counters or block inheritance', () => {
    const projection = project([pull(1, { rarity: 3 }), pull(2), pull(3, { timestamp: null })]);
    expect(projection.histories['limited-a']).toHaveLength(3);
    expect(projection.histories['limited-a'].some((row) => row.timestamp === null)).toBe(true);
    expect(getPoolState(projection.session, descriptor(pools[0]))).toMatchObject({
      totalPulls: 1,
      sixStarPity: 1,
      sequenceCount: 3,
    });
  });
});
