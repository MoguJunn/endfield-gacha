import { describe, it, expect, beforeEach } from 'vitest';
import { buildExportPayload, buildExportJsonContent } from '../dataExport.js';
import { validateAndNormalizeImportData } from '../dataImport.js';
import { computeWorkbenchMetrics } from '../../../shared/dataWorkbenchMetrics.js';

const pool = { id: 'special_test', name: '测试池', type: 'limited' };
const entity = { id: 'six', name: '六星', type: 'character', rarity: 6 };
const entry = { id: 'private-id', user_id: 'owner', entryId: 'aaaa0000-0000-4000-8000-000000000001', draftId: 'aaaa0000-0000-4000-8000-000000000002', scope: { gameUid: '100', serverScope: 'cn:official' }, poolId: pool.id, kind: 'pool-summary', source: 'manual', timePrecision: 'range', values: { rangeStart: '2026-02-01T00:00:00Z', rangeEnd: '2026-03-01T00:00:00Z', totalPulls: 180, sixStarCount: 3, drawMethod: 'normal' } };
const history = [{ id: 'record', user_id: 'owner', gameUid: '100', serverScope: 'cn:official', poolId: pool.id, character_id: 'six', name: '六星', rarity: 6, timestamp: '2026-02-15T00:00:00Z' }];
const payload = (overrides = {}) => buildExportPayload({ history, pools: [pool], currentUserId: 'owner', options: { accountFilter: 'all', poolFilter: 'all' }, workbenchEntries: [entry], ...overrides });

describe('workbench JSON roundtrip', () => {
  beforeEach(() => localStorage.clear());
  it('retains coverage and provenance without fabricating history or four-stars', () => {
    const json = JSON.parse(buildExportJsonContent(payload()));
    expect(json.history).toHaveLength(1);
    expect(JSON.stringify(json.supplements)).not.toMatch(/private-id|user_id|seqId/);
    const imported = validateAndNormalizeImportData(json, { currentUserId: 'new-owner' });
    expect(imported.valid, imported.errors.join(', ')).toBe(true);
    expect(imported.stats.supplementCount).toBe(1);
    const restored = imported.normalizedData.workbenchEntries;
    expect(restored[0]).toMatchObject({ source: 'manual', gameUid: '100', serverScope: 'cn:official', user_id: 'new-owner', values: entry.values });
    expect(imported.normalizedData.history[0].serverScope).toBe('cn:official');
    const metrics = computeWorkbenchMetrics({ entries: restored, history: imported.normalizedData.history, pools: [pool], entities: [entity] });
    expect(metrics.combined.totalPulls).toBe(180);
    expect(metrics.supplemental.totalPulls).toBe(179);
    expect(metrics.rates.sixStarRate).toBe(3 / 180);
    expect(metrics.coverage.unknownFourStar).toBe(1);
  });
  it('exports a supplement-only account with its referenced pool', () => {
    const result = payload({ history: [] });
    expect(result.history).toEqual([]);
    expect(result.pools).toHaveLength(1);
    expect(result.accounts).toHaveLength(1);
    expect(validateAndNormalizeImportData(JSON.parse(buildExportJsonContent(result))).valid).toBe(true);
  });
  it('excludes a partially selected range instead of guessing a clipped total', () => {
    const result = payload({ options: { accountFilter: 'all', poolFilter: 'all', dateFrom: '2026-02-10' } });
    expect(result.history).toHaveLength(1);
    expect(result.supplements).toBeUndefined();
  });
  it('keeps same-UID supplements isolated by server in filtered exports', () => {
    const other = { ...entry, scope: { gameUid: '100', serverScope: 'intl:asia' }, entryId: 'other' };
    const result = payload({ workbenchEntries: [entry, other], options: { accountFilter: 'specific', gameUid: '100::server:cn:official', poolFilter: 'all' } });
    expect(result.supplements.workbenchEntries).toHaveLength(1);
    expect(result.supplements.workbenchEntries[0].serverScope).toBe('cn:official');
    expect(result.accounts).toHaveLength(1);
  });
  it('rejects duplicate portable identities and unsupported supplement versions', () => {
    const json = JSON.parse(buildExportJsonContent(payload()));
    json.supplements.workbenchEntries.push(json.supplements.workbenchEntries[0]);
    expect(validateAndNormalizeImportData(json).valid).toBe(false);
    json.supplements.schemaVersion = 999;
    expect(validateAndNormalizeImportData(json).errors).toContain('补录数据版本或格式不受支持');
  });
});
