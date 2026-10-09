import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSimulator, getRulesByPoolType } from '../gachaSimulator.js';
import { characterCache } from '../characterUtils.js';
import {
  EXTRA_POOL_RULES,
  LIMITED_POOL_RULES,
  UNRESOLVED_POOL_RULES,
  WEAPON_POOL_RULES,
} from '../../constants/index.js';

describe('gachaSimulator state import', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs the legacy facade without loading the global character cache', () => {
    const load = vi.spyOn(characterCache, 'load').mockResolvedValue([]);
    createSimulator('limited');
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the current simulator pool type when importing stale saved state', () => {
    const simulator = createSimulator('extra');

    simulator.importState({
      poolType: 'limited',
      totalPulls: 90,
      pullHistory: [{ pullNumber: 1, rarity: 4, characterName: 'Alpha' }],
    });

    expect(simulator.getState()).toMatchObject({
      poolType: 'extra',
      totalPulls: 90,
    });
    expect(simulator.exportState()).toMatchObject({
      poolType: 'extra',
    });

    simulator.reset();
    expect(simulator.getState()).toMatchObject({
      poolType: 'extra',
      totalPulls: 0,
    });
  });

  it('keeps free ten-pulls from changing pity, paid pulls, target guarantee, or rewards', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const simulator = createSimulator('limited');
    simulator.updateState({
      sixStarPity: 20,
      fiveStarPity: 8,
      totalPulls: 30,
      sixStarCount: 1,
      fiveStarCount: 2,
      guaranteedLimitedPity: 30,
      hasReceivedGuaranteedLimited: false,
      giftsReceived: 0,
    });

    const results = simulator.pullFreeTen();

    expect(results).toHaveLength(10);
    expect(results.some((result) => result.rarity >= 5)).toBe(true);
    expect(simulator.getState()).toMatchObject({
      sixStarPity: 20,
      fiveStarPity: 8,
      totalPulls: 30,
      sixStarCount: 1,
      fiveStarCount: 2,
      guaranteedLimitedPity: 30,
      hasReceivedGuaranteedLimited: false,
      giftsReceived: 0,
      freeTenPullsReceived: 1,
    });
    expect(simulator.getState().pullHistory).toHaveLength(10);
    expect(simulator.getState().pullHistory.every((pull) => pull.isFreePull === true)).toBe(true);
  });

  it('earns only one free ten-pull from paid limited pulls', () => {
    const simulator = createSimulator('limited');
    simulator.updateState({
      totalPulls: 90,
      freeTenPullsReceived: 0,
    });

    expect(simulator.getStatistics().freeTenPulls).toMatchObject({
      count: 1,
      isNewGift: true,
      nextGiftAt: null,
      remainingPulls: 0,
    });
  });

  it('rejects repeated free ten-pulls after the earned allowance is used', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const simulator = createSimulator('extra');
    simulator.updateState({ totalPulls: 30 });

    simulator.pullFreeTen();
    expect(() => simulator.pullFreeTen()).toThrow('免费十连不可用');

    expect(simulator.getState().freeTenPullsReceived).toBe(1);
    expect(simulator.getState().pullHistory).toHaveLength(10);
    expect(simulator.getStatistics().freeTenPulls).toMatchObject({ count: 1, received: 1, available: 0 });
  });

  it('rejects single pulls for weapon pools because weapons are claimed in sets of ten', () => {
    const simulator = createSimulator('weapon');

    expect(() => simulator.pullSingle()).toThrow('武器池按申领进行');
  });

  it('keeps roster avatar urls on four-star and five-star simulator results', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const roster = {
      up: [{ name: '测试UP', avatarUrl: '/avatars/up.webp' }],
      offBanner: [{ name: '测试常驻', avatarUrl: '/avatars/off.webp' }],
      fiveStar: [{ name: '测试五星', avatarUrl: '/avatars/five.webp' }],
      fourStar: [{ name: '测试四星', avatarUrl: '/avatars/four.webp' }],
    };

    const fiveStarSimulator = createSimulator('limited', null, '测试UP', roster);
    fiveStarSimulator.updateState({ fiveStarPity: 9 });
    expect(fiveStarSimulator.pullSingle()).toMatchObject({
      rarity: 5,
      characterName: '测试五星',
      avatarUrl: '/avatars/five.webp',
    });

    randomSpy.mockReturnValue(0.999);
    const fourStarSimulator = createSimulator('limited', null, '测试UP', roster);
    expect(fourStarSimulator.pullSingle()).toMatchObject({
      rarity: 4,
      characterName: '测试四星',
      avatarUrl: '/avatars/four.webp',
    });
  });

  it('runs weapon ten-pulls as one arsenal claim and advances claim-based pity', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const simulator = createSimulator('weapon', null, '测试武器', {
      up: [{ name: '测试武器' }],
      offBanner: [{ name: '常驻武器' }],
      fiveStar: [{ name: '测试五星武器' }],
      fourStar: [{ name: '测试四星武器' }],
    });
    simulator.updateState({
      totalPulls: 70,
      sixStarPity: 10,
      guaranteedLimitedPity: 70,
      hasReceivedGuaranteedLimited: false,
    });

    const results = simulator.pullTen();

    expect(results).toHaveLength(10);
    expect(results.some((result) => result.rarity === 6 && result.isUp)).toBe(true);
    expect(simulator.getState()).toMatchObject({
      totalPulls: 80,
      sixStarPity: 0,
      guaranteedLimitedPity: 80,
      hasReceivedGuaranteedLimited: true,
      sixStarCount: 1,
      upSixStarCount: 1,
    });
    expect(simulator.getState().pullHistory).toHaveLength(10);
    expect(simulator.getStatistics().avgPullsPerSixStar).toBe('80.0');
  });

  it('resolves extra simulator rules from the pool profile', () => {
    expect(
      getRulesByPoolType({
        type: 'extra',
        extra_rule_profile: 'reconstruction_character_v1',
      })
    ).toBe(LIMITED_POOL_RULES);
    expect(
      getRulesByPoolType({
        type: 'extra',
        extra_rule_profile: 'reconstruction_weapon_v1',
      })
    ).toBe(WEAPON_POOL_RULES);
    expect(
      getRulesByPoolType({
        type: 'extra',
        extra_rule_profile: 'brilliance_festival_v1',
      })
    ).toBe(EXTRA_POOL_RULES);
    expect(
      getRulesByPoolType({
        id: 'joint_unknown',
        type: 'extra',
      })
    ).toBe(UNRESOLVED_POOL_RULES);
  });

  it('uses limited single-UP rules and three free milestones for reconstruction characters', () => {
    const simulator = createSimulator({
      id: 'recon-char',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'series-c',
    });
    simulator.updateState({ totalPulls: 90 });

    expect(simulator.poolType).toBe('limited');
    expect(simulator.rules).toBe(LIMITED_POOL_RULES);
    expect(simulator.getPityInfo().sixStar.max).toBe(80);
    expect(simulator.getStatistics().freeTenPulls).toMatchObject({
      count: 3,
      nextGiftAt: null,
    });
    expect(simulator.checkInfoBook(simulator.getState())).toBe(false);
  });

  it('records all three reconstruction free ten-pull claims without truncating at one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const simulator = createSimulator({
      id: 'recon-char-free',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'series-c',
    });
    simulator.updateState({ seriesRewardPulls: 90, totalPulls: 10 });

    simulator.pullFreeTen();
    simulator.pullFreeTen();
    simulator.pullFreeTen();
    expect(() => simulator.pullFreeTen()).toThrow('免费十连不可用');

    expect(simulator.getState().freeTenPullsReceived).toBe(3);
    expect(simulator.getState().pullHistory).toHaveLength(30);
    expect(simulator.getStatistics().freeTenPulls.count).toBe(3);
    expect(simulator.getStatistics().freeTenPulls.available).toBe(0);
  });

  it('uses claim-based weapon rules for reconstruction weapons', () => {
    const simulator = createSimulator({
      id: 'recon-weapon',
      type: 'extra',
      extra_rule_profile: 'reconstruction_weapon_v1',
    });

    expect(simulator.poolType).toBe('weapon');
    expect(simulator.getPityInfo().sixStar.max).toBe(40);
    expect(() => simulator.pullSingle()).toThrow('武器池按申领进行');
  });

  it('refuses to simulate unknown extra profiles as brilliance festivals', () => {
    const simulator = createSimulator({
      id: 'joint_future',
      type: 'extra',
      extra_rule_profile: 'future_profile_v2',
    });

    expect(simulator.rules).toBe(UNRESOLVED_POOL_RULES);
    expect(() => simulator.pullSingle()).toThrow('规则尚未识别');
  });

  it('rejects free ten-pulls before an allowance has been earned without changing the session', () => {
    const simulator = createSimulator('limited');
    const session = simulator.session;
    expect(() => simulator.pullFreeTen()).toThrow('免费十连不可用');
    expect(simulator.session).toBe(session);
    expect(simulator.getState().pullHistory).toHaveLength(0);
  });

  it('allows inspecting a reconstruction pool without a series key but refuses execution', () => {
    const simulator = createSimulator({
      id: 'missing-series',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
    });
    expect(simulator.getPityInfo().sixStar.max).toBe(80);
    expect(() => simulator.pullSingle()).toThrow('缺少系列标识');
    expect(() => simulator.pullTen()).toThrow('缺少系列标识');
    expect(() => simulator.pullFreeTen()).toThrow('缺少系列标识');
  });

  it('keeps explicitly supplied incomplete rosters strict', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const simulator = createSimulator('limited', null, '测试UP', { up: ['测试UP'] });
    const session = simulator.session;
    expect(() => simulator.pullSingle()).toThrow('simulator_incomplete_roster');
    expect(simulator.session).toBe(session);
  });

  it('calculates averages from stored counters when only partial history is available', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const simulator = createSimulator('limited');
    simulator.importState({
      totalPulls: 80,
      sixStarCount: 2,
      upSixStarCount: 1,
      pullHistory: [{ pullNumber: 80, rarity: 6, isUp: true, characterName: '测试UP' }],
    });
    expect(simulator.getStatistics().avgPullsPerSixStar).toBe('80.0');
    simulator.pullSingle();
    expect(simulator.getState()).toMatchObject({ totalPulls: 81, sixStarCount: 2, upSixStarCount: 1 });
    expect(simulator.getStatistics().avgPullsPerSixStar).toBe('81.0');
    expect(simulator.getState().pullHistory).toHaveLength(2);
  });

  it('uses session info-book availability once and counts its results without charging pulls', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const simulator = createSimulator('limited');
    simulator.updateState({ sixStarPity: 20, infoBookTenPullAvailable: true });
    const results = simulator.pullInfoBookTen();
    expect(results.every((result) => result.isInfoBookPull)).toBe(true);
    expect(simulator.getState()).toMatchObject({
      totalPulls: 10,
      sixStarPity: 30,
      hasUsedInfoBookTenPull: true,
      infoBookTenPullAvailable: false,
    });
    expect(simulator.session.ledger.characterPulls).toBe(0);
    expect(() => simulator.pullInfoBookTen()).toThrow('情报书十连不可用');
  });

  it('restores legacy series reward totals even when only partial history was saved', () => {
    const simulator = createSimulator({
      id: 'legacy-series',
      type: 'extra',
      extra_rule_profile: 'reconstruction_character_v1',
      extra_series_key: 'series-a',
    });
    simulator.importState({ totalPulls: 90, pullHistory: [{ pullNumber: 90, rarity: 4, characterName: '测试四星' }] });
    expect(simulator.getState()).toMatchObject({ totalPulls: 90, seriesRewardPulls: 90 });
    expect(simulator.getStatistics().freeTenPulls).toMatchObject({ count: 3, received: 0, available: 3 });
  });
});
