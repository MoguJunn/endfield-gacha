import { describe, expect, it } from 'vitest';
import { filterImportedHistory } from '../importHistoryMerge.js';
import { validateAndNormalizeImportData } from '../dataImport.js';
import { parseImportFileContent } from '../dataImportFileParser.js';

const pools = [{ id: 'weponbox_test', name: '测试申领', type: 'weapon' }];
const drops = Array.from({ length: 10 }, (_, i) => [i === 9 ? '五星武器' : '重复武器', i === 9 ? 4 : 3, 0]);
const batches = { '1769058181.296': { p: '测试申领', pi: 'weponbox_test', seq: '10', c: drops } };
function normalize(data) {
  const result = validateAndNormalizeImportData(data, { existingPools: pools });
  expect(result.valid).toBe(true);
  return result.normalizedData;
}
const scope = rows => rows.map(row => ({ ...row, gameUid: 'test-uid', game_uid: 'test-uid', serverId: 'bilibili', serverScope: 'bilibili' }));

describe('kwer cross-format merge', () => {
  it('keeps the original ten-pull multiplicity and merges TXT with JSON in either direction', async () => {
    const verified = normalize({ info: { export_app: 'endgacha', export_type: 'gacha', uid: 'test-uid', channel: 'bilibili', verify: 'fixture' }, data: batches });
    const txtPayload = await parseImportFileContent(`1769058181.296,测试申领,${drops.slice().reverse().map(item => item.join('-')).join('@')}`, { fileName: 'test.txt' });
    const txt = normalize(txtPayload);
    expect(txt.pools[0].id).toBe('weponbox_test');
    expect(verified.accounts[0]).toMatchObject({ serverId: 'bilibili', serverScope: 'bilibili', region: 'cn' });
    expect(filterImportedHistory(scope(verified.history), [], pools)).toHaveLength(10);
    expect(filterImportedHistory(scope(txt.history), scope(verified.history), pools)).toHaveLength(0);
    expect(filterImportedHistory(scope(verified.history), scope(txt.history), pools)).toHaveLength(0);
    expect(filterImportedHistory(scope(txt.history), scope(verified.history.slice(0, 5)), pools)).toHaveLength(5);
    const forwardTxt = scope(txt.history).map((row, index, all) => ({ ...all[all.length - index - 1],
      id: row.id, record_id: row.record_id, seqId: row.seqId, seq_id: row.seq_id }));
    const remainder = filterImportedHistory(forwardTxt, scope(txt.history.slice(0, 1)), pools);
    expect(remainder).toHaveLength(9);
    expect(remainder.every(row => row.name === '重复武器')).toBe(true);
    expect(filterImportedHistory([verified.history[0], verified.history[0]], [verified.history[0]], pools)).toEqual([]);
  });

  it('does not conflate accounts, servers, pools, free status, or separate batches', () => {
    const [base] = scope(normalize(batches).history);
    const synthetic = { ...base, id: 'endgacha:txt:0', seqId: 'endgacha:txt:0', seq_id: 'endgacha:txt:0' };
    for (const patch of [
      { gameUid: 'another', game_uid: 'another' }, { serverId: '2', serverScope: '2' },
      { poolId: 'another', pool_id: 'another' }, { isFree: true },
      { timestamp: '2026-01-23T00:00:00Z' },
    ]) expect(filterImportedHistory([{ ...synthetic, ...patch }], [base], pools)).toHaveLength(1);
  });

  it('matches legacy TXT fallback pool IDs by unique catalog name', () => {
    const [base] = scope(normalize(batches).history);
    const legacy = { ...base, poolId: 'endgacha_kwer_old', pool_id: 'endgacha_kwer_old', seqId: 'endgacha:old:0', seq_id: 'endgacha:old:0' };
    expect(filterImportedHistory([base], [legacy], [...pools, { id: 'endgacha_kwer_old', name: '测试申领' }])).toEqual([]);
  });
});
