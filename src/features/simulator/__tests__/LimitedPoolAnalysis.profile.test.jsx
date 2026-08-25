import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LimitedPoolAnalysis from '../LimitedPoolAnalysis.jsx';

const labels = {
  'dashboard.analysis.title.reconstructionCharacter': '重构寻访角色分析',
  'dashboard.analysis.title.reconstructionWeapon': '重构申领武器分析',
  'dashboard.analysis.reconstructionFreeTen.title': '同系列免费十连',
  'dashboard.analysis.reconstructionFreeTen.stage': ({ count }) => `${count}抽`,
  'dashboard.analysis.reconstructionFreeTen.status.claimed': '已领取',
  'dashboard.analysis.reconstructionFreeTen.status.available': '已达成，待领取',
  'dashboard.analysis.reconstructionFreeTen.status.locked': '未达成',
  'dashboard.analysis.reconstructionFreeTen.remaining': ({ count }) => `还差 ${count} 抽`,
  'dashboard.analysis.reconstructionFreeTen.summary.available': ({ count }) => `可领取 ${count} 次免费十连，请在操作区使用`,
  'dashboard.analysis.reconstructionFreeTen.summary.allClaimed': '三次免费十连均已领取',
  'dashboard.analysis.reconstructionFreeTen.summary.next': ({ count }) => `下一阶段还差 ${count} 抽`,
  'dashboard.analysis.reconstructionFreeTen.progressValue': ({ current, max }) => `已完成 ${current} / ${max} 抽`,
  'dashboard.analysis.reconstructionCharacterGuarantee120': '同系列目标角色保障 (120抽)',
  'dashboard.analysis.reconstructionCharacterToken240': '同系列目标角色信物 (每240抽)',
  'dashboard.analysis.reconstructionWeaponPity40': '6星保障 (4次申领 / 40抽)',
  'dashboard.analysis.reconstructionWeaponGuarantee80': '同系列目标武器保障 (8次申领 / 80抽)',
  'dashboard.analysis.reconstructionWeaponGiftRule': '系列第10次申领获武库赠礼，第18次获目标武器，之后每8次申领交替奖励。',
  'dashboard.analysis.arsenalGiftReward': '武库赠礼',
  'dashboard.analysis.targetWeaponReward': '目标武器',
  'dashboard.analysis.freeTenOnce': '免费十连 (仅一次)',
  'dashboard.unit.claim': '次申领',
};

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    locale: 'zh-CN',
    t: (key, params = {}) => {
      const label = labels[key];
      return typeof label === 'function' ? label(params) : label || key;
    },
  }),
}));

vi.mock('../../../utils/gameDataI18n.js', () => ({
  localizeEntityName: (name) => name,
  localizePoolFeaturedList: () => [],
  localizePoolFeaturedName: (pool) => pool?.up_character || '',
  localizePoolName: (pool) => pool?.name || '',
}));

function buildStats(overrides = {}) {
  return {
    total: 15,
    paidTotal: 15,
    rewardPaidTotal: 75,
    currentPity: 5,
    currentPity5: 5,
    sixStarCount: 0,
    upSixStarCount: 0,
    avgPullCost: { 6: 0, 5: 0 },
    freeTenPulls: { received: 2 },
    gifts: { standardCount: 0, limitedCount: 0 },
    targetProbabilityInfo: null,
    probabilityInfo: null,
    ...overrides,
  };
}

describe('LimitedPoolAnalysis profile display', () => {
  it('merges reconstruction character milestones and exposes paid progress accessibly', () => {
    render(
      <LimitedPoolAnalysis
        currentPool={{
          id: 'recon-character-b',
          type: 'extra',
          name: '重构角色二期',
          up_character: '目标角色',
          extra_rule_profile: 'reconstruction_character_v1',
          extra_series_key: 'series-c',
        }}
        stats={buildStats({ rewardPaidTotal: 60, freeTenPulls: { received: 1 } })}
        effectivePity={{ pity6: 5, pity5: 5, isInherited: true }}
        pityInfo={{ guaranteedUp: { current: 60, max: 120, hasReceived: false } }}
      />
    );

    expect(screen.getByText('重构寻访角色分析')).toBeInTheDocument();
    expect(screen.getAllByTestId('reconstruction-free-ten-panel')).toHaveLength(1);
    const progressbars = screen.getAllByRole('progressbar', { name: '同系列免费十连' });
    expect(progressbars).toHaveLength(1);
    expect(progressbars[0]).toHaveAttribute('aria-valuemin', '0');
    expect(progressbars[0]).toHaveAttribute('aria-valuenow', '60');
    expect(progressbars[0]).toHaveAttribute('aria-valuemax', '90');
    expect(progressbars[0]).toHaveAttribute('aria-valuetext', '已完成 60 / 90 抽');
    expect(screen.getAllByTestId('reconstruction-free-ten-flag').map((flag) => flag.dataset.status)).toEqual([
      'claimed',
      'available',
      'locked',
    ]);
    expect(screen.getByText('30抽')).toBeInTheDocument();
    expect(screen.getByText('60抽')).toBeInTheDocument();
    expect(screen.getByText('90抽')).toBeInTheDocument();
    expect(screen.getByText('已领取')).toBeInTheDocument();
    expect(screen.getByText('已达成，待领取')).toBeInTheDocument();
    expect(screen.getByText('未达成')).toBeInTheDocument();
    expect(screen.getByText('还差 30 抽')).toBeInTheDocument();
    expect(screen.getByText('可领取 1 次免费十连，请在操作区使用')).toBeInTheDocument();
    expect(screen.getByText('同系列目标角色保障 (120抽)')).toBeInTheDocument();
    expect(screen.getByText('同系列目标角色信物 (每240抽)')).toBeInTheDocument();
    expect(screen.queryByText('免费十连 (仅一次)')).not.toBeInTheDocument();
  });

  it('shows the all-claimed reconstruction character summary at 90 paid pulls', () => {
    render(
      <LimitedPoolAnalysis
        currentPool={{
          id: 'recon-character-c',
          type: 'extra',
          name: '重构角色三期',
          up_character: '目标角色',
          extra_rule_profile: 'reconstruction_character_v1',
          extra_series_key: 'series-c',
        }}
        stats={buildStats({ rewardPaidTotal: 90, freeTenPulls: { received: 3 } })}
        effectivePity={{ pity6: 5, pity5: 5, isInherited: true }}
        pityInfo={{ guaranteedUp: { current: 90, max: 120, hasReceived: false } }}
      />
    );

    expect(screen.getByRole('progressbar', { name: '同系列免费十连' })).toHaveAttribute('aria-valuenow', '90');
    expect(screen.getAllByTestId('reconstruction-free-ten-flag').map((flag) => flag.dataset.status)).toEqual([
      'claimed',
      'claimed',
      'claimed',
    ]);
    expect(screen.getAllByText('已领取')).toHaveLength(3);
    expect(screen.getByText('三次免费十连均已领取')).toBeInTheDocument();
    expect(screen.queryByText(/还差/)).not.toBeInTheDocument();
  });

  it('keeps ordinary limited and brilliance festival free ten-pulls as one tier', () => {
    const ordinary = render(
      <LimitedPoolAnalysis
        currentPool={{
          id: 'limited-a',
          type: 'limited',
          name: '普通限定',
          up_character: '目标角色',
        }}
        stats={buildStats({ rewardPaidTotal: 20, freeTenPulls: { received: 0 } })}
        effectivePity={{ pity6: 5, pity5: 5, isInherited: false }}
        pityInfo={{ guaranteedUp: { current: 20, max: 120, hasReceived: false } }}
      />
    );

    expect(screen.getByText('免费十连 (仅一次)')).toBeInTheDocument();
    expect(screen.queryByTestId('reconstruction-free-ten-panel')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('reconstruction-free-ten-flag')).toHaveLength(0);
    ordinary.unmount();

    render(
      <LimitedPoolAnalysis
        currentPool={{
          id: 'brilliance-a',
          type: 'extra',
          name: '辉光庆典',
          extra_subtype: 'special',
          extra_rule_profile: 'brilliance_festival_v1',
          featured_characters: ['角色一', '角色二', '角色三', '角色四'],
        }}
        stats={buildStats({ rewardPaidTotal: 20, freeTenPulls: { received: 0 } })}
        effectivePity={{ pity6: 5, pity5: 5, isInherited: false }}
        pityInfo={{}}
      />
    );

    expect(screen.getByText('免费十连 (仅一次)')).toBeInTheDocument();
    expect(screen.queryByTestId('reconstruction-free-ten-panel')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('reconstruction-free-ten-flag')).toHaveLength(0);
  });

  it('shows reconstruction weapon pool-local and series claim milestones without free ten-pulls', () => {
    render(
      <LimitedPoolAnalysis
        currentPool={{
          id: 'recon-weapon-b',
          type: 'extra',
          name: '重构武器二期',
          up_character: '目标武器',
          extra_subtype: 'reconstruction_claim',
          extra_rule_profile: 'reconstruction_weapon_v1',
          extra_series_key: 'series-w',
        }}
        stats={buildStats({
          total: 20,
          paidTotal: 20,
          rewardPaidTotal: 100,
          currentPity: 20,
          freeTenPulls: { received: 0 },
          gifts: { standardCount: 1, limitedCount: 0 },
        })}
        effectivePity={{ pity6: 20, pity5: 0, isInherited: false }}
        pityInfo={{ guaranteedUp: { current: 70, max: 80, hasReceived: false } }}
      />
    );

    expect(screen.getByText('重构申领武器分析')).toBeInTheDocument();
    expect(screen.getByText('6星保障 (4次申领 / 40抽)')).toBeInTheDocument();
    expect(screen.getByText('同系列目标武器保障 (8次申领 / 80抽)')).toBeInTheDocument();
    expect(screen.getByText('系列第10次申领获武库赠礼，第18次获目标武器，之后每8次申领交替奖励。')).toBeInTheDocument();
    expect(screen.getByText(/10 \/ 18/)).toBeInTheDocument();
    expect(screen.queryByText(/免费十连/)).not.toBeInTheDocument();
  });
});
