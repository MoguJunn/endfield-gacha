import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planRescueSupplements, importRescueSupplements } from '../rescueImportService.js';
import { loadWorkbenchContext, validateWorkbenchWorkspace, commitWorkbenchEntries } from '../dataWorkbenchService.js';
vi.mock('../dataWorkbenchService.js', () => ({ loadWorkbenchContext: vi.fn(), validateWorkbenchWorkspace: vi.fn(), commitWorkbenchEntries: vi.fn() }));
const acquisition = (id, timestamp = '2026-10-16T00:00:00Z') => ({ id, entityId: 'weapon', rarity: 6, timestamp, drawMethod: 'normal', quantity: 1, timePrecision: 'second' });
const entry = acquisitions => ({ entryId: 'new', draftId: 'draft', gameUid: '123', serverScope: '1', poolId: 'pool', kind: 'pool-ledger', source: 'file',
  values: { drawMethod: 'normal', coverageMode: 'range', complete: false, rangeStart: '2026-10-01T00:00:00Z', rangeEnd: '2026-11-01T00:00:00Z', acquisitions } });
const data = entries => ({ sourceFormatId: 'endfield_helper_summary_xlsx', accounts: [{ gameUid: '123', serverId: '1' }], workbenchEntries: entries });
describe('rescue supplement saving', () => {
  beforeEach(() => vi.clearAllMocks());
  it('subtracts saved results one at a time and keeps distinct copies within one ten-pull', () => {
    const incoming = entry([acquisition('a'), acquisition('b')]);
    const plan = planRescueSupplements(data([incoming]), { entries: [], history: [{ pool_id: 'pool', character_id: 'weapon', rarity: 6, timestamp: '2026-10-16T00:00:00Z' }] });
    expect(plan.entries[0].values.acquisitions.map(row => row.id)).toEqual(['b']);
  });
  it('recognizes prior manually repaired ledgers despite different draft and row IDs', () => {
    const old = { ...entry([acquisition('old-id')]), entryId: 'previous', draftId: 'previous-draft', id: 'db-id', revision: 2 };
    expect(planRescueSupplements(data([entry([acquisition('new-id')])]), { entries: [old], history: [] })).toEqual({ entries: [], historyChanges: [], supplementChanges: [] });
  });
  it('merges missing outcomes into an incomplete file ledger using its expected revision', () => {
    const old = { ...entry([acquisition('old')]), id: 'db-id', revision: 3 };
    old.values.sixStarCount = 1;
    const incoming = entry([acquisition('first'), acquisition('second', '2026-10-17T00:00:00Z')]);
    const plan = planRescueSupplements(data([incoming]), { entries: [old], history: [] });
    expect(plan.entries).toEqual([]);
    expect(plan.supplementChanges[0]).toMatchObject({ id: 'db-id', expectedRevision: 3, action: 'update', entry: { values: { sixStarCount: 2 } } });
    expect(plan.supplementChanges[0].entry.values.acquisitions).toHaveLength(2);
    expect(plan.supplementChanges[0].entry.values.totalPulls).toBeUndefined();
    expect(old.values.acquisitions).toHaveLength(1);
  });
  it('stops on an overlapping complete summary instead of replacing it', () => {
    const old = entry([]); old.values.totalPulls = 80; old.values.complete = true;
    expect(() => planRescueSupplements(data([entry([acquisition('new')])]), { entries: [old], history: [] })).toThrow('不会被覆盖');
  });
  it('requires server validation and its token before committing any supplements', async () => {
    loadWorkbenchContext.mockResolvedValue({ history: [], entries: [] });
    validateWorkbenchWorkspace.mockResolvedValue({ preview: { canCommit: true }, validationToken: 'checked' });
    commitWorkbenchEntries.mockResolvedValue({ operationCount: 1 });
    await importRescueSupplements(data([entry([acquisition('a')])]));
    expect(loadWorkbenchContext).toHaveBeenCalledWith({ gameUid: '123', serverScope: '1' });
    expect(commitWorkbenchEntries).toHaveBeenCalledWith(expect.objectContaining({ mode: 'pool-workspace', validationToken: 'checked', historyChanges: [] }));
    validateWorkbenchWorkspace.mockResolvedValue({ preview: { canCommit: false, issues: [{ message: '冲突' }] } });
    await expect(importRescueSupplements(data([entry([acquisition('a')])]))).rejects.toThrow('冲突');
    expect(commitWorkbenchEntries).toHaveBeenCalledTimes(1);
  });
});
