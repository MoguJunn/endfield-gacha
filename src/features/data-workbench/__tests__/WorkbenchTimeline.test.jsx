import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/index.js';
import WorkbenchTimeline from '../WorkbenchTimeline.jsx';
import { buildWorkbenchHistoryProgress } from '../workbenchHistoryView.js';

const pools = [{ id: 'first', name: '上期限定池', type: 'limited' }, { id: 'next', name: '本期限定池', type: 'limited' }];
const entities = [{ id: 'six', name: '六星角色', type: 'character', rarity: 6 }, { id: 'five', name: '五星角色', type: 'character', rarity: 5 }];
const row = (index, poolId, rarity = 4, extra = {}) => ({ id: `r${index}`, seqId: String(index), poolId, rarity,
  characterId: rarity === 6 ? 'six' : 'five', timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), ...extra });
afterEach(cleanup);

describe('workbench original-history intervals', () => {
  it('renders cross-pool six-star intervals and five-star intervals from all precise rows, with free drops excluded', () => {
    const history = [row(1, 'first'), row(2, 'first'), row(3, 'first'), row(4, 'next'),
      row(5, 'next', 6, { isFree: true }), row(6, 'next', 5), row(7, 'next'), row(8, 'next', 6), row(9, 'next')];
    render(<WorkbenchTimeline entries={[]} pools={pools} entities={entities} history={history.filter(item => item.poolId === 'next')} intervalHistory={history} />, { wrapper: I18nProvider });
    const six = screen.getByTitle('出货间隔：7 抽');
    const five = document.querySelector('[data-record-id="r6"]');
    expect(five.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('五星获得 · 1 次'));
    expect(six).toHaveTextContent('7抽');
    expect(five).toHaveTextContent('5抽');
    expect(six).not.toHaveTextContent('出货间隔未知');
    expect(screen.getAllByRole('article')[0]).toBe(six);
    const free = document.querySelector('[data-record-id="r5"]');
    expect(free).toHaveTextContent('免费');
    expect(free).not.toHaveAttribute('title');
    expect(buildWorkbenchHistoryProgress(history, pools).get('next').currentPity).toBe(1);
  });

  it('keeps weapon pools independent and shares only the same reconstruction series', () => {
    const catalog = [{ id: 'w1', type: 'weapon' }, { id: 'w2', type: 'weapon' },
      { id: 'series1', type: 'extra', extra_subtype: 'reconstruction', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'one', extra_series_phase: 1 },
      { id: 'series2', type: 'extra', extra_subtype: 'reconstruction', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'one', extra_series_phase: 2 },
      { id: 'foreign', type: 'extra', extra_subtype: 'reconstruction', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'two', extra_series_phase: 1 }];
    const history = [row(1, 'w1'), row(2, 'w1'), row(3, 'w2', 6), row(4, 'series1'), row(5, 'foreign'), row(6, 'series2', 6)];
    const progress = buildWorkbenchHistoryProgress(history, catalog);
    expect(progress.get('w2').intervals.get('r3').sixStarPity).toBe(1);
    expect(progress.get('series2').intervals.get('r6').sixStarPity).toBe(2);
  });

  it('filters five stars for display without changing the calculated six-star interval', () => {
    const history = [row(1, 'next', 5), row(2, 'next'), row(3, 'next', 6)];
    render(<WorkbenchTimeline entries={[]} history={history} pools={pools} entities={entities} showFiveStars={false} />, { wrapper: I18nProvider });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByTitle('出货间隔：3 抽')).toHaveTextContent('3抽');
    expect(screen.queryByText('五星角色')).not.toBeInTheDocument();
  });
});
