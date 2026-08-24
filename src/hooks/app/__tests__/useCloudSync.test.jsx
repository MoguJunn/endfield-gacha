// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCloudSync } from '../useCloudSync.js';
import {
  loadAccountGachaAnalysis,
  loadAccountGachaData,
} from '../../../services/accountGachaDataService.js';
import {
  loadAllPoolsForCatalog,
  loadVisiblePools,
} from '../../../services/poolReadService.js';
import {
  usePersonalDataStore,
  usePersonalAnalysisStore,
  useAuthStore,
  usePoolStore,
} from '../../../stores/index.js';
import { createPersonalDataInitialState } from '../../../stores/usePersonalDataStore.js';
import { createPersonalAnalysisInitialState } from '../../../stores/usePersonalAnalysisStore.js';

vi.mock('../../../services/bootstrapService.js', () => ({
  getBootstrapVisiblePools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/poolReadService.js', () => ({
  loadAllPoolsForCatalog: vi.fn(),
  loadVisiblePools: vi.fn(),
  mergePoolCollections: vi.fn((primary, fallback) => [...primary, ...fallback]),
}));

vi.mock('../../../services/accountGachaDataService.js', () => ({
  deleteAccountGachaPool: vi.fn(),
  deleteAccountGachaPoolHistory: vi.fn(),
  deleteAccountGachaRecords: vi.fn(),
  deleteAllAccountGachaData: vi.fn(),
  loadAccountGachaAnalysis: vi.fn(),
  loadAccountGachaData: vi.fn(),
  saveAccountGachaData: vi.fn(),
}));

describe('useCloudSync.loadCloudData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, authResolved: true });
    usePersonalDataStore.setState(createPersonalDataInitialState());
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState());
    usePoolStore.setState({
      pools: [],
      currentPoolId: null,
      currentGameUid: 'account-current',
    });
    loadVisiblePools.mockResolvedValue([{ id: 'visible-pool', name: 'Visible' }]);
    loadAllPoolsForCatalog.mockResolvedValue([{ id: 'catalog-pool', name: 'Catalog' }]);
    loadAccountGachaAnalysis.mockResolvedValue({
      availability: 'ready',
      schemaVersion: 1,
      owner: { defaultAccountKey: 'account-current' },
      scope: {
        account: { accountKey: 'account-current' },
        poolManifest: [{ id: 'snapshot-pool', name: 'Snapshot' }],
        selector: { poolPullCounts: { 'snapshot-pool': 1 } },
      },
      source: 'site-session',
      meta: { ownerId: 'user-1', accountKey: 'account-current' },
      warnings: [],
    });
  });

  it('初始化读取 analysis 并合并 poolManifest，不调用旧 records 读取', async () => {
    const { result } = renderHook(() => useCloudSync({ showToast: vi.fn() }));

    const snapshot = await result.current.loadCloudData({ id: 'user-1' });

    expect(loadAccountGachaAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      accountKey: 'account-current',
      viewKey: '__group_all',
    }));
    expect(loadAccountGachaData).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      kind: 'analysis',
      ownerId: 'user-1',
      analysis: { availability: 'ready' },
    });
    expect(snapshot).not.toHaveProperty('history');
    expect(snapshot.pools.map((pool) => pool.id)).toEqual([
      'snapshot-pool',
      'visible-pool',
    ]);
    expect(loadAllPoolsForCatalog).not.toHaveBeenCalled();
  });

  it('旧本地账号不存在时不带 accountKey 重试一次并恢复默认分析', async () => {
    const notFoundError = Object.assign(new Error('account not found'), {
      code: 'personal_analysis_account_not_found',
    });
    loadAccountGachaAnalysis
      .mockRejectedValueOnce(notFoundError)
      .mockResolvedValueOnce({
        availability: 'ready',
        schemaVersion: 1,
        owner: { defaultAccountKey: 'account-default' },
        scope: {
          account: { accountKey: 'account-default' },
          poolManifest: [],
        },
        source: 'site-session',
        meta: { ownerId: 'user-1', accountKey: 'account-default' },
        warnings: [],
      });
    const { result } = renderHook(() => useCloudSync({ showToast: vi.fn() }));

    const snapshot = await result.current.loadCloudData({ id: 'user-1' }, {
      preferredGameUid: 'account-removed',
    });

    expect(loadAccountGachaAnalysis).toHaveBeenNthCalledWith(1, expect.objectContaining({
      accountKey: 'account-removed',
      viewKey: '__group_all',
    }));
    expect(loadAccountGachaAnalysis).toHaveBeenNthCalledWith(2, expect.objectContaining({
      viewKey: '__group_all',
    }));
    expect(snapshot.analysis.meta.accountKey).toBe('account-default');
  });

  it('当前选择与分析账号不同时自动刷新对应账号且不重复', async () => {
    useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
    usePersonalDataStore.getState().switchOwner('user-1');
    usePersonalDataStore.setState({ phase: 'ready', hasSnapshot: true });
    usePersonalAnalysisStore.setState({
      ownerId: 'user-1',
      availability: 'ready',
      scope: { account: { accountKey: 'account-old' } },
      meta: { ownerId: 'user-1', accountKey: 'account-old' },
    });
    usePoolStore.setState({ currentGameUid: 'account-new' });
    loadAccountGachaAnalysis.mockResolvedValue({
      availability: 'ready',
      schemaVersion: 1,
      owner: { defaultAccountKey: 'account-new' },
      scope: {
        account: {
          accountKey: 'account-new',
          gameUid: 'game-new',
          serverScope: 'server-new',
          region: 'cn',
        },
        poolManifest: [],
      },
      source: 'site-session',
      meta: { ownerId: 'user-1', accountKey: 'account-new' },
      warnings: [],
    });

    renderHook(() => useCloudSync({ showToast: vi.fn() }));

    await waitFor(() => {
      expect(loadAccountGachaAnalysis).toHaveBeenCalledWith(expect.objectContaining({
        accountKey: 'account-new',
        viewKey: '__group_all',
      }));
      expect(usePersonalAnalysisStore.getState().meta?.accountKey).toBe('account-new');
    });
    expect(loadAccountGachaAnalysis).toHaveBeenCalledTimes(1);
  });

  it('analysis building 时不重复触发账号 scope 刷新', async () => {
    useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
    usePersonalDataStore.getState().switchOwner('user-1');
    usePersonalDataStore.setState({ phase: 'ready', hasSnapshot: true });
    usePersonalAnalysisStore.setState({
      ownerId: 'user-1',
      availability: 'building',
      scope: null,
      meta: { ownerId: 'user-1', accountKey: 'account-old' },
    });
    usePoolStore.setState({ currentGameUid: 'account-new' });

    renderHook(() => useCloudSync({ showToast: vi.fn() }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loadAccountGachaAnalysis).not.toHaveBeenCalled();
  });

  it('切换卡池时只请求新卡池对应的分析 view', async () => {
    useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
    usePersonalDataStore.getState().switchOwner('user-1');
    usePersonalDataStore.setState({ phase: 'ready', hasSnapshot: true });
    usePersonalAnalysisStore.setState({
      ownerId: 'user-1',
      availability: 'ready',
      scope: {
        account: { accountKey: 'account-current' },
        dashboard: { views: { 'pool-old': { total: 1 } } },
      },
      meta: { ownerId: 'user-1', accountKey: 'account-current' },
    });
    usePoolStore.setState({
      currentGameUid: 'account-current',
      currentPoolId: 'pool-old',
    });
    loadAccountGachaAnalysis.mockResolvedValue({
      availability: 'ready',
      schemaVersion: 1,
      owner: { defaultAccountKey: 'account-current' },
      scope: {
        account: { accountKey: 'account-current' },
        poolManifest: [],
        dashboard: { views: { 'pool-new': { total: 2 } } },
      },
      source: 'site-session',
      meta: { ownerId: 'user-1', accountKey: 'account-current' },
      warnings: [],
    });

    renderHook(() => useCloudSync({ showToast: vi.fn() }));
    expect(loadAccountGachaAnalysis).not.toHaveBeenCalled();

    act(() => {
      usePoolStore.setState({ currentPoolId: 'pool-new' });
    });

    await waitFor(() => {
      expect(loadAccountGachaAnalysis).toHaveBeenCalledWith(expect.objectContaining({
        accountKey: 'account-current',
        viewKey: 'pool-new',
      }));
    });
    expect(loadAccountGachaAnalysis).toHaveBeenCalledTimes(1);
  });

  it('快速 B 到 C 切换不会把 C 合并进 B 的在途请求', async () => {
    useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
    usePersonalDataStore.getState().switchOwner('user-1');
    usePersonalDataStore.setState({ phase: 'ready', hasSnapshot: true });
    usePersonalAnalysisStore.setState({
      ownerId: 'user-1',
      availability: 'ready',
      scope: { account: { accountKey: 'account-a' } },
      meta: { ownerId: 'user-1', accountKey: 'account-a' },
    });
    usePoolStore.setState({ currentGameUid: 'account-a' });

    let resolveAccountB;
    const accountBPromise = new Promise((resolve) => {
      resolveAccountB = resolve;
    });
    const analysisFor = (accountKey) => ({
      availability: 'ready',
      schemaVersion: 1,
      owner: { defaultAccountKey: accountKey },
      scope: {
        account: { accountKey, gameUid: accountKey, serverScope: '1', region: 'cn' },
        poolManifest: [],
        selector: { poolPullCounts: {} },
      },
      source: 'site-session',
      meta: { ownerId: 'user-1', accountKey },
      warnings: [],
    });
    loadAccountGachaAnalysis.mockImplementation(({ accountKey }) => {
      if (accountKey === 'account-b') return accountBPromise;
      return Promise.resolve(analysisFor(accountKey));
    });

    renderHook(() => useCloudSync({ showToast: vi.fn() }));

    act(() => {
      usePoolStore.setState({ currentGameUid: 'account-b' });
    });
    await waitFor(() => {
      expect(loadAccountGachaAnalysis).toHaveBeenCalledWith(expect.objectContaining({
        accountKey: 'account-b',
        viewKey: '__group_all',
      }));
    });

    act(() => {
      usePoolStore.setState({ currentGameUid: 'account-c' });
    });
    await waitFor(() => {
      expect(loadAccountGachaAnalysis).toHaveBeenCalledWith(expect.objectContaining({
        accountKey: 'account-c',
        viewKey: '__group_all',
      }));
      expect(usePersonalAnalysisStore.getState().meta?.accountKey).toBe('account-c');
    });

    await act(async () => {
      resolveAccountB(analysisFor('account-b'));
      await accountBPromise;
    });
    expect(usePersonalAnalysisStore.getState().meta?.accountKey).toBe('account-c');
  });
});
