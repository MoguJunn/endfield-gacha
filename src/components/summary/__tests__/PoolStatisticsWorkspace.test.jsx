import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStoredPoolObservations, getStoredObservationAccounts } from '../../../utils/storedPoolObservations.js';

const state = vi.hoisted(() => ({ user: null, pools: [], history: [], load: vi.fn(), auth: vi.fn(), english: false, dark: false }));
vi.mock('../../../i18n/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useI18n: () => ({ isEnglish: state.english, locale: state.english ? 'en-US' : 'zh-CN', t: (key, values) => actual.getMessage(key, values, state.english ? 'en-US' : 'zh-CN'), formatNumber: (value) => String(value) }) };
});
vi.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: state.dark }) }));
vi.mock('../../../stores/index.js', () => ({
  useAppStore: (selector) => selector({ globalStats: null, fetchGlobalStats: state.load }),
  useAuthStore: (selector) => selector({ user: state.user, openAuthModal: state.auth }),
  useHistoryStore: (selector) => selector({ history: state.history }),
  usePoolStore: (selector) => selector({ pools: state.pools, currentPoolId: null }),
}));
vi.mock('../../../services/scheduledStatisticsService.js', () => ({ loadPersonalStatistics: state.load }));
vi.mock('../PoolObservationCharts.jsx', () => ({ default: ({ stats }) => <div data-testid="chart-source">{stats.scopeKind === 'group' ? stats.groupKey : stats.poolId}:{stats.total}</div> }));
vi.mock('../PoolTargetPrediction.jsx', () => ({ default: () => <div>theory</div> }));
import PoolStatisticsWorkspace from '../PoolStatisticsWorkspace.jsx';

const record = (id, uid, scope = 'cn') => ({ id, user_id: 'owner', game_uid: uid, server_scope: scope, poolId: 'p', character_id: 'a', rarity: 6, timestamp: 1700000000000 + id * 1000 });
const response = (data) => ({ ok: true, json: async () => ({ success: true, data }) });
function snapshot(history, ownerId = 'owner') {
  const accounts = getStoredObservationAccounts(history);
  const scopes = Object.fromEntries(['', ...accounts.map((account) => account.key)].map((key) => [key,
    Object.fromEntries(['p', 'q'].map((poolId) => [poolId, buildStoredPoolObservations({ history, poolId, accountKey: key || null })]))]));
  return { data: { accounts, scopes, pools: [] }, meta: { ownerId, updatedAt: '2026-09-22T00:00:00Z', refreshMinutes: 30 } };
}

beforeEach(() => {
  state.user = null;
  state.pools = [];
  state.history = [];
  state.english = false;
  state.dark = false;
  state.load.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url) => response(String(url).includes('type=characters') ? { characters: [{ id: 'a', name: 'A', rarity: 6, type: 'character' }] }
    : { pools: [{ id: 'p', name: '卡池 P', type: 'limited' }, { id: 'q', name: '卡池 Q', type: 'limited' }] })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('real statistics workspace', () => {
  it('does not load private history for a signed-out user', async () => {
    render(<PoolStatisticsWorkspace lockedDataSource="local" />);
    expect(screen.getByText('登录后读取你已保存的账号与抽卡记录。')).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(state.load).not.toHaveBeenCalled();
  });
  it('filters game accounts by UID and region using all saved rows', async () => {
    state.user = { id: 'owner' };
    state.load.mockResolvedValue(snapshot([record(1, 'same'), record(2, 'same'), record(3, 'same', 'intl')]));
    render(<PoolStatisticsWorkspace lockedDataSource="local" />);
    await waitFor(() => expect(screen.getByTestId('observation-total').textContent).toBe('3'));
    const select = screen.getByLabelText('游戏账号');
    expect(select.options.length).toBe(3);
    fireEvent.change(select, { target: { value: select.options[2].value } });
    expect(screen.getByTestId('observation-total').textContent).toBe('1');
    expect(screen.queryByLabelText('首次定义')).toBeNull();
    expect(screen.getByText('首次均指同一对象在本期卡池内首次获得。')).toBeTruthy();
  });
  it('switches compact banner rows without loading raw history again', async () => {
    state.user = { id: 'owner' };
    state.load.mockResolvedValue(snapshot([record(1, 'same'), record(2, 'same'), { ...record(3, 'same'), poolId: 'q' }]));
    const { container } = render(<PoolStatisticsWorkspace lockedDataSource="local" />);
    await waitFor(() => expect(screen.getByTestId('observation-total').textContent).toBe('2'));
    expect(container.querySelector('.pool-card-rail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '卡池 Q' }));
    expect(screen.getByTestId('chart-source').textContent).toBe('q:1');
    expect(screen.getByRole('button', { name: '卡池 Q' }).getAttribute('aria-pressed')).toBe('true');
    expect(state.load).toHaveBeenCalledTimes(1);
  });
  it('removes the previous owner data before the next owner response arrives', async () => {
    state.user = { id: 'owner' };
    state.load.mockResolvedValueOnce(snapshot([record(1, 'old-uid')]));
    const view = render(<PoolStatisticsWorkspace lockedDataSource="local" />);
    await screen.findByTestId('observation-total');
    let resolve;
    state.load.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    state.user = { id: 'new-owner' };
    view.rerender(<PoolStatisticsWorkspace lockedDataSource="local" />);
    expect(screen.queryByTestId('observation-total')).toBeNull();
    expect(screen.queryByText(/old-uid/)).toBeNull();
    await act(async () => resolve(snapshot([], 'new-owner')));
    expect(screen.getByText('尚未导入记录。请先从个人卡池分析导入。')).toBeTruthy();
  });
  it.each([{ truncated: true }, { ownerId: 'wrong-owner' }])('rejects incomplete or mismatched private results: %j', async (meta) => {
    state.user = { id: 'owner' };
    state.load.mockResolvedValue({ ...snapshot([record(1, 'uid')]), meta: { ownerId: 'owner', ...meta } });
    render(<PoolStatisticsWorkspace lockedDataSource="local" />);
    await screen.findByRole('alert');
    expect(screen.queryByTestId('observation-total')).toBeNull();
  });

  it('loads public group statistics independently and clears prior scope while loading', async () => {
    const observations = buildStoredPoolObservations({ history: [record(1, 'uid')], poolId: 'p' });
    let resolveGroup;
    fetch.mockImplementation(async (url) => {
      const params = new URL(url, 'https://example.test').searchParams;
      if (params.get('type') === 'group_statistics') {
        expect(params.get('groupKey')).toBe('limited');
        expect(params.has('poolId')).toBe(false);
        return new Promise((resolve) => { resolveGroup = resolve; });
      }
      if (params.get('type') === 'pool_observations') return response({ observations, legacy: legacy(40), meta: {} });
      if (params.get('type') === 'pool_counts') return response({ counts: { p: 1, q: 2 } });
      return response({ pools: [{ id: 'p', name: '卡池 P', type: 'limited', up_character: 'A' }, { id: 'q', name: '卡池 Q', type: 'limited' }] });
    });
    render(<PoolStatisticsWorkspace lockedDataSource="global" />);
    await screen.findByTestId('observation-total');
    expect(screen.getByTestId('legacy-regularTotal').textContent).toBe('40');
    const groupButton = screen.getByRole('button', { name: '全部限定角色' });
    expect(groupButton.textContent).toContain('2 期卡池');
    expect(groupButton.textContent).toContain('3 条记录合计');
    fireEvent.click(screen.getByRole('button', { name: '理论预测' }));
    expect(screen.getByText('theory')).toBeTruthy();
    fireEvent.click(groupButton);
    expect(screen.queryByText('theory')).toBeNull();
    expect(screen.queryByTestId('observation-total')).toBeNull();
    expect(screen.queryByTestId('legacy-regularTotal')).toBeNull();
    expect(screen.getByRole('button', { name: '理论预测' }).disabled).toBe(true);
    expect(groupButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '卡池 P' }).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(resolveGroup).toBeTypeOf('function'));
    await act(async () => resolveGroup(response({ observations: { ...observations, scopeKind: 'group', groupKey: 'limited', total: 3,
      members: [{ id: 'p', name: '卡池 P', total: 1 }, { id: 'q', name: '卡池 Q', total: 2 }] }, legacy: legacy(120), memberIds: ['p', 'q'], memberSignature: 'p,q', meta: {} })));
    expect(screen.getByTestId('chart-source').textContent).toBe('limited:3');
    expect(screen.getByTestId('legacy-regularTotal').textContent).toBe('120');
    expect(within(screen.getByRole('region', { name: '范围与成员期数' })).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '卡池 P' }));
    await waitFor(() => expect(screen.getByTestId('chart-source').textContent).toBe('p:1'));
    expect(screen.getByRole('button', { name: '理论预测' }).disabled).toBe(false);
  });

  it('uses personal groupScopes and legacyScopes and keeps the group selected across accounts', async () => {
    state.user = { id: 'owner' };
    const result = snapshot([record(1, 'first'), record(2, 'second'), { ...record(3, 'second'), poolId: 'q' }]);
    result.data.legacyScopes = { '': { p: legacy(10) } };
    result.data.groupScopes = Object.fromEntries(['', ...result.data.accounts.map((item) => item.key)].map((key, index) => [key, {
      limited: { observations: { ...result.data.scopes[key].p, scopeKind: 'group', groupKey: 'limited', total: index === 0 ? 3 : index,
        members: [{ id: 'p', name: '卡池 P', total: 1 }, { id: 'q', name: '卡池 Q', total: 2 }] }, legacy: legacy(100 + index) },
    }]));
    state.load.mockResolvedValue(result);
    render(<PoolStatisticsWorkspace lockedDataSource="local" />);
    await screen.findByTestId('observation-total');
    expect(screen.getByTestId('legacy-regularTotal').textContent).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: '全部限定角色' }));
    expect(screen.getByTestId('chart-source').textContent).toBe('limited:3');
    expect(screen.getByTestId('legacy-regularTotal').textContent).toBe('100');
    const select = screen.getByLabelText('游戏账号');
    fireEvent.change(select, { target: { value: select.options[2].value } });
    expect(screen.getByTestId('legacy-regularTotal').textContent).toBe('102');
    expect(screen.getByRole('button', { name: '全部限定角色' }).getAttribute('aria-pressed')).toBe('true');
    expect(state.load).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.every(([url]) => !String(url).includes('group_statistics'))).toBe(true);
  });

  it('offers exactly five aggregate types with separate reconstruction entries and filters synthetic pools', async () => {
    state.user = { id: 'owner' };
    state.pools = [{ id: '__group_limited', name: '合成分组', type: 'limited' }];
    const result = snapshot([record(1, 'uid')]);
    result.data.pools = [
      { id: 'wl', name: '限定武器', type: 'weapon', isLimitedWeapon: true },
      { id: 'ws', name: '常驻武器', type: 'weapon', is_limited_weapon: false },
      { id: 'rc', name: '重构角色', type: 'extra', extra_subtype: 'reconstruction' },
      { id: 'rw', name: '重构武器', type: 'extra', extra_subtype: 'reconstruction_claim' },
      { id: 's', name: '常驻角色', type: 'standard' },
      { id: 'e', name: '庆典', type: 'extra', extra_subtype: 'special' },
    ];
    state.load.mockResolvedValue(result);
    const { container } = render(<PoolStatisticsWorkspace lockedDataSource="local" />);
    await screen.findByTestId('observation-total');
    expect([...container.querySelectorAll('[data-group-key]')].map((node) => node.dataset.groupKey).sort())
      .toEqual(['limited', 'weapon_limited', 'weapon_standard', 'extra:reconstruction', 'extra:reconstruction_claim'].sort());
    expect(screen.getByRole('button', { name: '全部重构寻访' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '全部重构申领' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '合成分组' })).toBeNull();
    expect(container.querySelector('[data-pool-id="__group_limited"]')).toBeNull();
  });

  it.each([false, true])('renders English group controls with theme dark=%s on mobile', async (dark) => {
    state.english = true;
    state.dark = dark;
    state.user = { id: 'owner' };
    state.load.mockResolvedValue(snapshot([record(1, 'uid')]));
    const { container } = render(<PoolStatisticsWorkspace lockedDataSource="local" mobile />);
    await screen.findByTestId('observation-total');
    expect(container.querySelector('.ex-integrated').dataset.theme).toBe(dark ? 'dark' : 'light');
    expect(container.querySelector('.ex-integrated').dataset.variant).toBe('mobile');
    expect(screen.getByRole('button', { name: 'All limited operator banners' })).toBeTruthy();
    fireEvent.click(screen.getByText('Show'));
    expect(screen.getByText('Hide').getAttribute('aria-expanded')).toBe('true');
  });
});

function legacy(regularTotal) {
  return { regularTotal, sixStarCount: 2, sixStarRate: 0.05, avgSixStarInterval: 20, resultsPerTarget: 40,
    targetCount: 1, offTargetCount: 1, unknownTargetCount: 0, targetRate: 0.5, giftCount: 1,
    intervalDistribution: [{ from: 11, to: 20, count: 2, target: 1, offTarget: 1, unknown: 0 }] };
}
