import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import RotationScheduleCard from '../RotationScheduleCard.jsx';

vi.mock('../../../i18n/index.js', () => ({
  getAppLocale: () => 'zh-CN',
  getMessage: (key) => ({
    'pool.card.upShort': 'UP',
    'pool.card.upWeaponShort': 'UP 武器',
  })[key] || key,
  useI18n: () => ({
    locale: 'zh-CN',
    formatDateTime: (value) => new Date(value).toISOString(),
    t: (key, params = {}, fallback) => {
      const message = ({
        'home.rotation.title': '轮换计划',
        'home.rotation.status.rerunNext': '下一次复刻',
        'home.rotation.status.rerunCurrent': '当前复刻',
        'home.rotation.status.extraReconstructionCurrent': '当前重构',
        'home.rotation.status.extraReconstructionNode': '重构寻访',
        'home.rotation.status.inPoolSecond': '第2次轮换后移出',
        'home.rotation.status.inPoolNext': '下一次轮换后移出',
        'home.rotation.inPoolBadge': '在卡池中',
        'home.rotation.endLabel.openEnded': '版本更新维护前',
        'home.rotation.folded.currentRerun': '已合并当期复刻：{name}',
        'home.rotation.calendar': '版本日历',
        'home.rotation.openCalendar': '打开版本日历',
        'home.rotation.pending': '待公布...',
      })[key] || fallback || key;

      return message.replace(/\{(\w+)\}/gu, (_match, name) => params[name] ?? `{${name}}`);
    },
  }),
}));

vi.mock('../../../utils/characterUtils.js', () => ({
  characterCache: {
    isLoaded: () => true,
    searchByName: () => null,
  },
  getCharacterAvatarUrl: (name) => `/avatars/${name}.webp`,
  resolveCharacterRecordByName: (name) => ({ name }),
}));

vi.mock('../../../utils/gameDataI18n.js', () => ({
  localizeEntityName: (name) => name,
  localizePoolFeaturedList: (pool) => pool.featured_characters || [pool.up_character].filter(Boolean),
  localizePoolName: (pool) => pool.name,
}));

vi.mock('../../../utils/horizontalScroll.js', () => ({
  bindHorizontalWheelScroll: () => undefined,
}));

describe('RotationScheduleCard', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('renders an upcoming reconstruction character as a plain limited-style rerun node', () => {
    render(
      <RotationScheduleCard
        now={new Date('2026-07-24T04:00:00.000Z')}
        poolSchedule={[
          {
            id: 'extra_reconstruction_character',
            name: '重构寻访·伊冯',
            displayName: '重构寻访·伊冯',
            homeNodeKind: 'reconstruction-character',
            homeCharacterName: '伊冯',
            poolType: 'extra',
            startDate: '2026-08-01T04:00:00.000Z',
            endDate: null,
            endLabel: '版本更新维护前',
            hasDefaultEndLabel: true,
            poolData: {
              id: 'extra_reconstruction_character',
              type: 'extra',
              name: '重构寻访·伊冯',
              up_character: '伊冯',
              extra_rule_profile: 'reconstruction_character_v1',
            },
          },
        ]}
      />
    );

    expect(screen.getByText('下一次复刻')).toBeTruthy();
    expect(screen.getByText('伊冯')).toBeTruthy();
    expect(screen.getByText((_content, element) => (
      element.classList.contains('truncate') && element.textContent.endsWith('版本更新维护前')
    ))).toBeTruthy();
    expect(screen.getByAltText('伊冯').getAttribute('src')).toBe('/avatars/伊冯.webp');
    expect(screen.getByAltText('伊冯').parentElement.getAttribute('data-home-avatar-kind')).toBe('character');
    expect(screen.getByAltText('伊冯').parentElement.classList.contains('rounded-full')).toBe(true);
    expect(screen.queryByText('重构寻访·伊冯')).toBeNull();
    expect(screen.queryByText('UP')).toBeNull();
    expect(document.querySelector('[data-avatar-layout="grid"]')).toBeNull();
  });

  it('suppresses in-pool text, badges, and blue state while a reconstruction character is active', () => {
    const limitedPool = (id, name, startDate, endDate) => ({
      id,
      name,
      poolType: 'limited',
      startDate,
      endDate,
      poolData: { id, type: 'limited', name, up_character: name },
    });

    render(
      <RotationScheduleCard
        now={new Date('2026-05-01T04:00:00.000Z')}
        poolSchedule={[
          limitedPool('limited_1', '角色一', '2026-03-01T04:00:00.000Z', '2026-03-20T04:00:00.000Z'),
          limitedPool('limited_2', '角色二', '2026-03-20T04:00:00.000Z', '2026-04-10T04:00:00.000Z'),
          limitedPool('limited_3', '角色三', '2026-04-10T04:00:00.000Z', '2026-05-10T04:00:00.000Z'),
          {
            id: 'rerun_yvonne',
            name: '绚丽异彩',
            homeNodeKind: 'reconstruction-character',
            homeCharacterName: '伊冯',
            poolType: 'extra',
            startDate: '2026-04-20T04:00:00.000Z',
            endDate: null,
            poolData: {
              id: 'rerun_yvonne',
              type: 'extra',
              name: '绚丽异彩',
              up_character: '伊冯',
              extra_rule_profile: 'reconstruction_character_v1',
            },
          },
        ]}
      />
    );

    expect(screen.getByText('当前复刻')).toBeTruthy();
    expect(screen.queryByText('在卡池中')).toBeNull();
    expect(screen.queryByText('第2次轮换后移出')).toBeNull();
    expect(screen.queryByText('下一次轮换后移出')).toBeNull();
    expect(document.querySelector('.bg-blue-50')).toBeNull();
  });

  it('renders the structured current-rerun merge copy', () => {
    render(
      <RotationScheduleCard
        now={new Date('2026-06-28T04:00:00.000Z')}
        poolSchedule={[{
          id: 'limited_target',
          name: '弭弗',
          poolType: 'limited',
          startDate: '2026-06-27T04:00:00.000Z',
          endDate: '2026-07-18T04:00:00.000Z',
          foldedExtraPools: [{
            id: 'rerun_yvonne',
            mergeKind: 'current-rerun',
            characterName: '伊冯',
          }],
          poolData: { id: 'limited_target', type: 'limited', up_character: '弭弗' },
        }]}
      />
    );

    expect(screen.getByText('已合并当期复刻：伊冯')).toBeTruthy();
  });

  it('keeps four-target special pools in the avatar grid', () => {
    render(
      <RotationScheduleCard
        now={new Date('2026-08-24T04:00:00.000Z')}
        poolSchedule={[{
          id: 'extra_special',
          name: '辉光庆典',
          displayName: '辉光庆典',
          poolType: 'extra',
          startDate: '2026-08-01T04:00:00.000Z',
          endDate: '2026-09-01T04:00:00.000Z',
          poolData: {
            id: 'extra_special',
            type: 'extra',
            name: '辉光庆典',
            extra_subtype: 'special',
            extra_rule_profile: 'brilliance_festival_v1',
            featured_characters: ['角色一', '角色二', '角色三', '角色四'],
          },
        }]}
      />
    );

    const grid = document.querySelector('[data-avatar-layout="grid"]');
    expect(grid).toBeTruthy();
    expect(grid.querySelectorAll('img')).toHaveLength(4);
  });
});
