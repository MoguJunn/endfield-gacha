import { describe, expect, it } from 'vitest';

import {
  calculateCurrentProbability,
  calculatePity5FromHistory,
  calculatePityFromHistory,
  getPoolRules,
  validateBatchAgainstRules,
  validatePullData,
} from '../validators.js';

describe('validators', () => {
  it('returns weapon rules for weapon pool', () => {
    expect(getPoolRules('weapon')).toMatchObject({
      hasSoftPity: false,
      sixStarPity: 40,
    });
  });

  it('keeps limited pool probability at base rate before soft pity', () => {
    const result = calculateCurrentProbability(10, 'limited');
    expect(result).toMatchObject({
      isInSoftPity: false,
      hasSoftPity: true,
    });
    expect(result.probability).toBe(getPoolRules('limited').sixStarBaseProbability);
  });

  it('increases limited pool probability after soft pity starts', () => {
    const rules = getPoolRules('limited');
    const result = calculateCurrentProbability(rules.sixStarSoftPityStart, 'limited');

    expect(result.isInSoftPity).toBe(true);
    expect(result.probability).toBeGreaterThan(rules.sixStarBaseProbability);
    expect(result.probability).toBeLessThanOrEqual(1);
  });

  it('shows next-pull soft pity and hard pity probabilities from current miss count', () => {
    const rules = getPoolRules('limited');

    expect(calculateCurrentProbability(rules.sixStarSoftPityStart - 1, 'limited')).toMatchObject({
      probability: rules.sixStarBaseProbability + rules.sixStarSoftPityIncrease,
      isInSoftPity: true,
    });

    expect(calculateCurrentProbability(rules.sixStarPity - 1, 'limited')).toMatchObject({
      probability: 1,
      isInSoftPity: true,
    });

    expect(calculateCurrentProbability(getPoolRules('weapon').sixStarPity - 1, 'weapon')).toMatchObject({
      probability: 1,
      hasSoftPity: false,
    });
  });

  it('validates pull payload structure', () => {
    const invalid = validatePullData({
      rarity: 3,
      poolId: '',
      specialType: 'invalid',
    });

    expect(invalid.isValid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      '无效的星级: 3',
      '缺少卡池ID',
      '无效的特殊类型: invalid',
    ]));
  });

  it('calculates pity counters from latest six-star and five-star records', () => {
    const pulls = [
      { rarity: 6 },
      { rarity: 4 },
      { rarity: 4 },
      { rarity: 5 },
      { rarity: 4 },
    ];

    expect(calculatePityFromHistory(pulls)).toBe(4);
    expect(calculatePity5FromHistory(pulls)).toBe(1);
  });

  it('validates weapon six-star pity at claim level instead of fixed slot 40', () => {
    const missedClaim = [
      { rarity: 5, isStandard: true },
      ...Array.from({ length: 9 }, () => ({ rarity: 4 })),
    ];
    const existingPulls = Array.from({ length: 3 }, () => missedClaim).flat();

    const validFourthClaim = [
      { rarity: 6, isStandard: true },
      ...Array.from({ length: 9 }, () => ({ rarity: 4 })),
    ];
    expect(validateBatchAgainstRules({
      batchData: validFourthClaim,
      existingPulls,
      pool: { type: 'weapon' },
    }).isValid).toBe(true);

    const invalidFourthClaim = [
      { rarity: 5, isStandard: true },
      ...Array.from({ length: 9 }, () => ({ rarity: 4 })),
    ];
    const invalidResult = validateBatchAgainstRules({
      batchData: invalidFourthClaim,
      existingPulls,
      pool: { type: 'weapon' },
    });

    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors.some((error) => error.includes('应至少包含1件6星武器'))).toBe(true);
  });

  it('validates weapon target guarantee at claim level instead of fixed slot 80', () => {
    const nonTargetSixStarClaim = [
      { rarity: 6, isUp: false, isLimited: false, isStandard: true },
      ...Array.from({ length: 9 }, () => ({ rarity: 4 })),
    ];
    const existingPulls = Array.from({ length: 7 }, () => nonTargetSixStarClaim).flat();

    const validEighthClaim = [
      { rarity: 6, isUp: false, isLimited: false, isStandard: true },
      ...Array.from({ length: 8 }, () => ({ rarity: 4 })),
      { rarity: 6, isUp: true, isLimited: true, isStandard: false },
    ];
    expect(validateBatchAgainstRules({
      batchData: validEighthClaim,
      existingPulls,
      pool: { type: 'weapon' },
    }).isValid).toBe(true);

    const invalidEighthClaim = [
      { rarity: 6, isUp: false, isLimited: false, isStandard: true },
      ...Array.from({ length: 9 }, () => ({ rarity: 4 })),
    ];
    const invalidResult = validateBatchAgainstRules({
      batchData: invalidEighthClaim,
      existingPulls,
      pool: { type: 'weapon' },
    });

    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors.some((error) => error.includes('应至少包含1件目标武器'))).toBe(true);
  });

  it('shares only reconstruction weapon target claims across stages', () => {
    const stageA = {
      id: 'recon-weapon-a',
      type: 'extra',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'weapon-series',
    };
    const stageB = {
      ...stageA,
      id: 'recon-weapon-b',
    };
    const nonTargetClaim = [
      { rarity: 6, isUp: false, isLimited: false, isStandard: true },
      ...Array.from({ length: 9 }, () => ({ rarity: 4 })),
    ];
    const priorSeriesHistory = Array.from({ length: 7 }, (_, claimIndex) => (
      nonTargetClaim.map((pull, pullIndex) => ({
        ...pull,
        id: `a-${claimIndex}-${pullIndex}`,
        poolId: stageA.id,
        timestamp: claimIndex * 10 + pullIndex,
      }))
    )).flat();
    const invalidEighthClaim = [
      { rarity: 6, isUp: false, isLimited: false, isStandard: true },
      ...Array.from({ length: 9 }, () => ({ rarity: 4 })),
    ];

    const invalidResult = validateBatchAgainstRules({
      batchData: invalidEighthClaim,
      existingPulls: [],
      allLimitedPoolPulls: priorSeriesHistory,
      pools: [stageA, stageB],
      pool: stageB,
    });

    expect(invalidResult.errors.some((error) => error.includes('应至少包含1件目标武器'))).toBe(true);
    expect(invalidResult.errors.some((error) => error.includes('连续 4 次申领未获得6星'))).toBe(false);
  });
});
