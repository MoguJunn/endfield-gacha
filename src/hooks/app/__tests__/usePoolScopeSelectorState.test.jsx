// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePoolScopeSelectorState } from '../usePoolScopeSelectorState.js';
import { useAuthStore, useHistoryStore, usePoolStore } from '../../../stores/index.js';

describe('usePoolScopeSelectorState', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
    usePoolStore.setState({
      pools: [
        { id: 'pool-a', name: 'A', type: 'limited_character' },
        { id: 'pool-b', name: 'B', type: 'limited_character' },
      ],
      currentPoolId: 'pool-a',
      currentGameUid: null,
    });
    useHistoryStore.setState({
      history: [
        { id: 'a-1', user_id: 'user-1', gameUid: 'game-a', poolId: 'pool-a' },
        { id: 'a-2', user_id: 'user-1', gameUid: 'game-a', poolId: 'pool-a' },
        { id: 'b-1', user_id: 'user-1', gameUid: 'game-b', poolId: 'pool-b' },
      ],
    });
  });

  it('provides one shared account and pool-count projection', async () => {
    const { result } = renderHook(() => usePoolScopeSelectorState({
      locale: 'zh-CN',
      hideZeroPullPools: true,
    }));

    await waitFor(() => {
      expect(result.current.effectiveGameUid).toBeTruthy();
    });
    expect(result.current.filteredHistory).toHaveLength(2);
    expect(result.current.poolPullCounts['pool-a']).toBe(2);
    expect(result.current.selectorPools.map((pool) => pool.id)).toEqual(['pool-a']);
    expect(result.current.totalPulls).toBe(2);
    expect(usePoolStore.getState().currentGameUid).toBe(result.current.effectiveGameUid);
  });
});
