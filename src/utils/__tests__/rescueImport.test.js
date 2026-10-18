import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseImportFileContent } from '../dataImportFileParser.js';
import { validateAndNormalizeImportData } from '../dataImport.js';
import { normalizeLcxWikiExport, normalizeHelperSummaryExport } from '../rescueImport.js';
import { buildPendingImportPreview } from '../../components/modals/importPreviewUtils.js';
import { buildQuotaLedgerFromHistory } from '../quotaEconomy.js';
import { LCX_FOUR_STAR_PLACEHOLDER, LCX_FOUR_STAR_EXCESS } from '../../../shared/lcxImportPlaceholder.js';

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
    expect(result.normalizedData.history[0]).toMatchObject({ character_id: 'wpn_jade', poolId: 'weaponbox_1_6_1', rarity: 6, isStandard: false, serverScope: 'bilibili', seqId: '11' });
    expect(result.normalizedData.history[0].id).not.toBe('18');
  });
  it('retains unknown low-rarity weapons as 4-star pulls without catalog ownership or fake first-copy rewards', () => {
    const unknown = { ...row, seqId: '12', weaponId: '', weaponName: '未知武器', rarity: 3 };
    const data = normalizeLcxWikiExport(payload([row, unknown]), options);
    expect(data.history).toHaveLength(2);
    expect(data.history[1]).toMatchObject({ rarity: 4, character_id: null, seqId: '12', specialType: LCX_FOUR_STAR_PLACEHOLDER });
    expect(data.unresolvedRecords).toEqual([]);
    expect(data.supplements.workbenchEntries).toEqual([]);
    const validated = validateAndNormalizeImportData(payload([row, unknown]), options);
    expect(buildPendingImportPreview({ data: validated.normalizedData })).toMatchObject({ historyCount: 2, fourStarPlaceholderCount: 1, rarityCounts: { 4: 1, 6: 1 } });
    expect(buildQuotaLedgerFromHistory([data.history[1]], { pools, characters }).characterRows).toEqual([]);
  });
  it('recognizes generic star scaling by a unique known entity without shifting correct named results', () => {
    const five = { id: 'wpn_five', name: '五星武器', rarity: 5, type: 'weapon' };
    const data = normalizeLcxWikiExport(payload([{ ...row, rarity: 5 }, { ...row, seqId: '12', weaponName: '五星武器', rarity: 5 },
      { ...row, seqId: '13', weaponName: '五星武器', rarity: 4 }]), { ...options, characters: [...characters, five] });
    expect(data.history.map(record => record.rarity)).toEqual([6, 5, 5]);
    expect(() => normalizeLcxWikiExport(payload([{ ...row, rarity: 3 }]), options)).toThrow('唯一匹配');
  });
  it('normalizes the legacy weapon name before deduplication and rejects conflicting sequence payloads', () => {
    const weapon = { id: 'wpn_sword_0008', name: '显锋', rarity: 4, type: 'weapon' };
    const old = { ...row, rarity: 4, weaponName: '应急手段', weaponId: '43' };
    const corrected = { ...old, weaponName: '显锋', weaponId: '' };
    const catalog = { ...options, characters: [...characters, weapon] };
    const data = normalizeLcxWikiExport(payload([old, corrected, { ...corrected, seqId: '12' }]), catalog);
    expect(data.history).toHaveLength(2);
    expect(data.history[0]).toMatchObject({ name: '显锋', character_id: weapon.id });
    for (const change of [{ gachaTs: '1792161253144' }, { isFree: true }, { weaponName: '玉中身', rarity: 6 }]) {
      expect(() => normalizeLcxWikiExport(payload([old, { ...corrected, ...change }]), catalog)).toThrow('内容冲突');
    }
  });
  it('proves full potential before awarding unnamed four-star duplicate quota and never invents a catalog entry', () => {
    const unknown = { seqId: '99', gachaTs: '1792161252144', poolName: '万物更新', charName: '未知角色', rarity: 3, isFree: false };
    const known = Array.from({ length: 6 }, (_, index) => ({ ...unknown, seqId: String(index + 1),
      gachaTs: '1792161242144', charName: '萤石', rarity: 4 }));
    const data = normalizeLcxWikiExport(payload([...known, unknown]), options);
    expect(data.history.at(-1)).toMatchObject({ specialType: LCX_FOUR_STAR_EXCESS, character_id: null, rarity: 4 });
    const baseline = buildQuotaLedgerFromHistory(data.history.slice(0, -1), { pools, characters });
    const withPlaceholder = buildQuotaLedgerFromHistory(data.history, { pools, characters });
    expect(withPlaceholder.characterRows).toEqual(baseline.characterRows);
    expect(withPlaceholder.quota.aicQuotaDirect).toBe(baseline.quota.aicQuotaDirect);
    expect(withPlaceholder.quota.aicQuotaConvertible - baseline.quota.aicQuotaConvertible).toBe(5);
    const incomplete = normalizeLcxWikiExport(payload([unknown, ...known.slice(1)]), options);
    expect(incomplete.history[0].specialType).toBe(LCX_FOUR_STAR_PLACEHOLDER);
    const sameTimestamp = normalizeLcxWikiExport(payload([...known.map(record => ({ ...record, gachaTs: unknown.gachaTs })), unknown]), options);
    expect(sameTimestamp.history.at(-1).specialType).toBe(LCX_FOUR_STAR_PLACEHOLDER);
    const otherFour = { id: 'another_4', name: '另一四星', rarity: 4, type: 'character' };
    expect(normalizeLcxWikiExport(payload([...known, unknown]), { ...options, characters: [...characters, otherFour] }).history.at(-1).specialType)
      .toBe(LCX_FOUR_STAR_PLACEHOLDER);
  });
  it.each(['1', '2', '3'])('keeps source server %s distinct from the Bilibili channel', serverId => {
    const input = payload([row]); input.data.serverId = serverId; input.data.server = 'official';
    expect(normalizeLcxWikiExport(input, options).history[0].serverScope).toBe(serverId);
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
