import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ImportManager from '../ImportManager.jsx';

const harness = vi.hoisted(() => ({
  result: null,
  user: { id: 'user-1' },
  loadCloudData: vi.fn(),
  applyCloudDataToStores: vi.fn(),
  loadAccountSecurityState: vi.fn(),
  notifyOfficialBotImportUpdated: vi.fn(),
  navigate: vi.fn(),
  setPools: vi.fn(),
  switchPool: vi.fn(),
  switchGameAccount: vi.fn(),
  setHistory: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => harness.navigate,
  };
});

vi.mock('../../../stores', () => ({
  useAuthStore: (selector) => selector({ user: harness.user }),
  usePoolStore: (selector) => selector({
    pools: [{ id: 'pool-1', name: '测试卡池' }],
    currentPoolId: 'pool-1',
    setPools: harness.setPools,
    switchPool: harness.switchPool,
    switchGameAccount: harness.switchGameAccount,
  }),
  useHistoryStore: (selector) => selector({ setHistory: harness.setHistory }),
}));

vi.mock('../../../hooks', () => ({
  useCloudSync: () => ({ loadCloudData: harness.loadCloudData }),
}));

vi.mock('../../../utils/gameAccountMetadata.js', () => ({
  buildGameAccountKey: (account = {}) => account.gameUid || account.hgUid || '',
  buildImportedGameAccountMetadataEntries: () => [],
  buildHistorySeqDedupeKeys: () => [],
  isGameAccountSelectionMatch: () => true,
  saveGameAccountMetadata: vi.fn(),
}));

vi.mock('../../../utils/cloudDataSync.js', () => ({
  applyCloudDataToStores: harness.applyCloudDataToStores,
}));

vi.mock('../../../services/accountGachaDataService.js', () => ({
  loadAccountGachaSeqKeys: vi.fn(),
  resolveAccountGachaAliases: vi.fn(),
  saveAccountGachaData: vi.fn(),
}));

vi.mock('../../../services/accountSecurityService.js', () => ({
  isOAuthAccountCompletionRequired: () => false,
  loadAccountSecurityState: harness.loadAccountSecurityState,
}));

vi.mock('../importPersistence.js', () => ({
  filterImportedHistoryRecords: vi.fn(),
  prepareOfficialImportPersistenceData: vi.fn(),
}));

vi.mock('../../../services/accountIntegrationsService.js', () => ({
  notifyOfficialBotImportUpdated: harness.notifyOfficialBotImportUpdated,
}));

vi.mock('../OfficialAPIImport', () => ({
  default: ({ onImportComplete }) => (
    <button type="button" onClick={() => onImportComplete(harness.result)}>
      finish-import
    </button>
  ),
}));

vi.mock('../importShared.js', () => ({
  getPoolName: (value) => String(value || ''),
}));

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    t: (key, values = {}) => ({
      'import.refreshFailedAfterSave': '记录已保存，但云端刷新失败',
      'import.warning.title': '导入完成，但有事项需要留意',
      'import.warning.skippedRecords': `有 ${values.count} 条记录未安全写入`,
      'import.warning.anomalyReminderFailed': '待核对提醒创建失败',
      'import.anomaly.title': `有 ${values.count} 条异常记录`,
      'import.anomaly.desc': '只展示异常记录',
      'import.anomaly.recordLabel': '异常记录',
      'import.anomaly.unknownItem': '未知角色或武器',
      'import.anomaly.missingIdentity': '官方记录缺少可识别的角色或武器信息',
      'import.anomaly.poolLabel': '卡池',
      'import.anomaly.seqLabel': '官方序号',
      'import.anomaly.timeLabel': '记录时间',
      'import.anomaly.actionHint': '前往详细记录处理',
      'import.anomaly.later': '稍后处理',
      'import.anomaly.openDetails': '前往详细记录',
      'import.partialTitle': '部分卡池未完整获取',
      'import.partialDesc': '请检查以下卡池',
      'import.partialSuccess': '部分成功',
      'import.partialFailed': '获取失败',
      'import.partialFallback': '仅获取到部分记录',
      'import.failedFallback': '未获取到记录',
    }[key] || key),
    locale: 'zh-CN',
    formatNumber: String,
    formatDateTime: String,
  }),
}));

vi.mock('../../../utils/appLogger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../utils/importResultSummary.js', () => ({
  buildImportResultSummary: () => null,
}));

function makeResult(overrides = {}) {
  return {
    success: true,
    backendImported: true,
    summary: {
      total: 10,
      newRecords: 2,
      duplicates: 8,
      skippedRecords: 0,
      anomalyRecords: 0,
      anomalyPoolIds: [],
      anomalyItems: [],
      partialPools: [],
      failedPools: [],
      warnings: [],
      ...overrides,
    },
    userInfo: { gameUid: 'game-1', nickName: '测试账号' },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('ImportManager completion behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.user = { id: 'user-1' };
    harness.result = makeResult();
    harness.loadCloudData.mockResolvedValue({ pools: [], history: [] });
    harness.loadAccountSecurityState.mockResolvedValue({});
    harness.notifyOfficialBotImportUpdated.mockResolvedValue({});
  });

  it('正常导入完成后自动结束，并且完成与关闭回调各调用一次', async () => {
    const onClose = vi.fn();
    const onImportComplete = vi.fn();
    render(<ImportManager isOpen onClose={onClose} onImportComplete={onImportComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'finish-import' }));

    await waitFor(() => {
      expect(onImportComplete).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onImportComplete).toHaveBeenCalledWith(harness.result);
  });

  it('记录已保存但云端刷新失败时保留结果并显示明确提示', async () => {
    harness.loadCloudData.mockRejectedValue(new Error('network down'));
    const onClose = vi.fn();
    const onImportComplete = vi.fn();
    render(<ImportManager isOpen onClose={onClose} onImportComplete={onImportComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'finish-import' }));

    expect(await screen.findByText('记录已保存，但云端刷新失败')).toBeInTheDocument();
    expect(screen.getByText('导入完成，但有事项需要留意')).toBeInTheDocument();
    expect(onImportComplete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('有真实异常时只展示异常摘要，并引导进入详细记录', async () => {
    harness.result = makeResult({
      anomalyRecords: 1,
      anomalyPoolIds: ['pool-1'],
      anomalyItems: [{
        recordId: 'record-1',
        poolId: 'pool-1',
        seqId: '42',
        issueCode: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
        itemName: '未知角色或武器',
        message: '后端中文说明不应直接显示',
      }],
      warnings: ['有 1 条已导入记录需要后续核对。'],
    });
    const onClose = vi.fn();
    const onImportComplete = vi.fn();
    render(<ImportManager isOpen onClose={onClose} onImportComplete={onImportComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'finish-import' }));

    expect(await screen.findByText('有 1 条异常记录')).toBeInTheDocument();
    expect(screen.getByText('未知角色或武器')).toBeInTheDocument();
    expect(screen.getByText('官方记录缺少可识别的角色或武器信息')).toBeInTheDocument();
    expect(screen.queryByText('后端中文说明不应直接显示')).not.toBeInTheDocument();
    expect(screen.queryByText('import.summary.total')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '前往详细记录' }));
    expect(onImportComplete).toHaveBeenCalledWith(harness.result);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('异常记录与部分获取同时出现时，两类信息都会展示', async () => {
    harness.result = makeResult({
      anomalyRecords: 1,
      anomalyItems: [{
        recordId: 'record-1',
        poolId: 'pool-1',
        seqId: '42',
        issueCode: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
        itemName: '未知角色或武器',
      }],
      partialPools: [{
        poolType: 'limited',
        records: 5,
        error: '请求中途停止',
      }],
    });

    render(<ImportManager isOpen onClose={vi.fn()} onImportComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'finish-import' }));

    expect(await screen.findByText('有 1 条异常记录')).toBeInTheDocument();
    expect(screen.getByText('部分卡池未完整获取')).toBeInTheDocument();
    expect(screen.getByText(/请求中途停止/)).toBeInTheDocument();
  });

  it('云端刷新完成前禁止关闭，避免迟到回调污染下一次弹窗', async () => {
    const cloudRefresh = createDeferred();
    harness.loadCloudData.mockReturnValue(cloudRefresh.promise);
    const onClose = vi.fn();
    const onImportComplete = vi.fn();
    render(<ImportManager isOpen onClose={onClose} onImportComplete={onImportComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'finish-import' }));

    const closeButton = screen.getByRole('button', { name: 'common.close' });
    await waitFor(() => expect(closeButton).toBeDisabled());
    fireEvent.click(closeButton);
    expect(onClose).not.toHaveBeenCalled();

    cloudRefresh.resolve({ pools: [], history: [] });
    await waitFor(() => {
      expect(onImportComplete).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
