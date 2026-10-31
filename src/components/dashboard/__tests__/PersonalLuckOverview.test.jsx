import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/index.js';
import { buildPersonalLuck } from '../../../utils/personalLuck.js';
import { useAuthStore, useHistoryStore, usePoolStore } from '../../../stores/index.js';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../../services/scheduledStatisticsService.js', () => ({ loadPersonalStatistics: mocks.load }));
vi.mock('../../../contexts/ThemeContext.jsx', () => ({ useTheme: () => ({ isDark: true }) }));
import PersonalLuckOverview from '../PersonalLuckOverview.jsx';

const fetchedAt = '2026-07-15T00:00:00Z';
const pools = [{ id: 'p', type: 'limited', name: '测试卡池', up_character: '目标角色' }];
const characters = [{ id: 'up', name: '目标角色', type: 'character', rarity: 6, avatar_url: '/avatars/up.webp' }];
const versions = { versions: Array.from({ length: 7 }, (_, i) => ({ id: `v${i}`, name: `版本${i}`, starts_at: `2026-0${i + 1}-01T00:00:00Z` })) };
const history = Array.from({ length: 10 }, (_, i) => ({ user_id: 'owner', game_uid: 'uid', server_scope: '1',
  record_id: `r${i}`, seq_id: String(i + 1), pool_id: 'p', timestamp: '2026-07-10T01:00:00Z', batch_id: 'batch',
  rarity: i < 2 ? 6 : 4, ...(i < 2 ? { character_id: 'up', character_name: '目标角色' } : { item_name: '四星角色' }) }));
const luck = buildPersonalLuck({ history, pools, characters, versionConfig: versions, fetchedAt });
const firstKey = luck.accounts[0].key;
const secondKey = JSON.stringify(['owner', 'other', '2']);
const second = structuredClone(luck.accounts[0]);
second.key = secondKey;
second.character = { ...second.weapon };
const snapshot = { accounts: [{ key: firstKey, name: '账号一', gameUid: 'uid', serverScope: '1' },
  { key: secondKey, name: '账号二', gameUid: 'other', serverScope: '2' }], luck: { ...luck, accounts: [...luck.accounts, second] } };
const response = data => ({ data, meta: { ownerId: 'owner', truncated: false } });
const mount = locale => render(<I18nProvider initialLocale={locale || 'zh-CN'}><PersonalLuckOverview /></I18nProvider>);

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'owner' } });
  usePoolStore.setState({ currentGameUid: 'uid::server:1' });
  useHistoryStore.setState({ history: [] });
  mocks.load.mockReset(); mocks.load.mockResolvedValue(response(snapshot));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('integrated personal luck overview', () => {
  it('renders snapshot results, named images, highlights and collapsed explanations', async () => {
    mount();
    await screen.findByRole('region', { name: '寻访运气' });
    const highlights = screen.getByRole('region', { name: '抽卡高光' });
    expect(within(highlights).getByRole('button', { name: '一发双彩' })).toBeTruthy();
    expect(highlights.querySelectorAll('img')).toHaveLength(2);
    expect(highlights.textContent).not.toContain('一次出金记录');
    expect(screen.queryByRole('dialog')).toBeNull();
    const trigger = screen.getByRole('button', { name: '查看本次统计说明' });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '本次统计说明' }).textContent).toContain('10 / 10');
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole('button', { name: '最近三个版本', exact: true }));
    expect(document.querySelector('.pl-hero-footer').textContent).toContain('10');
    expect(document.querySelectorAll('.pl-version-axis > span')).toHaveLength(7);
  });
  it('switches accounts and entities without carrying old highlights or grades', async () => {
    mount(); await screen.findByRole('region', { name: '寻访运气' });
    fireEvent.change(screen.getByRole('combobox', { name: '游戏账号' }), { target: { value: secondKey } });
    await waitFor(() => expect(document.querySelector('.pl-summary-strip strong').textContent).toBe('0'));
    expect(screen.queryByRole('button', { name: '一发双彩' })).toBeNull();
    expect(screen.getByText('暂时没有可展示的高光。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '武器', exact: true }));
    expect(document.querySelector('.pl-signal-grade').textContent).toBe('—');
  });
  it('hides previous private results immediately on an owner switch or logout', async () => {
    mount(); await screen.findByRole('region', { name: '寻访运气' });
    let finish;
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => useAuthStore.setState({ user: { id: 'new-owner' } }));
    expect(screen.queryByRole('region', { name: '寻访运气' })).toBeNull();
    await act(async () => finish(response(snapshot)));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('账号一')).toBeNull();
    act(() => useAuthStore.setState({ user: null }));
    expect(screen.getByText('登录后查看个人手气和抽卡高光。')).toBeTruthy();
  });
  it('distinguishes pending, empty, older snapshots and read errors', async () => {
    mocks.load.mockResolvedValueOnce(response(null));
    const page = mount(); await screen.findByText('个人概览正在等待后台首次计算，完成后自动显示。'); page.unmount();
    mocks.load.mockResolvedValueOnce(response({ accounts: [] }));
    const empty = mount(); await screen.findByText('暂无已保存的游戏账号记录。'); empty.unmount();
    mocks.load.mockResolvedValueOnce(response({ accounts: snapshot.accounts }));
    const old = mount(); await screen.findByText('手气评价正在等待后台更新，完成后自动显示。'); old.unmount();
    mocks.load.mockResolvedValueOnce(response({ accounts: snapshot.accounts, luck: { version: 1, accounts: [] } }));
    const supplements = mount(); await screen.findByText('该账号暂无可用于评价的完整抽卡记录。'); supplements.unmount();
    mocks.load.mockRejectedValueOnce(new Error('offline'));
    mount(); expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('shows English labels without injecting sample account data', async () => {
    mount('en-US'); await screen.findByRole('region', { name: 'Pull luck' });
    expect(screen.getByRole('button', { name: 'Latest three versions' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Pull highlights' })).toBeTruthy();
    expect(screen.queryByText('高抽数样本')).toBeNull();
  });
});
