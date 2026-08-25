import { describe, expect, it, vi } from 'vitest';

import {
  getActiveHomeCountdownPools,
  getCurrentUpPoolInfo,
  getHomeRotationPoolSchedule,
  getLimitedPoolScheduleFromDB,
  getPoolActivityTiming,
} from '../poolTimeUtils.js';

vi.mock('../characterUtils.js', () => ({
  characterCache: {
    isLoaded: () => false,
    searchByName: () => null,
  },
  getCharacterAvatarUrl: (name) => `/avatars/${name}.webp`,
  resolveCharacterRecordByName: (name) => ({ name }),
}));

describe('poolTimeUtils homepage pool schedule', () => {
  const pools = [
    {
      id: 'limited_1',
      type: 'limited',
      name: '春雷动，万物生',
      up_character: '庄方宜',
      start_time: '2026-05-01T04:00:00.000Z',
      end_time: '2026-05-20T04:00:00.000Z',
    },
    {
      id: 'extra_1',
      type: 'extra',
      name: '辉光庆典',
      featured_characters: ['莱万汀', '艾尔黛拉', '别礼', '洁尔佩塔'],
      start_time: '2026-05-14T04:00:00.000Z',
      end_time: '2026-05-28T04:00:00.000Z',
    },
    {
      id: 'limited_2',
      type: 'limited',
      name: '风起云程',
      up_character: '佩丽卡',
      start_time: '2026-05-28T04:00:00.000Z',
      end_time: '2026-06-18T04:00:00.000Z',
    },
    {
      id: 'limited_3',
      type: 'limited',
      name: '星轨待发',
      up_character: '阿尔菲',
      start_time: '2026-06-18T04:00:00.000Z',
      end_time: '2026-07-09T04:00:00.000Z',
    },
    {
      id: 'weapon_1',
      type: 'weapon',
      name: '锋刃审锻',
      up_character: '限定武器',
      start_time: '2026-05-14T04:00:00.000Z',
      end_time: '2026-05-28T04:00:00.000Z',
    },
  ];

  it('keeps the legacy limited schedule scoped to limited character pools', () => {
    const schedule = getLimitedPoolScheduleFromDB(pools);

    expect(schedule).toHaveLength(3);
    expect(schedule[0]).toMatchObject({
      name: '庄方宜',
      poolData: expect.objectContaining({ id: 'limited_1' }),
    });
  });

  it('adds extra pools to the homepage rotation schedule without adding weapon pools', () => {
    const schedule = getHomeRotationPoolSchedule(pools);

    expect(schedule.map((pool) => pool.id)).toEqual(['limited_1', 'extra_1', 'limited_2', 'limited_3']);
    expect(schedule.map((pool) => pool.poolType)).toEqual(['limited', 'extra', 'limited', 'limited']);
    expect(schedule[1]).toMatchObject({
      id: 'extra_1',
      displayName: '辉光庆典',
      featuredNames: ['莱万汀', '艾尔黛拉', '别礼', '洁尔佩塔'],
      poolType: 'extra',
      rotationGroup: 'extra',
      isIndependentNode: true,
    });
  });

  it('returns active limited and extra pools for homepage countdowns', () => {
    const activePools = getActiveHomeCountdownPools(pools, new Date('2026-05-15T04:00:00.000Z'));

    expect(activePools.map((pool) => pool.id)).toEqual(['limited_1', 'extra_1']);
    expect(activePools.every((pool) => pool.isActive)).toBe(true);
  });

  it('keeps the extra-pool countdown visible after the previous limited pool ends', () => {
    const activePools = getActiveHomeCountdownPools(pools, new Date('2026-05-21T04:00:00.000Z'));

    expect(activePools.map((pool) => pool.id)).toEqual(['extra_1']);
    expect(activePools[0]).toMatchObject({
      poolType: 'extra',
      scheduleDate: '2026-05-14T04:00:00.000Z',
    });
  });

  it('derives the next limited pool name from the limited-only timeline', () => {
    const currentPool = getCurrentUpPoolInfo(pools, new Date('2026-05-21T04:00:00.000Z'));

    expect(currentPool).toMatchObject({
      name: '佩丽卡',
      nextPool: '阿尔菲',
      isActive: false,
      poolData: expect.objectContaining({ id: 'limited_2' }),
    });
  });

  it('uses the explicit UP character for homepage countdown and rotation even when the pool roster includes other six-stars', () => {
    const limitedPoolWithRoster = {
      id: 'limited_mifu',
      type: 'limited',
      name: '拳出无悔',
      up_character: '弭弗',
      featured_characters: ['余烬', '弭弗', '庄方宜'],
      resolved_roster: {
        up: [
          { name: '余烬' },
          { name: '弭弗' },
          { name: '庄方宜' },
        ],
      },
      start_time: '2026-06-05T04:00:00.000Z',
      end_time: '2026-06-26T04:00:00.000Z',
    };

    const currentPool = getCurrentUpPoolInfo([limitedPoolWithRoster], new Date('2026-06-06T04:00:00.000Z'));
    const schedule = getHomeRotationPoolSchedule([limitedPoolWithRoster]);

    expect(currentPool).toMatchObject({
      name: '弭弗',
      poolData: expect.objectContaining({ id: 'limited_mifu' }),
    });
    expect(schedule[0]).toMatchObject({
      id: 'limited_mifu',
      name: '弭弗',
      featuredNames: ['弭弗'],
    });
  });

  it('distinguishes active, upcoming and expired pool activity states', () => {
    const pool = {
      start_time: '2026-08-24T12:00:00.000Z',
      end_time: '2026-08-24T13:00:00.000Z',
    };

    expect(getPoolActivityTiming(pool, '2026-08-24T12:40:30.000Z')).toMatchObject({
      status: 'active',
      isActive: true,
      days: 0,
      hours: 0,
      minutes: 20,
    });
    expect(getPoolActivityTiming(pool, '2026-08-24T11:50:30.000Z')).toMatchObject({
      status: 'upcoming',
      isUpcoming: true,
      minutes: 10,
    });
    expect(getPoolActivityTiming(pool, '2026-08-24T13:00:00.000Z')).toMatchObject({
      status: 'expired',
      isExpired: true,
      days: 0,
      hours: 0,
      minutes: 0,
    });
  });
});
