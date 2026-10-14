import { describe, expect, it } from 'vitest';
import { createWorkbenchDraft, createWorkbenchEntry, getWorkbenchStorageKey, validateWorkbenchEntry } from '../../shared/dataWorkbench.js';
import { computeWorkbenchMetrics } from '../../shared/dataWorkbenchMetrics.js';

const scope = { gameUid: '100', serverScope: 'cn:official' };
const pools = [{ id: 'special_test', type: 'limited' }];
const entities = [
  { id: 'six', type: 'character', rarity: 6, release_date: '2026-01-01' },
  { id: 'four', type: 'character', rarity: 4, release_date: '2026-01-01' },
];
const rangeStart = '2026-02-01T00:00:00Z';
const rangeEnd = '2026-03-01T00:00:00Z';
function entry(kind, values, extra = {}) {
  return { ...createWorkbenchEntry(kind), poolId: 'special_test', reviewState: 'confirmed', timePrecision: kind === 'detail' || kind === 'potential-evidence' ? 'second' : 'range', values: { drawMethod: 'normal', ...values }, ...extra };
}
const metrics = (entries, history = [], extra = {}) => computeWorkbenchMetrics({ entries, history, pools, entities, scope, ...extra });

describe('workbench contracts and metric qualification', () => {
  it('creates an empty draft and does not invent values', () => {
    expect(createWorkbenchDraft({ ownerId: 'u', scope }).entries).toEqual([]);
    const raw = createWorkbenchEntry();
    expect(raw.values).toEqual({});
    expect(validateWorkbenchEntry(raw, { pools, entities }).valid).toBe(false);
    expect(raw.values).toEqual({});
  });
  it('isolates owners and servers in storage', () => {
    expect(getWorkbenchStorageKey('u', scope)).not.toEqual(getWorkbenchStorageKey('v', scope));
    expect(getWorkbenchStorageKey('u', scope)).not.toEqual(getWorkbenchStorageKey('u', { ...scope, serverScope: 'intl:asia' }));
  });
  it('retains date-only detail as a draft instead of inventing precision', () => {
    const raw = entry('detail', { entityId: 'six', quantity: 1, timestamp: '2026-02-03' }, { timePrecision: 'day' });
    expect(validateWorkbenchEntry(raw, { pools, entities }).issues.map(i => i.code)).toContain('exact_time_required');
  });
  it('requires a matched denominator for a rate while preserving known six-stars', () => {
    const result = metrics([entry('pool-summary', { rangeStart, rangeEnd, sixStarCount: 3 })]);
    expect(result.combined).toMatchObject({ totalPulls: 0, sixStarCount: 3, fourStarCount: 0 });
    expect(result.rates.sixStarRate).toBeNull();
    expect(result.coverage.unknownFourStar).toBe(1);
  });
  it('does not add 180 to 100 detailed pulls', () => {
    const history = Array.from({ length: 100 }, (_, index) => ({ id: index, game_uid: '100', server_scope: 'cn:official', pool_id: 'special_test', timestamp: '2026-02-02T00:00:00Z', rarity: index < 2 ? 6 : 4 }));
    const summary = entry('pool-summary', { rangeStart, rangeEnd, totalPulls: 180, sixStarCount: 3 });
    const result = metrics([summary], history);
    expect(result.confirmed.totalPulls).toBe(100);
    expect(result.supplemental.totalPulls).toBe(80);
    expect(result.combined.totalPulls).toBe(180);
    expect(result.combined.sixStarCount).toBe(3);
    expect(result.rates.sixStarRate).toBe(3 / 180);
    expect(result.rates.fiveStarDenominator).toBe(100);
  });
  it('removes a covered manual detail when official data arrives', () => {
    const manual = entry('detail', { entityId: 'six', quantity: 1, timestamp: rangeStart });
    const official = { id: 'official', pool_id: 'special_test', character_id: 'six', rarity: 6, timestamp: rangeStart };
    expect(metrics([manual], [official]).supplemental.totalPulls).toBe(0);
  });
  it('blocks intersecting summaries and contradictory totals', () => {
    const a = entry('pool-summary', { rangeStart, rangeEnd, totalPulls: 100 });
    const b = entry('pool-summary', { rangeStart, rangeEnd, totalPulls: 180 });
    expect(metrics([a, b]).combined.totalPulls).toBe(0);
    expect(metrics([a, b]).issues).toHaveLength(2);
    expect(validateWorkbenchEntry(entry('pool-summary', { rangeStart, rangeEnd, totalPulls: 1, sixStarCount: 2 }), { pools, entities }).valid).toBe(false);
  });
  it('does not count a gift in rate denominators', () => {
    const gift = entry('detail', { entityId: 'six', quantity: 1, timestamp: rangeStart, drawMethod: 'gift' });
    expect(metrics([gift]).rates.sixStarRate).toBeNull();
  });
  it('blocks coverage when a same-pool historical timestamp is unknown', () => {
    const summary = entry('pool-summary', { rangeStart, rangeEnd, totalPulls: 180, sixStarCount: 3 });
    const result = metrics([summary], [{ id: 'untimed', pool_id: 'special_test', rarity: 6 }]);
    expect(result.supplemental.totalPulls).toBe(0);
    expect(result.issues.some(issue => issue.code === 'coverage_time_unknown')).toBe(true);
  });
  it('rejects an impossible combined composition even when each summary field exceeds details', () => {
    const summary = entry('pool-summary', { rangeStart, rangeEnd, totalPulls: 2, sixStarCount: 2 });
    const result = metrics([summary], [{ id: 'four', pool_id: 'special_test', rarity: 4, timestamp: rangeStart }]);
    expect(result.supplemental.sixStarCount).toBe(0);
    expect(result.issues.some(issue => issue.code === 'summary_less_than_details')).toBe(true);
  });
});

describe('potential evidence and bounded resource calculation', () => {
  const evidence = () => entry('potential-evidence', { entityId: 'four', quantity: 6, timestamp: '2026-02-15T00::00Z', evidenceRef: 'inventory-check' });
  it('only counts excess four-star copies after the proven boundary', () => {
    const proof = evidence();
    proof.values.timestamp = '2026-02-15T00:00:00Z';
    const before = entry('detail', { entityId: 'four', quantity: 1, timestamp: '2026-02-14T00:00:00Z' });
    const after = entry('detail', { entityId: 'four', quantity: 1, timestamp: '2026-02-16T00:00:00Z' });
    const result = metrics([proof, before, after]);
    expect(result.resource.knownExcessAic).toBe(5);
    expect(result.resource.unknown.some(i => i.code === 'copy_state_unknown')).toBe(true);
  });
  it('does not retroactively apply a boundary to a whole summary', () => {
    const proof = evidence();
    proof.values.timestamp = '2026-02-15T00:00:00Z';
    const mixed = entry('pool-summary', { rangeStart, rangeEnd, fourStarCount: 20 });
    expect(metrics([proof, mixed]).resource.rangeExcessAic).toBe(0);
    const after = entry('pool-summary', { rangeStart: '2026-02-16T00:00:00Z', rangeEnd, fourStarCount: 10 });
    expect(metrics([proof, after]).resource.rangeExcessAic).toBe(50);
  });
  it('does not infer four-star quantities even after full potential', () => {
    const proof = evidence();
    proof.values.timestamp = '2026-01-20T00:00:00Z';
    const summary = entry('pool-summary', { rangeStart, rangeEnd, totalPulls: 100, sixStarCount: 2 });
    const result = metrics([proof, summary]);
    expect(result.resource.rangeExcessAic).toBe(0);
    expect(result.resource.unknown.some(i => i.code === 'four_star_count_unknown')).toBe(true);
  });
  it('rechecks all four-star entities when a new entity is introduced', () => {
    const proof = evidence();
    proof.values.timestamp = '2026-01-20T00:00:00Z';
    const summary = entry('pool-summary', { rangeStart, rangeEnd, fourStarCount: 10 });
    const result = metrics([proof, summary], [], { entities: [...entities, { id: 'new-four', type: 'character', rarity: 4, release_date: '2026-02-10' }] });
    expect(result.resource.rangeExcessAic).toBe(0);
  });
  it('does not turn repeated acquisition evidence into full potential', () => {
    const previous = Array.from({ length: 5 }, (_, index) => ({ id: `copy-${index}`, character_id: 'four', pool_id: 'special_test', rarity: 4, timestamp: rangeStart }));
    const proof = entry('potential-evidence', { entityId: 'four', quantity: 1, timestamp: rangeStart, evidenceRef: 'copy-0' });
    const detail = entry('detail', { entityId: 'four', quantity: 1, timestamp: '2026-02-16T00:00:00Z' });
    expect(metrics([proof, detail], previous).resource.knownExcessAic).toBe(0);
  });
  it('does not order same-second acquisitions around a newly reached boundary', () => {
    const proof = entry('potential-evidence', { entityId: 'four', quantity: 6, timestamp: rangeStart, evidenceRef: 'inventory' });
    const detail = entry('detail', { entityId: 'four', quantity: 1, timestamp: rangeStart });
    expect(metrics([proof, detail]).resource.knownExcessAic).toBe(0);
  });
  it('subtracts gifted weapon details from a gift summary before computing resources', () => {
    const weaponPools = [{ id: 'special_test', type: 'weapon' }];
    const weapons = [{ id: 'weapon-six', type: 'weapon', rarity: 6 }];
    const detail = entry('detail', { entityId: 'weapon-six', quantity: 1, timestamp: rangeStart, drawMethod: 'gift' });
    const summary = entry('pool-summary', { rangeStart, rangeEnd, sixStarCount: 1, drawMethod: 'gift' });
    const result = metrics([detail, summary], [], { pools: weaponPools, entities: weapons });
    expect(result.resource.knownWeaponAic).toBe(50);
    expect(result.combined.totalPulls).toBe(0);
  });
});
