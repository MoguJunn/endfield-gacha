// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDataExportImport } from '../useDataExportImport.js';
import { loadAllAccountGachaHistoryForAccounts } from '../../../services/accountGachaDataService.js';
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
  loadAllAccountGachaHistoryForAccounts: vi.fn(),
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
    savePoolToCloud: vi.fn(),
    saveHistoryToCloud: vi.fn(),
    refreshPersonalData: vi.fn(),
  };
}

describe('useDataExportImport export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
