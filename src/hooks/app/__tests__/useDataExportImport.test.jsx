// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDataExportImport } from '../useDataExportImport.js';
import { loadAccountGachaData, loadAllAccountGachaHistoryForAccounts } from '../../../services/accountGachaDataService.js';
import { loadWorkbenchEntriesForExport, importWorkbenchEntries } from '../../../services/workbenchTransferService.js';
import { importRescueSupplements } from '../../../services/rescueImportService.js';
import {
  useAuthStore,
  useHistoryStore,
  usePersonalAnalysisStore,
  usePoolStore,
} from '../../../stores/index.js';
import { createPersonalAnalysisInitialState } from '../../../stores/usePersonalAnalysisStore.js';
import {
  buildExportContent,
  buildExportPayload,
  normalizeExportOptions,
} from '../../../utils/dataExport.js';

vi.mock('../../../services/accountGachaDataService.js', () => ({
  loadAccountGachaData: vi.fn(),
  loadAllAccountGachaHistoryForAccounts: vi.fn(),
}));
vi.mock('../../../services/dataWorkbenchService.js', () => ({ loadWorkbenchContext: vi.fn() }));
vi.mock('../../../services/rescueImportService.js', () => ({ importRescueSupplements: vi.fn().mockResolvedValue({ saved: 1 }) }));
vi.mock('../../../services/workbenchTransferService.js', () => ({
  loadWorkbenchEntriesForExport: vi.fn().mockResolvedValue([]),
  importWorkbenchEntries: vi.fn().mockResolvedValue({ saved: 1, skipped: 0 }),
}));

vi.mock('../../../utils/dataExport.js', () => ({
  normalizeExportOptions: vi.fn((options = {}, context = {}) => ({
    format: context.defaultFormat,
    poolFilter: options.poolFilter || 'all',
    poolId: options.poolId || null,
    accountFilter: options.accountFilter || 'all',
    gameUid: options.gameUid || context.currentGameUid || null,
    dateFrom: options.dateFrom || '',
    dateTo: options.dateTo || '',
  })),
  buildExportPayload: vi.fn(({ history, options }) => ({ history, options })),
  buildExportContent: vi.fn().mockResolvedValue({
    content: '{}',
    mimeType: 'application/json',
    extension: 'json',
    fileName: 'export.json',
  }),
}));

vi.mock('../../../utils/characterUtils.js', () => ({
  characterCache: {
    load: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn(() => []),
  },
}));

vi.mock('../../../supabaseClient.js', () => ({
  supabase: null,
}));

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({ locale: 'zh-CN' }),
}));

function createCloudSync() {
  return {
    savePoolToCloud: vi.fn().mockResolvedValue(true),
    saveHistoryToCloud: vi.fn(async batch => ({ saved: { history: batch.length }, skipped: { history: 0 } })),
    refreshPersonalData: vi.fn(),
  };
}

describe('useDataExportImport export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAccountGachaData.mockResolvedValue({ history: [], meta: { ownerId: 'user-1', truncated: false } });
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:export'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    usePoolStore.setState({
      pools: [{ id: 'pool-1', name: 'Pool 1' }],
      currentPoolId: 'pool-1',
      currentGameUid: 'game-1::server:1',
    });
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState());
  });

  it('loads paged analysis history on click without exporting or replacing the partial store', async () => {
    const setSyncing = vi.fn();
    const setHistory = vi.fn();
    const partialHistory = [{ id: 'partial-record', user_id: 'user-1' }];
    const exportHistory = [{ id: 'full-record', user_id: 'user-1' }];
    const matchingAccount = {
      accountKey: 'game-1::server:1',
      gameUid: 'game-1',
      serverScope: '1',
      region: 'cn',
    };
    const otherAccount = {
      accountKey: 'game-2::server:2',
      gameUid: 'game-2',
      serverScope: '2',
      region: 'intl',
    };
    useAuthStore.setState({ user: { id: 'user-1' }, setSyncing });
    useHistoryStore.setState({ history: partialHistory, setHistory });
    usePersonalAnalysisStore.setState({
      ownerId: 'user-1',
      availability: 'ready',
      owner: { accounts: [matchingAccount, otherAccount] },
      meta: { ownerId: 'user-1' },
    });
    loadAllAccountGachaHistoryForAccounts.mockResolvedValue({
      history: exportHistory,
      accounts: [matchingAccount],
      warnings: [],
    });
    const showToast = vi.fn();
    const { result } = renderHook(() => useDataExportImport({
      showToast,
      cloudSync: createCloudSync(),
    }));

    expect(loadAllAccountGachaHistoryForAccounts).not.toHaveBeenCalled();
    let exported;
    await act(async () => {
      exported = await result.current.handleExportJSON({
        poolFilter: 'all',
        accountFilter: 'current',
        gameUid: matchingAccount.accountKey,
      });
    });

    expect(exported).toBe(true);
    expect(normalizeExportOptions).toHaveBeenCalledWith(expect.objectContaining({
      accountFilter: 'current',
    }), {
      currentGameUid: matchingAccount.accountKey,
      defaultFormat: 'internal_json_v3',
    });
    expect(loadAllAccountGachaHistoryForAccounts).toHaveBeenCalledWith({
      accounts: [matchingAccount],
      expectedOwnerId: 'user-1',
    });
    expect(buildExportPayload).toHaveBeenCalledWith(expect.objectContaining({
      history: exportHistory,
      options: expect.objectContaining({
        accountFilter: 'current',
        gameUid: matchingAccount.accountKey,
      }),
    }));
    expect(buildExportContent).toHaveBeenCalledTimes(1);
    expect(setSyncing.mock.calls).toEqual([[true], [false]]);
    expect(setHistory).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().history).toBe(partialHistory);
    expect(loadWorkbenchEntriesForExport).toHaveBeenCalled();
  });

  it.each(['history', 'workbenchEntries'])('keeps the preview and writes nothing when %s contains an unopened pool', async field => {
    const setHistory = vi.fn(); const setPools = vi.fn();
    useAuthStore.setState({ user: { id: 'user-1' }, setSyncing: vi.fn() });
    useHistoryStore.setState({ history: [], setHistory });
    usePoolStore.setState({ pools: [{ id: 'pool-1', name: '尚未开放卡池', start_time: '2099-01-01' }], setPools });
    const showToast = vi.fn(); const cloudSync = createCloudSync();
    const { result } = renderHook(() => useDataExportImport({ showToast, cloudSync }));
    const pending = { willSyncToCloud: true, data: { pools: [{ id: 'pool-1', start_time: '2020-01-01' }], history: [], workbenchEntries: [],
      [field]: [{ id: 'future-record', poolId: 'pool-1', gameUid: 'game-1' }] } };
    act(() => result.current.setPendingImport(pending));
    await act(async () => result.current.confirmImport());
    expect(result.current.pendingImport).toEqual(pending);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('尚未开放'), 'warning');
    expect(setHistory).not.toHaveBeenCalled(); expect(setPools).not.toHaveBeenCalled();
    expect(cloudSync.saveHistoryToCloud).not.toHaveBeenCalled(); expect(importWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('persists supplement-only reimports and refreshes personal analysis', async () => {
    useAuthStore.setState({ user: { id: 'user-1' }, setSyncing: vi.fn() });
    useHistoryStore.setState({ history: [], setHistory: vi.fn() });
    const cloudSync = createCloudSync();
    cloudSync.refreshPersonalData.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDataExportImport({ showToast: vi.fn(), cloudSync }));
    const supplements = [{ entryId: 'supplement', gameUid: 'game-1', serverScope: '1' }];
    act(() => result.current.setPendingImport({ willSyncToCloud: true, data: { pools: [], history: [], workbenchEntries: supplements } }));
    await act(async () => { await result.current.confirmImport(); });
    expect(importWorkbenchEntries).toHaveBeenCalledWith(supplements);
    expect(cloudSync.saveHistoryToCloud).not.toHaveBeenCalled();
    expect(cloudSync.refreshPersonalData).toHaveBeenCalled();
    expect(result.current.pendingImport).toBeNull();
  });

  it('retains the import preview if supplement validation fails', async () => {
    useAuthStore.setState({ user: { id: 'user-1' }, setSyncing: vi.fn() });
    useHistoryStore.setState({ history: [], setHistory: vi.fn() });
    importWorkbenchEntries.mockRejectedValueOnce(new Error('覆盖范围冲突'));
    const showToast = vi.fn();
    const { result } = renderHook(() => useDataExportImport({ showToast, cloudSync: createCloudSync() }));
    const pending = { willSyncToCloud: true, data: { pools: [], history: [], workbenchEntries: [{ entryId: 'supplement' }] } };
    act(() => result.current.setPendingImport(pending));
    await act(async () => { await result.current.confirmImport(); });
    expect(result.current.pendingImport.data).toEqual(pending.data);
    expect(result.current.pendingImport.progress.phase).toBe('failed');
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: expect.stringContaining('导入预览已保留') }));
  });

  it('checks all saved wiki history when the store only holds a partial snapshot and preserves existing official records', async () => {
    useAuthStore.setState({ user: { id: 'user-1' }, setSyncing: vi.fn() });
    useHistoryStore.setState({ history: [], setHistory: vi.fn() });
    loadAccountGachaData.mockResolvedValue({ meta: { ownerId: 'user-1' }, history: [{ game_uid: '123', server_scope: '1', pool_id: 'pool-1', seq_id: '11' }] });
    const cloudSync = createCloudSync(); cloudSync.refreshPersonalData.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDataExportImport({ showToast: vi.fn(), cloudSync }));
    act(() => result.current.setPendingImport({ willSyncToCloud: true, data: { sourceFormatId: 'lcx_wiki_json', pools: [],
      accounts: [{ gameUid: '123', nickName: '测试', serverId: '1' }],
      history: [{ gameUid: '123', serverScope: '1', poolId: 'pool-1', seqId: '11', name: '角色' }],
      workbenchEntries: [{ entryId: 'unknowns', gameUid: '123', serverScope: '1' }] } }));
    await act(async () => result.current.confirmImport());
    expect(loadAccountGachaData).toHaveBeenCalled();
    expect(cloudSync.saveHistoryToCloud).not.toHaveBeenCalled();
    expect(importRescueSupplements).toHaveBeenCalled();
    expect(result.current.pendingImport).toBeNull();
  });

  it('resumes a 2164-pull import after 400 saves, even when local history contains the entire failed import', async () => {
    const rows = Array.from({ length: 2164 }, (_, index) => ({ id: `endgacha:uid:pool-1:time:${index}`,
      gameUid: 'uid', serverId: 'bilibili', poolId: 'pool-1', seqId: String(index + 1), name: '武器', rarity: 4 }));
    useAuthStore.setState({ user: { id: 'user-1' }, setSyncing: vi.fn() });
    const setHistory = vi.fn();
    useHistoryStore.setState({ history: rows, setHistory });
    loadAccountGachaData.mockResolvedValue({ history: [], meta: { ownerId: 'user-1' } });
    const cloudSync = createCloudSync();
    let calls = 0;
    cloudSync.saveHistoryToCloud.mockImplementation(async batch => {
      if (++calls === 5) throw new Error('网络中断');
      return { saved: { history: batch.length }, skipped: { history: 0 } };
    });
    cloudSync.refreshPersonalData.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDataExportImport({ showToast: vi.fn(), cloudSync }));
    act(() => result.current.setPendingImport({ willSyncToCloud: true, data: { pools: [], history: rows } }));
    await act(async () => result.current.confirmImport());
    expect(result.current.pendingImport.progress).toEqual({ phase: 'failed', completed: 400, total: 2164 });
    expect(setHistory).not.toHaveBeenCalled();
    expect(cloudSync.refreshPersonalData).not.toHaveBeenCalled();
    loadAccountGachaData.mockResolvedValue({ history: rows.slice(0, 400), meta: { ownerId: 'user-1' } });
    cloudSync.saveHistoryToCloud.mockClear();
    await act(async () => result.current.confirmImport());
    const resumed = cloudSync.saveHistoryToCloud.mock.calls.flatMap(([batch]) => batch);
    expect(resumed).toHaveLength(1764);
    expect(resumed[0].seqId).toBe('401');
    expect(result.current.pendingImport).toBeNull();
    expect(cloudSync.refreshPersonalData).toHaveBeenCalledTimes(1);
  });

  it.each([
    { meta: { ownerId: 'someone-else' }, history: [] },
    { meta: { ownerId: 'user-1', truncated: true }, history: [] },
  ])('keeps the preview if existing cloud history cannot be trusted: %j', async saved => {
    useAuthStore.setState({ user: { id: 'user-1' }, setSyncing: vi.fn() });
    useHistoryStore.setState({ history: [], setHistory: vi.fn() });
    loadAccountGachaData.mockResolvedValue(saved);
    const cloudSync = createCloudSync();
    const { result } = renderHook(() => useDataExportImport({ showToast: vi.fn(), cloudSync }));
    act(() => result.current.setPendingImport({ willSyncToCloud: true, data: { pools: [], history: [{ id: 'r' }] } }));
    await act(async () => result.current.confirmImport());
    expect(result.current.pendingImport.progress.phase).toBe('failed');
    expect(cloudSync.saveHistoryToCloud).not.toHaveBeenCalled();
  });

  it('falls back to current history when a logged-in legacy session has no analysis snapshot', async () => {
    const setSyncing = vi.fn();
    const setHistory = vi.fn();
    const legacyHistory = [{ id: 'legacy-record', user_id: 'user-legacy' }];
    useAuthStore.setState({ user: { id: 'user-legacy' }, setSyncing });
    useHistoryStore.setState({ history: legacyHistory, setHistory });
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState('legacy_session'));
    const { result } = renderHook(() => useDataExportImport({
      showToast: vi.fn(),
      cloudSync: createCloudSync(),
    }));

    await act(async () => {
      await result.current.handleExportJSON({
        poolFilter: 'all',
        accountFilter: 'all',
      });
    });

    expect(loadAllAccountGachaHistoryForAccounts).not.toHaveBeenCalled();
    expect(buildExportPayload).toHaveBeenCalledWith(expect.objectContaining({
      history: legacyHistory,
    }));
    expect(setSyncing).not.toHaveBeenCalled();
    expect(setHistory).not.toHaveBeenCalled();
  });

  it.each([
    ['account_gacha_history_owner_mismatch', '分页读取返回了不属于当前用户的抽卡记录'],
    ['history_revision_changed', '抽卡记录在分页读取期间再次发生变化'],
  ])('shows the existing export failure toast for %s', async (code, message) => {
    const setSyncing = vi.fn();
    const setHistory = vi.fn();
    const account = {
      accountKey: 'game-1::server:1',
      gameUid: 'game-1',
      serverScope: '1',
      region: 'cn',
    };
    useAuthStore.setState({ user: { id: 'user-1' }, setSyncing });
    useHistoryStore.setState({ history: [{ id: 'partial-record' }], setHistory });
    usePersonalAnalysisStore.setState({
      ownerId: 'user-1',
      availability: 'ready',
      owner: { accounts: [account] },
    });
    loadAllAccountGachaHistoryForAccounts.mockRejectedValue(
      Object.assign(new Error(message), { code })
    );
    const showToast = vi.fn();
    const { result } = renderHook(() => useDataExportImport({
      showToast,
      cloudSync: createCloudSync(),
    }));

    let exported;
    await act(async () => {
      exported = await result.current.handleExportJSON({
        poolFilter: 'all',
        accountFilter: 'all',
      });
    });

    expect(exported).toBe(false);
    expect(showToast).toHaveBeenCalledWith(`导出失败：${message}`, 'error');
    expect(setSyncing.mock.calls).toEqual([[true], [false]]);
    expect(setHistory).not.toHaveBeenCalled();
    expect(buildExportPayload).not.toHaveBeenCalled();
  });
});
