// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthenticatedSessionSync } from '../useAuthenticatedSessionSync.js';
import {
  useAuthStore,
  useHistoryStore,
  usePersonalAnalysisStore,
  usePersonalDataStore,
  usePoolStore,
} from '../../../stores';
import { createPersonalDataInitialState } from '../../../stores/usePersonalDataStore.js';
import { createPersonalAnalysisInitialState } from '../../../stores/usePersonalAnalysisStore.js';

vi.mock('../../../utils/appLogger.js', () => ({
  default: {
    warn: vi.fn(),
  },
}));

describe('useAuthenticatedSessionSync', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({
      user: null,
      userRole: null,
      authResolved: false,
      syncing: false,
      syncError: null,
      lastSyncAt: null,
    });
    usePoolStore.setState({
      pools: [],
      currentPoolId: 'limited_pool',
      currentGameUid: 'game-1',
    });
    useHistoryStore.setState({
      history: [],
    });
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState());
    usePersonalDataStore.setState(createPersonalDataInitialState());
  });

  it('同 owner 已有成功快照时 SIGNED_IN 恢复不读取个人数据', async () => {
    usePersonalDataStore.getState().switchOwner('user-1');
    usePersonalDataStore.setState({
      phase: 'ready',
      hasSnapshot: true,
      lastSuccessfulAt: '2026-08-17T00:00:00.000Z',
    });
    useHistoryStore.setState({ history: [{ id: 'existing-record' }] });
    const refreshPersonalData = vi.fn();
    const onUpdateLastSeen = vi.fn();
    const { result } = renderHook(() => useAuthenticatedSessionSync({
      refreshPersonalData,
      onUpdateLastSeen,
    }));

    let syncResult;
    await act(async () => {
      syncResult = await result.current.applyAuthenticatedSession({
        id: 'user-1',
        email: 'user@example.com',
      }, {
        event: 'SIGNED_IN',
        source: 'supabase_auth_change',
      });
    });

    expect(syncResult).toMatchObject({ ok: true, skipped: true, applied: false });
    expect(refreshPersonalData).not.toHaveBeenCalled();
    expect(onUpdateLastSeen).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().history).toEqual([{ id: 'existing-record' }]);
    expect(useAuthStore.getState().user).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
    });
  });

  it('首次 SIGNED_IN 读取一次并建立 owner', async () => {
    const publicPools = [{ id: 'public-pool' }];
    usePersonalDataStore.getState().setPublicPools(publicPools);
    useHistoryStore.setState({ history: [{ id: 'old-anonymous-record' }] });
    const refreshPersonalData = vi.fn().mockResolvedValue({
      ok: true,
      data: { pools: publicPools, history: [] },
      error: null,
      stale: false,
      applied: true,
    });
    const onUpdateLastSeen = vi.fn();
    const { result } = renderHook(() => useAuthenticatedSessionSync({
      refreshPersonalData,
      onUpdateLastSeen,
    }));

    await act(async () => {
      await result.current.applyAuthenticatedSession({ id: 'user-1' }, {
        event: 'SIGNED_IN',
        source: 'supabase_auth_change',
      });
    });

    expect(refreshPersonalData).toHaveBeenCalledTimes(1);
    expect(refreshPersonalData).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({
        kind: 'session',
        preferredGameUid: null,
      })
    );
    expect(onUpdateLastSeen).toHaveBeenCalledTimes(1);
    expect(usePersonalDataStore.getState().ownerId).toBe('user-1');
    expect(useHistoryStore.getState().history).toEqual([]);
    expect(usePoolStore.getState().pools).toEqual(publicPools);
    expect(usePoolStore.getState().currentGameUid).toBe(null);
  });

  it('切换用户时先清除旧历史和游戏账号，再读取新 owner', async () => {
    const publicPools = [{ id: 'public-pool' }];
    usePersonalDataStore.getState().setPublicPools(publicPools);
    usePersonalDataStore.getState().switchOwner('user-a');
    usePersonalDataStore.setState({ phase: 'ready', hasSnapshot: true });
    useHistoryStore.setState({ history: [{ id: 'user-a-record' }] });
    usePoolStore.setState({
      pools: [{ id: 'user-a-private-pool' }],
      currentGameUid: 'user-a-game',
    });
    usePersonalAnalysisStore.setState({
      ...createPersonalAnalysisInitialState(),
      ownerId: 'user-a',
      availability: 'ready',
      owner: { defaultAccountKey: 'user-a-game' },
    });
    const refreshPersonalData = vi.fn().mockImplementation(async () => {
      expect(useHistoryStore.getState().history).toEqual([]);
      expect(usePoolStore.getState().pools).toEqual(publicPools);
      expect(usePoolStore.getState().currentGameUid).toBe(null);
      return {
        ok: true,
        data: { pools: publicPools, history: [] },
        error: null,
        stale: false,
        applied: true,
      };
    });
    const onUpdateLastSeen = vi.fn();
    const { result } = renderHook(() => useAuthenticatedSessionSync({
      refreshPersonalData,
      onUpdateLastSeen,
    }));

    await act(async () => {
      await result.current.applyAuthenticatedSession({ id: 'user-b' }, {
        event: 'SIGNED_IN',
        source: 'supabase_auth_change',
      });
    });

    expect(refreshPersonalData).toHaveBeenCalledTimes(1);
    expect(refreshPersonalData).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-b' }),
      expect.objectContaining({ preferredGameUid: null })
    );
    expect(onUpdateLastSeen).toHaveBeenCalledTimes(1);
    expect(usePersonalDataStore.getState()).toMatchObject({
      ownerId: 'user-b',
      phase: 'idle',
      hasSnapshot: false,
      lastSuccessfulAt: null,
    });
    expect(usePersonalAnalysisStore.getState()).toMatchObject({
      ownerId: null,
      availability: 'idle',
      owner: null,
      reason: 'owner_changed',
    });
  });
});
