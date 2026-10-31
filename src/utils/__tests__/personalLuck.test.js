import { describe, expect, it } from 'vitest';
import { buildPersonalLuck } from '../personalLuck.js';
import { evaluateLuckTimeline, evaluateLuckWindow, sumLuckWindows } from '../personalLuckRating.js';
import { getStartedLuckVersions, groupLuckUnitsByVersion } from '../personalLuckVersions.js';
import { formatAccountGachaHistoryRows } from '../accountGachaHistoryFormat.js';

const pools = [{ id: 'limited', name: '限定', type: 'limited', up_character: '目标角色' }, { id: 'standard', type: 'standard' },
  { id: 'weapon', name: '武器池', type: 'weapon', up_character: '目标武器' }];
const characters = [{ id: 'up', name: '目标角色', rarity: 6, type: 'character', avatar_url: '/avatars/up.webp' },
  { id: 'off', name: '常驻角色', rarity: 6, type: 'character' }, { id: 'wup', name: '目标武器', rarity: 6, type: 'weapon' }, { id: 'woff', name: '常驻武器', rarity: 6, type: 'weapon' }];
const versionConfig = { versions: [{ id: 'v1', name: '版本一', starts_at: '2026-01-01T00:00:00Z' }] };
const row = (seq, changes = {}) => ({ user_id: 'owner', game_uid: 'uid', server_scope: '1', pool_id: 'limited', seq_id: String(seq), record_id: `r${seq}`,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), rarity: 4, ...changes });
const gold = (id = 'up') => ({ rarity: 6, character_id: id, character_name: characters.find(item => item.id === id).name });
const analyze = (history, changes = {}) => buildPersonalLuck({ history, pools, characters, versionConfig, fetchedAt: '2026-01-30T00:00:00Z', ...changes }).accounts;

describe('personal luck reconstructed from complete owner history', () => {
  it('accepts the shared worker format and separates owner, UID and server', () => {
    const raw = [row(1, gold()), row(1, { user_id: 'other', ...gold() }), row(1, { server_scope: '2', ...gold() }), row(1, { game_uid: 'another', ...gold() })];
    const accounts = analyze(formatAccountGachaHistoryRows(raw));
    expect(accounts).toHaveLength(4);
    expect(accounts.every(account => account.character.sample === 1)).toBe(true);
    expect(accounts.map(account => account.key)).toContain(JSON.stringify(['owner', 'uid', '1']));
    expect(JSON.stringify(accounts[0].character)).not.toMatch(/record_id|game_uid|batch_id/);
  });
  it('keeps standard sequence context and excludes free gold from paid pity', () => {
    const rows = Array.from({ length: 65 }, (_, i) => row(i + 1));
    rows.push(...Array.from({ length: 10 }, (_, i) => row(i + 66, { pool_id: 'standard' })), row(76, { is_free: true, ...gold() }), row(77, gold()));
    const stats = analyze(rows)[0].character;
    expect(stats).toMatchObject({ total: 66, sample: 66, soft: 1 });
    expect(stats.expected).toBeCloseTo(65 * .008 + .058, 10);
  });
  it('calculates first-UP only once and retains its probability in expectations', () => {
    const stats = analyze(Array.from({ length: 121 }, (_, i) => row(i + 1, i === 79 ? gold('off') : i === 119 ? gold() : {})))[0].character;
    expect(stats).toMatchObject({ sample: 121, hard: 1, guarantee: 1, chances: 1, wins: 0 });
    expect(stats.expected).toBeCloseTo(65 * .008 + 14 * .008 + .05 * 105 + 1 + 39 * .008 + 1 + .008, 10);
    expect(stats.highlightRecords.streak).toBeNull();
  });
  it('requires complete weapon claims and calculates claim pity and guarantees', () => {
    const rows = Array.from({ length: 80 }, (_, i) => row(i + 1, { pool_id: 'weapon', batch_id: `claim-${Math.floor(i / 10)}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, Math.floor(i / 10))).toISOString(), ...(i === 39 ? gold('woff') : i === 79 ? gold('wup') : {}) }));
    const stats = analyze(rows)[0].weapon;
    expect(stats).toMatchObject({ sample: 80, hard: 2, guarantee: 1, batches: 8 });
    expect(stats.expected).toBeCloseTo(6 * .4 + 2 * 1.36, 10);
    expect(stats.upExpected).toBeCloseTo(6 * .1 + .34 + 1.09, 10);
    expect(analyze(rows.slice(0, 10).map((item, i) => ({ ...item, batch_id: `single-${i}` })))[0].weapon.sample).toBe(0);
  });
  it('labels reward-boundary inference, distinguishes explicit rewards and real missing draws', () => {
    const rows = Array.from({ length: 70 }, (_, i) => row(i + 1, { batch_id: `b${i}`, is_free: i >= 30 && i < 40, ...(i === 49 ? gold() : {}) }));
    rows.push(row(72, { batch_id: 'new' }), row(73, { batch_id: 'gold', ...gold() }), row(74));
    const inferred = analyze(rows)[0].character;
    expect(inferred.sample).toBe(63); expect(inferred.inferredSample).toBe(2);
    expect(inferred.continuity.inferredRewards).toHaveLength(1);
    const explicit = analyze([...rows, row(71, { kind: 'gift_intel_book', ...gold() })])[0].character;
    expect(explicit.sample).toBe(63); expect(explicit.six).toBe(2); expect(explicit.inferredSample).toBe(0);
    const missing = analyze(rows.filter(item => item.seq_id !== '20'))[0].character;
    expect(missing.continuity.inferredRewards).toEqual([]); expect(missing.sample).toBeLessThan(missing.total);
  });
  it('recovers a new pool target after an old gap without resetting inherited six-star pity', () => {
    const old = { ...pools[0], id: 'old', start_time: '2025-12-01T00:00:00Z' }, fresh = { ...pools[0], id: 'new', start_time: '2026-01-02T00:00:00Z' };
    const rows = [row(1, { pool_id: 'old' }), row(3, { pool_id: 'old' }), ...Array.from({ length: 3 }, (_, i) => row(i + 4,
      { pool_id: 'new', timestamp: `2026-01-03T00:00:0${i}Z`, ...(i === 0 ? gold('off') : {}) }))];
    const stats = analyze(rows, { pools: [old, fresh] })[0].character;
    expect(stats.sample).toBe(3); expect(stats.excluded).toMatchObject({ initial: 2, target: 0 });
    const base = { type: 'extra', extra_rule_profile: 'reconstruction_character_v1', extra_series_key: 'series', up_character: '目标角色' };
    const series = analyze(rows, { pools: [{ ...old, ...base }, { ...fresh, ...base }] })[0].character;
    expect(series.excluded.target).toBe(2);
  });
  it('shows only actual multiple six-stars, with named images and dated fastest/streak events', () => {
    const batch = count => Array.from({ length: 10 }, (_, i) => row(i + 1, { timestamp: row(1).timestamp, batch_id: 'ten',
      ...(i < count ? gold(i === 0 ? 'up' : 'off') : { item_name: '四星角色' }) }));
    expect(analyze(batch(1))[0].character.highlightRecords.multi).toBeNull();
    const stats = analyze([...batch(2), row(11, gold()), row(12, gold()), row(13, gold())])[0].character;
    expect(stats.highlightRecords.multi.items).toHaveLength(10);
    expect(stats.highlightRecords.multi.items[0]).toMatchObject({ name: '目标角色', up: true, avatarUrl: 'https://ef-gacha.mogujun.icu/avatars/up.webp' });
    expect(stats.highlightRecords.fastest).toMatchObject({ position: 1, at: row(13).timestamp });
    expect(stats.highlightRecords.streak).toMatchObject({ count: 3, startAt: row(11).timestamp, endAt: row(13).timestamp });
    expect(analyze([row(1, gold()), row(3, gold()), row(4, gold())])[0].character.highlightRecords.streak).toBeNull();
  });
  it('does not fabricate probability scores through supplements or unresolved identities', () => {
    expect(analyze([row(1, gold())], { entries: [{ user_id: 'owner', game_uid: 'uid', server_scope: '1', pool_id: 'limited' }] })[0].character.excluded.manual).toBe(1);
    expect(analyze([row(1, { ...gold(), character_id: 'unknown' })])[0].character).toMatchObject({ sample: 0, unknownUp: 1 });
  });
});

describe('luck ratings and versions', () => {
  it('assigns early release-day character pulls and linked weapon claims to their configured version', () => {
    const versions = { versions: [
      { id: 'old', name: '旧版本', starts_at: '2026-08-01T04:00:00Z', pool_ids: ['old-pool'] },
      { id: 'new', name: '新版本', starts_at: '2026-09-02T04:00:00Z', pool_ids: ['limited'] },
    ] };
    const history = [row(1, { timestamp: '2026-09-02T03:33:00Z' }),
      ...Array.from({ length: 10 }, (_, i) => row(i + 1, { pool_id: 'weapon', batch_id: 'claim', timestamp: '2026-09-02T03:40:00Z' }))];
    const configuredPools = [pools[0], { ...pools[2], character_pool_id: 'limited' }];
    for (const fetchedAt of ['2026-09-02T03:50:00Z', '2026-09-03T04:00:00Z']) {
      const account = analyze(history, { pools: configuredPools, versionConfig: versions, fetchedAt })[0];
      expect(account.character.timeline.map(p => p.observed)).toEqual([0, 1]);
      expect(account.weapon.timeline.map(p => p.observed)).toEqual([0, 10]);
      expect(account.character.timeline[1].sample).toBe(1);
    }
    expect(getStartedLuckVersions(versions, '2026-09-02T03:50:00Z')).toHaveLength(1);
  });
  it('moves only the matching new banner on release day and preserves the total rating and incomplete records', () => {
    const versions = getStartedLuckVersions({ versions: [
      { id: 'old', name: '旧版本', starts_at: '2026-08-01T04:00:00Z' },
      { id: 'new', name: '新版本', starts_at: '2026-09-02T04:00:00Z', pool_ids: ['new-pool'] },
    ] }, '2026-09-30T04:00:00Z');
    const unit = (versionPoolId, startAt, sample = 1) => ({ sample, observed: 1, actual: 0, expected: .008 * sample,
      upActual: 0, upExpected: .004 * sample, versionPoolId, startAt, endAt: startAt });
    const units = [unit('new-pool', '2026-09-02T03:33:00Z'), unit('new-pool', '2026-09-02T03:34:00Z', 0),
      unit('old-pool', '2026-09-02T03:33:00Z'), unit('new-pool', '2026-09-01T03:33:00Z'),
      unit('old-pool', '2026-09-03T03:33:00Z')];
    const result = groupLuckUnitsByVersion(units, versions);
    expect(result.timeline.map(p => p.observed)).toEqual([2, 3]);
    expect(result.timeline.map(p => p.sample)).toEqual([2, 2]);
    expect(sumLuckWindows(result.timeline)).toEqual(sumLuckWindows(units));
    expect(evaluateLuckTimeline(result.timeline, 'character').overall.score).toBe(evaluateLuckWindow(sumLuckWindows(units)).score);
  });
  it('recognises modest good luck, reserves C for a clearer deficit and keeps uncertainty visible', () => {
    const base = { sample: 5000, expected: 100, upExpected: 50 };
    for (const [actual, upActual, grade] of [[100, 50, 'B'], [100, 54, 'A'], [100, 63, 'A+'], [100, 75, 'S'], [90, 47, 'B'], [80, 40, 'C']])
      expect(evaluateLuckWindow({ ...base, actual, upActual }).grade).toBe(grade);
    expect(evaluateLuckWindow({ sample: 3, actual: 0, upActual: 0, expected: .024, upExpected: .012 })).toMatchObject({ grade: 'B', provisional: true });
    expect(evaluateLuckWindow(sumLuckWindows([])).grade).toBeNull();
    expect(evaluateLuckWindow({ ...base, actual: NaN, upActual: 0 }).grade).toBeNull();
    expect(evaluateLuckWindow({ ...base, actual: 100, upActual: 54, inferredSample: 1 }).provisional).toBe(true);
  });
  it('preserves empty versions, complete weapon claims and the non-overlapping recent three', () => {
    const versions = getStartedLuckVersions({ versions: Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, name: `版本${i}`, starts_at: `2026-0${i + 1}-01T00:00:00Z` })) }, '2026-07-15T00:00:00Z');
    const unit = (startAt, sample, endAt = startAt) => ({ sample, actual: 0, upActual: 0, expected: .008 * sample, upExpected: .004 * sample, observed: sample, startAt, endAt });
    const grouped = groupLuckUnitsByVersion([unit('2026-05-01T00:00:00Z', 10), unit('2026-07-01T00:00:00Z', 20), unit('2025-12-31T23:59:59Z', 5), unit('2026-05-31T23:59:59Z', 10, '2026-06-01T00:00:00Z')], versions);
    expect(grouped.timeline.map(p => p.sample)).toEqual([0, 0, 0, 0, 10, 0, 20]);
    const result = evaluateLuckTimeline(grouped.timeline, 'character', grouped.unassignedVersion);
    expect(result.overall.sample).toBe(45); expect(result.recent.sample).toBe(30);
    expect(result.recentPeriods.map(p => p.versionId)).toEqual(['v4', 'v5', 'v6']);
    expect(result.previousPeriods.map(p => p.versionId)).toEqual(['v1', 'v2', 'v3']);
  });
  it('keeps whole-period ratings order independent and trend labels consistent with current grades', () => {
    const timeline = Array.from({ length: 6 }, (_, i) => ({ sample: 1800, actual: i < 3 ? 33 : 30, upActual: i < 3 ? 21 : 16, expected: 33, upExpected: 16 }));
    const forward = evaluateLuckTimeline(timeline, 'character'), reverse = evaluateLuckTimeline([...timeline].reverse(), 'character');
    expect(forward.overall.score).toBeCloseTo(reverse.overall.score, 10);
    expect(forward.previous.grade).toBe('A+'); expect(forward.recent.grade).toBe('B'); expect(forward.trend.id).toBe('cooling');
    expect(reverse.trend.id).toBe('rising');
    const empty = timeline.map((p, i) => i < 3 ? p : sumLuckWindows([]));
    expect(evaluateLuckTimeline(empty, 'character').trend.id).toBe('insufficient');
  });
});
