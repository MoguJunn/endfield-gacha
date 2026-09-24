import { describe, expect, it } from 'vitest';
import { LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../../constants/index.js';
import { targetProbabilityDistribution } from '../targetProbabilityDistribution.js';

describe('target first-passage probability', () => {
  it('matches a hand-computed two-step process including an off-target reset', () => {
    const rules = { sixStarPity: 2, sixStarBaseProbability: 0.5, hasSoftPity: false, upProbability: 0.5 };
    const result = targetProbabilityDistribution({ rules, horizon: 2 });
    // Step 1: target .25, off-target .25, no six .5.
    // Step 2: target .25*.25 + .5*.5 = .3125; surviving .4375.
    expect(result.points[1].probability).toBe(0.25);
    expect(result.points[2].probability).toBe(0.3125);
    expect(result.tailProbability).toBe(0.4375);
    expect(result.expectedCapped).toBe(1.75);
    expect(result.expectationIsComplete).toBe(false);
  });
  it('hits 100% by the first guarantee and conserves probability at every step', () => {
    const result = targetProbabilityDistribution({ rules: LIMITED_POOL_RULES, horizon: 160 });
    expect(result.points[120].cumulativeRate).toBeCloseTo(1, 12);
    expect(result.points[121].probability).toBe(0);
    expect(result.expectationIsComplete).toBe(true);
    expect(result.points.reduce((sum, p) => sum + p.probability, 0) + result.tailProbability).toBeCloseTo(1, 12);
    result.points.forEach((point, i) => {
      expect(point.probability).toBeGreaterThanOrEqual(0);
      if (i) expect(point.cumulativeRate).toBeGreaterThanOrEqual(result.points[i - 1].cumulativeRate);
    });
    expect(result.expectedCapped).toBeCloseTo(result.points.reduce((sum, p) => sum + p.cost * p.probability, 0), 10);
  });
  it('does not regrant the one-time guarantee for repeats', () => {
    const result = targetProbabilityDistribution({ rules: LIMITED_POOL_RULES, guaranteeUsed: true, horizon: 120 });
    expect(result.tailProbability).toBeGreaterThan(0);
    expect(result.points[120].cumulativeRate).toBeLessThan(1);
  });
  it('still labels a tiny nonzero tail as a capped expectation', () => {
    const rules = { sixStarPity: 1, sixStarBaseProbability: 1, hasSoftPity: false, upProbability: 0.5 };
    const result = targetProbabilityDistribution({ rules, horizon: 50 });
    expect(result.tailProbability).toBe(2 ** -50);
    expect(result.expectationIsComplete).toBe(false);
  });
  it('separates inherited six-star pity from the per-banner guarantee', () => {
    const result = targetProbabilityDistribution({ rules: LIMITED_POOL_RULES, currentPity: 79, horizon: 1 });
    expect(result.points[1].probability).toBe(0.5);
    const forced = targetProbabilityDistribution({ rules: LIMITED_POOL_RULES, guaranteeProgress: 119, horizon: 1 });
    expect(forced.points[1].probability).toBe(1);
  });
  it('models weapons by whole claims and explicitly labels the reserved-slot model', () => {
    const result = targetProbabilityDistribution({ rules: WEAPON_POOL_RULES, unit: 'claim', horizon: 12 });
    expect(result.points[1].probability).toBeCloseTo(1 - 0.99 ** 10, 12);
    expect(result.points[8].cumulativeRate).toBeCloseTo(1, 12);
    expect(result.model).toBe('reserved-six-star-slot');
    const guaranteed = targetProbabilityDistribution({ rules: WEAPON_POOL_RULES, unit: 'claim', currentPity: 3, horizon: 1 });
    expect(guaranteed.points[1].probability).toBeCloseTo(1 - 0.75 * 0.99 ** 9, 12);
  });
  it('rejects impossible starting states instead of silently normalizing them', () => {
    expect(() => targetProbabilityDistribution({ rules: LIMITED_POOL_RULES, currentPity: 80 })).toThrow('Invalid');
    expect(() => targetProbabilityDistribution({ rules: LIMITED_POOL_RULES, guaranteeProgress: 120 })).toThrow('Invalid');
    expect(() => targetProbabilityDistribution({ rules: LIMITED_POOL_RULES, guaranteeUsed: 'false' })).toThrow('Invalid');
    for (const rules of [undefined, {}, { ...LIMITED_POOL_RULES, sixStarBaseProbability: NaN }, { ...LIMITED_POOL_RULES, sixStarSoftPityIncrease: undefined }]) {
      expect(() => targetProbabilityDistribution({ rules })).toThrow('Invalid');
    }
  });
});
