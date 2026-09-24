import { describe, expect, it } from 'vitest';
import { observationAccountCoverage, observationCostInterval, observationFrequencyBins, observationShareWithin } from '../observationInsights.js';

const summary = { sampleCount: 10, points: [
  { cost: 1, count: 1 }, { cost: 10, count: 2 }, { cost: 11, count: 2 },
  { cost: 20, count: 3 }, { cost: 21, count: 1 }, { cost: 100, count: 1 },
] };

describe('observed acquisition insights', () => {
  it('uses frequency weights and inverse CDF thresholds, not a mean of unique costs', () => {
    expect(observationCostInterval(summary)).toEqual({ q25: 10, median: 11, q75: 20, p90: 21 });
    expect(observationShareWithin(summary, 20)).toBe(.8);
    expect(observationShareWithin(summary, 0)).toBe(0);
    expect(observationShareWithin(summary, 100)).toBe(1);
  });

  it('distinguishes missing samples from zero and handles tied one-sample percentiles', () => {
    expect(observationCostInterval({ sampleCount: 0, points: [] })).toEqual({ q25: null, median: null, q75: null, p90: null });
    expect(observationShareWithin(undefined, 80)).toBeNull();
    expect(observationCostInterval({ sampleCount: 1, points: [{ cost: 37, count: 1 }] })).toEqual({ q25: 37, median: 37, q75: 37, p90: 37 });
  });

  it('counts each boundary exactly once and retains empty frequency bins', () => {
    const bins = observationFrequencyBins(summary, 0, 100, 10);
    expect(bins.slice(0, 3)).toEqual([
      { cost: 10, from: 1, to: 10, count: 3 },
      { cost: 20, from: 11, to: 20, count: 5 },
      { cost: 30, from: 21, to: 30, count: 1 },
    ]);
    expect(bins[3].count).toBe(0);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(10);
    expect(observationFrequencyBins(summary, 0, 100, 20).reduce((sum, bin) => sum + bin.count, 0)).toBe(10);
  });

  it('clips edge bins without moving their anchors or mutating the full sample denominator', () => {
    expect(observationFrequencyBins(summary, 10, 21, 10)).toEqual([
      { cost: 10, from: 10, to: 10, count: 2 },
      { cost: 20, from: 11, to: 20, count: 5 },
      { cost: 21, from: 21, to: 21, count: 1 },
    ]);
    expect(observationShareWithin(summary, 20)).toBe(.8);
    expect(observationFrequencyBins(summary, 10, 11, 1).map((bin) => bin.count)).toEqual([2, 2]);
  });

  it('derives account coverage independently of repeat hits and unknown cost intervals', () => {
    expect(observationAccountCoverage({ count: 40, nonObtainingAccounts: 3, first: { sampleCount: 2 } }, 10))
      .toEqual({ obtained: 7, notRecorded: 3, total: 10, rate: .7 });
    expect(observationAccountCoverage({ nonObtainingAccounts: 10 }, 10)?.rate).toBe(0);
    expect(observationAccountCoverage({ nonObtainingAccounts: 0 }, 0)).toBeNull();
  });
});
