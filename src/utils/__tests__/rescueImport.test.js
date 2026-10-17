import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseImportFileContent } from '../dataImportFileParser.js';
import { validateAndNormalizeImportData } from '../dataImport.js';
import { normalizeLcxWikiExport, normalizeHelperSummaryExport } from '../rescueImport.js';
import { buildPendingImportPreview } from '../../components/modals/importPreviewUtils.js';

const pools = [{ id: 'special_1_6_1', name: '万物更新', type: 'limited', up_character: '缇缇' },
  { id: 'weaponbox_1_6_1', name: '篆玉申领', type: 'weapon', up_character: '玉中身' }];
const characters = [{ id: 'chr_titi', name: '缇缇', rarity: 6, type: 'character' },
  { id: 'wpn_jade', name: '玉中身', rarity: 6, type: 'weapon' }, { id: 'chr_4', name: '萤石', rarity: 4, type: 'character' }];
const options = { existingPools: pools, characters };
const row = { seqId: '11', gachaTs: '1792161252144', rarity: 6, poolName: '篆玉申领', isFree: false, weaponId: '18', weaponName: '玉中身' };
const payload = list => ({ code: 0, data: { uid: '12345', nickName: '测试', serverId: '1', server: 'bilibili', exportTs: '1792220373000', total: list.length, list } });
const summaryRow = { '卡池ID': 'special_1_6_1', '卡池名称': '万物更新', '获得内容': '缇缇', '抽取序列ID': '99', '星级': '6',
  '角色/武器ID': 'chr_titi', '记录类型': '角色', '间隔抽数': '67', timestamp: '2026-10-16T14:34:12.144Z' };

describe('rescue imports', () => {
  it.each(['12', 'records.txt', 'records.json'])('recognizes LCX JSON regardless of filename %s', async fileName => {
    const parsed = await parseImportFileContent(JSON.stringify(payload([row])), { fileName });
    const result = validateAndNormalizeImportData(parsed, options);
    expect(result.valid).toBe(true);
    expect(result.normalizedData.sourceFormatId).toBe('lcx_wiki_json');
    expect(result.normalizedData.history[0]).toMatchObject({ character_id: 'wpn_jade', poolId: 'weaponbox_1_6_1', rarity: 6, isStandard: false, serverScope: '1', seqId: '11' });
    expect(result.normalizedData.history[0].id).not.toBe('18');
  });
  it('retains source unknowns as incomplete coverage evidence without creating fake pulls or gifts', () => {
    const unknown = { ...row, seqId: '12', weaponId: '', weaponName: '未知武器', rarity: 3 };
    const data = normalizeLcxWikiExport(payload([row, unknown]), options);
    expect(data.history).toHaveLength(1);
    expect(data.unresolvedRecords).toHaveLength(1);
    expect(data.supplements.workbenchEntries[0].values.totalPulls).toBeUndefined();
    expect(data.supplements.workbenchEntries[0].values.notes).toContain('未知武器');
    expect(data.supplements.workbenchEntries[0].values.acquisitions).toEqual([]);
  });
  it('rejects ambiguous banners and inconsistent export totals instead of choosing one or dropping rows', () => {
    expect(() => normalizeLcxWikiExport(payload([row]), { ...options, existingPools: [...pools, { ...pools[1], id: 'other' }] })).toThrow('匹配到多项');
    expect(() => normalizeLcxWikiExport({ ...payload([row]), data: { ...payload([row]).data, total: 2 } }, options)).toThrow('条数');
    expect(() => normalizeLcxWikiExport(payload([{ ...row, weaponName: '不存在' }]), options)).toThrow('唯一匹配');
  });
  it('keeps account and banner identities separate even when source sequence IDs repeat', () => {
    const first = normalizeLcxWikiExport(payload([row]), options);
    const second = normalizeLcxWikiExport({ ...payload([row]), data: { ...payload([row]).data, uid: '98765' } }, options);
    expect(first.history[0].id).not.toBe(second.history[0].id);
  });
  it('converts high-star summaries to portable supplements with unknown totals and explicit intervals', () => {
    const parsed = normalizeHelperSummaryExport({ gameUid: '12345', summaryRows: [summaryRow,
      { ...summaryRow, '抽取序列ID': '100', '星级': '0', '获得内容': '未出货', '记录类型': '免费十连', '角色/武器ID': '' }] }, options);
    expect(parsed.history).toEqual([]);
    expect(parsed.accountServerMissing).toBe(true);
    const entries = parsed.supplements.workbenchEntries;
    expect(entries.find(row => row.kind === 'batch-summary').values).toMatchObject({ totalPulls: 10, drawMethod: 'free' });
    const ledger = entries.find(row => row.kind === 'pool-ledger');
    expect(ledger.values.totalPulls).toBeUndefined();
    expect(ledger.values.acquisitions[0]).toMatchObject({ entityId: 'chr_titi', intervalPulls: 67 });
    expect(ledger.values.acquisitions[0].pullIndex).toBeUndefined();
    const validated = validateAndNormalizeImportData(parsed, options);
    expect(validated.valid).toBe(true);
    const preview = buildPendingImportPreview({ data: validated.normalizedData });
    expect(preview).toMatchObject({ historyCount: 0, supplementalDropCount: 1, supplementCount: 2, sparseSummary: true, accountServerMissing: true });
    expect(preview.sixStarDrops).toEqual([{ name: '缇缇', count: 1 }]);
  });
  it('finds the summary header below title/UID rows and converts Excel local times consistently', async () => {
    const rows = [['终末地抽卡记录'], ['UID','12345'], Object.keys(summaryRow).filter(key => key !== 'timestamp')];
    rows.push(rows[2].map(key => key === '抽卡时间' ? '46311.5' : summaryRow[key]));
    rows[2].push('抽卡时间'); rows[3].push('46311.5');
    const sheet = '<worksheet><sheetData>'+rows.map((row,index)=>`<row r="${index+1}">`+row.map((value,col)=>`<c r="${String.fromCharCode(65+col)}${index+1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>';
    const archive = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet) });
    const first = await parseImportFileContent(archive, { ...options, fileName: 'old-9.19.xlsx' });
    const second = await parseImportFileContent(archive, { ...options, fileName: 'renamed.xlsx' });
    expect(first.supplements.workbenchEntries[0].values.acquisitions[0].timestamp).toMatch(/T04:00:00.000Z$/);
    expect(first.supplements).toEqual(second.supplements);
  });
  it('preserves calendar and pity conflicts as source evidence instead of falsifying their values', () => {
    const parsed = normalizeHelperSummaryExport({ gameUid: '12345', summaryRows: [{ ...summaryRow, '间隔抽数': '999' }] },
      { ...options, existingPools: [{ ...pools[0], start_time: '2026-10-17T00:00:00Z' }] });
    const drop = parsed.supplements.workbenchEntries[0].values.acquisitions[0];
    expect(drop).toMatchObject({ sourceIntervalPulls: 999, sourceTimestamp: summaryRow.timestamp, timestamp: null, timePrecision: 'unknown' });
    expect(drop.intervalPulls).toBeUndefined();
    expect(parsed).toMatchObject({ calendarConflictCount: 1, intervalConflictCount: 1 });
  });
});
