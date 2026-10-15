import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { listWorkbenchEntries, commitWorkbenchEntries } from '../dataWorkbenchService.js';
import { importWorkbenchEntries, loadWorkbenchEntriesForExport } from '../workbenchTransferService.js';

vi.mock('../dataWorkbenchService.js', () => ({ listWorkbenchEntries: vi.fn(), commitWorkbenchEntries: vi.fn() }));
const entry = { entryId: 'aaaa0000-0000-4000-8000-000000000001', draftId: 'aaaa0000-0000-4000-8000-000000000002', gameUid: '100', serverScope: 'cn:official', kind: 'pool-summary', poolId: 'special_test', timePrecision: 'range', values: { rangeStart: '2026-02-01T00:00:00Z', rangeEnd: '2026-03-01T00:00:00Z', totalPulls: 180, sixStarCount: 3, drawMethod: 'normal' } };

describe('workbench portable save consumer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('crypto', webcrypto);
    const stored = [];
    listWorkbenchEntries.mockImplementation(async () => [...stored]);
    commitWorkbenchEntries.mockImplementation(async payload => {
      stored.push(...payload.entries);
      return { saved: payload.entries.length };
    });
  });
  it('uses stable idempotency keys across transport retries', async () => {
    commitWorkbenchEntries.mockRejectedValueOnce(new Error('connection lost'));
    await expect(importWorkbenchEntries([entry])).rejects.toThrow('connection lost');
    await expect(importWorkbenchEntries([entry])).resolves.toEqual({ saved: 1, skipped: 0 });
    const first = commitWorkbenchEntries.mock.calls[0][0];
    expect(first.commitId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(commitWorkbenchEntries.mock.calls[1][0]).toEqual(first);
    expect(first.scope).toEqual({ gameUid: '100', serverScope: 'cn:official' });
  });
  it('does not call a deleted entry saved when a historical commit is replayed', async () => {
    listWorkbenchEntries.mockResolvedValue([]);
    await expect(importWorkbenchEntries([entry])).rejects.toThrow('已删除或保存后发生变化');
  });
  it('skips already saved entries and blocks conflicting edits', async () => {
    listWorkbenchEntries.mockResolvedValue([{ ...entry, id: 'private-id', revision: 7 }]);
    await expect(importWorkbenchEntries([entry])).resolves.toEqual({ saved: 0, skipped: 1 });
    expect(commitWorkbenchEntries).not.toHaveBeenCalled();
    await expect(importWorkbenchEntries([{ ...entry, values: { ...entry.values, totalPulls: 200 } }])).rejects.toThrow('已被修改');
    expect(commitWorkbenchEntries).not.toHaveBeenCalled();
  });
  it('loads each account scope once and never merges different servers', async () => {
    listWorkbenchEntries.mockResolvedValue([entry]);
    const result = await loadWorkbenchEntriesForExport([entry, entry, { ...entry, serverScope: 'intl:asia' }]);
    expect(listWorkbenchEntries).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });
  it('keeps submissions within the server batch limit', async () => {
    await importWorkbenchEntries(Array.from({ length: 101 }, (_, index) => ({ ...entry, entryId: `entry-${index}` })));
    expect(commitWorkbenchEntries.mock.calls.map(([payload]) => payload.entries.length)).toEqual([100, 1]);
  });
});
