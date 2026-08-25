import { describe, expect, it } from 'vitest';

import {
  EXTRA_RULE_PROFILES,
  POOL_RULE_KEYS,
  resolvePoolCapabilities,
} from '../poolCapabilities.js';

describe('resolvePoolCapabilities', () => {
  it('maps reconstruction character pools to limited character rules', () => {
    expect(resolvePoolCapabilities({
      id: 'joint_reconstruction_character',
      type: 'extra',
      extra_rule_profile: EXTRA_RULE_PROFILES.RECONSTRUCTION_CHARACTER,
      extra_series_key: 'reconstruction-s1',
    })).toMatchObject({
      entityType: 'character',
      basePoolType: 'limited',
      rulesKey: POOL_RULE_KEYS.LIMITED,
      targetMode: 'single-up',
      pityScope: 'series',
      rewardScope: 'series',
      seriesKey: 'reconstruction-s1',
      isResolved: true,
      extraSubtype: 'reconstruction',
      ruleProfile: EXTRA_RULE_PROFILES.RECONSTRUCTION_CHARACTER,
      freeTenPullMilestones: [30, 60, 90],
      infoBookEnabled: false,
    });
  });

  it('maps reconstruction weapon pools to weapon rules with pool-local pity', () => {
    expect(resolvePoolCapabilities({
      id: 'joint_reconstruction_weapon',
      type: 'extra',
      extra_subtype: 'reconstruction',
      extra_rule_profile: EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON,
      extra_series_key: 'reconstruction-w1',
    })).toMatchObject({
      entityType: 'weapon',
      basePoolType: 'weapon',
      rulesKey: POOL_RULE_KEYS.WEAPON,
      targetMode: 'single-up',
      pityScope: 'pool',
      rewardScope: 'series',
      seriesKey: 'reconstruction-w1',
      isResolved: true,
      extraSubtype: 'reconstruction_claim',
    });
  });

  it('maps brilliance festival pools to four equal targets and extra rules', () => {
    expect(resolvePoolCapabilities({
      id: 'joint_brilliance',
      type: 'extra',
      extra_rule_profile: EXTRA_RULE_PROFILES.BRILLIANCE_FESTIVAL,
    })).toMatchObject({
      entityType: 'character',
      basePoolType: 'extra',
      rulesKey: POOL_RULE_KEYS.EXTRA,
      targetMode: 'four-target-equal',
      targetCount: 4,
      pityScope: 'pool',
      rewardScope: 'pool',
      isResolved: true,
      extraSubtype: 'special',
      bondQuotaPerPull: true,
    });
  });

  it('only applies the legacy brilliance fallback to exact joint_1_2_2', () => {
    expect(resolvePoolCapabilities({ id: 'joint_1_2_2', type: 'extra' })).toMatchObject({
      ruleProfile: EXTRA_RULE_PROFILES.BRILLIANCE_FESTIVAL,
      isResolved: true,
      isLegacyFallback: true,
    });

    expect(resolvePoolCapabilities({ id: 'joint_unknown', type: 'extra' })).toMatchObject({
      entityType: 'unknown',
      rulesKey: POOL_RULE_KEYS.UNRESOLVED,
      targetMode: 'none',
      isResolved: false,
      extraSubtype: 'unclassified',
      ruleProfile: null,
    });
  });

  it('does not let an explicit unknown profile use the legacy fallback', () => {
    expect(resolvePoolCapabilities({
      id: 'joint_1_2_2',
      type: 'extra',
      extra_rule_profile: 'future_profile_v2',
    })).toMatchObject({
      isResolved: false,
      isLegacyFallback: false,
      ruleProfile: 'future_profile_v2',
    });
  });

  it('keeps ordinary pool behavior compatible', () => {
    expect(resolvePoolCapabilities({ type: 'limited_character' })).toMatchObject({
      entityType: 'character',
      basePoolType: 'limited',
      rulesKey: POOL_RULE_KEYS.LIMITED,
      targetMode: 'single-up',
      pityScope: 'shared',
      isResolved: true,
    });
    expect(resolvePoolCapabilities({ type: 'limited_weapon' })).toMatchObject({
      entityType: 'weapon',
      basePoolType: 'weapon',
      rulesKey: POOL_RULE_KEYS.WEAPON,
    });
    expect(resolvePoolCapabilities({ type: 'standard' })).toMatchObject({
      entityType: 'character',
      basePoolType: 'standard',
      rulesKey: POOL_RULE_KEYS.STANDARD,
      targetMode: 'none',
    });
  });
});
