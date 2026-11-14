import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SixStarSourceSummary from '../SixStarSourceSummary.jsx';

const language = vi.hoisted(() => ({ isEnglish: false }));
vi.mock('../../../i18n/index.js', () => ({ useI18n: () => language }));
afterEach(() => { cleanup(); language.isEnglish = false; });

describe('SixStarSourceSummary', () => {
  it('adds only target gifts beside the existing count and explains guarantees in a popover', () => {
    render(<SixStarSourceSummary stats={{ counts: { 6: 13, '6_std': 16 },
      winRateTargetCount: 9, winRateTotalCount: 25,
      sixStarSources: { gifted: 3, giftedTarget: 2, giftedOffrate: 1, guaranteed: 4 },
    }} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText('+3')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '六星数量说明' })).toHaveAttribute('popovertarget');
    expect(screen.getByText(/赠送／自选获得/)).toHaveTextContent('不计入抽数、保底和不歪率');
    expect(screen.getByText(/原抽取数量中含 4 个保障出货/)).toHaveTextContent('仍按抽取处理保底');
    expect(screen.getByText(/不歪率：9\/25/)).toBeInTheDocument();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('adds no indicator or zero suffix when there are no gifts or exclusions', () => {
    render(<SixStarSourceSummary stats={{ counts: { 6: 12, '6_std': 22 },
      upSixStarCount: 12, sixStarCount: 34,
      sixStarSources: { gifted: 0, giftedTarget: 0, giftedOffrate: 0, guaranteed: 0 },
      gifts: { count: 5 },
    }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.queryByText('+5')).not.toBeInTheDocument();
  });

  it('does not turn an older snapshot without source counts into zero gifts', () => {
    render(<SixStarSourceSummary stats={{ counts: { 6: 13, '6_std': 16 },
      winRateTargetCount: 9, winRateTotalCount: 25,
    }} />);
    expect(screen.getByText(/尚未统计赠送／自选明细/)).toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.getByText(/另有 4 个展示六星/)).toHaveTextContent('未提供具体来源');
    expect(screen.queryByText(/4 个保障出货/)).not.toBeInTheDocument();
  });

  it('supports English offrate gifts without assigning them to the target count', () => {
    language.isEnglish = true;
    render(<SixStarSourceSummary category="offrate" showWinRate={false} stats={{ counts: { '6_std': 3 },
      upSixStarCount: 0, sixStarCount: 3,
      sixStarSources: { gifted: 1, giftedTarget: 0, giftedOffrate: 1, guaranteed: 0 },
    }} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Six-star count details' })).toBeInTheDocument();
    expect(screen.queryByText(/Target rate:/)).not.toBeInTheDocument();
  });
});
