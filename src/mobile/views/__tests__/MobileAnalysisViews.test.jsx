import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../../i18n/index.js';
import useAuthStore from '../../../stores/useAuthStore.js';
import usePoolStore from '../../../stores/usePoolStore.js';
import useHistoryStore from '../../../stores/useHistoryStore.js';
import usePersonalAnalysisStore from '../../../stores/usePersonalAnalysisStore.js';
import useAppStore from '../../../stores/useAppStore.js';

const mocks = vi.hoisted(() => ({ useSummaryViewState: vi.fn() }));
vi.mock('../../../hooks/summary', () => ({
  useSummaryViewState: mocks.useSummaryViewState,
  useThemeDetection: () => false,
  getTooltipStyle: () => ({}),
}));
vi.mock('../../../components/summary', () => ({
  CharacterCatalogView: () => <div>图鉴内容</div>,
  ChartSection: () => <div>图表内容</div>,
}));
vi.mock('../../../components/resources/ResourceSummaryPanel.jsx', () => ({ default: () => null }));
vi.mock('../../../components/summary/PoolStatisticsWorkspace.jsx', () => ({
  default: ({ overview }) => overview('global', null),
}));

import MobileOverviewView from '../MobileOverviewView.jsx';
import MobileStatisticsWorkspace from '../MobileStatsView.jsx';

const account = { accountKey: 'game-1::server:1', gameUid: 'game-1', serverScope: '1', nickName: '测试账号' };
async function renderPage(Component) {
  let page;
  await act(async () => { page = render(<MemoryRouter><I18nProvider initialLocale="zh-CN">{React.createElement(Component)}</I18nProvider></MemoryRouter>); });
  return page;
}
const metric = label => within(screen.getByRole('region', { name: '个人总览' }))
  .getByText(label).parentElement;

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'user-1' } });
  usePoolStore.setState({ pools: [], currentGameUid: account.accountKey });
  useHistoryStore.setState({ history: [] });
  useAppStore.setState({ globalStatsLoading: false });
  usePersonalAnalysisStore.setState({ ownerId: 'user-1', availability: 'ready',
    owner: { accounts: [account] }, scope: { account, dashboard: { views: {
      'pool-current': { excludeFree: { stats: { total: 12, totalSixStar: 1 } } },
    } }, overview: { total: 1200, sixStar: 24, totalKnown: true },
    recentSixStars: [{ id: 'six-1', name: '测试六星', timestamp: '2026-10-10T10:00:00Z', pity: 60 }] } });
  mocks.useSummaryViewState.mockReturnValue({
    dataSource: 'global', setDataSource: vi.fn(), poolTypeFilter: 'all', setPoolTypeFilter: vi.fn(),
    currentStats: { total: 9999, sixStar: 99, counts: { 6: 99 }, byType: {},
      workbench: { status: 'ready', coverage: { includedLedgers: 1 }, supplemental: { sixStarCount: 2 } } },
    chartDisplayData: { charts: [] }, filterOptions: [],
  });
});
afterEach(cleanup);

describe('mobile personal overview', () => {
  it('shows account totals when only the selected banner view is loaded', async () => {
    await renderPage(MobileOverviewView);
    expect(metric('总抽数').textContent).toContain('1200');
    expect(metric('6★ 总数').textContent).toContain('24');
    expect(screen.getByText('测试六星')).toBeTruthy();
  });

  it('shows a lower bound for incomplete supplements and includes unclassified six-stars', async () => {
    usePersonalAnalysisStore.setState(state => ({ scope: { ...state.scope,
      overview: { total: 285, sixStar: 26, totalKnown: false } } }));
    await renderPage(MobileOverviewView);
    expect(metric('总抽数').textContent).toContain('≥ 285');
    expect(metric('6★ 总数').textContent).toContain('26');
  });

  it('does not display old account totals or owner-wide totals while switching accounts', async () => {
    const next = { ...account, accountKey: 'game-2::server:1', gameUid: 'game-2', nickName: '新账号' };
    usePersonalAnalysisStore.setState({ owner: { accounts: [account, next] } });
    usePoolStore.setState({ currentGameUid: next.accountKey });
    await renderPage(MobileOverviewView);
    expect(metric('总抽数').textContent).toContain('—');
    expect(metric('6★ 总数').textContent).toContain('—');
    expect(screen.queryByText('测试六星')).toBeNull();
  });

  it('distinguishes missing overview data from verified zero totals', async () => {
    usePersonalAnalysisStore.setState(state => ({ scope: { ...state.scope, overview: null } }));
    const page = await renderPage(MobileOverviewView);
    expect(metric('总抽数').textContent).toContain('—');
    page.unmount();
    usePersonalAnalysisStore.setState(state => ({ scope: { ...state.scope,
      overview: { total: 0, sixStar: 0, totalKnown: true } } }));
    await renderPage(MobileOverviewView);
    expect(metric('总抽数').textContent).toContain('0');
    expect(metric('总抽数').textContent).not.toContain('—');
  });

  it('reads the same totals from an already loaded complete account snapshot', async () => {
    usePersonalAnalysisStore.setState(state => ({ scope: { ...state.scope, overview: undefined,
      dashboard: { views: { __group_all: { excludeFree: { stats: { total: 1200, totalSixStar: 24 } } } } } } }));
    await renderPage(MobileOverviewView);
    expect(metric('总抽数').textContent).toContain('1200');
    expect(metric('6★ 总数').textContent).toContain('24');
  });
});

describe('mobile aggregate statistics', () => {
  it('renders loaded overview with the real supplement panel and opens the catalog', async () => {
    await renderPage(MobileStatisticsWorkspace);
    expect(screen.getByRole('region', { name: '补录覆盖统计' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '角色图鉴' }));
    expect(screen.getByText('图鉴内容')).toBeTruthy();
  });
});
