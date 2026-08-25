import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const controllerState = vi.hoisted(() => ({ value: null }));

vi.mock('../useGachaSimulatorController.js', () => ({
  useGachaSimulatorController: () => controllerState.value,
}));

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    t: (key) => ({
      'simulator.hero.reconstructionCharacter': 'RECONSTRUCTION HEADHUNTING',
      'simulator.hero.reconstructionWeapon': 'RECONSTRUCTION CLAIM',
    }[key] || key),
  }),
}));

vi.mock('../SimulatorToolbar.jsx', () => ({ default: () => null }));
vi.mock('../SimulatorResults.jsx', () => ({ default: () => null }));
vi.mock('../SimulatorControls.jsx', () => ({ default: () => null }));
vi.mock('../PullAnimation.jsx', () => ({ default: () => null }));
vi.mock('../LimitedPoolAnalysis.jsx', () => ({ default: () => null }));
vi.mock('../SimulatorHistoryPanel.jsx', () => ({ default: () => null }));
vi.mock('../SimulatorShareCard.jsx', () => ({ default: () => null }));

import GachaSimulator from '../GachaSimulator.jsx';

function buildController(profile, basePoolType) {
  const isWeapon = profile === 'reconstruction_weapon_v1';
  const pool = {
    id: isWeapon ? 'recon-weapon' : 'recon-character',
    type: 'extra',
    name: isWeapon ? '重构武器' : '重构角色',
    extra_rule_profile: profile,
    extra_series_key: isWeapon ? 'series-w' : 'series-c',
  };
  return {
    currentPoolObj: pool,
    currentSimPool: pool,
    currentPullCosts: { single: {}, ten: {}, settings: { originiteToJadeRate: 1 } },
    dashboardStats: {},
    effectivePityObj: {},
    expandedTenPulls: new Set(),
    historyGroups: [],
    pityInfoWithGuarantee: {},
    poolPullCounts: {},
    poolCharactersList: {},
    pullHistory: [],
    resourceLedger: {},
    resourceSettings: {},
    shareActionFeedback: { phase: 'idle' },
    sharePayload: {},
    shareTimelineSections: [],
    simulator: { poolType: basePoolType },
    simulatorPools: [pool],
    canAffordSinglePull: !isWeapon,
    canAffordTenPull: true,
    isAnimating: false,
    isShareActionBusy: false,
    isWeaponPool: isWeapon,
    lastResults: null,
    resetAllPools: false,
    resetKeepResources: false,
    resetSettings: false,
    showOriginitePrompt: null,
    showResetConfirm: false,
    showToast: false,
    skipAnimation: true,
    supportsClipboardImageCopy: false,
    supportsNativeImageShare: false,
  };
}

describe('GachaSimulator profile hero', () => {
  beforeEach(() => {
    controllerState.value = buildController('reconstruction_character_v1', 'limited');
  });

  it('uses reconstruction character and weapon profile titles instead of base pool titles', () => {
    const { rerender } = render(<GachaSimulator />);
    expect(screen.getByRole('heading', { name: 'RECONSTRUCTION HEADHUNTING' })).toBeInTheDocument();

    controllerState.value = buildController('reconstruction_weapon_v1', 'weapon');
    rerender(<GachaSimulator />);
    expect(screen.getByRole('heading', { name: 'RECONSTRUCTION CLAIM' })).toBeInTheDocument();
  });
});
