import { describe, expect, it } from 'vitest';

import { applySimulatorSeriesState, buildSimulatorSeriesState } from '../simulatorSeriesState.js';

const characterStageA = {
  id: 'recon-character-a',
  type: 'extra',
  extra_rule_profile: 'reconstruction_character_v1',
  extra_series_key: 'series-1',
};
const characterStageB = {
  ...characterStageA,
  id: 'recon-character-b',
};
const weaponStageA = {
  id: 'recon-weapon-a',
  type: 'extra',
  extra_rule_profile: 'reconstruction_weapon_v1',
  extra_series_key: 'series-1',
};
const weaponStageB = {
  ...weaponStageA,
  id: 'recon-weapon-b',
};

describe('simulatorSeriesState', () => {
  it('restores reconstruction character pity, target and rewards across stages', () => {
    const seriesState = buildSimulatorSeriesState(characterStageA, {
      sixStarPity: 37,
      fiveStarPity: 6,
      guaranteedLimitedPity: 91,
      hasReceivedGuaranteedLimited: false,
      seriesRewardPulls: 231,
      giftsReceived: 0,
      freeTenPullsReceived: 3,
    });

    expect(applySimulatorSeriesState(characterStageB, {
      sixStarPity: 0,
      fiveStarPity: 0,
      guaranteedLimitedPity: 0,
      seriesRewardPulls: 0,
    }, seriesState)).toMatchObject({
      sixStarPity: 37,
      fiveStarPity: 6,
      guaranteedLimitedPity: 91,
      hasReceivedGuaranteedLimited: false,
      seriesRewardPulls: 231,
      freeTenPullsReceived: 3,
    });
  });

  it('keeps reconstruction weapon six-star pity pool-local while sharing target and rewards', () => {
    const seriesState = buildSimulatorSeriesState(weaponStageA, {
      sixStarPity: 30,
      guaranteedLimitedPity: 70,
      hasReceivedGuaranteedLimited: false,
      seriesRewardPulls: 170,
      giftsReceived: 1,
    });

    expect(seriesState).not.toHaveProperty('sixStarPity');
    expect(applySimulatorSeriesState(weaponStageB, {
      sixStarPity: 20,
      fiveStarPity: 0,
      guaranteedLimitedPity: 0,
      seriesRewardPulls: 0,
    }, seriesState)).toMatchObject({
      sixStarPity: 20,
      guaranteedLimitedPity: 70,
      seriesRewardPulls: 170,
      giftsReceived: 1,
    });
  });

  it('refuses state from another profile or series', () => {
    const seriesState = buildSimulatorSeriesState(characterStageA, {
      sixStarPity: 37,
      guaranteedLimitedPity: 91,
    });

    expect(applySimulatorSeriesState({
      ...characterStageB,
      extra_series_key: 'series-2',
    }, { sixStarPity: 4 }, seriesState)).toEqual({ sixStarPity: 4 });
    expect(applySimulatorSeriesState(weaponStageB, { sixStarPity: 8 }, seriesState)).toEqual({ sixStarPity: 8 });
  });
});
