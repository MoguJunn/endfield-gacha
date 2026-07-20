import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RecordsView from '../RecordsView.jsx';

const harness = vi.hoisted(() => ({
  user: { id: 'user-1' },
  poolData: null,
  loadMoreHistory: vi.fn(),
  setVisibleHistoryCount: vi.fn(),
  loadHistoryAnomalies: vi.fn(),
  updateHistoryAnomaly: vi.fn(),
}));

vi.mock('../../../stores', () => ({
  useAuthStore: (selector) => selector({ user: harness.user }),
  useHistoryStore: (selector) =>
    selector({
      visibleHistoryCount: 20,
      loadMoreHistory: harness.loadMoreHistory,
      setVisibleHistoryCount: harness.setVisibleHistoryCount,
    }),
}));

vi.mock('../../../hooks', () => ({
  useCurrentPoolData: () => harness.poolData,
  useCurrentPoolGroupedHistory: () => ({ groupedHistory: [], filteredGroupedHistory: [] }),
}));

vi.mock('../../BatchCard', () => ({ default: () => null }));
vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    t: (key, values = {}) =>
      ({
        'records.anomaly.title': `这个卡池有 ${values.count} 条记录需要你核对`,
        'records.anomaly.loadFailed': '待核对记录读取失败',
        'records.anomaly.updateFailed': '待核对记录更新失败',
        'records.anomaly.unknownItem': '未知角色或武器',
        'records.anomaly.seq': `序号 ${values.seq}`,
        'records.anomaly.missingIdentity': '官方记录缺少可识别的物品字段',
        'records.anomaly.keep': '保留',
        'records.anomaly.edit': '编辑记录',
        'records.anomaly.delete': '删除记录',
        'records.anomaly.postpone': '24 小时后提醒',
      })[key] || key,
    formatNumber: String,
    locale: 'zh-CN',
  }),
}));
vi.mock('../../../utils/gameDataI18n.js', () => ({
  localizePoolName: (pool) => pool?.name || '',
}));
vi.mock('../../../utils/historyInfoBook.js', () => ({
  isFreeHistoryPull: () => false,
  isGiftHistoryPull: () => false,
  isInfoBookHistoryPull: () => false,
}));
vi.mock('../../../services/historyAnomalyService.js', () => ({
  loadHistoryAnomalies: harness.loadHistoryAnomalies,
  updateHistoryAnomaly: harness.updateHistoryAnomaly,
}));

function makeRecord(overrides = {}) {
  return {
    id: 'record-1',
    seqId: '10',
    poolId: 'pool-1',
    gameUid: 'game-1',
    serverScope: 'cn-1',
    rarity: 4,
    timestamp: '2026-07-11T10:00:00.000Z',
    ...overrides,
  };
}

function makeAnomaly(overrides = {}) {
  return {
    id: 'anomaly-1',
    record_id: 'record-1',
    seq_id: '10',
    pool_id: 'pool-1',
    game_uid: 'game-1',
    server_scope: 'cn-1',
    issue_code: 'OFFICIAL_IMPORT_UNKNOWN_ITEM',
    details: { itemName: '未知记录', message: '官方记录缺少物品字段' },
    ...overrides,
  };
}

function setPool(poolId = 'pool-1', record = makeRecord({ poolId })) {
  harness.poolData = {
    currentPool: { id: poolId, name: poolId, type: 'limited_character' },
    normalizedCurrentPoolHistory: [record],
    poolsArray: [{ id: poolId, name: poolId, type: 'limited_character' }],
  };
}

describe('RecordsView history anomalies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.user = { id: 'user-1' };
    setPool();
    harness.loadHistoryAnomalies.mockResolvedValue([makeAnomaly()]);
    harness.updateHistoryAnomaly.mockResolvedValue({});
  });

  it('只在当前账号、区服和卡池显示提醒，并把精确记录交给编辑删除', async () => {
    const onEdit = vi.fn();
    const onDeleteItem = vi.fn();
    render(<RecordsView onEdit={onEdit} onDeleteItem={onDeleteItem} onDeleteGroup={vi.fn()} />);

    expect(await screen.findByText(/这个卡池有 1 条记录需要你核对/)).toBeInTheDocument();
    expect(screen.getByText('官方记录缺少可识别的物品字段')).toBeInTheDocument();
    expect(screen.queryByText('官方记录缺少物品字段')).not.toBeInTheDocument();
    expect(harness.loadHistoryAnomalies).toHaveBeenCalledWith({
      poolId: 'pool-1',
      gameUid: 'game-1',
      serverScope: 'cn-1',
    });

    fireEvent.click(screen.getByRole('button', { name: /编辑记录/ }));
    fireEvent.click(screen.getByRole('button', { name: /删除记录/ }));
    expect(onEdit).toHaveBeenCalledWith(harness.poolData.normalizedCurrentPoolHistory[0]);
    expect(onDeleteItem).toHaveBeenCalledWith(harness.poolData.normalizedCurrentPoolHistory[0]);

    fireEvent.click(screen.getByRole('button', { name: /24 小时后提醒/ }));
    await waitFor(() => {
      expect(harness.updateHistoryAnomaly).toHaveBeenCalledWith({
        anomalyId: 'anomaly-1',
        action: 'postpone',
      });
      expect(screen.queryByText(/这个卡池有 1 条记录需要你核对/)).not.toBeInTheDocument();
    });
  });

  it('首次读取失败时显示错误而不是静默隐藏', async () => {
    harness.loadHistoryAnomalies.mockRejectedValue(new Error('数据库暂时不可用'));
    render(<RecordsView onEdit={vi.fn()} onDeleteItem={vi.fn()} onDeleteGroup={vi.fn()} />);

    expect(await screen.findByText('待核对记录读取失败')).toBeInTheDocument();
    expect(screen.queryByText(/数据库暂时不可用/)).not.toBeInTheDocument();
  });

  it('保留记录时只结束异常提醒，不触发编辑或删除', async () => {
    const onEdit = vi.fn();
    const onDeleteItem = vi.fn();
    render(<RecordsView onEdit={onEdit} onDeleteItem={onDeleteItem} onDeleteGroup={vi.fn()} />);

    await screen.findByText(/这个卡池有 1 条记录需要你核对/);
    fireEvent.click(screen.getByRole('button', { name: '保留' }));

    await waitFor(() => {
      expect(harness.updateHistoryAnomaly).toHaveBeenCalledWith({
        anomalyId: 'anomaly-1',
        action: 'confirm',
      });
    });
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDeleteItem).not.toHaveBeenCalled();
  });

  it('当前账号在卡池内没有记录时不退化为跨账号查询', async () => {
    harness.poolData = {
      currentPool: { id: 'pool-1', name: 'pool-1', type: 'limited_character' },
      normalizedCurrentPoolHistory: [],
      poolsArray: [{ id: 'pool-1', name: 'pool-1', type: 'limited_character' }],
    };

    render(<RecordsView onEdit={vi.fn()} onDeleteItem={vi.fn()} onDeleteGroup={vi.fn()} />);

    await waitFor(() => {
      expect(harness.loadHistoryAnomalies).not.toHaveBeenCalled();
    });
  });

  it('一条异常正在更新时阻止其他异常并发提交', async () => {
    let resolveUpdate;
    harness.loadHistoryAnomalies.mockResolvedValue([
      makeAnomaly(),
      makeAnomaly({ id: 'anomaly-2', record_id: 'record-2', seq_id: '11' }),
    ]);
    harness.updateHistoryAnomaly.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
    );

    render(<RecordsView onEdit={vi.fn()} onDeleteItem={vi.fn()} onDeleteGroup={vi.fn()} />);

    const keepButtons = await screen.findAllByRole('button', { name: '保留' });
    fireEvent.click(keepButtons[0]);
    fireEvent.click(keepButtons[1]);

    expect(harness.updateHistoryAnomaly).toHaveBeenCalledTimes(1);
    expect(harness.updateHistoryAnomaly).toHaveBeenCalledWith({
      anomalyId: 'anomaly-1',
      action: 'confirm',
    });

    await act(async () => {
      resolveUpdate({});
    });
  });

  it('快速切换卡池时忽略旧卡池迟到的响应', async () => {
    let resolveFirst;
    let resolveSecond;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    harness.loadHistoryAnomalies.mockImplementation(({ poolId }) =>
      poolId === 'pool-a' ? firstResponse : secondResponse
    );

    setPool('pool-a', makeRecord({ id: 'record-a', poolId: 'pool-a' }));
    const view = render(<RecordsView onEdit={vi.fn()} onDeleteItem={vi.fn()} onDeleteGroup={vi.fn()} />);
    await waitFor(() =>
      expect(harness.loadHistoryAnomalies).toHaveBeenCalledWith(expect.objectContaining({ poolId: 'pool-a' }))
    );

    setPool('pool-b', makeRecord({ id: 'record-b', poolId: 'pool-b' }));
    view.rerender(<RecordsView onEdit={vi.fn()} onDeleteItem={vi.fn()} onDeleteGroup={vi.fn()} />);
    await waitFor(() =>
      expect(harness.loadHistoryAnomalies).toHaveBeenCalledWith(expect.objectContaining({ poolId: 'pool-b' }))
    );

    await act(async () => {
      resolveSecond([
        makeAnomaly({
          id: 'anomaly-b',
          record_id: 'record-b',
          pool_id: 'pool-b',
          details: { itemName: '新池记录' },
        }),
      ]);
    });
    expect(await screen.findByText('新池记录')).toBeInTheDocument();

    await act(async () => {
      resolveFirst([
        makeAnomaly({
          id: 'anomaly-a',
          record_id: 'record-a',
          pool_id: 'pool-a',
          details: { itemName: '旧池记录' },
        }),
      ]);
    });
    expect(screen.queryByText('旧池记录')).not.toBeInTheDocument();
    expect(screen.getByText('新池记录')).toBeInTheDocument();
  });
});
