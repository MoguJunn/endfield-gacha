// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import MergedUpAveragePanel from '../MergedUpAveragePanel.jsx';

const fact = (poolId, entityType, category, pulls, upCount) => ({ poolId, entityType, category, incomplete: false,
  excludeFree: { pulls, upCount, unknownSixCount: 0 }, includeFree: { pulls: pulls + 10, upCount: upCount + 1, unknownSixCount: 0 } });
const data = { version: 1, pools: [fact('limited', 'character', 'limited', 100, 1),
  fact('rerun', 'character', 'reconstruction', 20, 2), fact('weapon', 'weapon', 'limited', 80, 1)] };
const pools = [{ id: 'limited', name: '限定甲' }, { id: 'rerun', name: '复刻甲' }, { id: 'weapon', name: '武器甲' }];
const panel = (options = {}) => <I18nProvider initialLocale="zh-CN"><MergedUpAveragePanel data={data} pools={pools} {...options} /></I18nProvider>;

describe('merged UP panel', () => {
  it('updates weighted averages and the included banner list when the scope changes', async () => {
    await act(async () => { render(panel()); });
    expect(screen.getByText('40.00')).toBeInTheDocument();
    expect(screen.getByText('80.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复刻' }));
    expect(screen.getByText('100.00')).toBeInTheDocument();
    expect(screen.getAllByText('查看计入的 1 个卡池')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '限定' }));
    expect(screen.getAllByText('请选择至少一个范围。')).toHaveLength(2);
    expect(screen.queryByText('100.00')).not.toBeInTheDocument();
  });

  it('follows the free-pull setting without resetting the selected scope', async () => {
    let view;
    await act(async () => { view = render(panel()); });
    fireEvent.click(screen.getByRole('button', { name: '复刻' }));
    view.rerender(panel({ includeFree: true }));
    expect(screen.getByText('55.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复刻' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/计算口径 · 计入免费抽/)).toBeInTheDocument();
  });

  it.each([
    [null, '统计正在更新，请稍后查看。'],
    [{ version: 1, pools: [{ ...data.pools[0], excludeFree: { ...data.pools[0].excludeFree, incomplete: true } }] }, /范围内含补录或汇总/],
    [{ version: 1, pools: [{ ...data.pools[0], excludeFree: { pulls: 100, upCount: 1, unknownSixCount: 2 } }] }, /有 2 个六星/],
  ])('explains why unavailable data cannot produce an average', async (value, message) => {
    await act(async () => { render(panel({ data: value })); });
    expect(screen.getAllByText(message).length).toBeGreaterThan(0);
    expect(screen.queryByText('100.00')).not.toBeInTheDocument();
  });
});
