import { normalizeEntityNameForMatch } from './canonicalEntityUtils.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';

export const HELPER_RESCUE_FORMAT = 'endfield_helper_summary_xlsx';
export const LCX_RESCUE_FORMAT = 'lcx_wiki_json';
const text = value => String(value ?? '').trim();
const idOf = pool => text(pool.id || pool.pool_id);

// Stable portable identities, independent of filename, row order and export date.
// These IDs identify supplementary evidence, never official pull records.
export function rescueImportId(value) {
  const hex = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => {
    let hash = seed;
    for (const char of String(value)) hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function directory(options) {
  const pools = (options.existingPools || []).filter(pool => !idOf(pool).startsWith('__group_'));
  const entities = options.characters || [];
  return {
    pool(name, rawId, type, timestamp) {
      let matches = pools.filter(pool => (!type || resolvePoolCapabilities(pool).entityType === type)
        && (rawId ? idOf(pool) === rawId : text(pool.name) === name || text(pool.name_en) === name));
      if (matches.length > 1 && timestamp) {
        const at = Date.parse(timestamp);
        matches = matches.filter(pool => (!pool.start_time || at >= Date.parse(pool.start_time))
          && (!pool.end_time || at <= Date.parse(pool.end_time)));
      }
      if (matches.length !== 1) throw new Error(`卡池“${name || rawId}”${matches.length ? '匹配到多项' : '未匹配本站目录'}，请先在卡池目录核对。`);
      return { ...matches[0], id: idOf(matches[0]), pool_id: idOf(matches[0]) };
    },
    entity(name, rawId, rarity, type) {
      const matches = entities.filter(entity => Number(entity.rarity) === Number(rarity) && entity.type === type
        && (rawId ? text(entity.id) === rawId : [entity.name, entity.name_en, ...(entity.aliases || [])]
          .some(alias => normalizeEntityNameForMatch(alias) === normalizeEntityNameForMatch(name))));
      if (matches.length !== 1) throw new Error(`“${name}”无法按名称、星级和类型唯一匹配目录，请核对文件。`);
      if (rawId && normalizeEntityNameForMatch(matches[0].name) !== normalizeEntityNameForMatch(name)) {
        throw new Error(`“${name}”的实体 ID 与目录名称不一致，请核对文件。`);
      }
      return matches[0];
    },
  };
}

function timestamp(value) {
  const raw = text(value);
  const number = Number(raw);
  const date = /^\d+$/.test(raw) ? new Date(number < 1e10 ? number * 1000 : number) : new Date(raw);
  if (!raw || !Number.isFinite(date.getTime())) throw new Error('存在无法解析的记录时间，请核对文件。');
  return date.toISOString();
}

function supplement(account, poolId, identity, kind, values) {
  return { entryId: rescueImportId([account.gameUid, poolId, identity].join('|')),
    draftId: rescueImportId([account.gameUid, 'rescue-import'].join('|')), gameUid: account.gameUid,
    serverScope: account.serverId || 'legacy', poolId, kind, source: 'file', derivation: 'declared',
    timePrecision: 'range', reviewState: 'confirmed', values };
}

export function looksLikeLcxWikiExport(data) {
  return data?.code === 0 && data.data && Array.isArray(data.data.list) && Boolean(text(data.data.uid));
}

export function normalizeLcxWikiExport(payload, options = {}) {
  const data = payload.data;
  if (Number(data.total) !== data.list.length) throw new Error('原站导出条数与 list 不一致，请重新导出完整文件。');
  const account = { gameUid: text(data.uid), nickName: text(data.nickName) || text(data.uid),
    serverId: text(data.serverId), region: text(data.serverId) === '1' ? 'cn' : 'intl', channelName: text(data.server) };
  if (!['1', '2', '3'].includes(account.serverId)) throw new Error('原站文件没有可识别的区服，请核对 serverId。');
  const catalog = directory(options), poolMap = new Map(), history = [], unresolvedRecords = [], seen = new Set();
  for (const row of data.list) {
    const type = Object.hasOwn(row, 'weaponName') ? 'weapon' : 'character';
    const at = timestamp(row.gachaTs), seqId = text(row.seqId), name = text(row.weaponName || row.charName);
    if (!/^\d+$/.test(seqId)) throw new Error('原站记录缺少有效序号，无法安全去重。');
    const pool = catalog.pool(text(row.poolName), '', type, at);
    poolMap.set(pool.id, pool);
    const identity = `${pool.id}|${seqId}`;
    if (seen.has(identity)) throw new Error(`原站文件存在重复记录：${row.poolName} / ${seqId}`);
    seen.add(identity);
    // The source has already replaced unrecognized rewards with 3★ "unknown".
    // Their original identity/quality is lost. Never invent a weapon or gift.
    if (Number(row.rarity) === 3 && /^未知(?:角色|武器)$/.test(name)) {
      unresolvedRecords.push({ ...row, poolId: pool.id, timestamp: at });
      continue;
    }
    if (![4, 5, 6].includes(Number(row.rarity))) throw new Error(`“${name}”的星级无法识别。`);
    // LCX numeric IDs belong to its own directory. Resolve trusted names instead.
    const entity = catalog.entity(name, '', row.rarity, type);
    const isFree = row.isFree === true;
    const featured = text(pool.up_character || pool.upCharacter);
    history.push({ id: `lcx:${account.gameUid}:${account.serverId}:${pool.id}:${seqId}`, poolId: pool.id, seqId, rarity: Number(entity.rarity),
      name: entity.name, character_id: entity.id, timestamp: at, isFree,
      isStandard: resolvePoolCapabilities(pool).basePoolType === 'standard' || Boolean(featured && featured !== entity.name),
      gameUid: account.gameUid, nickName: account.nickName, serverId: account.serverId, serverScope: account.serverId,
      region: account.region, channelName: account.channelName, batchId: `lcx:${pool.id}:${at}:${isFree ? 'free' : 'normal'}` });
  }
  const workbenchEntries = [];
  for (const poolId of new Set(unresolvedRecords.map(row => row.poolId))) {
    const unknown = unresolvedRecords.filter(row => row.poolId === poolId);
    const known = history.filter(row => row.poolId === poolId && !row.isFree);
    const times = [...known, ...unknown].map(row => Date.parse(row.timestamp));
    workbenchEntries.push(supplement(account, poolId, 'lcx-unresolved', 'pool-ledger', {
      drawMethod: 'normal', coverageMode: 'range', complete: false,
      rangeStart: new Date(Math.min(...times)).toISOString(), rangeEnd: new Date(Math.max(...times) + 1).toISOString(),
      fourStarCount: known.filter(row => row.rarity === 4).length, fiveStarCount: known.filter(row => row.rarity === 5).length,
      sixStarCount: known.filter(row => row.rarity === 6).length, acquisitions: [],
      notes: `离愁轩原站存在身份及品质不明的结果；不推断为赠礼或计入抽数，总量和受影响保底保持未知。原始条目：${JSON.stringify(unknown)}`,
    }));
  }
  return { formatId: LCX_RESCUE_FORMAT, schemaVersion: '3.0.0', exportTime: timestamp(data.exportTs),
    accounts: [account], pools: [...poolMap.values()], history, unresolvedRecords,
    importWarningCodes: unresolvedRecords.length ? ['lcx_unknown_records'] : [],
    supplements: { schemaVersion: 1, workbenchEntries } };
}

export function normalizeHelperSummaryExport(data, options = {}) {
  const catalog = directory(options), poolMap = new Map(), groups = new Map(), workbenchEntries = [], seen = new Set();
  let calendarConflictCount = 0;
  let intervalConflictCount = 0;
  const account = { gameUid: text(data.gameUid), nickName: text(data.nickName) || text(data.gameUid), serverId: '', region: '' };
  if (!/^\d+$/.test(account.gameUid)) throw new Error('高星摘要表没有可识别的 UID，请保留表头上方的 UID 行。');
  for (const row of data.summaryRows) {
    const rawId = text(row['卡池ID']), name = text(row['获得内容']), seq = text(row['抽取序列ID']);
    const at = row.timestamp, rarity = Number(row['星级']), recordType = text(row['记录类型']);
    const pool = catalog.pool(text(row['卡池名称']), rawId, null, at);
    poolMap.set(pool.id, pool);
    if (!/^\d+$/.test(seq) || seen.has(`${pool.id}|${seq}`)) throw new Error('高星摘要表存在缺失或重复的抽取序列 ID。');
    seen.add(`${pool.id}|${seq}`);
    const method = recordType === '免费十连' ? 'free' : /赠送|赠礼|信物/.test(recordType) ? 'gift' : 'normal';
    if (rarity === 0 && method === 'free' && name === '未出货' && !text(row['角色/武器ID'])) {
      workbenchEntries.push(supplement(account, pool.id, `free:${seq}`, 'batch-summary', {
        drawMethod: 'free', totalPulls: 10, batchIndex: 1, rangeStart: at, rangeEnd: new Date(Date.parse(at)+1).toISOString(),
        notes: `原表序列 ${seq}：免费十连、未出货。只保留批次摘要，不生成角色或武器。`,
      }));
      continue;
    }
    if (![5, 6].includes(rarity)) throw new Error(`“${name}”不是已支持的高星结果或免费十连摘要，请核对表格。`);
    const entity = catalog.entity(name, text(row['角色/武器ID']), rarity, resolvePoolCapabilities(pool).entityType);
    const interval = text(row['间隔抽数']);
    if (interval && (!/^\d+$/.test(interval) || Number(interval) <= 0)) throw new Error(`“${name}”的间隔抽数无效。`);
    const key = `${pool.id}|${method}`;
    const intervalConflict = rarity === 6 && method === 'normal' && Number(interval) > Number(resolvePoolCapabilities(pool).rules.sixStarPity);
    if (intervalConflict) intervalConflictCount++;
    const calendarConflict = pool.start_time && Date.parse(at) < Date.parse(pool.start_time)
      || pool.end_time && Date.parse(at) > Date.parse(pool.end_time);
    if (calendarConflict) calendarConflictCount++;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: rescueImportId([account.gameUid, pool.id, seq].join('|')), entityId: entity.id, rarity,
      quantity: 1, name: entity.name, drawMethod: method,
      timePrecision: calendarConflict ? 'unknown' : 'second', timestamp: calendarConflict ? null : at,
      ...(calendarConflict ? { sourceTimestamp: at } : {}),
      ...(interval && rarity === 6 && method === 'normal' ? intervalConflict
        ? { sourceIntervalPulls: Number(interval) } : { intervalPulls: Number(interval) } : {}),
      notes: `原表序列 ${seq}；是否UP：${text(row['是否UP']) || '未知'}；是否首次获得：${text(row['是否首次获得']) || '未知'}。`
        + (calendarConflict ? `原表准确时间 ${at} 与当前卡池日历不一致，保留待核对，不参与准确时间分析。` : '低星明细及累计抽数未知。')
        + (intervalConflict ? `原表间隔 ${interval} 与本池保底上限不一致，保留原值待核对，不参与准确间隔分析。` : '') });
  }
  for (const [key, acquisitions] of groups) {
    const [poolId, method] = key.split('|');
    acquisitions.sort((a, b) => Date.parse(a.timestamp || a.sourceTimestamp) - Date.parse(b.timestamp || b.sourceTimestamp) || a.id.localeCompare(b.id));
    const times = acquisitions.map(row => Date.parse(row.timestamp || row.sourceTimestamp));
    workbenchEntries.push(supplement(account, poolId, `helper:${method}`, 'pool-ledger', {
      drawMethod: method, coverageMode: 'range', complete: false,
      rangeStart: new Date(Math.min(...times)).toISOString(), rangeEnd: new Date(Math.max(...times)+1).toISOString(),
      acquisitions, notes: '终末地小助手高星摘要：只导入已知出货和明确提供的六星间隔，总抽数、四星数及累计位置保持未知。',
    }));
  }
  return { formatId: HELPER_RESCUE_FORMAT, schemaVersion: '3.0.0', accounts: [account], pools: [...poolMap.values()],
    history: [], importWarningCodes: ['sparse_high_star_summary'], accountServerMissing: true, calendarConflictCount, intervalConflictCount,
    supplements: { schemaVersion: 1, workbenchEntries } };
}
