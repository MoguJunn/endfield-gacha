import React from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import PoolSelector from '../PoolSelector.jsx';
import MobilePoolRailSelector from '../../../mobile/components/MobilePoolRailSelector.jsx';
import { I18nProvider, getMessage } from '../../../i18n/index.js';
import { useAuthStore, useHistoryStore, usePoolStore, usePersonalAnalysisStore } from '../../../stores/index.js';
import { getPoolGroupId } from '../../../utils/poolSelectorDisplay.js';

vi.mock('../../../features/import/ImportManager', () => ({ default: () => null }));

const pools = [
  { id: 'festival', name: '辉光庆典', type: 'extra', extra_subtype: 'special' },
  { id: 'other-special', name: '另一特殊池', type: 'extra', extra_subtype: 'special' },
  { id: 'reconstruction', name: '重构池甲', type: 'extra', extra_subtype: 'reconstruction' },
  { id: 'other-reconstruction', name: '重构池乙', type: 'extra', extra_subtype: 'reconstruction' },
  { id: 'limited', name: '当期限定', type: 'limited', start_time: '2000-01-01', end_time: '2100-01-01' },
  { id: 'old-limited', name: '往期限定', type: 'limited', start_time: '2000-01-01', end_time: '2001-01-01' },
  { id: 'earlier-limited', name: '更早限定', type: 'limited', start_time: '1998-01-01', end_time: '1999-01-01' },
  { id: 'zero', name: '零抽限定', type: 'limited' },
  { id: 'standard', name: '常驻池', type: 'standard' },
];
const originalSwitch = usePoolStore.getState().switchPool;
const switchPool = vi.fn();
const msg = (key, params) => getMessage(key, params, 'zh-CN');

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.localStorage.clear();
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, authResolved: true });
  usePersonalAnalysisStore.setState({ availability: 'idle', scope: null, owner: null });
  useHistoryStore.setState({ history: pools.filter(pool => pool.id !== 'zero').map((pool, i) => ({ id: `r${i}`, poolId: pool.id, gameUid: 'fixture' })) });
  usePoolStore.setState({ pools, currentGameUid: 'fixture', currentPoolId: 'festival', switchPool });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); usePoolStore.setState({ switchPool: originalSwitch }); });

async function setup(mobile) {
  const content = () => <MemoryRouter><I18nProvider initialLocale="zh-CN">
    {mobile ? <MobilePoolRailSelector /> : <PoolSelector />}
  </I18nProvider></MemoryRouter>;
  let view;
  await act(async () => { view = render(content()); });
  if (mobile) fireEvent.click(view.container.querySelector('button.mobile-ux-card'));
  const list = within(view.container.querySelector(mobile ? '.mobile-ux-dropdown' : '.pool-card-rail'));
  const toggle = (label, expanded = true) => list.getByTitle(msg(expanded ? 'pool.card.groupToggleCollapse' : 'pool.card.groupToggleExpand', { label }));
  return { view, list, toggle, rerender: () => view.rerender(content()) };
}

describe.each([false, true])('category collapse mobile=%s', mobile => {
  it('keeps only the selected pool, gives feedback, survives rerender, and restores all rows', async () => {
    const { list, toggle, rerender } = await setup(mobile);
    fireEvent.click(toggle('附加寻访'));
    expect(toggle('附加寻访', false)).toHaveAttribute('aria-expanded', 'false');
    expect(list.getByText('类型已折叠')).toBeVisible();
    expect(list.getByText('辉光庆典')).toBeVisible();
    expect(list.queryByText('另一特殊池')).toBeNull();
    expect(list.queryByText('重构池甲')).toBeNull();
    expect(list.queryByText(msg('pool.card.allGroupTitle', { label: '附加寻访' }))).toBeNull();
    expect(switchPool).not.toHaveBeenCalled();
    expect(usePoolStore.getState().currentPoolId).toBe('festival');
    rerender();
    expect(toggle('附加寻访', false)).toHaveAttribute('aria-expanded', 'false');
    act(() => usePoolStore.setState({ currentPoolId: 'reconstruction' }));
    expect(list.getByText('重构池甲')).toBeVisible();
    expect(list.queryByText('辉光庆典')).toBeNull();
    fireEvent.click(toggle('附加寻访', false));
    expect(list.queryByText('类型已折叠')).toBeNull();
    expect(list.getByText('另一特殊池')).toBeVisible();
    expect(list.getByText('重构池乙')).toBeVisible();
  });

  it.each([
    ['special', '特殊寻访', 'festival', '辉光庆典', '另一特殊池'],
    ['reconstruction', '重构寻访', 'reconstruction', '重构池甲', '重构池乙'],
  ])('respects selected %s subgroup collapse and re-expansion', async (_type, label, selected, name, other) => {
    usePoolStore.setState({ currentPoolId: selected });
    const { list, toggle, rerender } = await setup(mobile);
    fireEvent.click(toggle(label));
    expect(toggle(label, false)).toHaveAttribute('aria-expanded', 'false');
    expect(within(toggle(label, false)).getByRole('status')).toHaveTextContent('类型已折叠');
    expect(list.getByText(name)).toBeVisible();
    expect(list.queryByText(other)).toBeNull();
    rerender();
    expect(toggle(label, false)).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle(label, false));
    expect(list.getByText(other)).toBeVisible();
  });

  it('keeps the selected subgroup overview when its parent is collapsed', async () => {
    usePoolStore.setState({ currentPoolId: getPoolGroupId('extra', 'special') });
    const { list, toggle } = await setup(mobile);
    fireEvent.click(toggle('特殊寻访'));
    expect(toggle('特殊寻访', false)).toHaveAttribute('aria-expanded', 'false');
    expect(list.getByText(msg('pool.card.allGroupTitle', { label: '特殊寻访' }))).toBeVisible();
    expect(list.queryByText('辉光庆典')).toBeNull();
    fireEvent.click(toggle('附加寻访'));
    expect(toggle('附加寻访', false)).toHaveAttribute('aria-expanded', 'false');
    expect(list.getByText(msg('pool.card.allGroupTitle', { label: '特殊寻访' }))).toBeVisible();
    expect(list.queryByText('辉光庆典')).toBeNull();
    expect(list.queryByText('重构池甲')).toBeNull();
  });

  it('pins current and latest past limited pools plus the selected older pool when collapsed', async () => {
    usePoolStore.setState({ currentPoolId: 'earlier-limited' });
    const { list, toggle } = await setup(mobile);
    fireEvent.click(toggle('限定角色'));
    expect(list.getByText('往期限定')).toBeVisible();
    expect(list.getByText('当期限定')).toBeVisible();
    expect(list.getByText('更早限定')).toBeVisible();
    act(() => usePoolStore.setState({ currentPoolId: 'standard' }));
    expect(list.getByText('当期限定')).toBeVisible();
    expect(list.getByText('往期限定')).toBeVisible();
    expect(list.queryByText('更早限定')).toBeNull();
    expect(switchPool).not.toHaveBeenCalled();
    fireEvent.click(toggle('限定角色', false));
    expect(list.getByText('当期限定')).toBeVisible();
    expect(list.queryByText('零抽限定')).toBeNull();
  });

  it('jumps to a category without changing selection or its collapsed state', async () => {
    const { view, toggle } = await setup(mobile);
    fireEvent.click(toggle('附加寻访'));
    const scroller = view.container.querySelector(mobile ? '.mobile-ux-dropdown' : '.pool-card-rail-scrollbar');
    scroller.scrollTo = vi.fn();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const nav = view.getByRole('navigation', { name: '卡池类型导航' });
    fireEvent.click(within(nav).getByRole('button', { name: '跳转至附加寻访' }));
    expect(scroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
    expect(toggle('附加寻访', false)).toHaveAttribute('aria-expanded', 'false');
    expect(usePoolStore.getState().currentPoolId).toBe('festival');
    expect(switchPool).not.toHaveBeenCalled();
  });

  it('updates progress when scrolling and removes the scroll hint when content fits', async () => {
    const { view } = await setup(mobile);
    const scroller = view.container.querySelector(mobile ? '.mobile-ux-dropdown' : '.pool-card-rail-scrollbar');
    const sizeKey = mobile ? 'scrollHeight' : 'scrollWidth';
    Object.defineProperties(scroller, {
      [sizeKey]: { configurable: true, value: 900 },
      [mobile ? 'clientHeight' : 'clientWidth']: { configurable: true, value: 300 },
    });
    scroller[mobile ? 'scrollTop' : 'scrollLeft'] = 300;
    fireEvent.scroll(scroller);
    expect(view.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(view.getByTitle(mobile ? '向下滑动查看更多' : '滚轮向下浏览更多')).toBeVisible();
    scroller[mobile ? 'scrollTop' : 'scrollLeft'] = 600;
    fireEvent.scroll(scroller);
    expect(view.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(view.getByTitle('已到列表末尾')).toBeVisible();
    Object.defineProperty(scroller, sizeKey, { configurable: true, value: 300 });
    fireEvent(window, new Event('resize'));
    expect(view.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(view.queryByTitle('已到列表末尾')).toBeNull();
    expect(usePoolStore.getState().currentPoolId).toBe('festival');
  });

  it('collapses an unselected category without selecting a default pool in guest mode', async () => {
    useHistoryStore.setState({ history: [] });
    usePoolStore.setState({ currentGameUid: null, currentPoolId: 'standard' });
    const { list, toggle } = await setup(mobile);
    fireEvent.click(toggle('附加寻访'));
    expect(toggle('附加寻访', false)).toHaveAttribute('aria-expanded', 'false');
    expect(list.getByText('类型已折叠')).toBeVisible();
    expect(usePoolStore.getState().currentPoolId).toBe('standard');
    expect(switchPool).not.toHaveBeenCalled();
  });

  it('temporarily reveals a collapsed category during search and restores the manual state afterwards', async () => {
    const { view, list, toggle } = await setup(mobile);
    fireEvent.click(toggle('附加寻访'));
    if (mobile) fireEvent.click(view.getByRole('button', { name: '筛选' }));
    const search = view.getByPlaceholderText(msg('pool.selector.searchPlaceholder'));
    fireEvent.change(search, { target: { value: '辉光' } });
    expect(toggle('附加寻访')).toHaveAttribute('aria-expanded', 'true');
    expect(list.getByText('辉光庆典')).toBeVisible();
    fireEvent.change(search, { target: { value: '' } });
    expect(toggle('附加寻访', false)).toHaveAttribute('aria-expanded', 'false');
    expect(list.queryByText('另一特殊池')).toBeNull();
  });
});
