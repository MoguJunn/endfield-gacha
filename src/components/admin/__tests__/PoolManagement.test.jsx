import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PoolManagement from '../PoolManagement.jsx';

vi.mock('../../../hooks/admin/usePools', () => ({
  usePools: vi.fn(),
}));

vi.mock('../../../services/admin/poolPushService', () => ({
  previewPoolPush: vi.fn(),
  sendPoolPush: vi.fn(),
}));

vi.mock('../pools', () => ({
  PoolCard: () => null,
  PoolEditDialog: ({ show, onSaveAndPreviewPush }) =>
    show ? <button onClick={onSaveAndPreviewPush}>保存并预览推送</button> : null,
}));

vi.mock('../HomeVersionTimelineManager.jsx', () => ({
  default: ({ pools }) => (
    <div data-testid="version-manager">版本时间线管理 · {pools.length} 个卡池</div>
  ),
}));

const { usePools } = await import('../../../hooks/admin/usePools');
const poolPushService = await import('../../../services/admin/poolPushService');

describe('PoolManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePools.mockReturnValue({
      pools: [
        {
          pool_id: 'pool_1',
          name: '拳出无悔',
          type: 'limited',
          start_time: '2026-06-05T04:00:00.000Z',
          end_time: '2026-06-26T04:00:00.000Z',
        },
      ],
      characters: [],
      poolCharacters: {},
      filteredPools: [],
      loading: false,
      actionLoading: null,
      searchQuery: '',
      setSearchQuery: vi.fn(),
      typeFilter: 'all',
      setTypeFilter: vi.fn(),
      sortField: 'created_at',
      setSortField: vi.fn(),
      sortOrder: 'desc',
      setSortOrder: vi.fn(),
      showEditDialog: false,
      editingPool: null,
      poolForm: {},
      setPoolForm: vi.fn(),
      editingPoolCharacters: [],
      poolDraftDiff: null,
      checkUpCharacterExists: vi.fn(),
      resetForm: vi.fn(),
      startCreate: vi.fn(),
      startEdit: vi.fn(),
      handleSavePool: vi.fn(),
      handleDeletePool: vi.fn(),
      handleRecalculateIsStandard: vi.fn(),
      toggleCharacterInPool: vi.fn(),
      addAllCharactersToPool: vi.fn(),
      removeAllCharactersFromPool: vi.fn(),
    });
  });

  it('opens the version management subtab from pool management', () => {
    render(<PoolManagement showToast={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /版本管理/u }));

    expect(screen.getByTestId('version-manager')).toHaveTextContent('版本时间线管理 · 1 个卡池');
  });

  it('saves, previews, and confirms a pool push with the signed preview token', async () => {
    const handleSavePool = vi.fn().mockResolvedValue({
      success: true,
      pool: {
        pool_id: 'pool_saved',
        name: '染赤申领',
        type: 'weapon',
        up_character: '镀红祝福',
        featured_characters: ['wpn_lance_0015', 'wpn_lance_0010'],
      },
    });
    usePools.mockReturnValue({
      ...usePools(),
      characters: [{ id: 'wpn_lance_0015', name: '不应进入推送的武器', type: 'weapon' }],
      showEditDialog: true,
      handleSavePool,
    });
    poolPushService.previewPoolPush.mockResolvedValue({
      success: true,
      data: {
        title: '【终末地新增卡池】',
        dedupeKey: 'pool-update:test',
        confirmationToken: 'signed-preview-token',
        messageText: '新增卡池：逐罪者',
        alreadyDelivered: false,
        targetCount: 1,
        allowedTargetCount: 1,
        blockedTargetCount: 0,
        targets: [
          {
            targetHash: 'group-hash',
            platform: 'personal-demo',
            adapter: 'napcat-personal-demo',
            scene: 'group',
            status: 'allowed',
          },
        ],
      },
    });
    poolPushService.sendPoolPush.mockResolvedValue({
      success: true,
      data: { sentCount: 1, skippedCount: 0, failedCount: 0, records: [] },
    });

    render(<PoolManagement showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '保存并预览推送' }));

    expect(await screen.findByText('卡池更新推送确认')).toBeInTheDocument();
    expect(handleSavePool).toHaveBeenCalledTimes(1);
    expect(poolPushService.previewPoolPush).toHaveBeenCalledWith({
      pool: {
        id: 'pool_saved',
        name: '染赤申领',
        type: 'weapon',
        upItems: ['镀红祝福'],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
    await waitFor(() => {
      expect(poolPushService.sendPoolPush).toHaveBeenCalledWith({
        confirmationToken: 'signed-preview-token',
      });
    });
  });

  it('makes it clear when saving succeeds but preview generation fails', async () => {
    const showToast = vi.fn();
    usePools.mockReturnValue({
      ...usePools(),
      showEditDialog: true,
      handleSavePool: vi.fn().mockResolvedValue({
        success: true,
        pool: { pool_id: 'pool_saved', name: '逐罪者', type: 'limited' },
      }),
    });
    poolPushService.previewPoolPush.mockResolvedValue({
      success: false,
      error: 'Bot service unavailable',
      code: 'pool_push_request_failed',
    });

    render(<PoolManagement showToast={showToast} />);
    fireEvent.click(screen.getByRole('button', { name: '保存并预览推送' }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        '卡池已保存，但生成卡池推送预览失败: Bot service unavailable',
        'error'
      );
    });
  });
});
