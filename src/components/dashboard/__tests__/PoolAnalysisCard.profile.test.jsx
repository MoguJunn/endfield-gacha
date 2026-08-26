import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PoolAnalysisCard from '../PoolAnalysisCard.jsx';

const messages = {
  'dashboard.analysis.title.reconstructionCharacter': '重构寻访角色分析',
  'dashboard.analysis.freeTenMilestone': ({ count }) => `${count}抽免费十连`,
  'dashboard.analysis.freeTenOnce': '免费十连 (仅一次)',
  'dashboard.analysis.reconstructionCharacterGuarantee120': '同系列目标角色保障 (120抽)',
  'dashboard.analysis.reconstructionCharacterToken240': '同系列目标角色信物 (每240抽)',
};

vi.mock('../../../stores', () => ({
  usePoolStore: (selector) => selector({ pools: [] }),
}));

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    locale: 'zh-CN',
    formatDateTime: () => '2026/1/1',
    t: (key, params = {}) => {
      const message = messages[key];
      return typeof message === 'function' ? message(params) : message || key;
    },
  }),
}));

vi.mock('../../../utils/gameDataI18n.js', () => ({
  localizeEntityName: (name) => name,
  localizePoolFeaturedList: () => [],
  localizePoolFeaturedName: (pool) => pool?.up_character || '',
  localizePoolName: (pool) => pool?.name || '',
}));

vi.mock('../../../utils/index.js', () => ({
  calculateCurrentProbability: () => null,
}));

vi.mock('../AveragePullStatsPanel.jsx', () => ({
  default: () => <div data-testid="average-stats" />,
}));

describe('PoolAnalysisCard profile display', () => {
  it('renders reconstruction character milestones with series wording', () => {
    const currentPool = {
      id: 'recon-character-b',
      type: 'extra',
      name: '重构角色二期',
      up_character: '目标角色',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'series-c',
      start_time: '2026-01-01T00:00:00.000Z',
      end_time: '2026-02-01T00:00:00.000Z',
    };
    const stats = {
      total: 15,
      paidTotal: 15,
      rewardPaidTotal: 75,
      currentPity: 5,
      currentPity5: 5,
      counts: { 6: 0, '6_std': 0, 5: 0, 4: 15 },
      sixStarCount: 0,
      upSixStarCount: 0,
      includeFreePullsInStats: false,
      gifts: { count: 0, limitedCount: 0, standardCount: 0 },
      avgPullCost: { 6: '0', 5: '0' },
    };
    const specialProgress = {
      paidTotal: 75,
      freeTenMilestones: [
        { threshold: 30, progress: 30, reached: true, received: true },
        { threshold: 60, progress: 60, reached: true, received: true },
        { threshold: 90, progress: 75, reached: false, received: false },
      ],
      targetGuarantee: { threshold: 120, progress: 75, reached: false },
      giftInterval: 240,
    };

    render(
      <PoolAnalysisCard
        currentPool={currentPool}
        stats={stats}
        effectivePity={{ pity6: 5, pity5: 5, isInherited: true }}
        checkLimitedInFirstN={{ validPullCount: 75 }}
        specialProgress={specialProgress}
      />
    );

    expect(screen.getByText('重构寻访角色分析')).toBeInTheDocument();
    expect(screen.getByText('30抽免费十连')).toBeInTheDocument();
    expect(screen.getByText('60抽免费十连')).toBeInTheDocument();
    expect(screen.getByText('90抽免费十连')).toBeInTheDocument();
    expect(screen.getByText('同系列目标角色保障 (120抽)')).toBeInTheDocument();
    expect(screen.getByText('同系列目标角色信物 (每240抽)')).toBeInTheDocument();
    expect(screen.queryByText('免费十连 (仅一次)')).not.toBeInTheDocument();
  });
});
