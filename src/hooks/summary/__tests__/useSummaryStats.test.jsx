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

vi.mock('../../../utils/gameAccountMetadata.js', () => ({
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
  { id: 'pool-extra', type: 'extra' },
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
    ...Array.from({ length: 60 }, (_, index) => makePull(
      index + 1,
      'pool-limited-old',
      index === 59 ? { rarity: 6, item_name: '洛茜', isStandard: true } : {}
    )),
    ...Array.from({ length: 10 }, (_, index) => makePull(
      index + 61,
      'pool-limited-new',
      index === 4 ? { rarity: 6, item_name: '莱万汀', isStandard: true } : {}
    )),
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
    const { result, rerender } = renderHook(
      ({ currentHistory }) => useSummaryStats(currentHistory, pools, user),
      { initialProps: { currentHistory: history } }
    );
    const firstStats = result.current;

    const editedHistory = history.map(pull => (
      pull.id === 78
        ? { ...pull, rarity: 6, item_name: '常驻六星A' }
        : pull
    ));
    rerender({ currentHistory: editedHistory });

    expect(result.current).not.toBe(firstStats);
    expect(result.current.total).toBe(firstStats.total);
    expect(result.current.sixStar).toBe(firstStats.sixStar + 1);
    expect(result.current.fiveStar).toBe(firstStats.fiveStar - 1);
    expect(result.current).toEqual(buildSummaryStats({
      history: editedHistory,
      pools,
      user,
      characters: fixtureCharacters,
    }));
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
});
