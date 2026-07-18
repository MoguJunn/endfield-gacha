import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportStatus } from '../importStatus.js';
import {
  loadOfficialImportReviewSession,
  saveOfficialImportReviewSession,
} from '../officialImportReviewSession.js';
import { useOfficialImportController } from '../useOfficialImportController.js';

const chainMocks = vi.hoisted(() => ({
  fetchFullImportReview: vi.fn(),
}));
const i18nMocks = vi.hoisted(() => ({
  t: vi.fn((key) => key),
}));

vi.mock('../../../utils/endfieldAuthChain.js', () => {
  class AuthChainError extends Error {}
  class RiskControlError extends Error {}
  class ServerConnectionError extends Error {}
  return {
    AuthChainError,
    RiskControlError,
    ServerConnectionError,
    executeAuthChainForAccount: vi.fn(),
    fetchAccountsList: vi.fn(),
    fetchAllGachaRecords: vi.fn(),
    fetchAllGachaRecordsConcurrent: vi.fn(),
    fetchImportQueueStatus: vi.fn(),
    fetchFullImportReview: chainMocks.fetchFullImportReview,
    importAllRecordsFullyOnBackend: vi.fn(),
    confirmFullImportReviewOnBackend: vi.fn(),
    rejectFullImportReviewOnBackend: vi.fn(),
  };
});

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({ t: i18nMocks.t }),
}));

vi.mock('../../../utils/appLogger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const blockedRecord = {
  ordinal: 0,
  itemName: null,
  selectedAction: 'keep',
  issues: [{ severity: 'blocking', code: 'MISSING_ITEM_NAME' }],
};

const validRecord = {
  ordinal: 1,
  itemName: '余烬',
  selectedAction: 'keep',
  issues: [],
};

function saveReviewSession() {
  saveOfficialImportReviewSession({
    userId: 'user-a',
    source: 'cn',
    taskId: 'task-a',
    accessKey: 'review-key',
  });
}

describe('useOfficialImportController review restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('刷新后恢复待确认任务，并强制阻断记录保持跳过', async () => {
    saveReviewSession();
    chainMocks.fetchFullImportReview.mockResolvedValue({
      task: {
        id: 'task-a',
        status: 'awaiting_confirmation',
        gameUid: 'game-1',
        serverId: '1',
        region: 'cn',
        summary: { review: { issueRecords: 1, blockingRecords: 1 } },
      },
      records: [blockedRecord, validRecord],
    });

    const { result } = renderHook(() => useOfficialImportController({
      userId: 'user-a',
      source: 'cn',
    }));

    await waitFor(() => {
      expect(result.current.status).toBe(ImportStatus.REVIEW_REQUIRED);
    });
    expect(chainMocks.fetchFullImportReview).toHaveBeenCalledWith('task-a', 'review-key', 'cn');
    expect(result.current.reviewRecords).toEqual([blockedRecord, validRecord]);
    expect(result.current.reviewDecisions).toEqual({ 0: 'skip', 1: 'keep' });
    expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'cn' })).not.toBeNull();
  });

  it('临时网络失败时保留恢复凭证', async () => {
    saveReviewSession();
    chainMocks.fetchFullImportReview.mockRejectedValue(new Error('network timeout'));

    const { result } = renderHook(() => useOfficialImportController({
      userId: 'user-a',
      source: 'cn',
    }));

    await waitFor(() => {
      expect(result.current.status).toBe(ImportStatus.ERROR);
    });
    expect(result.current.error).toContain('上次待确认的导入记录');
    expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'cn' })).not.toBeNull();
  });

  it('任务确定过期时清除恢复凭证', async () => {
    saveReviewSession();
    const expiredError = Object.assign(new Error('review expired'), {
      data: { code: 'REVIEW_TASK_EXPIRED' },
    });
    chainMocks.fetchFullImportReview.mockRejectedValue(expiredError);

    const { result } = renderHook(() => useOfficialImportController({
      userId: 'user-a',
      source: 'cn',
    }));

    await waitFor(() => {
      expect(chainMocks.fetchFullImportReview).toHaveBeenCalledTimes(1);
      expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'cn' })).toBeNull();
    });
    expect(result.current.status).toBe(ImportStatus.IDLE);
  });
});
