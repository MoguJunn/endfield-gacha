import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createSession,
  getPoolState,
  getResourceLedger,
  replayHistoryEvent,
  sixStarProbability,
} from '../../../../shared/simulator/engine.js';
import { classifyRecord } from '../../../../shared/simulator/records.js';
import { resolvePoolCapabilities } from '../../../utils/poolCapabilities.js';
import { buildSimulatorResourceLedger } from '../../../utils/resourceEconomy.js';

function descriptor(id, type = 'limited', extra = {}) {
  const pool = { id, type, up_character: 'UP', ...extra };
  return {
    id,
    pool,
    capabilities: resolvePoolCapabilities(pool),
    nextPoolId: id === 'a' ? 'b' : null,
    roster: {
      up: [{ id: 'up', name: 'UP' }],
      offBanner: [{ id: 'off', name: 'OFF' }],
      fiveStar: [{ id: 'five', name: 'FIVE' }],
      fourStar: [{ id: 'four', name: 'FOUR' }],
    },
  };
}
const a = descriptor('a');
const b = descriptor('b');
const context = { descriptors: { a, b }, random: () => 0.999, now: 1700000000000 };
function run(s, type = 'single', poolId = 'a', ctx = context) {
  return applyCommand(s, { type, poolId }, ctx);
}
function history(s, d, size, kind = 'paid') {
  for (let i = 0; i < size; i++)
    s = replayHistoryEvent(s, { kind, rarity: 4, characterId: 'four', characterName: 'FOUR', timestamp: i }, d);
  return s;
}

describe('shared simulator v2 engine', () => {
  it('assembles zero-pull pools from a single shared scope without copying or overwriting it', () => {
    const s = history(createSession(), a, 40);
    const serialized = JSON.stringify(s);
    expect(getPoolState(s, b)).toMatchObject({
      sixStarPity: 40,
      fiveStarPity: 40,
      totalPulls: 0,
      guaranteedLimitedPity: 0,
    });
    expect(s.pools.a).not.toHaveProperty('sixStarPity');
    expect(getPoolState(JSON.parse(serialized), b).sixStarPity).toBe(40);
    const result = run(s, 'single', 'b');
    expect(result.session.sharedPityState.sixStarPity).toBe(41);
    expect(JSON.stringify(s)).toBe(serialized);
  });

  it('keeps free outcomes, charged counts and display sequence independent', () => {
    const seed = history(createSession(), a, 30);
    const free = run(seed, 'free');
    expect(getPoolState(free.session, a)).toMatchObject({
      totalPulls: 30,
      sixStarPity: 30,
      sequenceCount: 40,
      freeTenPullsReceived: 1,
    });
    expect(getResourceLedger(free.session).jadeSpent).toBe(getResourceLedger(seed).jadeSpent);
    const paid = run(free.session);
    expect(paid.events[0].record).toMatchObject({ sequenceIndex: 41, paidIndex: 31 });
    expect(() => run(free.session, 'free')).toThrow('simulator_free_unavailable');
    expect(free.events.some((e) => e.record.rarity >= 5)).toBe(true);
  });

  it('keeps the preceding paid pity when a free six-star occurs', () => {
    const seed = history(createSession(), a, 30);
    const free = run(seed, 'free', 'a', { ...context, random: () => 0 });
    const paid = run(free.session, 'single', 'a', { ...context, random: () => 0 });
    expect(getPoolState(paid.session, a).sixStarHistory).toHaveLength(1);
    expect(getPoolState(paid.session, a).sixStarHistory[0].pityWhenPulled).toBe(31);
  });

  it('inherits pending info books into zero-pull pools and consumes them once without charging jade', () => {
    const seed = history(createSession(), a, 60);
    expect(getPoolState(seed, b).infoBookTenPullAvailable).toBe(true);
    const result = run(seed, 'info_book', 'b');
    expect(getPoolState(result.session, b)).toMatchObject({ totalPulls: 10, infoBookTenPullAvailable: false });
    expect(result.session.infoBooks.a.used).toBe(true);
    expect(getResourceLedger(result.session).jadeSpent).toBe(getResourceLedger(seed).jadeSpent);
    expect(() => run(result.session, 'info_book', 'b')).toThrow('simulator_info_book_unavailable');
  });

  it('checks costs before rolling and leaves inputs unchanged on a rejected command', () => {
    const s = createSession({ resourceSettings: { baseJade: 0, baseOriginite: 0 } });
    const serialized = JSON.stringify(s);
    expect(() => run(s)).toThrow('simulator_resource_shortfall');
    expect(JSON.stringify(s)).toBe(serialized);
    expect(() => run(createSession(), 'single', 'a', { ...context, random: () => 1 })).toThrow(
      'simulator_invalid_random'
    );
  });

  it('handles soft and hard pity edges and single-use target guarantees', () => {
    expect(sixStarProbability(65, a.capabilities.rules)).toBe(0.008);
    expect(sixStarProbability(66, a.capabilities.rules)).toBeCloseTo(0.058);
    expect(sixStarProbability(80, a.capabilities.rules)).toBe(1);
    const seed = history(createSession({ resourceSettings: { infiniteResources: true } }), a, 119);
    const result = run(seed);
    expect(result.events[0].record).toMatchObject({ rarity: 6, isUp: true });
    expect(getPoolState(result.session, a).hasReceivedGuaranteedLimited).toBe(true);
    expect(getPoolState(run(result.session).session, a).guaranteedLimitedPity).toBe(120);
  });

  it('keeps weapon claims atomic and guarantees the fourth claim', () => {
    const w = descriptor('w', 'weapon');
    const ctx = { ...context, descriptors: { w } };
    let s = createSession({ resourceSettings: { infiniteResources: true } });
    for (let i = 0; i < 3; i++) s = run(s, 'ten', 'w', ctx).session;
    expect(getPoolState(s, w).sixStarPity).toBe(30);
    const fourth = run(s, 'ten', 'w', ctx);
    expect(fourth.events.filter((e) => e.record.rarity === 6)).toHaveLength(1);
    expect(getPoolState(fourth.session, w).sixStarPity).toBe(0);
    expect(() => run(s, 'single', 'w', ctx)).toThrow('simulator_weapon_single_disabled');
  });

  it('continues from partial legacy weapon histories without discarding outcomes or reusing display sequences', () => {
    const w = descriptor('w', 'weapon');
    const s = history(createSession({ resourceSettings: { infiniteResources: true } }), w, 12);
    const snapshot = JSON.stringify(s);
    const result = run(s, 'ten', 'w', { ...context, descriptors: { w } });
    expect(result.events).toHaveLength(10);
    expect(result.events[0].record.sequenceIndex).toBe(13);
    expect(getPoolState(result.session, w)).toMatchObject({ totalPulls: 22, claimResults: 0, sixStarPity: 20 });
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('records the position within a weapon claim for the pity distribution', () => {
    const w = descriptor('w', 'weapon');
    const s = history(createSession({ resourceSettings: { infiniteResources: true } }), w, 30);
    const result = run(s, 'ten', 'w', { ...context, descriptors: { w } });
    expect(getPoolState(result.session, w).sixStarHistory[0].pityWhenPulled).toBe(40);
  });

  it('does not invent a target or limited gift for explicitly standard weapons', () => {
    const w = descriptor('standard-weapon', 'weapon', { isLimitedWeapon: false });
    w.roster.up = [];
    const result = run(createSession({ resourceSettings: { infiniteResources: true } }), 'ten', w.id, {
      ...context,
      descriptors: { [w.id]: w },
      random: () => 0,
    });
    expect(result.events.every((e) => e.record.rarity === 6 && !e.record.isUp)).toBe(true);
    expect(getPoolState(result.session, w)).toMatchObject({ guaranteedLimitedPity: 0, giftsReceived: 0 });
  });

  it('shares reconstruction reward/target counters and isolates weapon pity per phase', () => {
    const extra = { extra_rule_profile: 'reconstruction_weapon_v1', extra_series_key: 's' };
    const w1 = descriptor('w1', 'extra', extra);
    const w2 = descriptor('w2', 'extra', extra);
    const s = history(createSession(), w1, 30);
    expect(getPoolState(s, w2)).toMatchObject({
      sixStarPity: 0,
      totalPulls: 0,
      guaranteedLimitedPity: 30,
      seriesRewardPulls: 30,
    });
    const wrong = descriptor('wrong', 'extra', { ...extra, extra_series_key: 'different' });
    expect(getPoolState(s, wrong).guaranteedLimitedPity).toBe(0);
  });

  it('uses canonical classification for all supported existing flags', () => {
    for (const key of ['isFree', 'is_free', 'isFreePull', 'is_free_pull'])
      expect(classifyRecord({ [key]: true })).toBe('free');
    for (const key of ['isInfoBook', 'is_info_book', 'isInfoBookPull', 'is_info_book_pull'])
      expect(classifyRecord({ [key]: true })).toBe('info_book');
    expect(classifyRecord({ special_type: 'gift', is_free: true })).toBe('gift');
  });

  it('checks the weapon fourth-claim target distribution against its independent analytic formula', () => {
    const w = descriptor('w', 'weapon');
    const s = history(createSession({ resourceSettings: { infiniteResources: true } }), w, 30);
    let seed = 123456789;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
    const trials = 12000;
    let hits = 0;
    for (let index = 0; index < trials; index++) {
      const result = run(s, 'ten', 'w', { ...context, descriptors: { w }, random });
      if (result.events.some((e) => e.record.rarity === 6 && e.record.isUp)) hits++;
    }
    const expected = 1 - 0.75 * 0.99 ** 9;
    const deviation = Math.sqrt((expected * (1 - expected)) / trials);
    expect(Math.abs(hits / trials - expected)).toBeLessThan(6 * deviation);
  });

  it('matches the existing resource and quota ledger for mixed kinds without replay on reads', () => {
    const d = descriptor('standard', 'standard');
    const rows = Array.from({ length: 9 }, (_, i) => ({
      rarity: i === 0 ? 6 : 4,
      isUp: false,
      characterName: i === 0 ? 'SIX' : 'FOUR',
      timestamp: i,
      kind: i === 2 ? 'free' : i === 3 ? 'info_book' : 'paid',
    }));
    let s = createSession();
    rows.forEach((row) => {
      s = replayHistoryEvent(s, row, d);
    });
    const old = buildSimulatorResourceLedger([
      {
        poolId: d.id,
        poolType: 'standard',
        pullHistory: rows.map((row) => ({
          ...row,
          isFreePull: row.kind === 'free',
          isInfoBookPull: row.kind === 'info_book',
        })),
      },
    ]);
    const actual = getResourceLedger(s);
    for (const key of [
      'jadeSpent',
      'arsenalGained',
      'arsenalSpent',
      'aicQuotaDirect',
      'aicQuotaConvertible',
      'bondQuotaDirect',
      'endpointQuotaConvertible',
    ]) {
      expect(actual[key], key).toBe(old[key]);
    }
  });
});
