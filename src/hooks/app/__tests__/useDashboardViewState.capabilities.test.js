import { describe, expect, it } from 'vitest';

import {
  buildDashboardSpecialProgress,
  getDashboardPoolViewMeta,
} from '../useDashboardViewState.js';

describe('dashboard capability view state', () => {
  it('keeps reconstruction weapons in extra styling while driving weapon semantics from entityType', () => {
    const meta = getDashboardPoolViewMeta({
      id: 'reconstruction-weapon',
      type: 'extra',
      extra_rule_profile: 'reconstruction_weapon_v1',
      extra_series_key: 'weapon-series',
    });

    expect(meta).toMatchObject({
      normalizedPoolType: 'extra',
      isExtra: true,
      isWeapon: true,
      maxPity: 40,
      resourceSummaryVariant: 'weapon',
    });
    expect(meta.capabilities.extraSubtype).toBe('reconstruction_claim');
  });

  it('exposes reconstruction character 30/60/90, 120, and 240-series progress without inventing claims', () => {
    const { capabilities } = getDashboardPoolViewMeta({
      id: 'reconstruction-character',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'character-series',
    });
    const progress = buildDashboardSpecialProgress({
      capabilities,
      paidTotal: 95,
      freePullCount: 10,
      targetProgress: { validPullCount: 95, firstTargetIndex: 0 },
    });

    expect(progress.freeTenMilestones).toEqual([
      { threshold: 30, progress: 30, reached: true, received: true },
      { threshold: 60, progress: 60, reached: true, received: false },
      { threshold: 90, progress: 90, reached: true, received: false },
    ]);
    expect(progress.targetGuarantee).toEqual({ threshold: 120, progress: 95, reached: false });
    expect(progress.giftInterval).toBe(240);
    expect(progress.paidTotal).toBe(95);
  });

  it('uses the series-scoped free record count for each reconstruction milestone', () => {
    const { capabilities } = getDashboardPoolViewMeta({
      id: 'reconstruction-character-stage-b',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'character-series',
    });

    const progress = buildDashboardSpecialProgress({
      capabilities,
      paidTotal: 65,
      freePullCount: 20,
      targetProgress: { validPullCount: 65, firstTargetIndex: 0 },
    });

    expect(progress.freeTenMilestones.map(({ received }) => received)).toEqual([true, true, false]);
    expect(progress.freeTenMilestones.map(({ reached }) => reached)).toEqual([true, true, false]);
  });
});
