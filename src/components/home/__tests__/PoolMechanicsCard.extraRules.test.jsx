import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PoolMechanicsCard from '../PoolMechanicsCard.jsx';

vi.mock('../../../hooks/home/usePoolMechanicsData.js', () => ({
  default: () => ({
    limitedCharacters: { sixStar: [], fiveStar: [], fourStar: [] },
    standardCharacters: { sixStar: [], fiveStar: [], fourStar: [] },
  }),
}));

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    locale: 'zh-CN',
    t: (_key, _params, fallback) => fallback || _key,
  }),
}));

vi.mock('../../../utils/gameDataI18n.js', () => ({
  localizeEntityList: (items) => items,
  localizeEntityName: (name) => name,
}));

describe('PoolMechanicsCard extra rules', () => {
  it('shows reconstruction rules before the special brilliance rules', () => {
    const { container } = render(
      <PoolMechanicsCard
        currentUpInfo={{ name: '测试目标', isActive: true }}
        isOpen
        interactive={false}
      />
    );

    expect(screen.getByText('附加寻访分为重构寻访与特殊寻访；重构规则优先展示。')).toBeInTheDocument();
    expect(screen.getByText('累计 30 / 60 / 90 抽各赠一次免费十连；免费十连不推进付费保底或奖励进度。')).toBeInTheDocument();
    expect(screen.getByText('第 10 次申领赠武库赠礼，第 18 次赠概率提升武器，之后每 8 次交替；同系列奖励继承。')).toBeInTheDocument();
    expect(screen.getByText('四名 6★ 目标等概率出现。')).toBeInTheDocument();

    const content = container.textContent;
    expect(content.indexOf('重构寻访 · 角色')).toBeLessThan(content.indexOf('重构申领 · 武器'));
    expect(content.indexOf('重构申领 · 武器')).toBeLessThan(content.indexOf('特殊寻访 · 辉光庆典'));
  });
});
