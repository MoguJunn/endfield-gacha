import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StatisticsPoolList from '../StatisticsPoolList.jsx';
import { characterCache } from '../../../utils/characterUtils.js';

const pools = [
  { id: 'pool-a', name: '测试限定甲', type: 'limited', up_character: '测试角色甲' },
  { id: 'pool-b', name: '测试限定乙', type: 'limited', up_character: '测试角色乙' },
  { id: 'pool-w', name: '测试武器', type: 'weapon', isLimitedWeapon: false, up_character: '测试武器甲' },
];
const counts = { 'pool-a': 3, 'pool-b': 5, 'pool-w': 2 };
const baseProps = { pools, counts, scope: { kind: 'pool', poolId: 'pool-b' }, locale: 'zh-CN', t: (zh) => zh };
beforeEach(() => {
  characterCache.applyCharacters([]);
  vi.spyOn(characterCache, 'load').mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); characterCache.clear(); });

describe('StatisticsPoolList', () => {
  it('preserves aggregate choices and concrete selection by default', async () => {
    const onSelect = vi.fn();
    render(<div className="ex-theme"><StatisticsPoolList {...baseProps} onSelect={onSelect} /></div>);
    await waitFor(() => expect(characterCache.load).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '全部限定角色' })).toBeVisible();
    expect(screen.getByRole('button', { name: '全部常驻武器' })).toBeVisible();
    expect(screen.getByText('8 条记录合计')).toBeVisible();
    expect(screen.getByRole('button', { name: '测试限定乙' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '全部限定角色' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'group', groupKey: 'limited' });
    fireEvent.click(screen.getByRole('button', { name: '测试限定甲' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'pool', poolId: 'pool-a' });
  });

  it('offers only concrete pools for workbench editing with allowGroups=false', async () => {
    const onSelect = vi.fn();
    const { container } = render(<StatisticsPoolList {...baseProps} allowGroups={false} onSelect={onSelect} />);
    await waitFor(() => expect(characterCache.load).toHaveBeenCalled());
    expect(container.querySelector('[data-group-key]')).toBeNull();
    expect(container.querySelectorAll('[data-pool-id]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '测试武器' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'pool', poolId: 'pool-w' });
  });

  it('retains searchable UP names and collapsed groups in concrete-only mode', async () => {
    const { container, rerender } = render(<StatisticsPoolList {...baseProps} allowGroups={false} onSelect={vi.fn()} />);
    await waitFor(() => expect(characterCache.load).toHaveBeenCalled());
    const heading = container.querySelector('.ex-pool-group-heading');
    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '测试限定甲' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '测试角色甲' } });
    expect(screen.getByRole('button', { name: '测试限定甲' })).toBeVisible();
    // The main-site selector keeps the current pool visible while searching.
    expect(screen.getByRole('button', { name: '测试限定乙' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '测试武器' })).toBeNull();
    expect(container.querySelector('[data-group-key]')).toBeNull();
    rerender(<StatisticsPoolList {...baseProps} scope={null} allowGroups={false} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '没有这个卡池' } });
    expect(screen.getByText('没有匹配的卡池')).toBeVisible();
  });
});
