import { describe, expect, it } from 'vitest';
import { normalizePoolVersion } from '../../../shared/poolVersion.js';
import { filterOfficialImportPullRecords, normalizeOfficialImportRecord } from '../../../shared/officialImportRecordNormalizer.js';
import { formatAccountGachaHistoryRows } from '../accountGachaHistoryFormat.js';
import { serializeHistoryForUpsert } from '../cloudDataWriteRows.js';
import { buildExportPayload, buildExportJsonContent, buildExportCsvContent } from '../dataExport.js';
import { validateAndNormalizeImportData } from '../dataImport.js';
import { buildPersonalAnalysisSnapshots } from '../personalAnalysisSnapshot.js';
import { prepareOfficialImportPersistenceData } from '../../features/import/importPersistence.js';

const pool = { id: 'rerun_original', name: '重构寻访', type: 'extra', extra_subtype: 'reconstruction', extra_rule_profile: 'reconstruction_character_v1' };
const records = [1, 2].map((version) => ({
  record_id: `period-${version}`, user_id: 'user-1', game_uid: 'game-1', server_id: '1',
  seq_id: String(version), pool_id: pool.id, pool_version: version, rarity: 6,
  character_name: '测试角色', timestamp: `2026-09-0${version}T12:00:00Z`,
}));

describe('poolVersion record contract', () => {
  it('normalizes official period and display name without admitting gift events', () => {
    const normalized = normalizeOfficialImportRecord({
      ...records[1], itemId: 'char_test', nameText: '官方展示名', charName: '旧名称', poolVersion: '2',
    });
    expect(normalized).toMatchObject({ poolId: pool.id, poolVersion: 2, itemName: '官方展示名', blocked: false });
    expect(normalized.rawMin.poolVersion).toBe('2');
    expect(filterOfficialImportPullRecords([
      { nameText: '官方展示名', poolVersion: 2 },
      { nameText: '武库赠礼-重构申领', poolVersion: 2 },
      { nameText: '寻访情报书', kind: 'gift_intel_book', poolVersion: 2 },
    ])).toEqual([{ nameText: '官方展示名', poolVersion: 2 }]);
  });

  it.each([0, -1, 1.5, true, '2x', '1.5', {}, 2147483648])('rejects invalid period %j', (value) => {
    expect(normalizePoolVersion(value)).toBeNull();
    expect(normalizeOfficialImportRecord({ ...records[0], poolVersion: value }).issues)
      .toContainEqual(expect.objectContaining({ code: 'INVALID_POOL_VERSION', severity: 'blocking' }));
    expect(() => serializeHistoryForUpsert({ ...records[0], poolVersion: value }, 'user-1')).toThrow('正整数');
  });

  it('preserves two periods through official persistence, DB DTO, JSON export/import and cloud write', async () => {
    const prepared = await prepareOfficialImportPersistenceData({
      records, pools: [pool], userInfo: { gameUid: 'game-1', serverId: '1' },
    });
    expect(prepared.poolEntries).toHaveLength(1);
    expect(prepared.historyRecords.map((record) => record.poolVersion)).toEqual([1, 2]);
    const history = formatAccountGachaHistoryRows(records);
    const payload = buildExportPayload({ history, pools: [pool], currentUserId: 'user-1', options: { poolFilter: 'all', accountFilter: 'all' } });
    const exported = JSON.parse(buildExportJsonContent(payload));
    expect(exported.pools).toHaveLength(1);
    expect(exported.history.map((record) => record.poolVersion)).toEqual([1, 2]);
    expect(buildExportCsvContent(payload)).toContain('pool_version');
    const imported = validateAndNormalizeImportData(exported, { currentUserId: 'user-1' });
    expect(imported.valid, imported.errors.join(';')).toBe(true);
    expect(imported.normalizedData.history.map((record) => serializeHistoryForUpsert(record, 'user-1').pool_version)).toEqual([1, 2]);
    expect(new Set(imported.normalizedData.history.map((record) => record.poolId)).size).toBe(1);
    exported.history[0].poolVersion = -1;
    expect(validateAndNormalizeImportData(exported).valid).toBe(false);
  });

  it('keeps missing legacy periods null and preserves periods in compact snapshot records', () => {
    expect(formatAccountGachaHistoryRows([{ pool_id: pool.id }])[0].poolVersion).toBeNull();
    const snapshot = buildPersonalAnalysisSnapshots({ history: formatAccountGachaHistoryRows(records), pools: [pool], userId: 'user-1' });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain('"poolVersion":1');
    expect(serialized).toContain('"poolVersion":2');
    expect(snapshot.scopes[0].payload.poolManifest).toHaveLength(1);
  });
});
