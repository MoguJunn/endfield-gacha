import { unzipSync } from 'fflate';
import { normalizeHelperSummaryExport } from './rescueImport.js';

function normalizeText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isArrayBufferLike(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '');
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/^\uFEFF/, '');
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(cell);
      if (row.some(value => normalizeText(value))) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some(value => normalizeText(value))) {
    rows.push(row);
  }

  return rows;
}

function parseCsvBoolean(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'new', '是'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', '否', ''].includes(normalized)) {
    return false;
  }
  return false;
}

function inferRoleIdFromUid(uid) {
  const normalized = normalizeText(uid);
  if (!normalized) {
    return '';
  }

  const parts = normalized.split(':').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function parseBhaooXlsxFileName(fileName) {
  const baseName = normalizeText(fileName).split(/[\\/]/).pop() || '';
  const match = baseName.match(/Endfield[_\s.-]*Gacha[_\s.-]*(.+?)\((\d{5,})\)/i)
    || baseName.match(/(.+?)\((\d{5,})\).*\.xlsx$/i);
  if (!match) {
    return { gameUid: '', nickName: '' };
  }

  return {
    nickName: normalizeText(match[1]).replace(/[_\s.-]+$/g, ''),
    gameUid: normalizeText(match[2])
  };
}

function xmlDecode(value) {
  return normalizeText(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function unzipXlsxEntries(input) {
  const bytes = input instanceof Uint8Array
    ? input
    : ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
  const zipEntries = unzipSync(bytes);
  const entries = new Map();

  Object.entries(zipEntries).forEach(([path, fileBytes]) => {
    entries.set(path.replace(/\\/g, '/'), fileBytes);
  });

  return entries;
}

function decodeZipText(entries, path) {
  const bytes = entries.get(path);
  return bytes ? new TextDecoder('utf-8').decode(bytes) : '';
}

function parseXmlAttributes(text) {
  const attrs = {};
  String(text || '').replace(/([\w:]+)="([^"]*)"/g, (_, key, value) => {
    attrs[key] = xmlDecode(value);
    return '';
  });
  return attrs;
}

function parseSharedStrings(xml) {
  if (!xml) {
    return [];
  }

  const values = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(xml))) {
    const texts = [];
    String(match[1]).replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, value) => {
      texts.push(xmlDecode(value));
      return '';
    });
    values.push(texts.join(''));
  }
  return values;
}

function columnIndexFromRef(ref) {
  const letters = normalizeText(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, index - 1);
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  // Self-closing rows and cells are common in styled workbooks. Matching them
  // with a greedy "open tag then find close tag" pattern makes every empty cell
  // scan the rest of the sheet, which turns large formatted sheets quadratic.
  const rowRegex = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml))) {
    const rowXml = rowMatch[1];
    if (!rowXml) {
      continue;
    }

    const row = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowXml))) {
      if (cellMatch[2] === undefined) {
        continue;
      }

      const attrs = parseXmlAttributes(cellMatch[1]);
      const columnIndex = columnIndexFromRef(attrs.r);
      const cellXml = cellMatch[2];
      const inlineValue = cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1];
      const rawValue = inlineValue ?? cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
      let value = xmlDecode(rawValue);

      if (attrs.t === 's') {
        value = sharedStrings[Number.parseInt(value, 10)] || '';
      }

      row[columnIndex] = value;
    }

    if (row.some(value => normalizeText(value))) {
      rows.push(row);
    }
  }

  return rows;
}

function getWorkbookSheets(entries) {
  const workbookXml = decodeZipText(entries, 'xl/workbook.xml');
  const relsXml = decodeZipText(entries, 'xl/_rels/workbook.xml.rels');
  const relMap = new Map();
  const relationshipRegex = /<Relationship\b([^>]*)\/?>/g;
  let relMatch;

  while ((relMatch = relationshipRegex.exec(relsXml))) {
    const attrs = parseXmlAttributes(relMatch[1]);
    if (attrs.Id && attrs.Target) {
      const target = attrs.Target.startsWith('/') ? attrs.Target.slice(1) : `xl/${attrs.Target}`.replace(/\/\.\//g, '/');
      relMap.set(attrs.Id, target.replace(/\\/g, '/'));
    }
  }

  const sheets = [];
  const sheetRegex = /<sheet\b([^>]*)\/?>/g;
  let sheetMatch;
  while ((sheetMatch = sheetRegex.exec(workbookXml))) {
    const attrs = parseXmlAttributes(sheetMatch[1]);
    const relationshipId = attrs['r:id'];
    const target = relMap.get(relationshipId);
    if (target) {
      sheets.push({ name: attrs.name || target, path: target });
    }
  }

  if (sheets.length > 0) {
    return sheets;
  }

  return Array.from(entries.keys())
    .filter(path => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .map((path, index) => ({ name: index === 0 ? '角色记录' : '武器记录', path }));
}

function normalizeXlsxTimestamp(value) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}+08:00`;
  }
  return text;
}

function inferPoolType(poolId, category) {
  const normalized = normalizeText(poolId).toLowerCase();
  if (category === 'weapon' || normalized.startsWith('weaponbox') || normalized.startsWith('weponbox')) {
    return 'weapon';
  }
  if (normalized.startsWith('standard')) {
    return 'standard';
  }
  if (normalized.startsWith('beginner')) {
    return 'beginner';
  }
  if (normalized.startsWith('extra') || normalized.startsWith('joint')) {
    return 'extra';
  }
  return 'limited';
}

function getRowValue(rowObject, ...keys) {
  for (const key of keys) {
    const value = normalizeText(rowObject[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

const BHAOO_POOL_HEADERS = new Set(['卡池 ID', '卡池ID', 'poolId']);
const BHAOO_ITEM_HEADERS = new Set(['名称', 'name', 'itemName']);

function parseBhaooSheetRows(rows, category, account) {
  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map(normalizeText);
  const recognized = headers.some(header => BHAOO_POOL_HEADERS.has(header))
    && headers.some(header => BHAOO_ITEM_HEADERS.has(header));
  const pools = new Map();
  const history = [];

  dataRows.forEach((row, index) => {
    const rowObject = {};
    headers.forEach((header, headerIndex) => {
      rowObject[header] = row[headerIndex];
    });

    const poolId = getRowValue(rowObject, '卡池 ID', '卡池ID', 'poolId');
    const poolName = getRowValue(rowObject, '卡池名', 'poolName') || poolId;
    const itemName = getRowValue(rowObject, '名称', 'name', 'itemName');
    if (!poolId || !itemName) {
      return;
    }

    const seqId = getRowValue(rowObject, 'seqId', 'seq_id');
    const recordId = seqId || `${category}:${poolId}:${index}`;
    const poolType = inferPoolType(poolId, category);
    pools.set(poolId, {
      id: poolId,
      pool_id: poolId,
      name: poolName,
      type: poolType
    });

    history.push({
      id: recordId,
      record_id: recordId,
      poolId,
      pool_id: poolId,
      rarity: getRowValue(rowObject, '星级', 'rarity'),
      name: itemName,
      item_name: itemName,
      timestamp: normalizeXlsxTimestamp(getRowValue(rowObject, '时间', 'timestamp')),
      seqId,
      seq_id: seqId,
      isNew: parseCsvBoolean(getRowValue(rowObject, '是否 NEW', '是否NEW', 'isNew')),
      is_new: parseCsvBoolean(getRowValue(rowObject, '是否 NEW', '是否NEW', 'isNew')),
      isFree: parseCsvBoolean(getRowValue(rowObject, '是否为加急招募', 'isFree')),
      is_free: parseCsvBoolean(getRowValue(rowObject, '是否为加急招募', 'isFree')),
      gameUid: account.gameUid || null,
      game_uid: account.gameUid || null,
      nickName: account.nickName || null,
      nick_name: account.nickName || null,
      channelName: 'endfield-gacha',
      channel_name: 'endfield-gacha'
    });
  });

  return { pools: Array.from(pools.values()), history, recognized };
}

async function parseBhaooXlsxContent(content, options = {}) {
  const { fileName = '' } = options;
  if (!isArrayBufferLike(content)) {
    throw new Error('Excel 导入需要读取二进制文件内容');
  }

  const entries = unzipXlsxEntries(content);
  const sharedStrings = parseSharedStrings(decodeZipText(entries, 'xl/sharedStrings.xml'));
  const workbookSheets = getWorkbookSheets(entries);
  const parsedSheets = workbookSheets.map(sheet => ({ ...sheet, rows: parseSheetRows(decodeZipText(entries, sheet.path), sharedStrings) }));
  const summarySheets = parsedSheets.filter(sheet => sheet.rows.some(row => ['抽卡时间', '卡池ID', '获得内容', '抽取序列ID'].every(header => row.includes(header))));
  if (summarySheets.length) {
    const summaryRows = [];
    const uids = new Set();
    const date1904 = /date1904="(?:1|true)"/.test(decodeZipText(entries, 'xl/workbook.xml'));
    for (const sheet of summarySheets) {
      const headerIndex = sheet.rows.findIndex(row => row.includes('抽取序列ID') && row.includes('获得内容'));
      for (const row of sheet.rows.slice(0, headerIndex)) {
        const index = row.findIndex(cell => normalizeText(cell).toUpperCase() === 'UID');
        if (index >= 0 && normalizeText(row[index+1])) uids.add(normalizeText(row[index+1]));
      }
      const headers = sheet.rows[headerIndex].map(normalizeText);
      for (const row of sheet.rows.slice(headerIndex+1)) {
        const item = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
        if (!normalizeText(item['获得内容']) && !normalizeText(item['卡池ID'])) throw new Error('高星摘要表存在无法识别的数据行，请核对表头及内容。');
        const value = normalizeText(item['抽卡时间']);
        const serial = Number(value);
        const at = value && Number.isFinite(serial)
          ? new Date((date1904 ? Date.UTC(1904,0,1) : Date.UTC(1899,11,30)) + Math.round(serial*86400000) - 8*3600000).toISOString()
          : normalizeXlsxTimestamp(value);
        if (!at || !Number.isFinite(Date.parse(at))) throw new Error('高星摘要表的抽卡时间无效。');
        summaryRows.push({ ...item, timestamp: at });
      }
    }
    if (uids.size !== 1) throw new Error('高星摘要表需要且只能包含一个有效 UID。');
    return normalizeHelperSummaryExport({ gameUid: [...uids][0], summaryRows }, options);
  }
  const account = parseBhaooXlsxFileName(fileName);
  const poolMap = new Map();
  const history = [];
  let recognizedSheetCount = 0;

  workbookSheets.forEach((sheet, index) => {
    const sheetName = normalizeText(sheet.name).toLowerCase();
    const category = sheetName.includes('武器') || sheetName.includes('weapon') || index === 1
      ? 'weapon'
      : 'character';
    const xml = decodeZipText(entries, sheet.path);
    if (!xml) {
      return;
    }

    const parsed = parseBhaooSheetRows(parseSheetRows(xml, sharedStrings), category, account);
    if (parsed.recognized) {
      recognizedSheetCount += 1;
    }
    parsed.pools.forEach(pool => poolMap.set(pool.id, pool));
    history.push(...parsed.history);
  });

  if (recognizedSheetCount === 0) {
    throw new Error('未能从 Excel 中识别到抽卡记录。请导出原始记录；只有汇总数字的分析表可在工作台手动补录。');
  }

  return {
    formatId: 'bhaoo_endfield_gacha_xlsx',
    schemaVersion: '3.0.0',
    exportTime: new Date().toISOString(),
    accounts: account.gameUid ? [{
      gameUid: account.gameUid,
      nickName: account.nickName || account.gameUid,
      channelName: 'endfield-gacha'
    }] : [],
    pools: Array.from(poolMap.values()),
    history
  };
}

function buildHelperCsvPayload(text) {
  const rows = parseCsvRows(text);
  const headers = (rows.shift() || []).map(normalizeHeader);
  if (headers.length === 0) {
    throw new Error('CSV 文件缺少表头');
  }

  const headerLookup = new Map(headers.map((header, index) => [header, index]));
  const getValue = (row, ...keys) => {
    for (const key of keys) {
      const index = headerLookup.get(key);
      if (index !== undefined) {
        const value = normalizeText(row[index]);
        if (value) {
          return value;
        }
      }
    }
    return '';
  };

  const records = [];
  const weaponRecords = [];
  const uidSet = new Set();

  rows.forEach((row, index) => {
    const poolId = getValue(row, 'poolId', 'pool_id', 'pool');
    const itemName = getValue(row, 'itemName', 'charName', 'characterName', 'weaponName', 'name');
    if (!poolId || !itemName) {
      return;
    }

    const categoryText = [
      getValue(row, 'category'),
      getValue(row, 'itemType'),
      getValue(row, 'type')
    ].join(' ').toLowerCase();
    const isWeapon = categoryText.includes('weapon')
      || categoryText.includes('武器')
      || Boolean(getValue(row, 'weaponId', 'weaponName'));
    const category = isWeapon ? 'weapon' : 'character';
    const uid = getValue(row, 'uid', 'gameUid', 'game_uid');
    if (uid) {
      uidSet.add(uid);
    }

    const record = {
      recordUid: getValue(row, 'recordUid', 'record_id', 'id') || `${category}:${poolId}:${index}`,
      uid,
      category,
      poolId,
      poolName: getValue(row, 'poolName', 'pool_name') || poolId,
      rarity: getValue(row, 'rarity', 'star'),
      isNew: parseCsvBoolean(getValue(row, 'isNew', 'is_new')),
      isFree: parseCsvBoolean(getValue(row, 'isFree', 'is_free')),
      gachaTs: getValue(row, 'gachaTs', 'pulledAt', 'timestamp', 'created_at'),
      seqId: getValue(row, 'seqId', 'seq_id'),
      fetchedAt: getValue(row, 'fetchedAt', 'fetched_at')
    };

    if (isWeapon) {
      weaponRecords.push({
        ...record,
        weaponId: getValue(row, 'weaponId', 'itemId', 'character_id', 'item_id'),
        weaponName: itemName
      });
    } else {
      records.push({
        ...record,
        charId: getValue(row, 'charId', 'itemId', 'character_id', 'item_id'),
        charName: itemName
      });
    }
  });

  return {
    schemaVersion: 2,
    exportedAt: Date.now(),
    accounts: Array.from(uidSet).map((uid) => ({
      uid,
      roleId: inferRoleIdFromUid(uid),
      nickName: inferRoleIdFromUid(uid)
    })),
    records,
    weaponRecords
  };
}

function parseEndgachaKwerTopTxt(text) {
  const data = {};
  const lines = stripBom(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  lines.forEach((line, lineIndex) => {
    const [timestamp, poolName, ...entryParts] = line.split(',');
    const normalizedTimestamp = normalizeText(timestamp);
    const normalizedPoolName = normalizeText(poolName);
    const entriesText = entryParts.join(',');

    if (!normalizedTimestamp || !normalizedPoolName || !entriesText) {
      throw new Error(`endgacha.kwer.top TXT 第 ${lineIndex + 1} 行格式不完整`);
    }

    const pulls = entriesText.split('@').map((entryText) => {
      const match = normalizeText(entryText).match(/^(.+)-([3-6])-([01])(?:-([01]))?$/);
      if (!match) {
        throw new Error(`endgacha.kwer.top TXT 第 ${lineIndex + 1} 行存在无法解析的寻访项`);
      }

      const pull = [
        match[1],
        Number.parseInt(match[2], 10),
        Number.parseInt(match[3], 10)
      ];
      if (match[4] !== undefined) pull.push(Number.parseInt(match[4], 10));
      return pull;
    });

    data[normalizedTimestamp] = {
      p: normalizedPoolName,
      c: pulls
    };
  });

  return {
    formatId: 'endgacha_kwer_top_plain_txt',
    schemaVersion: '1.0',
    accountInfoMissing: true,
    data
  };
}

export async function parseImportFileContent(content, options = {}) {
  const { fileName = '' } = options;
  const normalizedFileName = normalizeText(fileName).toLowerCase();

  if (normalizedFileName.endsWith('.xlsx')) {
    return parseBhaooXlsxContent(content, options);
  }

  const text = stripBom(content);
  // Wiki exports may be JSON in a .txt file, or have no extension at all.
  if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) return JSON.parse(text);
  if (normalizedFileName.endsWith('.csv')) {
    return buildHelperCsvPayload(text);
  }

  if (normalizedFileName.endsWith('.txt')) {
    return parseEndgachaKwerTopTxt(text);
  }

  return JSON.parse(text);
}

export default {
  parseImportFileContent
};
