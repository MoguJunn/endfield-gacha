import { expect, it } from 'vitest';
import { analyzeIncrementalPage, buildOfficialImportRecordKey } from '../../backend/lib/officialImportIncremental.js';

it('continues fetching old records until their missing official versions are restored', () => {
  const record = { poolId: 'rerun_wpn_yvonne', seqId: '10', poolVersion: 1, rarity: 6 };
  const key = buildOfficialImportRecordKey({ gameUid: '100', serverId: '1', poolId: record.poolId, seqId: record.seqId });
  const keys = new Set([key]);
  keys.poolVersions = new Map([[key, null]]);
  const input = { records: [record], gameUid: '100', serverId: '1', existingRecordKeys: keys };
  expect(analyzeIncrementalPage(input).allExisting).toBe(false);
  keys.poolVersions.set(key, 1);
  expect(analyzeIncrementalPage(input).allExisting).toBe(true);
  expect(analyzeIncrementalPage({ ...input, records: [{ ...record, poolVersion: undefined }] }).allExisting).toBe(true);
});
