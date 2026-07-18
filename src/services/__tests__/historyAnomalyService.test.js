import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadAdminHistoryAnomalies,
  loadHistoryAnomalies,
  updateAdminHistoryAnomaly,
  updateHistoryAnomaly,
} from '../historyAnomalyService.js';

const mocks = vi.hoisted(() => ({
  fetchJsonWithTimeout: vi.fn(),
  getSupabaseAccessToken: vi.fn(),
}));

vi.mock('../authFetchService.js', () => ({
  getSupabaseAccessToken: mocks.getSupabaseAccessToken,
}));

vi.mock('../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: mocks.fetchJsonWithTimeout,
}));

function ok(data = {}) {
  return {
    response: { ok: true, status: 200 },
    data: { success: true, ...data },
  };
}

describe('historyAnomalyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAccessToken.mockResolvedValue('site-token');
  });

  it('按账号、区服和卡池读取用户待核对记录', async () => {
    const anomalies = [{ id: 'anomaly-1' }];
    mocks.fetchJsonWithTimeout.mockResolvedValue(ok({ anomalies }));

    await expect(loadHistoryAnomalies({
      gameUid: 'game-1',
      serverScope: 'cn-1',
      poolId: 'pool-1',
    })).resolves.toEqual(anomalies);

    expect(mocks.fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/history-anomalies?gameUid=game-1&serverScope=cn-1&poolId=pool-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: expect.objectContaining({ Authorization: 'Bearer site-token' }),
      }),
      { label: 'history-anomalies-load', retries: 1 }
    );
  });

  it('空筛选不生成多余问号，并把非数组结果收敛为空列表', async () => {
    mocks.fetchJsonWithTimeout.mockResolvedValue(ok({ anomalies: null }));

    await expect(loadHistoryAnomalies()).resolves.toEqual([]);
    expect(mocks.fetchJsonWithTimeout.mock.calls[0][0]).toBe('/api/history-anomalies');
  });

  it('没有 Supabase Bearer token 时仍使用同源会话 Cookie', async () => {
    mocks.getSupabaseAccessToken.mockResolvedValue(null);
    mocks.fetchJsonWithTimeout.mockResolvedValue(ok({ anomalies: [] }));

    await expect(loadHistoryAnomalies()).resolves.toEqual([]);

    expect(mocks.fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/history-anomalies',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      }),
      { label: 'history-anomalies-load', retries: 1 }
    );
  });

  it('用户更新只提交异常动作并且不重试', async () => {
    mocks.fetchJsonWithTimeout.mockResolvedValue(ok({ anomaly: { id: 'anomaly-1' } }));

    await expect(updateHistoryAnomaly({
      anomalyId: 'anomaly-1',
      action: 'postpone',
      note: '稍后核对',
    })).resolves.toEqual({ id: 'anomaly-1' });

    expect(mocks.fetchJsonWithTimeout).toHaveBeenCalledWith(
      '/api/history-anomalies',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ anomalyId: 'anomaly-1', action: 'postpone', note: '稍后核对' }),
      }),
      { label: 'history-anomalies-update', retries: 0 }
    );
  });

  it('保留后端错误状态和错误码', async () => {
    mocks.fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: false, status: 409 },
      data: { success: false, error: '记录已被处理', code: 'history_anomaly_conflict' },
    });

    await expect(updateHistoryAnomaly({
      anomalyId: 'anomaly-1',
      action: 'confirm',
    })).rejects.toMatchObject({
      message: '记录已被处理',
      status: 409,
      code: 'history_anomaly_conflict',
    });
  });

  it('管理员读取和更新使用独立端点与零重试写入', async () => {
    mocks.fetchJsonWithTimeout
      .mockResolvedValueOnce(ok({ anomalies: [{ id: 'admin-1' }] }))
      .mockResolvedValueOnce(ok({ anomaly: { id: 'admin-1', status: 'resolved' } }));

    await expect(loadAdminHistoryAnomalies('resolved')).resolves.toEqual([{ id: 'admin-1' }]);
    await expect(updateAdminHistoryAnomaly({
      anomalyId: 'admin-1', action: 'reopen', note: '重新核对',
    })).resolves.toMatchObject({ status: 'resolved' });

    expect(mocks.fetchJsonWithTimeout.mock.calls[0][0]).toBe('/api/admin-history-anomalies?status=resolved');
    expect(mocks.fetchJsonWithTimeout.mock.calls[1][2]).toEqual({
      label: 'admin-history-anomalies-update',
      retries: 0,
    });
  });
});
