import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseImportFileContent } from '../dataImportFileParser.js';
import { validateAndNormalizeImportData } from '../dataImport.js';
import { buildPendingImportPreview } from '../../components/modals/importPreviewUtils.js';

const morningStarPool = {
  id: 'special_1_4_2',
  name: '晨星于此闪耀',
  type: 'limited',
  start_time: '2026-08-09T04:00:00+00:00',
  end_time: '2026-09-01T22:00:00+00:00',
  up_character: '梨诺',
};
const catalogCharacters = [
  { id: 'chr_0035_liino', name: '梨诺', rarity: 6, type: 'character' },
  { id: 'chr_0011_seraph', name: '赛希', rarity: 5, type: 'character' },
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index) {
  let name = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function cellXml(value, columnIndex, rowIndex) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const reference = `${columnName(columnIndex)}${rowIndex}`;
  if (typeof value === 'number') {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }

  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function sheetXml(rows) {
  const rowsXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => cellXml(value, columnIndex, rowIndex + 1)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
}

function styledSheetXml(rows, styledRowIndex, styledCellCount) {
  const rowsXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => cellXml(value, columnIndex, rowIndex + 1)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const styledCells = Array.from({ length: styledCellCount }, (_, columnIndex) =>
    `<c r="${columnName(columnIndex)}${styledRowIndex}" s="1"/>`).join('');
  return `<worksheet><sheetData>${rowsXml}<row r="${styledRowIndex}">${styledCells}</row></sheetData></worksheet>`;
}

function workbook(worksheetXml, fileName = 'summary.xlsx') {
  return {
    fileName,
    content: zipSync({ 'xl/worksheets/sheet1.xml': strToU8(worksheetXml) }),
  };
}

const summaryHeaders = [
  '序号', '抽卡时间', '卡池名称', '卡池ID', '记录类型', '星级',
  '获得内容', '是否UP', '是否首次获得', '间隔抽数', '抽取序列ID', '角色/武器ID',
];
const summaryRows = [
  ['终末地抽卡记录'],
  ['UID', '1000000001'],
  summaryHeaders,
  [1, 46245.26614900463, '晨星于此闪耀', 'special_1_4_2', '角色', 6, '梨诺', '否', '是', 45, 829, 'chr_0035_liino'],
  [2, 46245.26596587963, '晨星于此闪耀', 'special_1_4_2', '角色', 5, '赛希', '否', '否', '', 827, 'chr_0011_seraph'],
  [3, 46245.26530061342, '晨星于此闪耀', 'special_1_4_2', '免费十连', 0, '未出货', '', '', '', 828, ''],
];

function importOptions() {
  return { existingPools: [morningStarPool], characters: catalogCharacters };
}

describe('data import Excel parser', () => {
  it('parses the helper summary layout when the public catalog contains the morning-star pool', async () => {
    const file = workbook(sheetXml(summaryRows));
    const parsed = await parseImportFileContent(file.content, {
      ...importOptions(),
      fileName: file.fileName,
    });

    expect(parsed.formatId).toBe('endfield_helper_summary_xlsx');
    expect(parsed.accounts[0]).toMatchObject({ gameUid: '1000000001' });
    expect(parsed.pools.map(pool => pool.id)).toEqual(['special_1_4_2']);
    expect(parsed.history).toEqual([]);

    const ledger = parsed.supplements.workbenchEntries.find(entry => entry.kind === 'pool-ledger');
    const batches = parsed.supplements.workbenchEntries.filter(entry => entry.kind === 'batch-summary');
    expect(ledger.values.acquisitions).toHaveLength(2);
    expect(ledger.values.acquisitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '梨诺', rarity: 6 }),
      expect.objectContaining({ name: '赛希', rarity: 5 }),
    ]));
    expect(batches).toHaveLength(1);
    expect(batches[0].values).toMatchObject({ drawMethod: 'free', totalPulls: 10 });

    const validation = validateAndNormalizeImportData(parsed, importOptions());
    expect(validation.valid).toBe(true);
    expect(validation.stats).toMatchObject({ poolCount: 1, historyCount: 0, supplementCount: 2 });
    expect(buildPendingImportPreview({ data: validation.normalizedData })).toMatchObject({
      historyCount: 0,
      supplementCount: 2,
      supplementalDropCount: 2,
      sparseSummary: true,
      sixStarDrops: [{ name: '梨诺', count: 1 }],
    });
  });

  it('rejects a workbook that is neither a helper summary nor an EndfieldGacha export', async () => {
    const aggregateRows = [
      ['熔火', '信使', '晨星'],
      [194, 34, 120],
      [3, 1, 4],
      ['总抽数', '总出货数', ''],
      [2181, 75, ''],
    ];
    const file = workbook(sheetXml(aggregateRows), '终末地抽卡分析.xlsx');

    await expect(parseImportFileContent(file.content, {
      ...importOptions(),
      fileName: file.fileName,
    })).rejects.toThrow('未能从 Excel 中识别到抽卡记录');
  });

  it('parses a styled EndfieldGacha sheet without scanning every self-closing cell to the end', async () => {
    const rows = [
      ['卡池 ID', '名称', '星级', '时间', 'seqId'],
      ['special_1_4_2', '梨诺', 6, '2026-08-09 04:08', '829'],
    ];
    const file = workbook(styledSheetXml(rows, 3, 16000), 'Endfield_Gacha_Test(1000000001).xlsx');
    const startedAt = performance.now();
    const parsed = await parseImportFileContent(file.content, {
      ...importOptions(),
      fileName: file.fileName,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(parsed.formatId).toBe('bhaoo_endfield_gacha_xlsx');
    expect(parsed.history).toHaveLength(1);
    expect(parsed.history[0]).toMatchObject({
      poolId: 'special_1_4_2',
      name: '梨诺',
      rarity: '6',
      seqId: '829',
    });
    expect(elapsedMs).toBeLessThan(3000);
  });
});
