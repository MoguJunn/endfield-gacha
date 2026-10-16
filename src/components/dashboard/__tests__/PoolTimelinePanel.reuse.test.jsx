import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import PoolTimelinePanel, { TimelineSectionCard } from '../PoolTimelinePanel.jsx';
import { I18nProvider, getMessage } from '../../../i18n/index.js';

afterEach(cleanup);

async function renderTimeline(props) {
  let view;
  await act(async () => {
    view = render(<I18nProvider initialLocale="zh-CN"><PoolTimelinePanel {...props} /></I18nProvider>);
  });
  return view;
}

const section = {
  id: 'test', title: '卡池详情', type: 'limited', featured: '角色 A', period: '2026/01',
  status: { isTimed: true, isActive: true, remainingLabel: '进行中' }, totalPulls: 80, currentPity: 12, avgSixStarPulls: 40, avgUpPulls: 80,
  entries: [{ id: 'entry', pulls: 40, targetPulls: 80, stageKind: 'up', stageLabel: '出货', resultSummary: '角色 A',
    dateLabel: '01/22', leadBadge: { label: '角色 A', rarity: 6 }, dropBadges: [] }],
};
describe('timeline shared presentation', () => {
  it('sorts banners by opening date and filters the displayed cards independently of sharing', async () => {
    const newer = { ...section, id: 'new', title: '新卡池', startTime: '2026-06-01', endTime: '2026-07-01', acquisitions: [] };
    const older = { ...section, id: 'old', title: '旧卡池', startTime: '2026-01-01', endTime: '2026-02-01', acquisitions: [] };
    await renderTimeline({ sections: [older, newer], isGroupMode: true, displayMode: 'card' });
    expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['新卡池', '旧卡池']);
    fireEvent.change(screen.getByLabelText('开池时间排序'), { target: { value: 'asc' } });
    expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['旧卡池', '新卡池']);
    fireEvent.click(screen.getByText(/选择展示卡池/));
    fireEvent.click(screen.getByRole('checkbox', { name: '旧卡池' }));
    expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['新卡池']);
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });

  it('shows individual outcomes, pull positions, exact times and explicit unknown gift data', async () => {
    await renderTimeline({ sections: [{ ...section, acquisitions: [
      { id: 'first', name: '角色 A', rarity: 6, stageKind: 'up', drawMethod: 'normal', pullIndex: 42, intervalPulls: 12, timestamp: '2026-06-01T12:34:56Z' },
      { id: 'gift', name: '角色 A', rarity: 6, stageKind: 'gift', drawMethod: 'gift', pullIndex: null, intervalPulls: null, timestamp: null },
    ] }], displayMode: 'card', mobile: true });
    const [normal, gift] = screen.getAllByRole('article');
    expect(within(normal).getByText('第 42 抽')).toBeInTheDocument();
    expect(within(normal).getByText('12 抽')).toBeInTheDocument();
    expect(normal.querySelector('time').dateTime).toBe('2026-06-01T12:34:56Z');
    expect(normal.querySelector('time').textContent).toMatch(/:56/);
    expect(within(gift).getByText('时间未知')).toBeInTheDocument();
    expect(within(gift).queryByText(/第 .* 抽/)).not.toBeInTheDocument();
  });

  it('updates an expired weapon snapshot to a closed remainder without losing its five-star results', async () => {
    await renderTimeline({ sections: [{ ...section, type: 'weapon', startTime: '2020-01-01', endTime: '2020-02-01',
      entries: [{ ...section.entries[0], id: 'pending', stageKind: 'current', isCurrentStage: true, pulls: 8,
        stageLabel: '当前推进', resultSummary: '正在推进', dropBadges: [{ label: '五星武器', rarity: 5, count: 1 }] }] }] });
    expect(screen.queryByText('当前推进')).not.toBeInTheDocument();
    expect(screen.queryByText('正在推进')).not.toBeInTheDocument();
    expect(screen.getByText('收池结余')).toBeInTheDocument();
    expect(screen.getByText('五星武器')).toBeInTheDocument();
  });

  it('preserves the main page default metrics, bar value and UP stamp', async () => {
    await renderTimeline({ sections: [section] });
    expect(screen.getByText('卡池详情')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('UP')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('40.0 抽')).toHaveLength(1);
  });
  it('renders supplied workbench metrics without leaking calculated main-page metrics', () => {
    render(<TimelineSectionCard section={section} dense embedded t={(key, params) => getMessage(key, params, 'zh-CN')} locale="zh-CN"
      metrics={[{ label: '已知数量', value: '3' }]} statusText="待保存" renderEntry={(entry) => <p>本地条目 {entry.id}</p>} />);
    expect(screen.getByText('已知数量')).toBeInTheDocument();
    expect(screen.getByText('本地条目 entry')).toBeInTheDocument();
    expect(screen.queryByText('40.0 抽')).not.toBeInTheDocument();
    expect(screen.queryByText('12')).not.toBeInTheDocument();
  });

  it('shows carried pity inside the milestone bar while preserving the total interval', async () => {
    const carried = { ...section, entries: [{ ...section.entries[0], pulls: 67, inheritedPulls: 45, localPulls: 22 }] };
    await renderTimeline({ sections: [carried] });
    expect(screen.getByText('67')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '上池垫抽 45 抽' })).toBeInTheDocument();
    expect(screen.getByText('+ 本池 22 抽')).toBeInTheDocument();
  });

  it('distinguishes the 120-pull guarantee from an ordinary UP hit without replacing the six-star interval', async () => {
    const guaranteed = { ...section, entries: [{ ...section.entries[0], pulls: 50, guaranteePulls: 120 }] };
    await renderTimeline({ sections: [guaranteed] });
    expect(screen.getByText('120 抽保底出货')).toBeInTheDocument();
    expect(screen.getByText('保底')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.queryByText('UP')).not.toBeInTheDocument();
  });

  it('renders one complete weapon ten-pull strip for multiple six-stars, and respects the five-star toggle', async () => {
    const batch = {
      key: 'ten', size: 10, isCompleteTenPull: true, sixStarCount: 2, fiveStarCount: 3,
      slots: [5, 4, 4, 6, 4, 5, 4, 4, 6, 5].map((rarity, index) => ({ rarity, label: `武器${index + 1}` })),
    };
    const weapon = { ...section, type: 'weapon', entries: [
      { ...section.entries[0], id: 'up', highestRarity: 6, multiDropBatchKey: 'ten', weaponBatch: batch },
      { ...section.entries[0], id: 'off', stageKind: 'offStandard', highestRarity: 6, multiDropBatchKey: 'ten', weaponBatch: batch },
    ] };
    const onToggle = vi.fn();
    const { rerender } = await renderTimeline({ sections: [weapon], onToggleShowFiveStarDrops: onToggle });
    const strip = screen.getByRole('list', { name: '本次十连' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('6★ ×2')).toBeInTheDocument();
    expect(screen.getByText('5★ ×3')).toBeInTheDocument();
    expect(within(strip).getByRole('listitem', { name: '第 10 抽：5★ 武器10' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /隐藏五星/ }));
    expect(onToggle).toHaveBeenCalledWith(false);
    rerender(<I18nProvider initialLocale="zh-CN"><PoolTimelinePanel sections={[weapon]} showFiveStarDrops={false} onToggleShowFiveStarDrops={onToggle} /></I18nProvider>);
    expect(screen.queryByText('5★ ×3')).not.toBeInTheDocument();
    expect(within(strip).getAllByRole('listitem')).toHaveLength(10);
    expect(within(strip).queryByRole('listitem', { name: '第 10 抽：5★ 武器10' })).not.toBeInTheDocument();

    const partial = { ...weapon, entries: [{ ...weapon.entries[0], weaponBatch: { ...batch, size: 4, isCompleteTenPull: false } }] };
    rerender(<I18nProvider initialLocale="zh-CN"><PoolTimelinePanel sections={[partial]} /></I18nProvider>);
    expect(screen.getByText('该批已知 4 抽')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '本次十连' })).not.toBeInTheDocument();
  });
});
