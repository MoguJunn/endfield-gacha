import { describe, expect, it } from 'vitest';
import { buildScopedLegacyStatistics } from '../scopedLegacyStatistics.js';
import { storedAccountKey } from '../storedPoolObservations.js';
import { buildScopedPaidHistoryTimeline } from '../poolScopedHistory.js';

const pools = [
  { id: 'old', type: 'limited', up_character: 'Alpha', start_time: '2026-01-01' },
  { id: 'new', type: 'limited', up_character: 'Beta', start_time: '2026-02-01' },
  { id: 'standard', type: 'standard' },
  { id: 'weapon', type: 'weapon', up_character: 'Blade' },
  { id: 'weapon-next', type: 'weapon', up_character: 'Blade' },
  { id: 'festival', type: 'extra', extra_rule_profile: 'brilliance_festival_v1',
    six_star_entities: [{ id: 'alpha', name: 'Alpha', is_up: true }, { id: 'beta', name: 'Beta', is_up: true }] },
  ...['a', 'b'].map((stage) => ({ id: `re-${stage}`, type: 'extra',
    extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'series-one', up_character: 'Alpha' })),
  { id: 're-other', type: 'extra', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'series-two', up_character: 'Alpha' },
  { id: 're-weapon', type: 'extra', extra_rule_profile: 'reconstruction_weapon_v1', extra_series_key: 'series-one', up_character: 'Blade' },
];
const characters = [
  { id: 'alpha', name: 'Alpha', aliases: ['Alpha alias'], type: 'character', rarity: 6 },
  { id: 'beta', name: 'Beta', type: 'character', rarity: 6 },
  { id: 'blade', name: 'Blade', type: 'weapon', rarity: 6 },
];
const row = (seq, pool = 'old', overrides = {}) => ({
  id: `record-${seq}`, seq_id: seq, pool_id: pool, game_uid: 'private-game-uid',
  user_id: 'private-user-id', server_scope: 'cn',
  gacha_time: new Date(Date.UTC(2026, 0, 1) + seq * 1000).toISOString(),
  rarity: 4, character_name: 'Low', ...overrides,
});
const run = (history, memberPoolIds = ['new'], extra = {}) =>
  buildScopedLegacyStatistics({ history, pools, characters, memberPoolIds, ...extra });

describe('buildScopedLegacyStatistics', () => {
  it('returns finite empty resources and explicit unknown interval boundaries', () => {
    expect(run([])).toMatchObject({
      regularTotal: 0, sixStarCount: 0, sixStarRate: 0, targetCount: 0, offTargetCount: 0,
      targetRate: null, avgSixStarInterval: null, resultsPerTarget: null, giftCount: 0,
      intervalDistribution: [], resources: { jadeSpent: 0, aicQuotaDirect: 0, arsenalSpent: 0 },
      meta: { prefixVerified: false, participatingAccounts: 0, boundaryIntervalCount: 0 },
    });
  });

  it('inherits limited pity from unselected periods and attributes only the hitting pool', () => {
    const history = [row(1, 'old', { rarity: 6, character_name: 'Alpha' }),
      ...Array.from({ length: 12 }, (_, i) => row(i + 2)),
      row(14, 'new', { rarity: 6, character_name: 'Beta' })];
    const stats = run(history.reverse());
    expect(stats).toMatchObject({ regularTotal: 1, sixStarCount: 1, sixStarRate: 1,
      targetCount: 1, offTargetCount: 0, targetRate: 1, avgSixStarInterval: 13, resultsPerTarget: 1,
      intervalDistribution: [{ from: 11, to: 20, target: 1, offTarget: 0, count: 1 }],
      meta: { intervalCount: 1, boundaryIntervalCount: 0 } });
    expect(run(history, ['old', 'new'])).toMatchObject({ sixStarCount: 2,
      avgSixStarInterval: 7, meta: { intervalCount: 2, boundaryIntervalCount: 1 } });
  });

  it('isolates users and servers even when their game uid and record ids match', () => {
    const a = [row(1), row(2, 'new', { rarity: 6, character_name: 'Beta' })];
    const b = [row(2, 'new', { rarity: 6, character_name: 'Beta', server_scope: 'intl' })];
    const c = [row(2, 'new', { rarity: 6, character_name: 'Beta', user_id: 'other-user' })];
    expect(run([...a, ...b, ...c])).toMatchObject({ regularTotal: 3, avgSixStarInterval: 4 / 3,
      resources: { aicQuotaDirect: 90, bondQuotaDirect: 0 },
      meta: { participatingAccounts: 3, boundaryIntervalCount: 3 } });
    expect(run([...a, ...b, ...c], ['new'], { accountKey: storedAccountKey(a[0]) }))
      .toMatchObject({ regularTotal: 1, avgSixStarInterval: 2,
        resources: { aicQuotaDirect: 30 }, meta: { participatingAccounts: 1 } });
  });

  it('does not share weapon pity between pools', () => {
    expect(run([row(1, 'weapon'),
      row(2, 'weapon-next', { rarity: 6, character_id: 'blade', character_name: '' })], ['weapon-next']))
      .toMatchObject({ avgSixStarInterval: 1, targetCount: 1,
        resources: { characterPulls: 0, weaponPulls: 1, arsenalSpent: 198, aicQuotaDirect: 50 } });
  });

  it('shares reconstruction character pity only within the same profile and series', () => {
    const history = [row(1, 'old'), row(2, 're-a'), row(3, 're-other'), row(4, 're-weapon'),
      row(5, 're-b', { rarity: 6, character_name: 'Alpha' })];
    expect(run(history, ['re-b'])).toMatchObject({ regularTotal: 1, avgSixStarInterval: 2,
      targetCount: 1, meta: { intervalCount: 1, boundaryIntervalCount: 1 } });
  });

  it('does not fabricate an interval for reconstruction pools without a series', () => {
    const stats = run([row(1, 'incomplete', { rarity: 6, character_name: 'Alpha' })], ['incomplete'], {
      pools: [{ id: 'incomplete', type: 'extra', extra_rule_profile: 'reconstruction_character_v1', up_character: 'Alpha' }],
    });
    expect(stats).toMatchObject({ regularTotal: 1, sixStarCount: 1, avgSixStarInterval: null,
      intervalDistribution: [], meta: { missingSeriesIntervalCount: 1 } });
  });

  it('uses source pool target rules instead of limited-character flags', () => {
    const history = [row(1, 'new', { rarity: 6, character_name: 'Beta', is_up: false }),
      row(2, 'new', { rarity: 6, character_name: 'Alpha', is_up: true }),
      row(3, 'festival', { rarity: 6, character_name: 'Beta' }),
      row(4, 'standard', { rarity: 6, character_name: 'Alpha', is_up: true })];
    expect(run(history, ['new', 'festival', 'standard'])).toMatchObject({
      sixStarCount: 4, targetCount: 2, offTargetCount: 1, unknownTargetCount: 0,
      targetRate: 2 / 3, resultsPerTarget: 2,
      intervalDistribution: [{ from: 1, to: 10, target: 2, offTarget: 1, unknown: 0, count: 4 }],
    });
    expect(run(history, ['standard'])).toMatchObject({ targetCount: 0, offTargetCount: 0, targetRate: null });
  });

  it('excludes free and gift six-stars from pity but keeps info books as regular results', () => {
    const history = [row(1, 'new'),
      row(2, 'new', { rarity: 6, character_name: 'Beta', is_free_pull: true }),
      row(3, 'new', { rarity: 6, character_name: 'Beta', special_type: 'gift' }),
      row(4, 'new', { rarity: 6, character_name: 'Beta', is_info_book: true })];
    expect(run(history)).toMatchObject({ regularTotal: 2, sixStarCount: 1, sixStarRate: 0.5,
      giftCount: 1, avgSixStarInterval: 2, resources: {
        characterPulls: 2, chargedCharacterPulls: 1, jadeSpent: 500,
        arsenalGained: 2020, aicQuotaDirect: 60, bondQuotaDirect: 50, trustTokensGained: 1,
      } });
  });

  it('infers info-book credit per account using earlier unselected pools', () => {
    const history = [...Array.from({ length: 60 }, (_, i) => row(i + 1)),
      row(61, 'new'), row(62, 'new', { game_uid: 'other-account' })];
    expect(run(history)).toMatchObject({ regularTotal: 2, giftCount: 0,
      resources: { characterPulls: 2, chargedCharacterPulls: 1, jadeSpent: 500 } });
  });

  it('retains full-account copy order through pool filtering, gifts and aliases', () => {
    const history = [...Array.from({ length: 5 }, (_, i) => row(i + 1, 'old', {
      rarity: 6, character_name: 'Alpha alias',
    })), row(6, 'old', { rarity: 6, character_id: 'alpha', character_name: '', special_type: 'gift' }),
    row(7, 'new', { rarity: 6, character_id: 'alpha', character_name: '' })];
    expect(run(history)).toMatchObject({ giftCount: 0, resources: {
      aicQuotaDirect: 0, bondQuotaDirect: 50, endpointQuotaConvertible: 10,
      trustTokensGained: 1, excessTrustTokens: 1,
    } });
  });

  it('uses numeric sequence ordering when pulls have the same timestamp', () => {
    const timestamp = '2026-01-01T12:00:00Z';
    const history = [row(10, 'new', { rarity: 6, character_name: 'Alpha', gacha_time: timestamp }),
      row(2, 'old', { rarity: 6, character_name: 'Alpha', gacha_time: timestamp })];
    expect(run(history).resources).toMatchObject({ aicQuotaDirect: 0, bondQuotaDirect: 50 });
  });

  it('preserves festival free-pull Bond quota and info-book resource exemptions', () => {
    const history = [row(1, 'festival', { character_name: 'A' }),
      row(2, 'festival', { character_name: 'B', is_free_pull: true }),
      row(3, 'festival', { character_name: 'C', special_type: 'info_book' }),
      row(4, 'festival', { character_name: 'D', special_type: 'gift' })];
    expect(run(history, ['festival'])).toMatchObject({ regularTotal: 2, giftCount: 1,
      resources: { chargedCharacterPulls: 1, jadeSpent: 500, aicQuotaDirect: 90,
        bondQuotaDirect: 2, arsenalGained: 40 } });
  });

  it('supports normalized fields and pool aliases without mutating inputs', () => {
    const history = [Object.freeze({ id: 'normalized', userId: 'private-user-id', gameUid: 'uid', serverScope: 'cn',
      poolId: 'official-pool', timestamp: 1770000000000, seqId: 1,
      characterId: 'beta', rarity: '6', isInfoBookPull: true })];
    expect(run(Object.freeze(history), ['official-pool'], {
      accountKey: storedAccountKey(history[0]),
      pools: [{ id: 'db-pool', pool_id: 'official-pool', type: 'limited', up_character: 'Beta' }],
    })).toMatchObject({ regularTotal: 1, targetCount: 1,
      resources: { jadeSpent: 0, arsenalGained: 2000, aicQuotaDirect: 30 } });
  });

  it('drops invalid and duplicate records like stored observations', () => {
    const history = [
      row(1, 'new'),
      { ...row(2, 'new'), id: undefined },
      { ...row(3, 'new'), gacha_time: undefined },
      row(4, 'new', { rarity: 3 }),
      row(5, 'new'),
      row(5, 'new'),
      row(6, 'new', { game_uid: 'other-account' }),
    ];
    expect(run(history)).toMatchObject({
      regularTotal: 3,
      resources: { characterPulls: 3, chargedCharacterPulls: 3, jadeSpent: 1500 },
      meta: { excludedRecords: 4,
        exclusions: { missingIdentity: 1, invalidTime: 1, invalidRarity: 1, duplicate: 1,
          missingPool: 0, unresolvedPool: 0 } },
    });
  });

  it('marks unidentified six-stars as unknown instead of off-target', () => {
    const history = [
      row(1, 'new', { rarity: 6, character_name: '' }),
      row(2, 'new', { rarity: 6, character_name: 'Mystery' }),
      row(3, 'new', { rarity: 6, character_id: 'char-missing', character_name: 'Beta' }),
      row(4, 'new', { rarity: 6, character_name: 'Beta' }),
      row(5, 'new', { rarity: 6, character_name: 'Alpha' }),
      row(6, 'new', { rarity: 6, character_name: 'BETA' }),
      row(7, 'new', { rarity: 6, character_name: 'Beta Prime' }),
    ];
    expect(run(history)).toMatchObject({
      sixStarCount: 7, targetCount: 2, offTargetCount: 1, unknownTargetCount: 4,
      targetRate: 2 / 3, resultsPerTarget: 3.5,
      intervalDistribution: [{ from: 1, to: 10, target: 2, offTarget: 1, unknown: 4, count: 7 }],
    });
  });

  it('reports unknown when the pool target itself has no directory identity', () => {
    const stats = run([row(1, 'no-up', { rarity: 6, character_name: 'Alpha' })], ['no-up'], {
      pools: [{ id: 'no-up', type: 'limited' }],
    });
    expect(stats).toMatchObject({ targetCount: 0, offTargetCount: 0, unknownTargetCount: 1, targetRate: null });

    const festival = run([row(1, 'festival-empty', { rarity: 6, character_name: 'Alpha' })], ['festival-empty'], {
      pools: [{ id: 'festival-empty', type: 'extra', extra_rule_profile: 'brilliance_festival_v1' }],
    });
    expect(festival).toMatchObject({ targetCount: 0, offTargetCount: 0, unknownTargetCount: 1 });
  });

  it('resolves targets from the directory identity instead of the untrusted record label', () => {
    const record = { id: 'label-1', record_id: 'label-1', user_id: 'owner', game_uid: 'uid', server_scope: 'cn',
      pool_id: 'new', character_id: 'beta', character_name: 'untrusted user label', rarity: 6,
      timestamp: new Date(1770000000000).toISOString() };
    expect(run([Object.freeze({ ...record })])).toMatchObject({
      regularTotal: 1, targetCount: 1, offTargetCount: 0, unknownTargetCount: 0,
      resources: { aicQuotaDirect: 30, jadeSpent: 500 },
    });

    const unidentifiable = run([{ ...record, id: 'label-2', record_id: 'label-2', character_id: undefined }]);
    expect(unidentifiable).toMatchObject({ targetCount: 0, offTargetCount: 0, unknownTargetCount: 1 });

    const offPeriod = run([{ ...record, character_id: 'alpha' }]);
    expect(offPeriod).toMatchObject({ targetCount: 0, offTargetCount: 1, unknownTargetCount: 0 });
  });

  it('keeps per-pool intervals identical to the pool-scoped paid timeline helper', () => {
    const history = [row(1, 'weapon'), row(2, 'weapon-next'),
      row(3, 'weapon-next', { rarity: 6, character_id: 'blade', character_name: '' }),
      row(4, 'weapon'), row(5, 'weapon-next'),
      row(6, 'weapon-next', { rarity: 6, character_id: 'blade', character_name: '' }),
      row(7, 'weapon', { special_type: 'gift' }), row(8, 'weapon-next', { is_free_pull: true })];
    const stats = run(history, ['weapon-next']);
    const reference = [];
    let interval = 0;
    for (const paid of buildScopedPaidHistoryTimeline({ history, pools, pool: pools.find((pool) => pool.id === 'weapon-next') })) {
      interval += 1;
      if (paid.rarity === 6) {
        reference.push(interval);
        interval = 0;
      }
    }
    expect(reference).toEqual([2, 2]);
    expect(stats.meta.intervalCount).toBe(reference.length);
    expect(stats.avgSixStarInterval).toBe(reference.reduce((sum, value) => sum + value, 0) / reference.length);
    expect(stats.intervalDistribution.reduce((sum, bin) => sum + bin.count, 0)).toBe(reference.length);
  });

  it('keeps one pass per account across many per-pool scopes', () => {
    const manyPools = Array.from({ length: 40 }, (_, index) => ({ id: `w-${index}`, type: 'weapon', up_character: 'Blade' }));
    const history = [];
    for (let index = 0; index < 40; index += 1) {
      history.push(row(index * 10 + 1, `w-${index}`));
      history.push(row(index * 10 + 2, `w-${index}`, { rarity: 6, character_id: 'blade', character_name: '' }));
    }
    const stats = buildScopedLegacyStatistics({ history, pools: manyPools, characters,
      memberPoolIds: manyPools.map((pool) => pool.id) });
    expect(stats).toMatchObject({ regularTotal: 80, sixStarCount: 40, targetCount: 40,
      avgSixStarInterval: 2, meta: { intervalCount: 40, boundaryIntervalCount: 40 } });
    expect(stats.intervalDistribution).toEqual([{ from: 1, to: 10, target: 40, offTarget: 0, unknown: 0, count: 40 }]);
  });

  it('exposes no account identity or original record data and reports unclassifiable rows', () => {
    const stats = run([row(1, 'new', { game_uid: null }), row(2, 'missing'),
      row(3, 'unresolved'), row(4, 'new', { rarity: 6, character_name: 'Beta' })],
    ['new', 'missing', 'unresolved'], { pools: [...pools, { id: 'unresolved', type: 'extra' }] });
    expect(stats).toMatchObject({ regularTotal: 1,
      meta: { excludedRecords: 3,
        exclusions: { missingIdentity: 1, invalidTime: 0, invalidRarity: 0, duplicate: 0,
          missingPool: 1, unresolvedPool: 1 } } });
    const serialized = JSON.stringify(stats);
    for (const privateValue of ['private-game-uid', 'private-user-id', 'record-4', 'Beta', 'game_uid', 'accountKey', 'character_name']) {
      expect(serialized).not.toContain(privateValue);
    }
  });
});
