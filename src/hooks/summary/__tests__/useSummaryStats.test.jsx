import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSummaryStats } from '../useSummaryStats.js';
import { buildSummaryStats } from '../../../utils/summaryStats.js';

const { fixtureCharacters } = vi.hoisted(() => ({
  fixtureCharacters: [
    { id: 'char-luoxi', name: '洛茜', rarity: 6, type: 'character', is_limited: true },
    { id: 'char-levantin', name: '莱万汀', rarity: 6, type: 'character', is_limited: true },
    { id: 'char-standard', name: '常驻六星A', rarity: 6, type: 'character', is_limited: false },
    { id: 'char-five', name: '五星A', rarity: 5, type: 'character', is_limited: false },
  ],
}));

vi.mock('../../../utils/gameAccountMetadata.js', async (importOriginal) => ({
  ...(await importOriginal()),
  classifyGameAccountRegionBucket: vi.fn(() => 'cn'),
}));

vi.mock('../../../utils/characterUtils.js', () => ({
  characterCache: {
    getAll: vi.fn(() => fixtureCharacters),
  },
}));

const user = { id: 'user-1' };
const pools = [
  { id: 'pool-limited-old', type: 'limited', up_character: '洛茜', start_time: '2026-01-01T00:00:00.000Z' },
  { id: 'pool-limited-new', type: 'limited_character', up_character: '莱万汀', start_time: '2026-02-01T00:00:00.000Z' },
  { id: 'pool-extra', type: 'extra', extra_rule_profile: 'brilliance_festival_v1' },
  { id: 'pool-weapon', type: 'limited_weapon', up_character: '专武' },
  { id: 'pool-standard', type: 'standard' },
];

function makePull(id, poolId, overrides = {}) {
  return {
    id,
    user_id: 'user-1',
    pool_id: poolId,
    rarity: 4,
    item_name: `四星-${id}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
    ...overrides,
  };
}

function buildFixtureHistory() {
  return [
    ...Array.from({ length: 60 }, (_, index) =>
      makePull(index + 1, 'pool-limited-old', index === 59 ? { rarity: 6, item_name: '洛茜', isStandard: true } : {})
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      makePull(index + 61, 'pool-limited-new', index === 4 ? { rarity: 6, item_name: '莱万汀', isStandard: true } : {})
    ),
    makePull(71, 'pool-extra', { rarity: 6, item_name: '附加六星A', isStandard: true }),
    makePull(72, 'pool-extra'),
    makePull(73, 'pool-extra', { isFree: true }),
    makePull(74, 'pool-extra', { rarity: 6, item_name: '赠送六星', specialType: 'gift' }),
    makePull(75, 'pool-weapon', { rarity: 6, item_name: '专武', isStandard: true }),
    makePull(76, 'pool-weapon', { rarity: 6, item_name: '常驻武器', isStandard: false }),
    makePull(77, 'pool-standard', { rarity: 6, item_name: '常驻六星A', isStandard: false }),
    makePull(78, 'pool-standard', { rarity: 5, item_name: '五星A' }),
    makePull(79, 'pool-extra', { user_id: 'user-2', rarity: 6, item_name: '其他人六星' }),
  ];
}

describe('useSummaryStats', () => {
  it('matches the pure builder for multi-pool, free, gift, info-book, and quota data', () => {
    const history = buildFixtureHistory();
    const { result } = renderHook(() => useSummaryStats(history, pools, user));
    const pureStats = buildSummaryStats({ history, pools, user, characters: fixtureCharacters });

    expect(result.current).toEqual(pureStats);

    expect(result.current.total).toBe(76);
    expect(result.current.byType).toMatchObject({
      extra: { total: 2, six: 1, limitedSix: 1 },
      limited: { total: 70, six: 2, limitedSix: 2 },
      weapon: { total: 2, six: 2, limitedSix: 1 },
      standard: { total: 2, six: 1 },
    });
    expect(result.current.byType.limited.resources).toMatchObject({
      characterPulls: 70,
      chargedCharacterPulls: 60,
    });
    expect(result.current.byType.extra.resources).toMatchObject({
      characterPulls: 2,
      chargedCharacterPulls: 2,
      bondQuotaDirect: 3,
    });
    expect(result.current.byType.weapon.resources).toMatchObject({
      weaponPulls: 2,
      chargedWeaponPulls: 2,
      aicQuotaDirect: 100,
    });
    expect(result.current.resources.aicQuotaDirect).toBeGreaterThan(0);
  });
  it('recomputes when history content changes without changing its length', () => {
    const history = buildFixtureHistory();
    const { result, rerender } = renderHook(({ currentHistory }) => useSummaryStats(currentHistory, pools, user), {
      initialProps: { currentHistory: history },
    });
    const firstStats = result.current;

    const editedHistory = history.map((pull) =>
      pull.id === 78 ? { ...pull, rarity: 6, item_name: '常驻六星A' } : pull
    );
    rerender({ currentHistory: editedHistory });

    expect(result.current).not.toBe(firstStats);
    expect(result.current.total).toBe(firstStats.total);
    expect(result.current.sixStar).toBe(firstStats.sixStar + 1);
    expect(result.current.fiveStar).toBe(firstStats.fiveStar - 1);
    expect(result.current).toEqual(
      buildSummaryStats({
        history: editedHistory,
        pools,
        user,
        characters: fixtureCharacters,
      })
    );
  });

  it('keeps the previous extra and character aggregate semantics', () => {
    const history = buildFixtureHistory();
    const { result } = renderHook(() => useSummaryStats(history, pools, user));

    expect(result.current.byType.extra.total).toBe(2);
    expect(result.current.byType.extra.six).toBe(1);
    expect(result.current.byType.extra.limitedSix).toBe(1);
    expect(result.current.byType.extra.counts).toMatchObject({
      6: 1,
      4: 1,
      '6_std': 0,
    });
    expect(result.current.byType.extra.avgPityUp).toBe('2.0');

    expect(result.current.byType.character.total).toBe(74);
    expect(result.current.byType.character.six).toBe(4);
    expect(result.current.byType.character.limitedSix).toBe(3);
    expect(result.current.byType.character.counts).toMatchObject({
      6: 3,
      '6_std': 1,
      4: 69,
    });
    expect(result.current.byType.character.avgPityUp).toBe('24.0');
    expect(result.current.byType.character.avgPityTarget).toBe('24.0');
  });

  it('uses single-up rules and profile-plus-series scope across reconstruction character phases', () => {
    const user = { id: 'user-recon-character' };
    const pools = [
      {
        id: 'phase-a1',
        type: 'extra',
        up_character: '目标角色',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'series-a',
      },
      {
        id: 'phase-a2',
        type: 'extra',
        up_character: '目标角色',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'series-a',
      },
      {
        id: 'phase-b1',
        type: 'extra',
        up_character: '其他角色',
        extra_rule_profile: 'reconstruction_character_v1',
        extra_series_key: 'series-b',
      },
      {
        id: 'weapon-a1',
        type: 'extra',
        up_character: '目标武器',
        extra_rule_profile: 'reconstruction_weapon_v1',
        extra_series_key: 'series-a',
      },
    ];
    const history = [
      { id: 1, user_id: user.id, pool_id: 'phase-a1', rarity: 4, timestamp: '2026-01-01T00:00:01Z' },
      { id: 2, user_id: user.id, pool_id: 'phase-b1', rarity: 4, timestamp: '2026-01-01T00:00:02Z' },
      { id: 3, user_id: user.id, pool_id: 'weapon-a1', rarity: 4, timestamp: '2026-01-01T00:00:03Z' },
      {
        id: 4,
        user_id: user.id,
        pool_id: 'phase-a2',
        rarity: 6,
        item_name: '目标角色',
        timestamp: '2026-01-01T00:00:04Z',
      },
      {
        id: 5,
        user_id: user.id,
        pool_id: 'phase-a2',
        rarity: 6,
        item_name: '常驻角色',
        isStandard: true,
        timestamp: '2026-01-01T00:00:05Z',
      },
    ];

    const { result } = renderHook(() => useSummaryStats(history, pools, user));

    expect(result.current.byType.extra.counts).toMatchObject({ 6: 1, '6_std': 1 });
    expect(result.current.byType.extra.pityList.map((item) => item.count)).toEqual([2, 1]);
    expect(result.current.byType.extra.resources).toMatchObject({
      characterPulls: 4,
      weaponPulls: 1,
      chargedCharacterPulls: 4,
      chargedWeaponPulls: 1,
      jadeSpent: 2000,
      arsenalSpent: 198,
    });
    expect(result.current.byType.character.total).toBe(4);
    expect(result.current.byType.weapon.total).toBe(1);
  });

  it('uses 40-pull weapon pity and arsenal economy for reconstruction weapons', () => {
    const user = { id: 'user-recon-weapon' };
    const pool = {
      id: 'recon-weapon',
      type: 'extra',
      up_character: '目标武器',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'weapon-series',
    };
    const history = Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      user_id: user.id,
      pool_id: pool.id,
      rarity: index === 39 ? 6 : 4,
      item_name: index === 39 ? '目标武器' : `武器${index + 1}`,
      timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z`,
    }));

    const { result } = renderHook(() => useSummaryStats(history, [pool], user));

    expect(result.current.byType.extra.avgPity).toBe('40.0');
    expect(result.current.byType.extra.distribution).toHaveLength(4);
    expect(result.current.byType.extra.distribution[3].count).toBe(1);
    expect(result.current.byType.extra.resources).toMatchObject({
      characterPulls: 0,
      weaponPulls: 40,
      chargedWeaponPulls: 40,
      jadeSpent: 0,
      arsenalSpent: 7920,
      arsenalGained: 0,
    });
    expect(result.current.byType.character).toMatchObject({
      total: 0,
      six: 0,
    });
    expect(result.current.byType.weapon).toMatchObject({
      total: 40,
      six: 1,
      limitedSix: 1,
      counts: { 6: 1, '6_std': 0, 4: 39 },
      avgPity: '40.0',
      avgPityUp: '40.0',
    });
    expect(result.current.byType.weapon.resources).toMatchObject({
      characterPulls: 0,
      weaponPulls: 40,
      arsenalSpent: 7920,
    });
  });

  it('keeps brilliance four-target and Bond rules while displaying it in extra', () => {
    const user = { id: 'user-brilliance' };
    const pool = {
      id: 'festival-explicit',
      type: 'extra',
      extra_rule_profile: 'brilliance_festival_v1',
      featured_characters: ['甲', '乙', '丙', '丁'],
    };
    const history = [
      { id: 1, user_id: user.id, pool_id: pool.id, rarity: 6, item_name: '甲', isStandard: true },
      { id: 2, user_id: user.id, pool_id: pool.id, rarity: 6, item_name: '丁', isStandard: true },
    ];

    const { result } = renderHook(() => useSummaryStats(history, [pool], user));

    expect(result.current.byType.extra).toMatchObject({
      total: 2,
      limitedSix: 2,
      counts: { 6: 2, '6_std': 0 },
    });
    expect(result.current.byType.extra.resources).toMatchObject({
      characterPulls: 2,
      bondQuotaDirect: 2,
    });
  });
});
