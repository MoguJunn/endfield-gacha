import { describe, expect, it } from 'vitest';

import {
  buildOneTimeTargetGuaranteeState,
  buildScopedPaidHistoryTimeline,
  getPoolSeriesStateKey,
  isTargetSixStarHistoryRecord,
} from '../poolScopedHistory.js';

function makePull(poolId, index, overrides = {}) {
  return {
    id: `${poolId}-${index}`,
    poolId,
    rarity: 4,
    timestamp: index,
    ...overrides,
  };
}

describe('poolScopedHistory', () => {
  const characterA = {
    id: 'recon-char-a',
    type: 'extra',
    extra_rule_profile: 'reconstruction_character_v1',
    extra_series_key: 'recon-s1',
    up_character: '角色A',
  };
  const characterB = {
    id: 'recon-char-b',
    type: 'extra',
    extra_rule_profile: 'reconstruction_character_v1',
    extra_series_key: 'recon-s1',
    up_character: '角色B',
  };
  const weaponSameRawSeries = {
    id: 'recon-weapon-a',
    type: 'extra',
    extra_rule_profile: 'reconstruction_weapon_v1',
    extra_series_key: 'recon-s1',
    up_character: '武器A',
  };

  it('isolates series timelines by profile plus series key', () => {
    const pools = [characterA, characterB, weaponSameRawSeries];
    const history = [
      makePull(characterA.id, 1),
      makePull(weaponSameRawSeries.id, 2),
      makePull(characterB.id, 3),
    ];

    expect(buildScopedPaidHistoryTimeline({
      history,
      pools,
      pool: characterB,
      scopeType: 'pity',
    }).map((pull) => pull.id)).toEqual([
      'recon-char-a-1',
      'recon-char-b-3',
    ]);
    expect(getPoolSeriesStateKey(characterA)).toBe(getPoolSeriesStateKey(characterB));
    expect(getPoolSeriesStateKey(characterA)).not.toBe(getPoolSeriesStateKey(weaponSameRawSeries));
  });

  it('detects a cross-stage 120th target and ignores free or gift records', () => {
    const paidHistory = [
      ...Array.from({ length: 70 }, (_, index) => makePull(characterA.id, index + 1)),
      ...Array.from({ length: 50 }, (_, index) => makePull(characterB.id, index + 71)),
    ];
    paidHistory[119] = {
      ...paidHistory[119],
      rarity: 6,
      isStandard: false,
      character_name: '角色B',
    };
    const history = [
      makePull(characterA.id, -2, { isFree: true }),
      makePull(characterA.id, -1, { specialType: 'gift' }),
      ...paidHistory,
    ];

    const state = buildOneTimeTargetGuaranteeState({
      history,
      pools: [characterA, characterB],
      pool: characterB,
    });

    expect(state).toMatchObject({
      supported: true,
      pity: 120,
      hasReceivedGuaranteedLimited: true,
    });
    expect(state.timeline).toHaveLength(120);
    expect(state.guaranteedRecordKeys.has(paidHistory[119].id)).toBe(true);
  });

  it('keeps unknown profiles target-conservative', () => {
    const unknownPool = {
      id: 'unknown-extra',
      type: 'extra',
      extra_rule_profile: 'future_profile_v2',
      extra_series_key: 'future-series',
    };

    expect(buildOneTimeTargetGuaranteeState({
      history: [makePull(unknownPool.id, 1, { rarity: 6, isStandard: false })],
      pools: [unknownPool],
      pool: unknownPool,
    })).toMatchObject({
      supported: false,
      pity: 0,
      hasReceivedGuaranteedLimited: false,
    });
  });

  it('prefers explicit target names over stale standard flags for single-up pools', () => {
    const limitedPool = {
      id: 'limited-up',
      type: 'limited',
      up_character: '目标角色',
    };
    const weaponPool = {
      id: 'weapon-up',
      type: 'weapon',
      up_character: '目标武器',
    };

    expect(isTargetSixStarHistoryRecord({
      rarity: 6,
      item_name: '目标角色',
      isStandard: true,
    }, limitedPool)).toBe(true);
    expect(isTargetSixStarHistoryRecord({
      rarity: 6,
      item_name: '常驻角色',
      isStandard: false,
    }, limitedPool)).toBe(false);
    expect(isTargetSixStarHistoryRecord({
      rarity: 6,
      item_name: '目标武器',
      is_standard: true,
    }, weaponPool)).toBe(true);
    expect(isTargetSixStarHistoryRecord({
      rarity: 6,
      item_name: '常驻武器',
      is_standard: false,
    }, weaponPool)).toBe(false);
  });
});
