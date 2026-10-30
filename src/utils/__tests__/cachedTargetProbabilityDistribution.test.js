import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../targetProbabilityDistribution.js', async original => {
  const actual = await original();
  return { targetProbabilityDistribution: vi.fn(actual.targetProbabilityDistribution) };
});
import { targetProbabilityDistribution } from '../targetProbabilityDistribution.js';
import { cachedTargetProbabilityDistribution } from '../cachedTargetProbabilityDistribution.js';
import { LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../../constants/index.js';
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => vi.restoreAllMocks());

describe('persisted rule-model calculations', () => {
  it('restores the exact saved curve without running the model again', () => {
    const input = { rules: LIMITED_POOL_RULES, horizon: 180 };
    const first = cachedTargetProbabilityDistribution(input);
    const second = cachedTargetProbabilityDistribution(input);
    expect(second).toEqual(first);
    expect(targetProbabilityDistribution).toHaveBeenCalledTimes(1);
    first.points.length = 0;
    expect(cachedTargetProbabilityDistribution(input).points).toHaveLength(181);
  });
  it('separates rule values, pity, guarantee state, horizon and claim units', () => {
    for (const options of [
      { rules: LIMITED_POOL_RULES }, { rules: { ...LIMITED_POOL_RULES, upProbability: .75 } },
      { rules: LIMITED_POOL_RULES, currentPity: 20 }, { rules: LIMITED_POOL_RULES, guaranteeProgress: 80 },
      { rules: LIMITED_POOL_RULES, guaranteeUsed: true }, { rules: LIMITED_POOL_RULES, horizon: 80 },
      { rules: WEAPON_POOL_RULES, unit: 'claim', horizon: 24 },
    ]) cachedTargetProbabilityDistribution(options);
    expect(targetProbabilityDistribution).toHaveBeenCalledTimes(7);
  });
  it('recomputes corrupt/obsolete saved results and rejects invalid model inputs', () => {
    for (const saved of ['{broken', JSON.stringify({ modelVersion: 0, curves: [] })]) {
      localStorage.setItem('endfield-target-probability-v1', saved);
      expect(cachedTargetProbabilityDistribution({ rules: LIMITED_POOL_RULES }).points).toHaveLength(161);
    }
    expect(targetProbabilityDistribution).toHaveBeenCalledTimes(2);
    expect(() => cachedTargetProbabilityDistribution({ rules: LIMITED_POOL_RULES, currentPity: -1 })).toThrow('Invalid target distribution state');
  });
  it('caps saved curves and works when browser storage is full', () => {
    for (let horizon = 1; horizon <= 15; horizon++) cachedTargetProbabilityDistribution({ rules: LIMITED_POOL_RULES, horizon });
    expect(JSON.parse(localStorage.getItem('endfield-target-probability-v1')).curves).toHaveLength(12);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(cachedTargetProbabilityDistribution({ rules: LIMITED_POOL_RULES, horizon: 180 }).points).toHaveLength(181);
  });
  it('keeps prediction usable when access to browser storage is denied', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    expect(cachedTargetProbabilityDistribution({ rules: LIMITED_POOL_RULES, horizon: 180 }).points).toHaveLength(181);
  });
});
