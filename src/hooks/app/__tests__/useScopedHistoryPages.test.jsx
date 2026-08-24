// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAccountGachaHistoryPage } from '../../../services/accountGachaDataService.js';
import {
  useAuthStore,
  useHistoryPageStore,
  useHistoryStore,
  usePersonalAnalysisStore,
  usePoolStore,
} from '../../../stores/index.js';
import { createHistoryPageInitialState } from '../../../stores/useHistoryPageStore.js';
import { createPersonalAnalysisInitialState } from '../../../stores/usePersonalAnalysisStore.js';
import { useScopedHistoryPages } from '../useScopedHistoryPages.js';

vi.mock('../../../services/accountGachaDataService.js', () => ({
  loadAccountGachaHistoryPage: vi.fn(),
}));

function account(accountKey = 'account-1', gameUid = 'game-1') {
  return {
    accountKey,
    gameUid,
    serverScope: 'server-1',
    region: 'cn',
  };
}

function record(id, overrides = {}) {
  return {
    id,
    gameUid: 'game-1',
    serverScope: 'server-1',
    poolId: 'pool-1',
    seqId: id,
    ...overrides,
  };
}

function pageResponse(records, overrides = {}) {
  return {
    records,
    page: {
      nextCursor: null,
      hasMore: false,
      total: records.length,
      revision: 'revision-1',
      ...overrides.page,
    },
    meta: { ownerId: 'user-1', ...overrides.meta },
  };
}

function setAnalysisAccount(nextAccount) {
  usePersonalAnalysisStore.setState({
    ownerId: 'user-1',
    availability: nextAccount ? 'ready' : 'empty',
    scope: nextAccount ? { account: nextAccount } : null,
    meta: nextAccount ? { ownerId: 'user-1', accountKey: nextAccount.accountKey } : { ownerId: 'user-1' },
  });
}

describe('useScopedHistoryPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
    useHistoryStore.setState({ history: [] });
    useHistoryPageStore.setState(createHistoryPageInitialState());
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState());
    usePoolStore.setState({ currentGameUid: 'account-1' });
    setAnalysisAccount(account());
  });

  it('首次加载账号第一页且不传 poolId', async () => {
    loadAccountGachaHistoryPage.mockResolvedValueOnce(pageResponse(
      [record('record-1')],
      { page: { total: null } }
    ));

    const { result } = renderHook(() => useScopedHistoryPages());

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(loadAccountGachaHistoryPage).toHaveBeenCalledWith({
      accountKey: 'account-1',
      gameUid: 'game-1',
      serverScope: 'server-1',
      region: 'cn',
      cursor: '',
      limit: 100,
    });
    expect(loadAccountGachaHistoryPage.mock.calls[0][0]).not.toHaveProperty('poolId');
    expect(useHistoryStore.getState().history.map((item) => item.id)).toEqual(['record-1']);
    expect(result.current.total).toBeNull();
  });

  it('按按钮加载下一页并按复合键去重、保持返回顺序', async () => {
    loadAccountGachaHistoryPage
      .mockResolvedValueOnce(pageResponse([record('record-1'), record('record-2')], {
        page: { nextCursor: 'cursor-2', hasMore: true, total: 4 },
      }))
      .mockResolvedValueOnce(pageResponse([record('record-2'), record('record-3')], {
        page: { nextCursor: null, hasMore: false, total: 4 },
      }));
    const { result } = renderHook(() => useScopedHistoryPages());
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(loadAccountGachaHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: 'cursor-2',
    }));
    expect(useHistoryStore.getState().history.map((item) => item.id)).toEqual([
      'record-1',
      'record-2',
      'record-3',
    ]);
  });

  it('卡池筛选变化时按 poolId 重置并读取目标池第一页', async () => {
    loadAccountGachaHistoryPage
      .mockResolvedValueOnce(pageResponse([record('pool-a-record', { poolId: 'pool-a' })]))
      .mockResolvedValueOnce(pageResponse([record('pool-b-record', { poolId: 'pool-b' })]));
    const { result, rerender } = renderHook(
      ({ poolId }) => useScopedHistoryPages({ poolId }),
      { initialProps: { poolId: 'pool-a' } }
    );

    await waitFor(() => expect(useHistoryStore.getState().history[0]?.id).toBe('pool-a-record'));
    expect(loadAccountGachaHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({
      poolId: 'pool-a',
      cursor: '',
    }));

    rerender({ poolId: 'pool-b' });

    await waitFor(() => expect(useHistoryStore.getState().history[0]?.id).toBe('pool-b-record'));
    expect(loadAccountGachaHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({
      poolId: 'pool-b',
      cursor: '',
    }));
    expect(result.current.phase).toBe('ready');
  });

  it('账号 scope 切换时清空旧记录并加载新账号第一页', async () => {
    loadAccountGachaHistoryPage
      .mockResolvedValueOnce(pageResponse([record('old-record')]))
      .mockResolvedValueOnce(pageResponse([
        record('new-record', {
          gameUid: 'game-2',
          serverScope: 'server-2',
        }),
      ]));
    const { result } = renderHook(() => useScopedHistoryPages());
    await waitFor(() => expect(useHistoryStore.getState().history[0]?.id).toBe('old-record'));

    act(() => {
      usePoolStore.setState({ currentGameUid: 'account-2' });
      setAnalysisAccount({
        accountKey: 'account-2',
        gameUid: 'game-2',
        serverScope: 'server-2',
        region: 'intl',
      });
    });

    await waitFor(() => expect(useHistoryStore.getState().history[0]?.id).toBe('new-record'));
    expect(loadAccountGachaHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({
      accountKey: 'account-2',
      gameUid: 'game-2',
      serverScope: 'server-2',
      region: 'intl',
      cursor: '',
    }));
    expect(result.current.phase).toBe('ready');
  });

  it('区服修正后旧 accountKey 仍按同 UID 的权威 scope 加载日志', async () => {
    usePoolStore.setState({ currentGameUid: 'game-1::server:1' });
    setAnalysisAccount({
      accountKey: 'game-1::server:2',
      gameUid: 'game-1',
      serverScope: '2',
      region: 'intl',
    });
    loadAccountGachaHistoryPage.mockResolvedValueOnce(pageResponse([
      record('corrected-record', { serverScope: '2' }),
    ]));

    const { result } = renderHook(() => useScopedHistoryPages());

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(loadAccountGachaHistoryPage).toHaveBeenCalledWith(expect.objectContaining({
      accountKey: 'game-1::server:2',
      gameUid: 'game-1',
      serverScope: '2',
      region: 'intl',
    }));
    expect(useHistoryStore.getState().history).toEqual([
      expect.objectContaining({ id: 'corrected-record', serverScope: '2' }),
    ]);
  });

  it('revision 冲突时清空并只自动重启一次第一页', async () => {
    const revisionError = Object.assign(new Error('history changed'), {
      code: 'history_revision_changed',
    });
    loadAccountGachaHistoryPage
      .mockResolvedValueOnce(pageResponse([record('old-1')], {
        page: { nextCursor: 'old-cursor', hasMore: true, total: 2 },
      }))
      .mockRejectedValueOnce(revisionError)
      .mockResolvedValueOnce(pageResponse([record('fresh-1')]));
    const { result } = renderHook(() => useScopedHistoryPages());
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(loadAccountGachaHistoryPage).toHaveBeenCalledTimes(3);
    expect(loadAccountGachaHistoryPage.mock.calls[2][0]).toMatchObject({ cursor: '' });
    expect(useHistoryStore.getState().history.map((item) => item.id)).toEqual(['fresh-1']);
    expect(result.current.phase).toBe('ready');
  });

  it('分页 generation 被 mutation 失效后自动重载第一页', async () => {
    loadAccountGachaHistoryPage
      .mockResolvedValueOnce(pageResponse([record('before-mutation')]))
      .mockResolvedValueOnce(pageResponse([record('after-mutation')]));
    const { result } = renderHook(() => useScopedHistoryPages());
    await waitFor(() => expect(useHistoryStore.getState().history[0]?.id).toBe('before-mutation'));

    act(() => {
      useHistoryPageStore.getState().invalidate('history_mutation');
      useHistoryStore.getState().setHistory([]);
    });

    await waitFor(() => expect(useHistoryStore.getState().history[0]?.id).toBe('after-mutation'));
    expect(loadAccountGachaHistoryPage).toHaveBeenCalledTimes(2);
    expect(loadAccountGachaHistoryPage.mock.calls[1][0]).toMatchObject({ cursor: '' });
    expect(result.current.phase).toBe('ready');
  });

  it('empty analysis 不发记录请求并进入 total 0 的 ready', async () => {
    setAnalysisAccount(null);
    const { result } = renderHook(() => useScopedHistoryPages());

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.total).toBe(0);
    expect(loadAccountGachaHistoryPage).not.toHaveBeenCalled();
  });
});
