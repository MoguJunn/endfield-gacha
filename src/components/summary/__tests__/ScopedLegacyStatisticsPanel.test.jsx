import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScopedLegacyStatisticsPanel from '../ScopedLegacyStatisticsPanel.jsx';

vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ locale: 'en-US', t: (key) => key, formatNumber: (value) => String(value) }) }));
afterEach(cleanup);

const legacy = {
  regularTotal: 100, sixStarCount: 4, sixStarRate: 0.04, avgSixStarInterval: 25, resultsPerTarget: 50,
  targetCount: 2, offTargetCount: 2, unknownTargetCount: 1, targetRate: 0.5, giftCount: 3,
  intervalDistribution: [
    { from: 21, to: 30, count: 6, target: 2, offTarget: 2, unknown: 1 },
    { from: 31, to: 40, count: 3, target: 0, offTarget: 0, unknown: 0 },
  ],
  resources: { jadeSpent: 50000, originiteEquivalent: 66.67, arsenalGained: 1200, arsenalSpent: 800, aicQuotaDirect: 90 },
  meta: { intervalCount: 4, boundaryIntervalCount: 1, missingSeriesIntervalCount: 0, excludedRecords: 0 },
};

describe('scoped legacy statistics', () => {
  it('reads server metrics without confusing rates, intervals or gifts with item costs', () => {
    render(<ScopedLegacyStatisticsPanel legacy={legacy} locale="en-US" t={(_, en) => en} />);
    expect(screen.getByTestId('legacy-sixStarRate').textContent).toBe('4%');
    expect(screen.getByTestId('legacy-targetRate').textContent).toBe('50%');
    expect(screen.getByTestId('legacy-unknownTargetCount').textContent).toBe('1');
    expect(screen.getByTestId('legacy-avgSixStarInterval').textContent).toBe('25');
    expect(screen.getByTestId('legacy-resultsPerTarget').textContent).toBe('50');
    expect(screen.getByTestId('legacy-giftCount').textContent).toBe('3');
    expect(screen.getByText(/include intel tickets and exclude free batches and direct gifts/)).toBeTruthy();
    expect(screen.getByText(/precisely classified target and off-target six-stars/)).toBeTruthy();
    expect(screen.getByText('50,000')).toBeTruthy();
    const details = screen.getByText('Show resource details').closest('details');
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText('Show resource details'));
    expect(details.open).toBe(true);
    expect(within(details).getByText('dashboard.resources.jadeSpent')).toBeTruthy();
  });

  it('keeps every interval sample and lists undetermined targets separately from the total', () => {
    render(<ScopedLegacyStatisticsPanel legacy={legacy} locale="en-US" t={(_, en) => en} />);
    const bins = within(screen.getByRole('region', { name: 'Six-star interval distribution' })).getAllByRole('listitem');
    expect(bins).toHaveLength(2);
    expect(bins[0].textContent).toContain('21–30');
    expect(bins[0].textContent).toContain('6 intervals');
    expect(bins[0].querySelector('small').textContent).toBe('Target 2 · Off-target 2 · Undetermined 1');
    expect(bins[1].textContent).toContain('3 intervals');
    expect(bins[1].querySelector('small')).toBeNull();
    expect(screen.getByText(/Bars and totals use every six-star in the interval/)).toBeTruthy();
  });

  it('renders unavailable means separately from zero values and supports weapon resources', () => {
    render(<ScopedLegacyStatisticsPanel legacy={{ ...legacy, regularTotal: 0, avgSixStarInterval: null, resultsPerTarget: null, targetRate: null, intervalDistribution: [] }} weapon locale="zh-CN" t={(zh) => zh} mobile />);
    expect(screen.getByTestId('legacy-regularTotal').textContent).toBe('0');
    expect(screen.getByTestId('legacy-avgSixStarInterval').textContent).toBe('—');
    expect(screen.getByTestId('legacy-resultsPerTarget').textContent).toBe('—');
    expect(screen.getByTestId('legacy-targetRate').textContent).toBe('—');
    expect(screen.getByText('当前范围暂无可计算的六星间隔。')).toBeTruthy();
    expect(screen.getByText('武库配额消耗')).toBeTruthy();
    expect(screen.queryByText('嵌晶玉消耗')).toBeNull();
  });

  it('splits the metrics and resource sections for the single banner layout', () => {
    const metricsOnly = render(<ScopedLegacyStatisticsPanel legacy={legacy} locale="en-US" t={(_, en) => en} section="metrics" />);
    expect(screen.getByTestId('legacy-regularTotal')).toBeTruthy();
    expect(screen.queryByText('Show resource details')).toBeNull();
    metricsOnly.unmount();
    render(<ScopedLegacyStatisticsPanel legacy={legacy} locale="en-US" t={(_, en) => en} section="resources" />);
    expect(screen.queryByTestId('legacy-regularTotal')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Six-star interval distribution' })).toBeNull();
    expect(screen.getByText('Show resource details')).toBeTruthy();
  });
});
