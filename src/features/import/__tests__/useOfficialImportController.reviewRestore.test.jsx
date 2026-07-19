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

function saveReviewSession() {
  saveOfficialImportReviewSession({
    userId: 'user-a',
    source: 'cn',
    taskId: 'task-a',
    accessKey: 'review-key',
  });
}

describe('useOfficialImportController legacy review cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('新流程启动时清除旧版待确认会话，不再恢复逐条审阅页', async () => {
    saveReviewSession();

    const { result } = renderHook(() => useOfficialImportController({
      userId: 'user-a',
      source: 'cn',
    }));

    await waitFor(() => {
      expect(loadOfficialImportReviewSession({ userId: 'user-a', source: 'cn' })).toBeNull();
    });
    expect(chainMocks.fetchFullImportReview).not.toHaveBeenCalled();
    expect(result.current.status).toBe(ImportStatus.IDLE);
    expect(result.current.reviewRecords).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('没有旧版会话时保持空闲状态', () => {
    const { result } = renderHook(() => useOfficialImportController({
      userId: 'user-a',
      source: 'cn',
    }));

    expect(result.current.status).toBe(ImportStatus.IDLE);
    expect(chainMocks.fetchFullImportReview).not.toHaveBeenCalled();
  });
});
