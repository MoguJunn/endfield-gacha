import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, replayHistoryEvent } from '../../../../shared/simulator/engine.js';
import { buildSimulatorDescriptors } from '../simulatorSessionView.js';
import { buildSimulatorCatalogSignature } from '../inheritanceProjection.js';

const mocks = vi.hoisted(() => ({
  userId: 'user',
  currentGameUid: 'game::server:1',
  pools: [
    { id: 'a', type: 'limited', name: 'A', up_character: 'UP', start_time: '2026-01-01' },
    { id: 'b', type: 'limited', name: 'B', up_character: 'UP', start_time: '2026-02-01' },
  ],
  history: [],
  load: vi.fn(),
  commit: vi.fn(),
  inherit: vi.fn(),
  accounts: [{ accountKey: 'game::server:1', gameUid: 'game', serverScope: '1', nickName: '账号' }],
}));
vi.mock('../../../stores/index.js', () => ({
  useAuthStore: (selector) => selector({ user: { id: mocks.userId } }),
  useHistoryStore: (selector) => selector({ history: mocks.history }),
  usePoolStore: (selector) =>
    selector({ pools: mocks.pools, currentGameUid: mocks.currentGameUid, switchGameAccount: vi.fn() }),
}));
vi.mock('../../../hooks/app/usePersonalGameAccounts.js', () => ({ usePersonalGameAccounts: () => mocks.accounts }));
vi.mock('../../../services/accountGachaDataService.js', () => ({ loadSimulatorInheritance: mocks.inherit }));
vi.mock('../simulatorRepository.js', () => ({
  loadSimulatorSession: mocks.load,
  commitSimulatorSession: mocks.commit,
}));
vi.mock('../useSimulatorSharing.js', () => ({ useSimulatorSharing: () => ({}) }));
vi.mock('../../../utils/poolRoster.js', () => ({
  resolvePoolRosterBuckets: async () => ({
    up: [{ id: 'up', name: 'UP' }],
    offBanner: [{ id: 'off', name: 'OFF' }],
    fiveStar: ['FIVE'],
    fourStar: ['FOUR'],
    items: [],
  }),
}));
vi.mock('../../../i18n/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({ t: (key) => key, locale: 'zh-CN' }),
}));
import { useGachaSimulatorController } from '../useGachaSimulatorController.js';

function makeSeed() {
  const descriptors = buildSimulatorDescriptors(mocks.pools);
  let session = createSession({ scope: 'u:user|g:game%3A%3Aserver%3A1' });
  const history = [];
  for (let i = 0; i < 40; i++) {
    const record = {
      eventId: `r${i}`,
      kind: 'paid',
      rarity: 4,
      characterName: 'FOUR',
      timestamp: i,
      sequenceIndex: i + 1,
    };
    session = replayHistoryEvent(session, record, descriptors.a);
    history.push(record);
  }
  session.currentPoolId = 'b';
  return { session, histories: { a: history } };
}

describe('simulator controller v2', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('simulator_skipAnimation', 'true');
    mocks.userId = 'user';
    mocks.history = [];
    mocks.currentGameUid = 'game::server:1';
    mocks.load.mockReset().mockResolvedValue(makeSeed());
    mocks.commit.mockReset().mockResolvedValue(undefined);
    mocks.inherit
      .mockReset()
      .mockResolvedValue({
        availability: 'ready',
        projection: {
          contractVersion: 2,
          ...makeSeed(),
          catalogSignature: buildSimulatorCatalogSignature({ pools: mocks.pools }),
        },
        meta: {},
      });
  });
  afterEach(() => vi.restoreAllMocks());
  it('uses shared progress for zero-pull pools on init, inheritance, switch and refresh', async () => {
    const { result, unmount } = renderHook(() => useGachaSimulatorController());
    await waitFor(() => expect(result.current.canAffordSinglePull).toBe(true));
    expect(result.current.pityInfoWithGuarantee.guaranteedUp.current).toBe(0);
    expect(result.current.effectivePityObj.pity6).toBe(40);
    await act(() => result.current.handleInheritRealState());
    expect(result.current.effectivePityObj.pity6).toBe(40);
    expect(mocks.commit.mock.calls[0][0].session.sharedPityState.sixStarPity).toBe(40);
    await act(() => result.current.switchPool('sim_a'));
    expect(result.current.effectivePityObj.pity6).toBe(40);
    await act(() => result.current.switchPool('sim_b'));
    expect(result.current.effectivePityObj.pity6).toBe(40);
    unmount();
    const next = renderHook(() => useGachaSimulatorController());
    await waitFor(() => expect(next.result.current.canAffordSinglePull).toBe(true));
    expect(next.result.current.effectivePityObj.pity6).toBe(40);
  });
  it('rejects stale inheritance without clearing or replacing the save', async () => {
    mocks.inherit.mockResolvedValue({ availability: 'stale', projection: { contractVersion: 2, ...makeSeed() } });
    const { result } = renderHook(() => useGachaSimulatorController());
    await waitFor(() => expect(result.current.canAffordSinglePull).toBe(true));
    await act(() => result.current.handleInheritRealState());
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(result.current.effectivePityObj.pity6).toBe(40);
    expect(result.current.toastMessage).toBe('simulator.toast.inheritBuilding');
  });
  it('inherits guest local history through the same projection without calling the authenticated API', async () => {
    mocks.userId = null;
    mocks.history = Array.from({ length: 40 }, (_, i) => ({
      id: `r${i}`,
      poolId: 'a',
      rarity: 4,
      name: 'FOUR',
      gameUid: 'game',
      serverId: '1',
      timestamp: 1700000000000 + i,
    }));
    mocks.load.mockImplementation(async () => ({
      ...makeSeed(),
      session: { ...makeSeed().session, scope: 'u:guest|g:game%3A%3Aserver%3A1' },
    }));
    const { result } = renderHook(() => useGachaSimulatorController());
    await waitFor(() => expect(result.current.canAffordSinglePull).toBe(true));
    await act(() => result.current.handleInheritRealState());
    expect(mocks.inherit).not.toHaveBeenCalled();
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(result.current.effectivePityObj.pity6).toBe(40);
  });
  it('does not show generated outcomes or updated counters when the transaction fails', async () => {
    mocks.commit.mockRejectedValue(Object.assign(new Error('failed'), { code: 'simulator_repository_write_failed' }));
    const { result } = renderHook(() => useGachaSimulatorController());
    await waitFor(() => expect(result.current.canAffordSinglePull).toBe(true));
    await act(() => result.current.handlePull('single'));
    await waitFor(() => expect(result.current.isAnimating).toBe(false));
    expect(result.current.lastResults).toBeNull();
    expect(result.current.effectivePityObj.pity6).toBe(40);
    expect(result.current.pullHistory).toEqual([]);
    expect(result.current.toastMessage).toBe('simulator.toast.saveFailed');
  });
  it('ignores a previous account inheritance response after selection changes', async () => {
    let finish;
    mocks.inherit.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const { result, rerender } = renderHook(() => useGachaSimulatorController());
    await waitFor(() => expect(result.current.canAffordSinglePull).toBe(true));
    let pending;
    act(() => {
      pending = result.current.handleInheritRealState();
    });
    mocks.currentGameUid = 'other::server:1';
    rerender();
    await waitFor(() => expect(result.current.isInheritingRealState).toBe(false));
    await act(async () => {
      finish({ availability: 'ready', projection: { contractVersion: 2, ...makeSeed() } });
      await pending;
    });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
