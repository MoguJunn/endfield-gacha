import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render as renderComponent, screen, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/index.js';
import PoolGiftProgress from '../PoolGiftProgress.jsx';
import { resolvePoolCapabilities, EXTRA_RULE_PROFILES } from '../../../utils/poolCapabilities.js';

const weapon = resolvePoolCapabilities({ type: 'weapon' });
const character = resolvePoolCapabilities({ type: 'limited' });
const boxName = '补充武库箱';
const weaponName = '本期 UP 六星武器';
const render = async component => {
  let page;
  await act(async () => { page = renderComponent(<I18nProvider initialLocale="zh-CN">{component}</I18nProvider>); });
  return page;
};

beforeEach(() => localStorage.clear());

describe('independent banner gift progress', () => {
  it.each([
    [40, '40 / 100 抽', '40 / 180 抽'],
    [100, '100 / 260 抽', '100 / 180 抽'],
    [180, '180 / 260 抽', '180 / 340 抽'],
    [340, '340 / 420 抽', '340 / 500 抽'],
  ])('shows both next reward thresholds at %i pulls', async (paidTotal, box, target) => {
    await render(<PoolGiftProgress capabilities={weapon} stats={{ paidTotal }} />);
    expect(within(screen.getByRole('group', { name: boxName })).getByText(box)).toBeTruthy();
    expect(within(screen.getByRole('group', { name: weaponName })).getByText(target)).toBeTruthy();
  });

  it('hides boxes independently, retains the weapon reward, and remembers the choice on remount', async () => {
    const page = await render(<PoolGiftProgress capabilities={weapon} stats={{ paidTotal: 40 }} />);
    fireEvent.click(screen.getByText('赠送进度显示设置'));
    fireEvent.click(screen.getByRole('checkbox', { name: `显示${boxName}` }));
    expect(screen.queryByRole('group', { name: boxName })).toBeNull();
    expect(screen.getByRole('group', { name: weaponName })).toBeTruthy();
    page.unmount();
    await render(<PoolGiftProgress capabilities={weapon} stats={{ paidTotal: 40 }} />);
    expect(screen.queryByRole('group', { name: boxName })).toBeNull();
    expect(screen.getByRole('group', { name: weaponName })).toBeTruthy();
    fireEvent.click(screen.getByText('赠送进度显示设置'));
    fireEvent.click(screen.getByRole('checkbox', { name: `显示${weaponName}` }));
    expect(screen.queryByRole('group', { name: weaponName })).toBeNull();
  });

  it('uses cumulative character rewards and lets the user hide them', async () => {
    await render(<PoolGiftProgress capabilities={character} stats={{ paidTotal: 40, rewardPaidTotal: 280 }} />);
    expect(screen.getByText('280 / 480 抽')).toBeTruthy();
    fireEvent.click(screen.getByText('赠送进度显示设置'));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示赠送角色潜能 (每240抽)' }));
    expect(screen.queryByText('280 / 480 抽')).toBeNull();
  });

  it('uses claim units for reconstruction weapons and excludes free pulls from progress', async () => {
    const capabilities = resolvePoolCapabilities({ type: 'extra', extra_rule_profile: EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON });
    await render(<PoolGiftProgress capabilities={capabilities} stats={{ total: 150, paidTotal: 90, rewardPaidTotal: 120 }} />);
    expect(screen.getByText('12 / 18 次申领')).toBeTruthy();
    expect(screen.getByText('12 / 26 次申领')).toBeTruthy();
  });

  it('does not infer gift progress from incomplete cumulative history', async () => {
    await render(<PoolGiftProgress capabilities={weapon} stats={{ paidTotal: 40, statisticsContinuity: { cumulativeHistoryKnown: false } }} />);
    expect(screen.queryByText('赠送进度显示设置')).toBeNull();
  });
});
