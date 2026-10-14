import { describe, expect, it } from 'vitest';
import { buildPoolLedgerEntry, materializeInferredRecords, validateWorkbenchEntry } from '../../../../shared/dataWorkbench.js';
import { computeWorkbenchMetrics } from '../../../../shared/dataWorkbenchMetrics.js';
import { aggregateWorkbenchMetrics } from '../../../../shared/dataWorkbenchAnalytics.js';
import { validateWorkbenchRules } from '../../../../shared/workbenchRules.js';
import { readWorkbenchSupplements, serializeWorkbenchEntry } from '../../../utils/workbenchTransfer.js';

const pools = [{ id: 'limited', name: '限定池', type: 'limited', up_character: '目标' }];
const entities = [{ id: 'six', name: '目标', type: 'character', rarity: 6 }, { id: 'five', name: '五星', type: 'character', rarity: 5 }, { id: 'fourA', name: '四星甲', type: 'character', rarity: 4 }, { id: 'fourB', name: '四星乙', type: 'character', rarity: 4 }];
const scope = { gameUid: '123', serverScope: '1' };
function ledger(values = {}, extra = {}) { return { ...buildPoolLedgerEntry({ poolId: 'limited', entryId: 'stable-ledger', values: { totalPulls: 100, fiveStarCount: 9, sixStarCount: 2, ...values }, ...extra }, { entities, pools }), scope, reviewState: 'confirmed' }; }
function metrics(entry, history = []) { return computeWorkbenchMetrics({ entries: [entry], history, entities, pools, scope }); }

describe('card-pool evidence and inferred reconstruction', () => {
  it('retains unknown dates and materializes deterministic four stars without timestamps or seq IDs', () => {
    const entry = ledger();
    expect(validateWorkbenchEntry(entry, { entities, pools }).valid).toBe(true);
    expect(entry.values.timestamp).toBeUndefined();
    expect(entry.values.inferredFill.count).toBe(89);
    const rows = materializeInferredRecords(entry);
    expect(rows).toHaveLength(89);
    expect(materializeInferredRecords(JSON.parse(JSON.stringify(entry)))).toEqual(rows);
    expect(materializeInferredRecords(entry, { offset: 15, limit: 5 })).toEqual(rows.slice(15, 20));
    expect(rows.every(row => row.derivation === 'inferred' && row.timestamp === undefined && row.seqId === undefined)).toBe(true);
  });
  it('does not fill when five-star count is unknown or create a fake zero', () => {
    const entry = ledger({ fiveStarCount: undefined });
    expect(entry.values.inferredFill).toBeUndefined();
    expect(entry.values.fiveStarCount).toBeUndefined();
    expect(metrics(entry).rates.fiveStarDenominator).toBe(0);
  });
  it('counts confirmed totals exactly once as real history replaces inferred records', () => {
    const entry = ledger();
    const history = Array.from({ length: 10 }, (_, index) => ({ id: String(index), poolId: 'limited', rarity: 4, characterId: 'fourA', timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z`, ...scope }));
    const result = metrics(entry, history);
    expect(result.combined).toEqual({ totalPulls: 100, fourStarCount: 89, fiveStarCount: 9, sixStarCount: 2 });
    expect(result.supplemental.totalPulls).toBe(90);
    expect(result.inferred.records).toBe(79);
    expect(result.rates.sixStarDenominator).toBe(100);
    expect(result.eligible.time).toBe(false);
    expect(result.resource.knownExcessAic).toBe(0);
    expect(aggregateWorkbenchMetrics([result]).inferred.records).toBe(79);
  });
  it('rejects overlapping ledgers and a total smaller than existing records', () => {
    const entry = ledger({ totalPulls: 0, fiveStarCount: 0, sixStarCount: 0 });
    expect(metrics(entry, [{ id: 'real', poolId: 'limited', rarity: 4, ...scope }]).issues.some(issue => issue.code === 'summary_less_than_details')).toBe(true);
    expect(validateWorkbenchRules({ entries: [ledger(), ledger({}, { entryId: 'other' })], pools, entities }).issues.some(issue => issue.code === 'overlapping_ledgers')).toBe(true);
  });
  it('preserves provenance and compact reconstruction through JSON export/import', () => {
    const entry = { ...ledger({}, { source: 'xhh' }), draftId: 'draft' };
    const portable = serializeWorkbenchEntry(entry);
    const [restored] = readWorkbenchSupplements({ supplements: { schemaVersion: 1, workbenchEntries: [portable] } });
    expect(restored.source).toBe('xhh');
    expect(restored.values.inferredFill).toEqual(entry.values.inferredFill);
    expect(materializeInferredRecords(restored)).toEqual(materializeInferredRecords(entry));
  });
  it('blocks known six-star contradictions but explains incomplete coverage', () => {
    const invalid = ledger({ acquisitions: [{ id: 'six-row', entityId: 'six', rarity: 6, drawMethod: 'normal', intervalPulls: 81 }] });
    expect(validateWorkbenchRules({ entries: [invalid], entities, pools }).issues.some(issue => issue.code === 'six_star_interval_limit')).toBe(true);
    const result = validateWorkbenchRules({ entries: [ledger({ acquisitions: [{ id: 'six-row', rarity: 6, drawMethod: 'normal' }] })], entities, pools });
    expect(result.valid).toBe(true);
    expect(result.warnings.map(item => item.code)).toEqual(expect.arrayContaining(['time_unknown', 'identity_unknown', 'incomplete_coverage', 'four_star_inferred']));
  });
  it('does not treat a known high-star lower bound as a complete rate numerator', () => {
    const entry = ledger({ fiveStarCount: undefined, sixStarCount: undefined, acquisitions: [{ id: 'row', rarity: 6, entityId: 'six', drawMethod: 'normal' }] });
    const result = metrics(entry);
    expect(result.combined.sixStarCount).toBe(1);
    expect(result.rates.sixStarDenominator).toBe(0);
    expect(result.combined.fourStarCount).toBe(0);
  });
  it('retains known free drops without adding them to paid rates or counting a later real record twice', () => {
    const timestamp = '2026-01-01T12:00:00Z';
    const entry = ledger({ acquisitions: [{ id: 'free-six', rarity: 6, entityId: 'six', drawMethod: 'free', timestamp, timePrecision: 'second' }] });
    expect(metrics(entry).combined).toMatchObject({ totalPulls: 101, sixStarCount: 3 });
    expect(metrics(entry).rates).toMatchObject({ sixStarDenominator: 100, sixStarNumerator: 2 });
    const real = { id: 'real-free', ...scope, poolId: 'limited', characterId: 'six', rarity: 6, isFree: true, timestamp };
    expect(metrics(entry, [real]).combined).toMatchObject({ totalPulls: 101, sixStarCount: 3 });
    const freeSummary = ledger({ drawMethod: 'free', totalPulls: 10, fiveStarCount: 0, sixStarCount: 1 }, { entryId: 'free-summary' });
    const result = computeWorkbenchMetrics({ entries: [entry, freeSummary], history: [real], entities, pools, scope });
    expect(result.combined).toMatchObject({ totalPulls: 110, sixStarCount: 3 });
    expect(result.rates.sixStarDenominator).toBe(100);
  });
  it('checks the later history affected by removing an earlier six star', () => {
    const history = Array.from({ length: 80 }, (_, index) => ({ id: `real-${index}`, poolId: 'limited', timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), rarity: index === 0 ? 6 : (index + 1) % 10 === 0 ? 5 : 4, characterId: index === 0 ? 'six' : (index + 1) % 10 === 0 ? 'five' : 'fourA' }));
    const result = validateWorkbenchRules({ history, historyChanges: [{ recordId: 'real-0', currentPoolId: 'limited', changes: { characterId: 'fourA' } }], pools, entities });
    expect(result.issues.some(issue => issue.code === 'history_six_star_tail')).toBe(true);
  });
  it('reports missing positions without inventing a full sequence from complete counts', () => {
    const result = validateWorkbenchRules({ entries: [ledger({ complete: true })], pools, entities });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(warning => warning.code === 'positions_incomplete')).toBe(true);
  });
  it('does not count free and gifted history toward rule pity', () => {
    const history = Array.from({ length: 80 }, (_, index) => ({ id: String(index), poolId: 'limited', timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), rarity: 4, characterId: 'fourA', isFree: true }));
    const result = validateWorkbenchRules({ history, historyChanges: [{ recordId: '0', currentPoolId: 'limited', changes: { characterId: 'fourB', drawMethod: 'free' } }], pools, entities });
    expect(result.valid).toBe(true);
  });
});
