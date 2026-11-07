import { describe, expect, it } from 'vitest';
import { validateAndNormalizeImportData } from '../dataImport.js';
import { buildExportPayload } from '../dataExport.js';
import { buildPendingImportPreview } from '../../components/modals/importPreviewUtils.js';

const pool = { id: 'special_1_5_1', name: '冬喑', type: 'limited' };
const unknown = { id: '3890001340', poolId: pool.id, gameUid: 'uid', serverId: '1', seqId: '1340', rarity: 4,
  timestamp: '2026-09-02T03:42:29.322Z' };

describe('internal backup recovery', () => {
  it.each(['3.0.0', '2.0.0'])('retains unnamed records from site backups without inventing identities: %s', schemaVersion => {
    const payload = { schemaVersion, pools: [{ ...pool, pool_id: pool.id }], history: [unknown,
      { ...unknown, id: '3640000702', seqId: '702', specialType: 'gift', rarity: 6 }] };
    const result = validateAndNormalizeImportData(payload);
    expect(result.errors).toEqual([]);
    expect(result.stats).toMatchObject({ historyCount: 2, unidentifiedHistoryCount: 2 });
    expect(result.normalizedData.history).toHaveLength(2);
    expect(result.normalizedData.history[0]).toMatchObject({ name: null, character_id: null, rarity: 4, seqId: '1340' });
    expect(result.normalizedData.history[1]).toMatchObject({ specialType: 'gift', rarity: 6 });
    const exported = buildExportPayload({ pools: [pool], history: result.normalizedData.history });
    const restored = validateAndNormalizeImportData(JSON.parse(JSON.stringify(exported)));
    expect(restored.valid).toBe(true);
    expect(restored.stats).toMatchObject({ historyCount: 2, unidentifiedHistoryCount: 2 });
    expect(buildPendingImportPreview({ data: restored.normalizedData }).unidentifiedHistoryCount).toBe(2);
  });

  it('resolves a missing name only from an exact known entity ID', () => {
    const result = validateAndNormalizeImportData({ pools: [pool], history: [{ ...unknown, character_id: 'chr_known' }] }, {
      characters: [{ id: 'chr_known', name: '已知角色', rarity: 4 }],
    });
    expect(result.normalizedData.history[0]).toMatchObject({ name: '已知角色', character_id: 'chr_known' });
    expect(result.stats.unidentifiedHistoryCount).toBe(0);
  });

  it('still rejects invalid rarity and time in a nameless site backup', () => {
    const result = validateAndNormalizeImportData({ schemaVersion: '3.0.0', pools: [pool], history: [{ ...unknown, rarity: 9, timestamp: 'bad' }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('记录 #1: rarity 应为 3-6 的数字');
    expect(result.errors).toContain('记录 #1: timestamp 无法解析为有效时间');
  });

  it('restores and previews the same UID in two servers without rewriting both to one label', () => {
    const result = validateAndNormalizeImportData({ schemaVersion: '3.0.0', pools: [pool],
      accounts: [{ gameUid: 'uid', serverId: '1', serverScope: '1', nickName: '官服名' },
        { gameUid: 'uid', serverId: 'bilibili', serverScope: 'bilibili', channelMasterId: '2', nickName: 'B服名' }],
      history: [{ ...unknown, serverScope: '1' }, { ...unknown, serverId: 'bilibili', serverScope: 'bilibili' }],
    });
    expect(result.errors).toEqual([]);
    expect(result.normalizedData.history.map(row => [row.serverId, row.serverScope, row.nickName]))
      .toEqual([['1', '1', '官服名'], ['bilibili', 'bilibili', 'B服名']]);
    const preview = buildPendingImportPreview({ data: result.normalizedData });
    expect(preview.accountCount).toBe(2);
    expect(preview.accounts.map(account => account.accountKey)).toEqual(['uid::server:1', 'uid::channel:2']);
    expect(result.stats.accountCount).toBe(2);
  });
});
