// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBDatabase, IDBFactory, IDBIndex, IDBObjectStore } from 'fake-indexeddb';

import { closeRepositoryForTests, commitSimulatorSession, loadSimulatorSession } from '../simulatorRepository.js';

const POOL_A = 'special_20261009';
const POOL_B = 'weapon_20261009';
const SCOPE_A = 'account:one';
const SCOPE_B = 'account:two';
let closeOtherTabs;

function makeSession(scope = SCOPE_A, revision = 0) {
  return {
    version: 2,
    scope,
    revision,
    currentPoolId: POOL_A,
    pools: { [POOL_A]: { state: { sixStarPity: 13 } } },
    sharedPityState: { sixStarPity: 13 },
    seriesStates: { reconstruction: { pulls: 40 } },
    infoBooks: { character: { purchased: 2 } },
    resourceSettings: { budget: 120 },
    ledger: { spent: 10 },
  };
}

function makeRecord(sequenceIndex, eventId = `event-${sequenceIndex}`) {
  return {
    eventId,
    sequenceIndex,
    rarity: 6,
    characterName: '测试角色',
    timestamp: '2026-10-09T10:00:00.000Z',
    kind: 'pull',
    characterId: 'character_001',
    isLimited: true,
  };
}

async function seed(scope = SCOPE_A, histories = { [POOL_A]: [makeRecord(1)] }, revision = 0) {
  return commitSimulatorSession({
    scope,
    session: makeSession(scope, revision),
    expectedRevision: null,
    replaceHistories: histories,
  });
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

beforeEach(() => {
  closeRepositoryForTests();
  vi.stubGlobal('indexedDB', new IDBFactory());
  closeOtherTabs = [];
});

afterEach(() => {
  closeOtherTabs.forEach((close) => close());
  closeRepositoryForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('simulatorRepository', () => {
  it('returns an empty snapshot for a new scope', async () => {
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual({ session: null, histories: {} });
  });

  it.each([0, 1])('allows a new session at revision %i and reloads every independent state field', async (revision) => {
    const session = makeSession(SCOPE_A, revision);
    const committed = await seed(SCOPE_A, { [POOL_A]: [makeRecord(1)] }, revision);

    expect(committed).toEqual(session);
    expect(committed).not.toBe(session);
    closeRepositoryForTests();
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual({
      session,
      histories: { [POOL_A]: [makeRecord(1)] },
    });
  });

  it('separates accounts even when pool IDs and event IDs are identical', async () => {
    await seed(SCOPE_A);
    await seed(SCOPE_B, { [POOL_A]: [{ ...makeRecord(1), characterName: '另一个账号' }] });

    const first = await loadSimulatorSession(SCOPE_A);
    const second = await loadSimulatorSession(SCOPE_B);
    expect(first.session.scope).toBe(SCOPE_A);
    expect(second.session.scope).toBe(SCOPE_B);
    expect(first.histories[POOL_A][0].characterName).toBe('测试角色');
    expect(second.histories[POOL_A][0].characterName).toBe('另一个账号');
    await expect(loadSimulatorSession('anonymous')).resolves.toEqual({ session: null, histories: {} });
  });

  it('loads all real pool IDs and sorts records by sequence rather than event ID', async () => {
    const earlier = makeRecord(1, 'z-event');
    const later = makeRecord(2, 'a-event');
    await seed(SCOPE_A, { [POOL_A]: [later, earlier], [POOL_B]: [makeRecord(3)] });

    expect((await loadSimulatorSession(SCOPE_A)).histories).toEqual({
      [POOL_A]: [earlier, later],
      [POOL_B]: [makeRecord(3)],
    });
  });

  it('copies caller data before opening storage and isolates returned snapshots', async () => {
    const session = makeSession();
    const record = makeRecord(1);
    const originalSession = structuredClone(session);
    const originalRecord = structuredClone(record);
    const pending = commitSimulatorSession({
      scope: SCOPE_A,
      session,
      expectedRevision: null,
      appendEvents: [{ poolId: POOL_A, record }],
    });
    session.pools[POOL_A].state.sixStarPity = 99;
    record.characterName = '调用者修改';
    const committed = await pending;
    expect(committed).toEqual(originalSession);
    committed.ledger.spent = 900;

    const loaded = await loadSimulatorSession(SCOPE_A);
    expect(loaded).toEqual({ session: originalSession, histories: { [POOL_A]: [originalRecord] } });
    loaded.session.resourceSettings.budget = 1;
    loaded.histories[POOL_A][0].characterName = '返回值修改';
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual({
      session: originalSession,
      histories: { [POOL_A]: [originalRecord] },
    });
  });

  it('accepts frozen JSON inputs without changing them', async () => {
    const session = deepFreeze(makeSession());
    const replacements = deepFreeze({ [POOL_A]: [makeRecord(1)] });
    const events = deepFreeze([{ poolId: POOL_B, record: makeRecord(2) }]);
    await commitSimulatorSession({
      scope: SCOPE_A,
      session,
      expectedRevision: null,
      replaceHistories: replacements,
      appendEvents: events,
    });

    expect(session).toEqual(makeSession());
    expect(replacements).toEqual({ [POOL_A]: [makeRecord(1)] });
    expect(events).toEqual([{ poolId: POOL_B, record: makeRecord(2) }]);
  });

  it('allows only one concurrent tab to commit the same expected revision', async () => {
    await seed();
    // A second module instance has its own cached connection, like another tab.
    vi.resetModules();
    const otherTab = await import('../simulatorRepository.js');
    closeOtherTabs.push(otherTab.closeRepositoryForTests);
    const left = { ...makeSession(SCOPE_A, 1), marker: 'left' };
    const right = { ...makeSession(SCOPE_A, 1), marker: 'right' };
    const results = await Promise.allSettled([
      commitSimulatorSession({
        scope: SCOPE_A,
        session: left,
        expectedRevision: 0,
        appendEvents: [{ poolId: POOL_A, record: makeRecord(2, 'left') }],
      }),
      otherTab.commitSimulatorSession({
        scope: SCOPE_A,
        session: right,
        expectedRevision: 0,
        appendEvents: [{ poolId: POOL_A, record: makeRecord(2, 'right') }],
      }),
    ]);

    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].reason.code).toBe('simulator_revision_conflict');
    const loaded = await loadSimulatorSession(SCOPE_A);
    expect(loaded.session).toEqual(winners[0].value);
    expect(loaded.histories[POOL_A].map((record) => record.eventId)).toEqual(['event-1', loaded.session.marker]);
  });

  it('rejects a stale revision without writing its session or appended history', async () => {
    await seed(SCOPE_A, undefined, 1);
    const before = await loadSimulatorSession(SCOPE_A);
    await expect(
      commitSimulatorSession({
        scope: SCOPE_A,
        session: makeSession(SCOPE_A, 1),
        expectedRevision: 0,
        appendEvents: [{ poolId: POOL_A, record: makeRecord(2) }],
      })
    ).rejects.toMatchObject({ code: 'simulator_revision_conflict' });
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual(before);
  });

  it('compares missing sessions too, so concurrent creation has one winner', async () => {
    const results = await Promise.allSettled([seed(SCOPE_A), seed(SCOPE_A)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.code).toBe('simulator_revision_conflict');
    expect((await loadSimulatorSession(SCOPE_A)).histories[POOL_A]).toHaveLength(1);
  });

  it.each([
    { expectedRevision: 0, revision: 0 },
    { expectedRevision: 0, revision: 2 },
    { expectedRevision: null, revision: -1 },
    { expectedRevision: null, revision: 2 },
    { expectedRevision: -1, revision: 0 },
  ])('rejects invalid revision transitions: $expectedRevision -> $revision', async ({ expectedRevision, revision }) => {
    await expect(
      commitSimulatorSession({
        scope: SCOPE_A,
        session: makeSession(SCOPE_A, revision),
        expectedRevision,
      })
    ).rejects.toMatchObject({ code: 'simulator_revision_conflict' });
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual({ session: null, histories: {} });
  });

  it('rolls back the session and every append when a later add request fails', async () => {
    await seed();
    const before = await loadSimulatorSession(SCOPE_A);
    await expect(
      commitSimulatorSession({
        scope: SCOPE_A,
        session: makeSession(SCOPE_A, 1),
        expectedRevision: 0,
        appendEvents: [
          { poolId: POOL_A, record: makeRecord(2) },
          { poolId: POOL_A, record: makeRecord(1) },
          { poolId: POOL_B, record: makeRecord(3) },
        ],
      })
    ).rejects.toMatchObject({ code: 'simulator_repository_write_failed' });
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual(before);
  });

  it('rolls back queued writes when a native add call throws synchronously', async () => {
    await seed();
    const before = await loadSimulatorSession(SCOPE_A);
    await expect(
      commitSimulatorSession({
        scope: SCOPE_A,
        session: makeSession(SCOPE_A, 1),
        expectedRevision: 0,
        appendEvents: [
          { poolId: POOL_A, record: makeRecord(2) },
          { poolId: POOL_A, record: { ...makeRecord(3), eventId: null } },
        ],
      })
    ).rejects.toMatchObject({ code: 'simulator_repository_write_failed' });
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual(before);
  });

  it('atomically replaces only the chosen scope and appends to its new history', async () => {
    await seed(SCOPE_A, { [POOL_A]: [makeRecord(1)], [POOL_B]: [makeRecord(2)] });
    await seed(SCOPE_B);
    const otherAccount = await loadSimulatorSession(SCOPE_B);
    await commitSimulatorSession({
      scope: SCOPE_A,
      session: { ...makeSession(SCOPE_A, 1), currentPoolId: POOL_B },
      expectedRevision: 0,
      replaceHistories: { [POOL_B]: [makeRecord(5)] },
      appendEvents: [{ poolId: POOL_B, record: makeRecord(6) }],
    });

    expect((await loadSimulatorSession(SCOPE_A)).histories).toEqual({ [POOL_B]: [makeRecord(5), makeRecord(6)] });
    await expect(loadSimulatorSession(SCOPE_B)).resolves.toEqual(otherAccount);
  });

  it('clears history with an empty replacement without deleting the database or other accounts', async () => {
    await seed(SCOPE_A);
    await seed(SCOPE_B);
    const otherAccount = await loadSimulatorSession(SCOPE_B);
    const deleteDatabase = vi.spyOn(globalThis.indexedDB, 'deleteDatabase');
    await commitSimulatorSession({
      scope: SCOPE_A,
      session: makeSession(SCOPE_A, 1),
      expectedRevision: 0,
      replaceHistories: {},
    });

    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual({ session: makeSession(SCOPE_A, 1), histories: {} });
    await expect(loadSimulatorSession(SCOPE_B)).resolves.toEqual(otherAccount);
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it.each(['replacement', 'append'])('restores deleted history when a later %s request fails', async (failureAt) => {
    await seed(SCOPE_A, { [POOL_A]: [makeRecord(1)], [POOL_B]: [makeRecord(2)] });
    await seed(SCOPE_B);
    const before = await loadSimulatorSession(SCOPE_A);
    const otherAccount = await loadSimulatorSession(SCOPE_B);
    const replacement = makeRecord(5);
    await expect(
      commitSimulatorSession({
        scope: SCOPE_A,
        session: makeSession(SCOPE_A, 1),
        expectedRevision: 0,
        replaceHistories: { [POOL_B]: failureAt === 'replacement' ? [replacement, replacement] : [replacement] },
        appendEvents: failureAt === 'append' ? [{ poolId: POOL_B, record: replacement }] : [],
      })
    ).rejects.toMatchObject({ code: 'simulator_repository_write_failed' });

    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual(before);
    await expect(loadSimulatorSession(SCOPE_B)).resolves.toEqual(otherAccount);
  });

  it('does not read or scan history during an ordinary append', async () => {
    await seed();
    const indexReads = ['get', 'getAll', 'openCursor', 'openKeyCursor'].map((name) =>
      vi.spyOn(IDBIndex.prototype, name)
    );
    const storeScans = ['getAll', 'openCursor', 'openKeyCursor'].map((name) =>
      vi.spyOn(IDBObjectStore.prototype, name)
    );
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    await commitSimulatorSession({
      scope: SCOPE_A,
      session: makeSession(SCOPE_A, 1),
      expectedRevision: 0,
      appendEvents: [{ poolId: POOL_A, record: makeRecord(2) }],
    });

    [...indexReads, ...storeScans].forEach((read) => expect(read).not.toHaveBeenCalled());
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.instances[0].name).toBe('sessions');
  });

  it('reports unavailable IndexedDB even with a cached connection and never falls back to localStorage', async () => {
    await seed();
    const localWrite = vi.spyOn(globalThis.localStorage, 'setItem');
    vi.stubGlobal('indexedDB', undefined);
    await expect(loadSimulatorSession(SCOPE_A)).rejects.toMatchObject({ code: 'simulator_indexeddb_unavailable' });
    await expect(
      commitSimulatorSession({
        scope: SCOPE_A,
        session: makeSession(SCOPE_A, 1),
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: 'simulator_indexeddb_unavailable' });
    expect(localWrite).not.toHaveBeenCalled();
  });

  it('reports native read errors and leaves the persisted snapshot intact', async () => {
    await seed();
    const before = await loadSimulatorSession(SCOPE_A);
    const get = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
      throw new DOMException('Read blocked', 'SecurityError');
    });
    await expect(loadSimulatorSession(SCOPE_A)).rejects.toMatchObject({ code: 'simulator_repository_read_failed' });
    get.mockRestore();
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual(before);
  });

  it('reports asynchronous read transaction aborts instead of returning partial data', async () => {
    await seed();
    const get = IDBObjectStore.prototype.get;
    const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(function (key) {
      const request = get.call(this, key);
      // Abort through a native listener independently of the repository handler.
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    });
    await expect(loadSimulatorSession(SCOPE_A)).rejects.toMatchObject({ code: 'simulator_repository_read_failed' });
    read.mockRestore();
    expect((await loadSimulatorSession(SCOPE_A)).session.revision).toBe(0);
  });

  it('reports failures to create a read transaction', async () => {
    await seed();
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
      throw new DOMException('Connection closed', 'InvalidStateError');
    });
    await expect(loadSimulatorSession(SCOPE_A)).rejects.toMatchObject({ code: 'simulator_repository_read_failed' });
  });

  it('reports opening errors and can retry with an available factory', async () => {
    const factory = globalThis.indexedDB;
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('Open denied', 'SecurityError');
      },
    });
    await expect(loadSimulatorSession(SCOPE_A)).rejects.toMatchObject({ code: 'simulator_repository_open_failed' });
    vi.stubGlobal('indexedDB', factory);
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual({ session: null, histories: {} });
  });

  it('rejects non-cloneable input without updating the session', async () => {
    await seed();
    const before = await loadSimulatorSession(SCOPE_A);
    await expect(
      commitSimulatorSession({
        scope: SCOPE_A,
        session: { ...makeSession(SCOPE_A, 1), invalid: () => {} },
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: 'simulator_repository_write_failed' });
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual(before);
  });

  it('does not validate business state beyond the version, scope and revision envelope', async () => {
    const session = { version: 2, scope: SCOPE_A, revision: 0, extraState: { custom: [1, 2] } };
    await expect(commitSimulatorSession({ scope: SCOPE_A, session, expectedRevision: null })).resolves.toEqual(session);
    await expect(loadSimulatorSession(SCOPE_A)).resolves.toEqual({ session, histories: {} });
  });
});
