import { afterEach, describe, expect, it, vi } from 'vitest';

import { LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../../constants/index.js';
import { buildCurrentTargetProbabilityInfo } from '../../features/simulator/simulatorProbability.js';
import {
  calculateExpectedPulls,
  calculateFiveStarProbability,
  calculateSixStarProbability,
  checkGiftAvailable,
  checkGuaranteedLimitedTrigger,
  checkInfoBookAvailable,
  runSimulationBatch,
  simulateCharacterFreeTen,
  simulateSinglePull,
  simulateTenPull,
  simulateWeaponTenClaim,
} from '../probabilityEngine.js';
import { calculateWeaponSixStarPityTargetProbability } from '../weaponPoolProbability.js';

describe('probabilityEngine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps limited six-star probability at base rate before soft pity and increases afterwards', () => {
    expect(LIMITED_POOL_RULES.sixStarSoftPityStart).toBe(66);
    expect(calculateSixStarProbability(65, LIMITED_POOL_RULES)).toBe(LIMITED_POOL_RULES.sixStarBaseProbability);
    expect(calculateSixStarProbability(66, LIMITED_POOL_RULES)).toBeGreaterThan(
      LIMITED_POOL_RULES.sixStarBaseProbability
    );
    expect(calculateSixStarProbability(LIMITED_POOL_RULES.sixStarPity, LIMITED_POOL_RULES)).toBe(1);
  });

  it('keeps weapon six-star probability fixed until hard pity', () => {
    expect(calculateSixStarProbability(1, WEAPON_POOL_RULES)).toBe(WEAPON_POOL_RULES.sixStarBaseProbability);
    expect(calculateSixStarProbability(WEAPON_POOL_RULES.sixStarPity, WEAPON_POOL_RULES)).toBe(1);
  });

  it('uses five-star base rate until pity and guarantees at pity', () => {
    expect(calculateFiveStarProbability(1, LIMITED_POOL_RULES)).toBe(LIMITED_POOL_RULES.fiveStarBaseProbability);
    expect(calculateFiveStarProbability(LIMITED_POOL_RULES.fiveStarPity, LIMITED_POOL_RULES)).toBe(1);
  });

  it('checks guaranteed limited trigger and reward thresholds', () => {
    expect(
      checkGuaranteedLimitedTrigger({
        guaranteedLimitedPity: LIMITED_POOL_RULES.guaranteedLimitedPity,
        hasReceivedGuaranteedLimited: false,
      })
    ).toBe(true);

    expect(
      checkGuaranteedLimitedTrigger({
        guaranteedLimitedPity: LIMITED_POOL_RULES.guaranteedLimitedPity,
        hasReceivedGuaranteedLimited: true,
      })
    ).toBe(false);

    expect(checkGiftAvailable(LIMITED_POOL_RULES.giftInterval, LIMITED_POOL_RULES)).toBe(true);
    expect(checkGiftAvailable(LIMITED_POOL_RULES.giftInterval - 1, LIMITED_POOL_RULES)).toBe(false);

    expect(
      checkInfoBookAvailable(
        {
          hasReceivedInfoBook: false,
          totalPulls: LIMITED_POOL_RULES.infoBookThreshold,
        },
        LIMITED_POOL_RULES
      )
    ).toBe(true);
    expect(
      checkInfoBookAvailable(
        {
          hasReceivedInfoBook: true,
          totalPulls: LIMITED_POOL_RULES.infoBookThreshold,
        },
        LIMITED_POOL_RULES
      )
    ).toBe(false);
  });

  it('returns a bounded expected pull count near hard pity', () => {
    expect(calculateExpectedPulls(LIMITED_POOL_RULES.sixStarPity - 1, LIMITED_POOL_RULES)).toBe(1);
    expect(calculateExpectedPulls(0, LIMITED_POOL_RULES)).toBeGreaterThan(0);
  });

  it('preserves single-pull target guarantee and state snapshots without a legacy roster', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const state = {
      totalPulls: 119,
      sixStarPity: 20,
      fiveStarPity: 4,
      sixStarCount: 2,
      guaranteedLimitedPity: 119,
      hasReceivedGuaranteedLimited: false,
    };
    const result = simulateSinglePull(state, LIMITED_POOL_RULES, 'limited_character', '测试UP');
    expect(result).toMatchObject({
      rarity: 6,
      isUp: true,
      isLimited: true,
      characterName: '测试UP',
      totalPulls: 120,
      sixStarCount: 3,
      sixStarPity: 0,
      fiveStarPity: 0,
      guaranteedLimitedPity: 120,
      hasReceivedGuaranteedLimited: true,
      isGuaranteedUp: false,
    });
    expect(state.totalPulls).toBe(119);
    expect(state.hasReceivedGuaranteedLimited).toBe(false);
  });

  it('returns intermediate ten-pull snapshots and preserves supplied roster identities and avatars', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const state = { totalPulls: 30, sixStarPity: 20, fiveStarPity: 0 };
    const results = simulateTenPull(state, LIMITED_POOL_RULES, 'limited', '测试UP', {
      up: ['测试UP'],
      offBanner: ['测试常驻'],
      fiveStar: [{ id: 'five', name: '测试五星', avatar_url: '/five.webp' }],
      fourStar: [{ id: 'four', name: '测试四星', avatarUrl: '/four.webp' }],
    });
    expect(results.map((result) => result.totalPulls)).toEqual(Array.from({ length: 10 }, (_, index) => 31 + index));
    expect(results[0]).toMatchObject({ sixStarPity: 21, rarity: 4, characterId: 'four', avatarUrl: '/four.webp' });
    expect(results[9]).toMatchObject({
      sixStarPity: 30,
      fiveStarPity: 0,
      rarity: 5,
      fiveStarCount: 1,
      characterId: 'five',
      avatarUrl: '/five.webp',
    });
    expect(state).toEqual({ totalPulls: 30, sixStarPity: 20, fiveStarPity: 0 });
  });

  it('rejects unknown extra profiles and explicit missing roster buckets in pure entry points', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(() =>
      simulateSinglePull({}, LIMITED_POOL_RULES, {
        id: 'unknown-extra',
        type: 'extra',
        extra_rule_profile: 'future_profile_v2',
      })
    ).toThrow('规则尚未识别');
    expect(() => simulateSinglePull({}, LIMITED_POOL_RULES, 'limited', '测试UP', {})).toThrow(
      'simulator_incomplete_roster'
    );
  });

  it('reports actual six-star pity intervals in batch simulation', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const result = runSimulationBatch(1, 80, LIMITED_POOL_RULES, 'limited');
    // This roll misses every soft-pity chance and reaches hard pity at 80.
    expect(result.avgSixStarCount).toBe('1.00');
    expect(result.avgSixStarPity).toBe('80.00');
    expect(result.sixStarDistribution).toEqual({ 80: 1 });
  });

  it('guarantees at least one five-star or higher result in character free ten-pulls', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const results = simulateCharacterFreeTen(LIMITED_POOL_RULES, 'limited', '测试UP', {
      up: ['测试UP'],
      fiveStar: ['测试五星'],
      fourStar: ['测试四星'],
    });

    expect(results).toHaveLength(10);
    expect(results.some((result) => result.rarity >= 5)).toBe(true);
    expect(results.every((result) => result.isFree === true)).toBe(true);
    expect(results.at(-1)).toMatchObject({
      rarity: 5,
      isUp: false,
      isLimited: false,
      isFree: true,
    });
  });

  it('guarantees a six-star weapon on the fourth claim after three missed claims', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const { results, nextState } = simulateWeaponTenClaim(
      {
        totalPulls: 30,
        sixStarPity: 30,
        guaranteedLimitedPity: 30,
        hasReceivedGuaranteedLimited: false,
      },
      WEAPON_POOL_RULES,
      '测试武器',
      {
        up: ['测试武器'],
        offBanner: ['常驻武器'],
        fiveStar: ['测试五星武器'],
        fourStar: ['测试四星武器'],
      }
    );

    expect(results).toHaveLength(10);
    expect(results.filter((result) => result.rarity === 6)).toHaveLength(1);
    expect(results.some((result) => result.rarity >= 5)).toBe(true);
    expect(nextState).toMatchObject({
      sixStarPity: 0,
      guaranteedLimitedPity: 40,
      hasReceivedGuaranteedLimited: false,
    });
  });

  it('matches gui.cpp weapon fourth-claim pity target probability', () => {
    const expected = 1 - 0.75 * 0.99 ** 9;

    expect(calculateWeaponSixStarPityTargetProbability(WEAPON_POOL_RULES)).toBeCloseTo(expected, 12);

    const displayInfo = buildCurrentTargetProbabilityInfo({
      currentPity: 30,
      guaranteedLimitedPity: 30,
      hasReceivedGuaranteedLimited: false,
      poolType: 'weapon',
      customRules: WEAPON_POOL_RULES,
    });

    expect(displayInfo).toMatchObject({
      label: '目标武器',
      sixStarProbability: 1,
      targetRate: WEAPON_POOL_RULES.upProbability,
      unit: 'claim',
    });
    expect(displayInfo.probability).toBeCloseTo(expected, 12);
  });

  it('preselects one forced six-star slot on weapon fourth-claim pity', () => {
    const randomValues = [0.51];
    vi.spyOn(Math, 'random').mockImplementation(() => (randomValues.length > 0 ? randomValues.shift() : 0.999));

    const { results } = simulateWeaponTenClaim(
      {
        totalPulls: 30,
        sixStarPity: 30,
        guaranteedLimitedPity: 30,
        hasReceivedGuaranteedLimited: false,
      },
      WEAPON_POOL_RULES,
      '测试武器',
      {
        up: ['测试武器'],
        offBanner: ['常驻武器'],
        fiveStar: ['测试五星武器'],
        fourStar: ['测试四星武器'],
      }
    );

    expect(results.findIndex((result) => result.rarity === 6)).toBe(5);
    expect(results.filter((result) => result.rarity === 6)).toHaveLength(1);
    expect(results[5]).toMatchObject({
      rarity: 6,
      isUp: false,
    });
  });

  it('guarantees the target weapon on the eighth claim before the first target hit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const { results, nextState } = simulateWeaponTenClaim(
      {
        totalPulls: 70,
        sixStarPity: 10,
        guaranteedLimitedPity: 70,
        hasReceivedGuaranteedLimited: false,
      },
      WEAPON_POOL_RULES,
      '测试武器',
      {
        up: ['测试武器'],
        offBanner: ['常驻武器'],
        fiveStar: ['测试五星武器'],
        fourStar: ['测试四星武器'],
      }
    );

    expect(results).toHaveLength(10);
    expect(results.some((result) => result.rarity === 6 && result.isUp)).toBe(true);
    expect(nextState).toMatchObject({
      sixStarPity: 0,
      guaranteedLimitedPity: 80,
      hasReceivedGuaranteedLimited: true,
    });
  });

  it('does not repeat the target weapon guarantee after it has already been received', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const { results, nextState } = simulateWeaponTenClaim(
      {
        totalPulls: 150,
        sixStarPity: 30,
        guaranteedLimitedPity: 80,
        hasReceivedGuaranteedLimited: true,
      },
      WEAPON_POOL_RULES,
      '测试武器',
      {
        up: ['测试武器'],
        offBanner: ['常驻武器'],
        fiveStar: ['测试五星武器'],
        fourStar: ['测试四星武器'],
      }
    );

    expect(results).toHaveLength(10);
    expect(results.some((result) => result.rarity === 6)).toBe(true);
    expect(results.some((result) => result.rarity === 6 && result.isUp)).toBe(false);
    expect(nextState).toMatchObject({
      sixStarPity: 0,
      guaranteedLimitedPity: 80,
      hasReceivedGuaranteedLimited: true,
    });
  });
});
