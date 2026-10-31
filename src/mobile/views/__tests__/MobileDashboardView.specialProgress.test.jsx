import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../../i18n/index.js';
import { buildDashboardSpecialProgress, getDashboardPoolViewMeta } from '../../../hooks/app/useDashboardViewState.js';
import { EXTRA_RULE_PROFILES } from '../../../utils/poolCapabilities.js';

const mocks = vi.hoisted(() => ({ view: null }));
vi.mock('../../../hooks', () => ({
  useDashboardViewState: () => mocks.view,
  useCloudSync: () => ({ refreshPersonalData: vi.fn() }),
  useToast: () => ({ toasts: [], showToast: vi.fn(), removeToast: vi.fn() }),
}));
vi.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('../../components/MobilePoolRailSelector', () => ({ default: () => null }));
vi.mock('../../../components/app/AccountServerLabelNotice.jsx', () => ({ default: () => null }));
vi.mock('../../../components/resources/ResourceSummaryPanel', () => ({ default: () => null }));

import MobileDashboardView from '../MobileDashboardView.jsx';

function createView(pool = { id: 'limited-a', name: '测试限定池', type: 'limited' }, stats = {}) {
  const meta = getDashboardPoolViewMeta(pool);
  const poolStats = {
    total: 50, paidTotal: 40, freePullCount: 10, sixStarCount: 1,
    counts: { 6: 1, '6_std': 0, 5: 4, 4: 45 }, winRate: '100',
    chartData: [], pityStats: { history: [], distribution: [] },
    ...stats,
  };
  const targetProgress = { validPullCount: 40, firstTargetIndex: 40 };
  return {
    ...meta,
    user: { id: 'user-1' }, currentPool: pool, selectedPools: [pool],
    normalizedPoolHistory: [], allLimitedHistory: [], groupedHistory: [], characterStats: [],
    crossPoolPityMap: null, effectivePity: { pity6: 1, pity5: 1 },
    hasPoolData: true, isGroupMode: false, isAllPoolsOverview: false, hasMergedAccountView: false,
    isAnalysisBacked: true, snapshotTimelineSections: [],
    stats: poolStats, checkLimitedInFirstN: targetProgress,
    specialProgress: buildDashboardSpecialProgress({
      capabilities: meta.capabilities,
      paidTotal: poolStats.rewardPaidTotal ?? poolStats.paidTotal,
      freePullCount: poolStats.freePullCount,
      targetProgress,
    }),
    charViewMode: 'card', setCharViewMode: vi.fn(),
    includeFreePullsInStats: false, setIncludeFreePullsInStats: vi.fn(),
    currentUpPool: { isExpired: true }, getProgressClass: () => 'bg-cyan-500',
    weaponGifts: meta.isWeapon
      ? { nextGift: 200, nextGiftType: 'limited', standardCount: 1, limitedCount: 0 }
      : null,
  };
}

async function renderPage() {
  let page;
  await act(async () => {
    page = render(<MemoryRouter><I18nProvider initialLocale="zh-CN"><MobileDashboardView /></I18nProvider></MemoryRouter>);
  });
  return page;
}

function expandProgress() {
  const toggle = screen.getByRole('button', { name: '特殊机制进度' });
  fireEvent.click(toggle);
  return within(document.getElementById(toggle.getAttribute('aria-controls')));
}

beforeEach(() => { mocks.view = createView(); });
afterEach(cleanup);

describe('mobile special mechanism progress', () => {
  it('renders one panel after average pulls and removes its contents when collapsed', async () => {
    const page = await renderPage();
    expect(screen.getAllByText('特殊机制进度')).toHaveLength(1);
    const toggle = screen.getByRole('button', { name: '特殊机制进度' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('免费十连 (仅一次)')).toBeNull();
    expect(screen.getByText('平均出货').compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const panel = expandProgress();
    expect(panel.getByText('免费十连 (仅一次)')).toBeTruthy();
    expect(panel.getByText('必出限定 (120抽)')).toBeTruthy();
    expect(panel.getByText('赠送角色潜能 (每240抽)')).toBeTruthy();
    expect(panel.getByText('寻访情报书 (60抽)')).toBeTruthy();
    fireEvent.scroll(page.container.firstChild, { target: { scrollTop: 1000 } });
    expect(screen.getAllByText('特殊机制进度')).toHaveLength(1);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('免费十连 (仅一次)')).toBeNull();
    expect(screen.queryByText('必出限定 (120抽)')).toBeNull();
    expect(screen.queryByText('赠送角色潜能 (每240抽)')).toBeNull();
    expect(screen.queryByText('寻访情报书 (60抽)')).toBeNull();
  });

  it('preserves the standard pool selector progress', async () => {
    mocks.view = createView({ id: 'standard', name: '常驻池', type: 'standard' });
    await renderPage();
    expect(screen.getAllByText('特殊机制进度')).toHaveLength(1);
    expect(expandProgress().getByText('40 / 300')).toBeTruthy();
  });

  it('preserves ordinary weapon guarantee and gift progress', async () => {
    mocks.view = createView({ id: 'weapon', name: '武器池', type: 'weapon' });
    await renderPage();
    const panel = expandProgress();
    expect(panel.getByText('首轮限定必出 (80抽)')).toBeTruthy();
    expect(panel.getByText('40 / 200')).toBeTruthy();
  });

  it('preserves reconstruction character milestones and rewards across the series', async () => {
    mocks.view = createView({ id: 'rerun', name: '重构角色寻访', type: 'extra',
      extra_rule_profile: EXTRA_RULE_PROFILES.RECONSTRUCTION_CHARACTER }, { rewardPaidTotal: 280 });
    await renderPage();
    const panel = expandProgress();
    expect(panel.getByText('40 / 240')).toBeTruthy();
    expect(panel.getByText('同系列目标角色保障 (120抽)')).toBeTruthy();
    expect(panel.getByText('同系列目标角色信物 (每240抽)')).toBeTruthy();
    for (const threshold of [30, 60, 90]) {
      expect(panel.getByText(`${threshold}抽免费十连`)).toBeTruthy();
    }
    expect(panel.getAllByText('不计入保底次数')).toHaveLength(3);
    expect(panel.queryByText('寻访情报书 (60抽)')).toBeNull();
    expect(panel.queryByText('必出限定 (120抽)')).toBeNull();
  });

  it('preserves reconstruction weapon claim units and series rewards', async () => {
    mocks.view = createView({ id: 'rerun-weapon', name: '重构武器寻访', type: 'extra',
      extra_rule_profile: EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON }, { rewardPaidTotal: 120 });
    await renderPage();
    const panel = expandProgress();
    expect(panel.getByText('12 / 20 次申领')).toBeTruthy();
    expect(panel.getByText('同系列目标武器保障 (8次申领 / 80抽)')).toBeTruthy();
    expect(panel.queryByText('首轮限定必出 (80抽)')).toBeNull();
  });

  it.each(['isGroupMode', 'hasMergedAccountView'])('hides account-specific progress when %s is enabled', async (mode) => {
    mocks.view = { ...mocks.view, [mode]: true };
    await renderPage();
    expect(screen.queryByText('特殊机制进度')).toBeNull();
  });
});
