import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAllSimulatorStates,
  clearSimulatorCurrentPoolId,
  clearSimulatorMultipleFreeTenPreference,
  clearSimulatorOriginitePromptSuppressDate,
  clearSimulatorSkipAnimationPreference,
  clearSimulatorSeriesState,
  convertSimulatorHistoryToImportFormat,
  loadSimulatorCurrentPoolId,
  loadSimulatorOriginitePromptSuppressDate,
  loadSimulatorSkipAnimationPreference,
  loadSimulatorSeriesState,
  saveSimulatorCurrentPoolId,
  saveSimulatorOriginitePromptSuppressDate,
  saveSimulatorSkipAnimationPreference,
  saveSimulatorSeriesState,
  saveSimulatorState,
} from '../simulatorStorage.js';

describe('simulatorStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears extra simulator state together with other pool states', () => {
    saveSimulatorState('limited', { pity: 10 });
    saveSimulatorState('extra', { pity: 20 });
    saveSimulatorState('weapon', { pity: 30 });
    saveSimulatorState('standard', { pity: 40 });

    clearAllSimulatorStates();

    expect(localStorage.getItem('gacha_simulator_state_limited')).toBeNull();
    expect(localStorage.getItem('gacha_simulator_state_extra')).toBeNull();
    expect(localStorage.getItem('gacha_simulator_state_weapon')).toBeNull();
    expect(localStorage.getItem('gacha_simulator_state_standard')).toBeNull();
  });

  it('exports extra simulator pulls using extra pool type', () => {
    const result = convertSimulatorHistoryToImportFormat([
      {
        rarity: 6,
        name: '佩丽卡',
        timestamp: 1710000000000,
        isUp: true,
      }
    ], 'sim_extra_demo', 'extra');

    expect(result).toEqual([
      expect.objectContaining({
        pool: 'extra',
        name: '佩丽卡',
        rarity: 6,
        isLimited: true,
      })
    ]);
  });

  it('stores scoped current pool id through simulator storage helpers', () => {
    saveSimulatorCurrentPoolId('sim_special_001', 'u:test|g:1001');

    expect(loadSimulatorCurrentPoolId('u:test|g:1001')).toBe('sim_special_001');

    clearSimulatorCurrentPoolId('u:test|g:1001');

    expect(loadSimulatorCurrentPoolId('u:test|g:1001')).toBeNull();
  });

  it('stores simulator ui preferences and originite prompt suppression separately', () => {
    saveSimulatorSkipAnimationPreference(true);
    saveSimulatorOriginitePromptSuppressDate('2026-04-21');

    expect(loadSimulatorSkipAnimationPreference()).toBe(true);
    expect(loadSimulatorOriginitePromptSuppressDate()).toBe('2026-04-21');

    clearSimulatorSkipAnimationPreference();
    clearSimulatorOriginitePromptSuppressDate();

    expect(loadSimulatorSkipAnimationPreference()).toBe(false);
    expect(loadSimulatorOriginitePromptSuppressDate()).toBeNull();
  });

  it('clears the retired repeated free ten-pull preference key', () => {
    localStorage.setItem('simulator_multipleFreeTen', 'true');

    clearSimulatorMultipleFreeTenPreference();

    expect(localStorage.getItem('simulator_multipleFreeTen')).toBeNull();
  });

  it('stores series state under the profile plus series key and account scope', () => {
    const seriesStateKey = 'reconstruction_character_v1::series-a';
    const state = {
      seriesStateKey,
      sixStarPity: 21,
      guaranteedLimitedPity: 80,
    };

    saveSimulatorSeriesState(seriesStateKey, state, 'u:test|g:1001');

    expect(loadSimulatorSeriesState(seriesStateKey, 'u:test|g:1001')).toEqual(state);
    expect(loadSimulatorSeriesState(seriesStateKey, 'u:test|g:1002')).toBeNull();

    clearSimulatorSeriesState(seriesStateKey, 'u:test|g:1001');
    expect(loadSimulatorSeriesState(seriesStateKey, 'u:test|g:1001')).toBeNull();
  });
});
