import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWorkbenchPoolUnopened, validateWorkbenchPoolOperations } from '../../../../shared/workbenchPoolAvailability.js';
import { validateWorkbenchEntry } from '../../../../shared/dataWorkbench.js';
import { buildInputLedger, parseConvertedWorkbenchJson } from '../workbenchInputAdapters.js';
import { buildScreenshotEntries } from '../xhh/semantics.js';
import { buildWorkbenchConversionTemplate } from '../importConvertPrompt.js';

const scope = { gameUid: 'test', serverScope: '1' };
const future = { id: 'future', name: '未开放', type: 'limited', start_time: '2026-09-20T10:00:00+08:00', rosterEntityIds: [] };
const ended = { id: 'ended', name: '往期', type: 'limited', start_time: '2026-01-01', end_time: '2026-02-01', rosterEntityIds: [] };
const values = { coverageMode: 'pool', drawMethod: 'normal', totalPulls: 1, acquisitions: [] };
afterEach(() => vi.useRealTimers());

describe('workbench pool opening time', () => {
  it('unlocks exactly at the configured opening instant including its timezone', () => {
    const start = Date.parse(future.start_time);
    expect(isWorkbenchPoolUnopened(future, start - 1)).toBe(true);
    expect(isWorkbenchPoolUnopened(future, start)).toBe(false);
    expect(isWorkbenchPoolUnopened({ startTime: future.start_time }, start - 1)).toBe(true);
  });

  it('keeps ended pools and permanent pools available for historical supplements', () => {
    expect(isWorkbenchPoolUnopened(ended)).toBe(false);
    expect(isWorkbenchPoolUnopened({ id: 'standard' })).toBe(false);
    expect(buildInputLedger({ poolId: ended.id, values }, { pools: [ended] }).poolId).toBe(ended.id);
  });

  it('rejects future ledgers, converted files, and confirmed OCR rows using current time rather than record time', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const entry = { entryId: 'future-entry', kind: 'pool-ledger', poolId: future.id, values, timePrecision: 'unknown', reviewState: 'confirmed' };
    expect(validateWorkbenchEntry(entry, { pools: [future] }).issues.some(issue => issue.code === 'pool_not_open')).toBe(true);
    expect(() => buildInputLedger(entry, { pools: [future] })).toThrow(/尚未开放/);
    const file = { formatId: 'internal_json_v3', schemaVersion: '3.0.0', accounts: [scope], pools: [future], history: [],
      supplements: { schemaVersion: 1, workbenchEntries: [{ ...entry, scope }] } };
    expect(() => parseConvertedWorkbenchJson(file, { scope, pools: [future] })).toThrow(/尚未开放/);
    const screenshot = buildScreenshotEntries([{ poolId: future.id, poolName: future.name, poolConfirmed: true,
      countsConfirmed: true, rows: [], totalPulls: 1 }], { scope, pools: [future] });
    expect(screenshot.entries).toEqual([]);
    expect(screenshot.errors).toEqual([expect.stringContaining('尚未开放')]);
    const template = buildWorkbenchConversionTemplate({ scope, pools: [future, ended], selectedPoolId: future.id });
    expect(template.pools.map(pool => pool.id)).toEqual([ended.id]);
    expect(template._conversionGuide.selectedPoolId).toBeNull();
  });

  it('checks original saved pools when updates move records to an opened pool', () => {
    const pools = [{ ...future, start_time: '2099-01-01' }, ended];
    const issues = validateWorkbenchPoolOperations({ pools,
      history: [{ id: 'record', pool_id: future.id }], historyChanges: [{ recordId: 'record', currentPoolId: ended.id, changes: { poolId: ended.id } }],
      existingEntries: [{ id: 'saved', poolId: future.id }], supplementChanges: [{ id: 'saved', action: 'delete' }],
    });
    expect(issues.map(issue => issue.poolId)).toEqual([future.id]);
    expect(validateWorkbenchPoolOperations({ pools, entries: [{ poolId: future.id, reviewState: 'skipped' }] })).toEqual([]);
  });
});
