import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SummerLotteryContactPanel from '../SummerLotteryContactPanel.jsx';
import {
  loadSummerLotteryContactTargets,
  loadSummerLotteryOperatorGrants,
  loadSummerLotteryOperationStatus,
} from '../../../../services/admin/summerLotteryContactService.js';

vi.mock('../../../../services/admin/summerLotteryContactService.js', () => ({
  loadSummerLotteryContactTargets: vi.fn(),
  loadSummerLotteryOperatorGrants: vi.fn(),
  loadSummerLotteryOperationStatus: vi.fn(),
  purgeSummerLotteryContact: vi.fn(),
  readSummerLotteryContact: vi.fn(),
  runSummerLotteryOperation: vi.fn(),
  setSummerLotteryOperatorCapability: vi.fn(),
}));

const TARGET = {
  entryId: '55555555-5555-4555-8555-555555555555',
  publicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  entryNumber: 7,
  prizeTier: 'first',
  winnerOrder: 1,
  claimStatus: 'pending',
  contactType: 'email',
  contactAvailable: true,
};

describe('SummerLotteryContactPanel capability boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSummerLotteryContactTargets.mockResolvedValue({
      campaign: {
        campaignId: 'community-lottery',
        contactRetentionUntil: '2026-09-24T12:00:00.000Z',
        contactsClearedAt: null,
      },
      permissions: { canRead: true, canPurge: false },
      targets: [TARGET],
    });
    loadSummerLotteryOperationStatus.mockResolvedValue({
      campaignId: 'community-lottery',
      phase: 'drawn',
      seedConfigured: true,
    });
    loadSummerLotteryOperatorGrants.mockResolvedValue([]);
  });

  it('keeps the dedicated operator page limited to contact work', async () => {
    render(
      <SummerLotteryContactPanel
        showOperationControls={false}
        showPermissionManager={false}
      />,
    );

    await screen.findByText('编号 #7');
    expect(loadSummerLotteryContactTargets).toHaveBeenCalledWith('');
    expect(loadSummerLotteryOperationStatus).not.toHaveBeenCalled();
    expect(loadSummerLotteryOperatorGrants).not.toHaveBeenCalled();
    expect(screen.queryByText('短期管理员会话操作')).not.toBeInTheDocument();
    expect(screen.queryByText('兑奖最小权限')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通知中奖' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '隐私请求删除' })).toBeDisabled();
  });

  it('loads the deployed campaign by default and allows an explicit campaign switch', async () => {
    render(
      <SummerLotteryContactPanel
        showOperationControls
        showPermissionManager
      />,
    );

    await screen.findByText('编号 #7');
    fireEvent.change(screen.getByLabelText('当前操作活动'), {
      target: { value: 'arknights-p3r-collab-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: '切换并读取' }));

    await waitFor(() => {
      expect(loadSummerLotteryContactTargets).toHaveBeenLastCalledWith('arknights-p3r-collab-2026');
      expect(loadSummerLotteryOperationStatus).toHaveBeenLastCalledWith('arknights-p3r-collab-2026');
      expect(loadSummerLotteryOperatorGrants).toHaveBeenLastCalledWith('arknights-p3r-collab-2026');
    });
  });

  it('lets the super-admin permission manager load even without contact access', async () => {
    const denied = Object.assign(new Error('capability required'), {
      status: 403,
      code: 'lottery_operator_capability_required',
    });
    loadSummerLotteryContactTargets.mockRejectedValue(denied);
    loadSummerLotteryOperatorGrants.mockResolvedValue([{
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      username: '兑奖专员',
      capability: 'contact_read',
    }]);

    render(
      <SummerLotteryContactPanel
        showOperationControls
        showPermissionManager
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('兑奖最小权限')).toBeInTheDocument();
      expect(screen.getByText('兑奖专员 · 单条读取')).toBeInTheDocument();
    });
    expect(screen.getByText(/当前账号没有此活动的兑奖读取权限/u)).toBeInTheDocument();
    expect(screen.getByText('短期管理员会话操作')).toBeInTheDocument();
  });
});
