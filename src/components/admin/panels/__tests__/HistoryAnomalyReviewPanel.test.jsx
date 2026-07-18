import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HistoryAnomalyReviewPanel from '../HistoryAnomalyReviewPanel.jsx';

const serviceMocks = vi.hoisted(() => ({
  loadAdminHistoryAnomalies: vi.fn(),
  updateAdminHistoryAnomaly: vi.fn(),
}));

vi.mock('../../../../services/historyAnomalyService.js', () => serviceMocks);

const pendingItem = {
  id: 'anomaly-pending',
  user_id: 'user-1',
  user: { username: '管理员核对用户' },
  status: 'pending',
  game_uid: 'game-1',
  server_scope: 'cn-1',
  pool_id: 'pool-1',
  seq_id: '10',
  details: { itemName: '未知', message: '缺少物品字段' },
};

describe('HistoryAnomalyReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.loadAdminHistoryAnomalies.mockResolvedValue([pendingItem]);
    serviceMocks.updateAdminHistoryAnomaly.mockResolvedValue({});
  });

  it('默认读取待处理记录，并按管理员动作刷新', async () => {
    const showToast = vi.fn();
    render(<HistoryAnomalyReviewPanel showToast={showToast} />);

    expect(await screen.findByText('管理员核对用户')).toBeInTheDocument();
    expect(serviceMocks.loadAdminHistoryAnomalies).toHaveBeenCalledWith('pending');

    fireEvent.click(screen.getByRole('button', { name: /标记已处理/ }));
    await waitFor(() => {
      expect(serviceMocks.updateAdminHistoryAnomaly).toHaveBeenCalledWith({
        anomalyId: 'anomaly-pending',
        action: 'resolve',
        note: '管理员已核对并标记为已处理',
      });
    });
    expect(showToast).toHaveBeenCalledWith('异常记录状态已更新', 'success');
    expect(serviceMocks.loadAdminHistoryAnomalies.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('切换到已处理筛选后允许重新打开', async () => {
    const resolvedItem = { ...pendingItem, id: 'anomaly-resolved', status: 'resolved' };
    serviceMocks.loadAdminHistoryAnomalies.mockImplementation(async (status) => (
      status === 'resolved' ? [resolvedItem] : [pendingItem]
    ));
    render(<HistoryAnomalyReviewPanel showToast={vi.fn()} />);
    await screen.findByText('管理员核对用户');

    fireEvent.click(screen.getByRole('button', { name: '已处理' }));
    await waitFor(() => {
      expect(serviceMocks.loadAdminHistoryAnomalies).toHaveBeenCalledWith('resolved');
    });
    fireEvent.click(await screen.findByRole('button', { name: /重新打开/ }));
    await waitFor(() => {
      expect(serviceMocks.updateAdminHistoryAnomaly).toHaveBeenCalledWith({
        anomalyId: 'anomaly-resolved',
        action: 'reopen',
        note: '管理员重新打开核对',
      });
    });
  });

  it('父级提示函数换引用时不会重复读取', async () => {
    const { rerender } = render(<HistoryAnomalyReviewPanel showToast={vi.fn()} />);
    await screen.findByText('管理员核对用户');
    expect(serviceMocks.loadAdminHistoryAnomalies).toHaveBeenCalledTimes(1);

    rerender(<HistoryAnomalyReviewPanel showToast={vi.fn()} />);
    await Promise.resolve();
    expect(serviceMocks.loadAdminHistoryAnomalies).toHaveBeenCalledTimes(1);
  });
});
