// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAccountGachaRecord,
  updateAccountGachaRecord,
} from '../../../services/accountGachaDataService.js';
import {
  useAuthStore,
  useHistoryPageStore,
  useHistoryStore,
  useUIStore,
} from '../../../stores/index.js';
import { createHistoryPageInitialState } from '../../../stores/useHistoryPageStore.js';
import { useHistoryOperations } from '../useHistoryOperations.js';

vi.mock('../../../services/accountGachaDataService.js', () => ({
  deleteAccountGachaRecord: vi.fn(),
  updateAccountGachaRecord: vi.fn(),
}));

function record(id = 'record-1') {
  return {
    id,
    gameUid: 'game-1',
    serverScope: 'server-1',
    poolId: 'pool-1',
    seqId: id,
    editVersion: 1,
  };
}

function setReadyPage() {
  const token = useHistoryPageStore.getState().begin({
    ownerId: 'user-1',
    scopeKey: 'scope-1',
    reset: true,
  });
  useHistoryPageStore.getState().complete(token, {
    nextCursor: null,
    hasMore: false,
    total: 1,
    revision: 'revision-1',
  });
}

function renderOperations() {
  const refreshPersonalData = vi.fn().mockResolvedValue({ ok: true });
  const showToast = vi.fn();
  const hook = renderHook(() => useHistoryOperations({
    showToast,
    cloudSync: {
      refreshPersonalData,
      saveHistoryToCloud: vi.fn(),
    },
    clearEditItemState: vi.fn(),
  }));
  return { ...hook, refreshPersonalData, showToast };
}

describe('useHistoryOperations 分页失效', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
    useHistoryPageStore.setState(createHistoryPageInitialState());
    useHistoryStore.setState({ history: [record()] });
    useUIStore.setState({ modalState: { type: null, data: null } });
    setReadyPage();
  });

  it('PATCH 成功后失效分页、清空当前记录再刷新分析', async () => {
    updateAccountGachaRecord.mockResolvedValue({});
    const { result, refreshPersonalData } = renderOperations();

    await act(async () => {
      expect(await result.current.handleUpdateItem(record(), { rarity: 6 })).toBe(true);
    });

    expect(useHistoryStore.getState().history).toEqual([]);
    expect(useHistoryPageStore.getState()).toMatchObject({
      phase: 'unloaded',
      reason: 'history_mutation',
    });
    expect(refreshPersonalData).toHaveBeenCalledWith(
      { id: 'user-1' },
      { kind: 'mutation', reason: 'history_record_mutation' }
    );
  });

  it('单条 DELETE 成功后触发相同分页失效', async () => {
    deleteAccountGachaRecord.mockResolvedValue({});
    useUIStore.setState({ modalState: { type: 'deleteItem', data: record() } });
    const { result } = renderOperations();

    await act(async () => {
      await result.current.confirmRealDeleteItem();
    });

    expect(useHistoryStore.getState().history).toEqual([]);
    expect(useHistoryPageStore.getState().reason).toBe('history_mutation');
  });

  it('批量删除只要有成功项就失效分页并刷新', async () => {
    const records = [record('record-1'), record('record-2')];
    useHistoryStore.setState({ history: records });
    useUIStore.setState({ modalState: { type: 'deleteGroup', data: records } });
    deleteAccountGachaRecord
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('second failed'));
    const { result, refreshPersonalData } = renderOperations();

    await act(async () => {
      await result.current.confirmRealDeleteGroup();
    });

    expect(useHistoryStore.getState().history).toEqual([]);
    expect(useHistoryPageStore.getState().reason).toBe('history_mutation');
    expect(refreshPersonalData).toHaveBeenCalledTimes(1);
  });

  it('mutation 请求失败时保留当前分页和记录', async () => {
    updateAccountGachaRecord.mockRejectedValue(new Error('patch failed'));
    const generation = useHistoryPageStore.getState().generation;
    const { result, refreshPersonalData } = renderOperations();

    await act(async () => {
      expect(await result.current.handleUpdateItem(record(), { rarity: 6 })).toBe(false);
    });

    expect(useHistoryStore.getState().history).toEqual([record()]);
    expect(useHistoryPageStore.getState()).toMatchObject({
      phase: 'ready',
      generation,
    });
    expect(refreshPersonalData).not.toHaveBeenCalled();
  });
});
