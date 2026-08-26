import {
  getPoolsForGroupType,
  getPoolGroupType,
  isPoolGroupId
} from './poolGroupUtils.js';
import { strToU8, zipSync } from 'fflate';
import {
  buildGameAccountServerTag,
  getHistoryRecordAccountKey,
  isGameAccountSelectionMatch,
  loadGameAccountMetadataMap,
  normalizeGameAccountMetadata
} from './gameAccountMetadata.js';
import {
  classifyCharacterIdSource,
  normalizeEntityNameForMatch
} from './canonicalEntityUtils.js';
import { getDataFormatById } from './dataFormatRegistry.js';
import { getCanonicalExtraPoolSubtype } from '../../shared/extraPoolSubtype.js';

export const EXPORT_SCHEMA_VERSION = '3.0.0';
export const EXPORT_FORMAT_ID = 'internal_json_v3';
export const EXPORT_CSV_FORMAT_ID = 'internal_csv_flat';
export const EXPORT_ENDFIELD_GACHA_USERDATA_ZIP_FORMAT_ID = 'bhaoo_endfield_gacha_userdata_zip';
export const EXPORT_EFGH_JSON_FORMAT_ID = 'endfield_gacha_helper_json';
export const EXPORT_EFGH_CSV_FORMAT_ID = 'endfield_gacha_helper_csv';
export const EXPORT_EFGH_USERDATA_ZIP_FORMAT_ID = 'endfield_gacha_helper_userdata_zip';
export const EXPORT_ENDGACHA_KWER_TOP_PLAIN_JSON_FORMAT_ID = 'endgacha_kwer_top_plain_json';
export const EXPORT_ENDGACHA_KWER_TOP_PLAIN_TXT_FORMAT_ID = 'endgacha_kwer_top_plain_txt';
const EXPORT_ENDFIELD_GACHA_XLSX_FORMAT_ID = 'bhaoo_endfield_gacha_xlsx';
const exportFormat = getDataFormatById(EXPORT_FORMAT_ID);
let endfieldGachaHelperSqlJsPromise = null;

async function loadEndfieldGachaHelperSqlJs() {
  if (!endfieldGachaHelperSqlJsPromise) {
    endfieldGachaHelperSqlJsPromise = (async () => {
      const { default: initSqlJs } = await import('sql.js');

      if (typeof window !== 'undefined') {
        const wasmAsset = await import('sql.js/dist/sql-wasm-browser.wasm?url');
        return initSqlJs({
          locateFile: () => wasmAsset.default
        });
      }

      return initSqlJs();
    })();
  }

  return endfieldGachaHelperSqlJsPromise;
}

function getHistoryPoolId(record) {
  return record?.poolId || record?.pool_id || null;
}

function getHistoryGameUid(record) {
  return record?.game_uid || record?.gameUid || null;
}

function getHistoryRecordItemName(record) {
  return record?.item_name
    || record?.itemName
    || record?.name
    || record?.character_name
    || record?.characterName
    || record?.weapon_name
    || record?.weaponName
    || '';
}

function getHistoryRecordItemId(record) {
  return [
    record?.character_id,
    record?.characterId,
    record?.item_id,
    record?.itemId,
    record?.charId,
    record?.weaponId
  ]
    .map((value) => String(value ?? '').trim())
    .find(Boolean) || '';
}

function getHistoryAccountSelectionValue(record) {
  const explicitAccountKey = record?.accountKey || record?.account_key;
  if (explicitAccountKey) {
    return String(explicitAccountKey).trim();
  }

  return getHistoryRecordAccountKey(record) || getHistoryGameUid(record) || null;
}

function isHistoryRecordInAccountScope(record, selectedAccountValue) {
  if (!selectedAccountValue) {
    return true;
  }

  return isGameAccountSelectionMatch(record, selectedAccountValue)
    || getHistoryAccountSelectionValue(record) === selectedAccountValue;
}

function getHistoryTimestampMs(record) {
  const raw = record?.timestamp;
  if (typeof raw === 'number') {
    return raw;
  }

  const parsed = new Date(raw || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getHistoryTimestampIso(record) {
  const time = getHistoryTimestampMs(record);
  return time > 0 ? new Date(time).toISOString() : null;
}

function getHistoryId(record) {
  return record?.id || record?.record_id || null;
}

function getHistorySeqId(record) {
  const raw = record?.seqId || record?.seq_id || null;
  return raw === null || raw === undefined || raw === '' ? null : String(raw);
}

function normalizeSpecialType(record) {
  return record?.specialType || record?.special_type || null;
}

function normalizeIsFree(record) {
  return record?.isFree === true || record?.is_free === true;
}

function normalizeIsNew(record) {
  return record?.isNew === true || record?.is_new === true;
}

function normalizeIsStandard(record) {
  if (record?.isStandard === true || record?.is_standard === true) {
    return true;
  }
  if (record?.isStandard === false || record?.is_standard === false) {
    return false;
  }
  return null;
}

function normalizePoolTypeLabel(poolType) {
  switch (poolType) {
    case 'extra':
      return '附加寻访';
    case 'limited':
    case 'limited_character':
      return '限定角色池';
    case 'standard':
      return '常驻池';
    case 'beginner':
      return '新手池';
    case 'weapon':
    case 'limited_weapon':
      return '武器池';
    default:
      return poolType || '未知卡池';
  }
}

function compactExportObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => (
      entryValue !== undefined
      && entryValue !== null
      && entryValue !== ''
    ))
  );
}

function serializeInternalJsonPool(pool) {
  return compactExportObject({
    id: pool?.id || pool?.pool_id,
    name: pool?.name,
    name_en: pool?.name_en,
    type: pool?.type,
    extra_subtype: getCanonicalExtraPoolSubtype(pool),
    extra_rule_profile: pool?.extra_rule_profile ?? pool?.extraRuleProfile,
    extra_series_key: pool?.extra_series_key ?? pool?.extraSeriesKey,
    extra_series_phase: pool?.extra_series_phase ?? pool?.extraSeriesPhase,
    locked: pool?.locked === true,
    isLimitedWeapon: pool?.isLimitedWeapon ?? pool?.is_limited_weapon,
    up_character: pool?.up_character || pool?.upCharacter,
    description: pool?.description,
    banner_url: pool?.banner_url || pool?.bannerUrl,
    start_time: pool?.start_time || pool?.startTime,
    end_time: pool?.end_time || pool?.endTime,
    featured_characters: pool?.featured_characters
  });
}

function serializeInternalJsonHistoryRecord(record) {
  const itemName = record?.name || record?.item_name || record?.character_name || record?.characterName;

  return compactExportObject({
    id: getHistoryId(record),
    rarity: record?.rarity,
    isStandard: normalizeIsStandard(record),
    specialType: normalizeSpecialType(record),
    timestamp: record?.timestamp,
    poolId: getHistoryPoolId(record),
    name: itemName,
    character_id: getHistoryRecordItemId(record),
    batchId: record?.batchId || record?.batch_id,
    seqId: getHistorySeqId(record),
    pity: record?.pity,
    isNew: normalizeIsNew(record),
    isFree: normalizeIsFree(record),
    gameUid: getHistoryGameUid(record),
    nickName: record?.nickName || record?.nick_name,
    serverId: record?.serverId || record?.server_id,
    region: record?.region || record?.serverRegion
  });
}

function formatLocalTime(isoString) {
  if (!isoString) {
    return '';
  }

  return new Date(isoString).toLocaleString('zh-CN');
}

function buildPoolLookup(pools) {
  return new Map((pools || []).map(pool => [pool.id, pool]));
}

function buildAccountLookup(history) {
  const metadataMap = loadGameAccountMetadataMap();
  const accountMap = new Map();

  (history || []).forEach(record => {
    const gameUid = getHistoryGameUid(record);
    if (!gameUid) {
      return;
    }

    const accountSelectionValue = getHistoryAccountSelectionValue(record) || gameUid;
    const storedMetadata = metadataMap[accountSelectionValue] || metadataMap[gameUid] || {};

    const metadata = normalizeGameAccountMetadata({
      ...storedMetadata,
      gameUid,
      nickName: record?.nick_name || record?.nickName || storedMetadata.nickName || gameUid,
      channelName: record?.channel_name || record?.channelName || storedMetadata.channelName,
      hgUid: record?.hg_uid || record?.hgUid || storedMetadata.hgUid,
      channelMasterId: record?.channel_master_id || record?.channelMasterId || storedMetadata.channelMasterId,
      serverId: record?.server_id || record?.serverId || storedMetadata.serverId,
      region: record?.region || record?.serverRegion || storedMetadata.region,
      isOfficial: record?.is_official ?? record?.isOfficial ?? storedMetadata.isOfficial
    });

    accountMap.set(accountSelectionValue, {
      ...(accountMap.get(accountSelectionValue) || {}),
      accountKey: accountSelectionValue,
      gameUid,
      nickName: metadata?.nickName || gameUid,
      channelName: metadata?.channelName || null,
      hgUid: metadata?.hgUid || null,
      channelMasterId: metadata?.channelMasterId || null,
      serverId: metadata?.serverId || null,
      region: metadata?.region || null,
      isOfficial: metadata?.isOfficial ?? null,
      serverTag: buildGameAccountServerTag(metadata) || null
    });
  });

  return accountMap;
}

function resolveAccountForHistoryRecord(accountLookup, record) {
  return accountLookup.get(getHistoryAccountSelectionValue(record))
    || accountLookup.get(getHistoryGameUid(record))
    || null;
}

function resolvePoolFilterIds(options, pools, currentPoolId) {
  if (options.poolFilter === 'current') {
    if (isPoolGroupId(currentPoolId)) {
      const groupType = getPoolGroupType(currentPoolId);
      return new Set(getPoolsForGroupType(pools || [], groupType).map(pool => pool.id));
    }

    return currentPoolId ? new Set([currentPoolId]) : null;
  }

  if (options.poolFilter === 'specific' && options.poolId) {
    return new Set([options.poolId]);
  }

  return null;
}

function resolveTargetGameUid(options, currentGameUid) {
  if (options.accountFilter === 'specific' && options.gameUid) {
    return options.gameUid;
  }

  if (options.accountFilter === 'current') {
    return options.gameUid || currentGameUid || null;
  }

  return null;
}

function getLegacyGameUidFromSelection(selectionValue) {
  const normalized = String(selectionValue ?? '').trim();
  if (!normalized) {
    return null;
  }

  return normalized.split('::', 1)[0] || normalized;
}

function buildDateBoundary(dateString, isEnd) {
  if (!dateString) {
    return null;
  }

  const suffix = isEnd ? 'T23:59:59.999' : 'T00:00:00.000';
  const timestamp = new Date(`${dateString}${suffix}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildExportEntityIdLookup(entities = []) {
  const candidatesByName = new Map();

  (Array.isArray(entities) ? entities : []).forEach((entity) => {
    const entityId = String(entity?.id ?? '').trim();
    if (!entityId || classifyCharacterIdSource(entityId) === 'manual_placeholder') {
      return;
    }

    const names = [
      entity?.name,
      ...(Array.isArray(entity?.aliases) ? entity.aliases : [])
    ];

    names.forEach((name) => {
      const normalizedName = normalizeEntityNameForMatch(name);
      if (!normalizedName) {
        return;
      }

      if (!candidatesByName.has(normalizedName)) {
        candidatesByName.set(normalizedName, new Set());
      }
      candidatesByName.get(normalizedName).add(entityId);
    });
  });

  return new Map(
    Array.from(candidatesByName.entries())
      .filter(([, ids]) => ids.size === 1)
      .map(([name, ids]) => [name, Array.from(ids)[0]])
  );
}

function normalizeExportEntityCatalog(catalog) {
  if (Array.isArray(catalog)) {
    return catalog;
  }

  if (Array.isArray(catalog?.characters)) {
    return catalog.characters;
  }

  if (Array.isArray(catalog?.rows)) {
    return catalog.rows;
  }

  return [];
}

function enrichHistoryWithMissingItemIds(records, characterCatalog) {
  const entityIdLookup = buildExportEntityIdLookup(normalizeExportEntityCatalog(characterCatalog));
  if (entityIdLookup.size === 0) {
    return records;
  }

  return records.map((record) => {
    if (getHistoryRecordItemId(record)) {
      return record;
    }

    const itemName = getHistoryRecordItemName(record);
    const resolvedId = entityIdLookup.get(normalizeEntityNameForMatch(itemName));
    if (!resolvedId) {
      return record;
    }

    return {
      ...record,
      character_id: resolvedId,
    };
  });
}

function isGiftRecord(record) {
  return normalizeSpecialType(record) === 'gift';
}

function buildPitySequence(filteredHistory) {
  const groupedPity = new Map();
  const sortedHistory = [...filteredHistory].sort((a, b) => {
    const timeDelta = getHistoryTimestampMs(a) - getHistoryTimestampMs(b);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return String(getHistoryId(a) || '').localeCompare(String(getHistoryId(b) || ''));
  });

  sortedHistory.forEach(record => {
    const gameUid = getHistoryAccountSelectionValue(record) || '__all__';
    const poolId = getHistoryPoolId(record) || '__unknown__';
    const key = `${gameUid}::${poolId}`;
    const currentPity = groupedPity.get(key) || 0;

    if (isGiftRecord(record)) {
      groupedPity.set(`${key}::${getHistoryId(record)}`, '-');
      return;
    }

    const nextPity = currentPity + 1;
    groupedPity.set(key, nextPity);
    groupedPity.set(`${key}::${getHistoryId(record)}`, nextPity);

    if (record?.rarity === 6) {
      groupedPity.set(key, 0);
    }
  });

  return groupedPity;
}

function buildSummary(records, poolLookup, accountLookup) {
  const validRecords = records.filter(record => !isGiftRecord(record));
  const byPoolMap = new Map();
  const byAccountMap = new Map();

  records.forEach(record => {
    const poolId = getHistoryPoolId(record) || 'unknown';
    const gameUid = getHistoryGameUid(record) || 'unknown';
    const accountKey = getHistoryAccountSelectionValue(record) || gameUid;
    const pool = poolLookup.get(poolId);
    const account = resolveAccountForHistoryRecord(accountLookup, record);
    const isGift = isGiftRecord(record);

    if (!byPoolMap.has(poolId)) {
      byPoolMap.set(poolId, {
        poolId,
        poolName: pool?.name || poolId,
        poolType: pool?.type || 'unknown',
        poolTypeLabel: normalizePoolTypeLabel(pool?.type),
        recordCount: 0,
        pullCount: 0,
        sixStarCount: 0,
        fiveStarCount: 0,
        fourStarAndBelowCount: 0
      });
    }

    if (!byAccountMap.has(accountKey)) {
      byAccountMap.set(accountKey, {
        accountKey,
        gameUid,
        nickName: account?.nickName || gameUid,
        serverTag: account?.serverTag || null,
        recordCount: 0,
        pullCount: 0,
        sixStarCount: 0,
        fiveStarCount: 0,
        fourStarAndBelowCount: 0
      });
    }

    const poolEntry = byPoolMap.get(poolId);
    const accountEntry = byAccountMap.get(accountKey);

    poolEntry.recordCount += 1;
    accountEntry.recordCount += 1;

    if (!isGift) {
      poolEntry.pullCount += 1;
      accountEntry.pullCount += 1;
    }

    if (record?.rarity === 6) {
      poolEntry.sixStarCount += 1;
      accountEntry.sixStarCount += 1;
    } else if (record?.rarity === 5) {
      poolEntry.fiveStarCount += 1;
      accountEntry.fiveStarCount += 1;
    } else {
      poolEntry.fourStarAndBelowCount += 1;
      accountEntry.fourStarAndBelowCount += 1;
    }
  });

  const timestamps = records
    .map(getHistoryTimestampMs)
    .filter(value => value > 0)
    .sort((a, b) => a - b);

  return {
    recordCount: records.length,
    pullCount: validRecords.length,
    giftCount: records.length - validRecords.length,
    freePullCount: records.filter(normalizeIsFree).length,
    sixStarCount: validRecords.filter(record => record?.rarity === 6).length,
    fiveStarCount: validRecords.filter(record => record?.rarity === 5).length,
    fourStarAndBelowCount: validRecords.filter(record => (record?.rarity || 0) <= 4).length,
    poolCount: byPoolMap.size,
    accountCount: byAccountMap.size,
    timeRange: {
      from: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null,
      to: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : null
    },
    byPool: Array.from(byPoolMap.values()).sort((a, b) => b.recordCount - a.recordCount),
    byAccount: Array.from(byAccountMap.values()).sort((a, b) => b.recordCount - a.recordCount)
  };
}

export function normalizeExportOptions(rawOptions = {}, context = {}) {
  if (typeof rawOptions === 'string') {
    return rawOptions === 'current'
      ? {
          format: context.defaultFormat || 'json',
          poolFilter: 'current',
          poolId: null,
          accountFilter: context.currentGameUid ? 'current' : 'all',
          gameUid: context.currentGameUid || null,
          dateFrom: '',
          dateTo: ''
        }
      : {
          format: context.defaultFormat || 'json',
          poolFilter: 'all',
          poolId: null,
          accountFilter: 'all',
          gameUid: null,
          dateFrom: '',
          dateTo: ''
        };
  }

  return {
    format: rawOptions.format || context.defaultFormat || 'json',
    poolFilter: rawOptions.poolFilter || 'current',
    poolId: rawOptions.poolId || null,
    accountFilter: rawOptions.accountFilter || (context.currentGameUid ? 'current' : 'all'),
    gameUid: rawOptions.gameUid || context.currentGameUid || null,
    dateFrom: rawOptions.dateFrom || '',
    dateTo: rawOptions.dateTo || ''
  };
}

export function buildExportPayload({
  history,
  pools,
  currentPoolId,
  currentGameUid,
  currentUserId,
  options,
  characterCatalog = []
}) {
  const resolvedOptions = normalizeExportOptions(options, { currentGameUid });
  const poolLookup = buildPoolLookup(pools);
  const accountLookup = buildAccountLookup(history);
  const allowedPoolIds = resolvePoolFilterIds(resolvedOptions, pools, currentPoolId);
  const targetGameUid = resolveTargetGameUid(resolvedOptions, currentGameUid);
  const startTime = buildDateBoundary(resolvedOptions.dateFrom, false);
  const endTime = buildDateBoundary(resolvedOptions.dateTo, true);

  const filteredHistoryBeforeEntityResolution = (history || []).filter(record => {
    if (currentUserId && record?.user_id && record.user_id !== currentUserId) {
      return false;
    }

    const poolId = getHistoryPoolId(record);
    const timestamp = getHistoryTimestampMs(record);

    if (allowedPoolIds && !allowedPoolIds.has(poolId)) {
      return false;
    }

    if (targetGameUid && !isHistoryRecordInAccountScope(record, targetGameUid)) {
      return false;
    }

    if (startTime && timestamp < startTime) {
      return false;
    }

    if (endTime && timestamp > endTime) {
      return false;
    }

    return true;
  });

  const filteredHistory = enrichHistoryWithMissingItemIds(
    filteredHistoryBeforeEntityResolution,
    characterCatalog
  );

  const referencedPoolIds = new Set(filteredHistory.map(getHistoryPoolId).filter(Boolean));
  const referencedAccountKeys = new Set(filteredHistory.map(getHistoryAccountSelectionValue).filter(Boolean));
  const pityMap = buildPitySequence(filteredHistory);
  const summary = buildSummary(filteredHistory, poolLookup, accountLookup);

  const exportedPools = Array.from(referencedPoolIds)
    .map(poolId => poolLookup.get(poolId))
    .filter(Boolean);

  const exportedAccounts = Array.from(referencedAccountKeys)
    .map(accountKey => accountLookup.get(accountKey))
    .filter(Boolean);

  const exportedAccountKeys = Array.from(referencedAccountKeys);

  return {
    formatId: EXPORT_FORMAT_ID,
    formatLabel: exportFormat?.label || '站内 JSON v3',
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    filters: {
      poolFilter: resolvedOptions.poolFilter,
      poolId: resolvedOptions.poolId,
      accountFilter: resolvedOptions.accountFilter,
      gameUid: getLegacyGameUidFromSelection(targetGameUid),
      accountKey: targetGameUid || null,
      dateFrom: resolvedOptions.dateFrom || null,
      dateTo: resolvedOptions.dateTo || null
    },
    summary,
    pools: exportedPools,
    accounts: exportedAccounts,
    history: filteredHistory,
    accountKeys: exportedAccountKeys,
    pityMap
  };
}

export function buildExportJsonContent(payload) {
  return JSON.stringify({
    formatId: payload.formatId,
    formatLabel: payload.formatLabel,
    version: '3.0',
    schemaVersion: payload.schemaVersion,
    exportTime: payload.exportedAt,
    filters: payload.filters,
    summary: payload.summary,
    pools: payload.pools.map(serializeInternalJsonPool),
    accounts: payload.accounts,
    history: payload.history.map(serializeInternalJsonHistoryRecord)
  }, null, 2);
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function buildExportCsvContent(payload) {
  const poolLookup = buildPoolLookup(payload.pools);
  const accountLookup = new Map();
  (payload.accounts || []).forEach((account) => {
    const accountKey = account?.accountKey || account?.account_key || account?.gameUid;
    if (accountKey) {
      accountLookup.set(accountKey, account);
    }
    if (account?.gameUid && !accountLookup.has(account.gameUid)) {
      accountLookup.set(account.gameUid, account);
    }
  });
  const rows = (payload.history || []).map(record => {
    const poolId = getHistoryPoolId(record);
    const gameUid = getHistoryGameUid(record);
    const account = resolveAccountForHistoryRecord(accountLookup, record);
    const pool = poolLookup.get(poolId);
    const pityKey = `${getHistoryAccountSelectionValue(record) || '__all__'}::${poolId || '__unknown__'}::${getHistoryId(record)}`;
    const isoTime = getHistoryTimestampIso(record);

    return [
      payload.schemaVersion,
      payload.exportedAt,
      gameUid,
      account?.nickName || gameUid || '',
      account?.serverTag || '',
      poolId,
      pool?.name || poolId || '',
      normalizePoolTypeLabel(pool?.type),
      getHistoryId(record),
      getHistorySeqId(record),
      record?.rarity || '',
      getHistoryRecordItemName(record),
      normalizeIsStandard(record) === null ? '' : normalizeIsStandard(record) ? '常驻' : '限定',
      normalizeSpecialType(record) || '',
      normalizeIsFree(record) ? '是' : '否',
      normalizeIsNew(record) ? '是' : '否',
      payload.pityMap.get(pityKey) ?? '',
      isoTime || '',
      formatLocalTime(isoTime)
    ].map(escapeCsvValue).join(',');
  });

  const headers = [
    'schema_version',
    'exported_at',
    'game_uid',
    'nick_name',
    'server_tag',
    'pool_id',
    'pool_name',
    'pool_type',
    'record_id',
    'seq_id',
    'rarity',
    'item_name',
    'limited_or_standard',
    'special_type',
    'is_free',
    'is_new',
    'pity_at_pull',
    'timestamp_iso',
    'timestamp_local'
  ];

  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}`;
}

function escapeXmlValue(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getXlsxColumnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function formatEndfieldGachaTime(record) {
  const timestamp = getHistoryTimestampMs(record);
  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds())
  ].join('');
}

function buildEndfieldGachaSheetXml(rows) {
  const headers = ['时间', '名称', '星级', '卡池名', '卡池 ID', '是否 NEW', '是否为加急招募', 'seqId'];
  const allRows = [headers, ...rows];
  const lastRow = Math.max(1, allRows.length);
  const lastColumn = getXlsxColumnName(headers.length - 1);
  const rowXml = allRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cellXml = headers.map((_, columnIndex) => {
      const columnName = getXlsxColumnName(columnIndex);
      const value = row[columnIndex] ?? '';
      return `<c r="${columnName}${rowNumber}" t="str"><v>${escapeXmlValue(value)}</v></c>`;
    }).join('');
    return `<row r="${rowNumber}">${cellXml}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="20.83203125" customWidth="1"/><col min="2" max="2" width="24.83203125" customWidth="1"/><col min="3" max="3" width="8.83203125" customWidth="1"/><col min="4" max="4" width="24.83203125" customWidth="1"/><col min="5" max="5" width="20.83203125" customWidth="1"/><col min="6" max="6" width="12.83203125" customWidth="1"/><col min="7" max="7" width="16.83203125" customWidth="1"/><col min="8" max="8" width="24.83203125" customWidth="1"/></cols><sheetData>${rowXml}</sheetData></worksheet>`;
}

function buildEndfieldGachaWorkbookBytes(characterRows, weaponRows) {
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    'docProps/app.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Endfield Gacha Analyzer</Application></Properties>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Endfield Gacha Analyzer</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="角色记录" sheetId="1" r:id="rId1"/><sheet name="武器记录" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(buildEndfieldGachaSheetXml(characterRows)),
    'xl/worksheets/sheet2.xml': strToU8(buildEndfieldGachaSheetXml(weaponRows)),
  };

  return zipSync(files, { level: 6 });
}

function getPrimaryExportAccount(payload) {
  return (payload.accounts || [])[0] || null;
}

function sanitizeExportFileNamePart(value, fallback) {
  return String(value || fallback || 'Unknown')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 40) || fallback;
}

function buildEndfieldGachaFileName(payload) {
  const account = getPrimaryExportAccount(payload);
  const nickName = sanitizeExportFileNamePart(account?.nickName || account?.nick_name, 'Unknown');
  const gameUid = sanitizeExportFileNamePart(account?.gameUid || account?.game_uid, 'unknown');
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `Endfield_Gacha_${nickName}(${gameUid})_${stamp}.xlsx`;
}

function buildEndfieldGachaExcelContent(payload) {
  const poolLookup = buildPoolLookup(payload.pools || []);
  const characterRows = [];
  const weaponRows = [];

  (payload.history || [])
    .filter(record => !isGiftRecord(record))
    .sort((a, b) => {
      const timeDelta = getHistoryTimestampMs(b) - getHistoryTimestampMs(a);
      if (timeDelta !== 0) return timeDelta;
      return String(getHistorySeqId(b) || '').localeCompare(String(getHistorySeqId(a) || ''));
    })
    .forEach((record) => {
      const poolId = getHistoryPoolId(record) || '';
      const pool = poolLookup.get(poolId);
      const itemName = record?.item_name || record?.itemName || record?.name || record?.character_name || record?.characterName || '';
      const row = [
        formatEndfieldGachaTime(record),
        itemName,
        record?.rarity || '',
        pool?.name || poolId || '',
        poolId,
        normalizeIsNew(record) ? '是' : '否',
        normalizeIsFree(record) ? '是' : '否',
        getHistorySeqId(record) || ''
      ];

      if (isWeaponExportRecord(record, poolLookup)) {
        weaponRows.push(row);
      } else {
        characterRows.push(row);
      }
    });

  return buildEndfieldGachaWorkbookBytes(characterRows, weaponRows);
}

function getExportItemName(record) {
  return record?.item_name
    || record?.itemName
    || record?.name
    || record?.character_name
    || record?.characterName
    || '';
}

function normalizeEndgachaExportRarity(record) {
  const rarity = Number(record?.rarity);
  if (!Number.isInteger(rarity)) {
    return 3;
  }

  return Math.min(5, Math.max(3, rarity - 1));
}

function formatEndgachaTimestampKey(record) {
  const time = getHistoryTimestampMs(record);
  if (!Number.isFinite(time) || time <= 0) {
    return `${Math.floor(Date.now() / 1000)}`;
  }

  return (time / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function getEndgachaBatchKey(record) {
  return record?.batchId
    || record?.batch_id
    || `${getHistoryPoolId(record) || 'unknown'}:${formatEndgachaTimestampKey(record)}`;
}

function buildEndgachaKwerTopBatches(payload) {
  const poolLookup = buildPoolLookup(payload.pools || []);
  const batchMap = new Map();

  (payload.history || [])
    .filter(record => !isGiftRecord(record))
    .slice()
    .sort((a, b) => {
      const timeDelta = getHistoryTimestampMs(a) - getHistoryTimestampMs(b);
      if (timeDelta !== 0) return timeDelta;
      return String(getHistorySeqId(a) || '').localeCompare(String(getHistorySeqId(b) || ''));
    })
    .forEach((record) => {
      const itemName = getExportItemName(record);
      const poolId = getHistoryPoolId(record);
      if (!itemName || !poolId) {
        return;
      }

      const batchKey = getEndgachaBatchKey(record);
      if (!batchMap.has(batchKey)) {
        const pool = poolLookup.get(poolId);
        batchMap.set(batchKey, {
          timestampKey: formatEndgachaTimestampKey(record),
          poolId,
          poolName: pool?.name || poolId,
          entries: []
        });
      }

      batchMap.get(batchKey).entries.push([
        itemName,
        normalizeEndgachaExportRarity(record),
        normalizeIsNew(record) ? 1 : 0,
        normalizeIsFree(record) ? 1 : 0
      ]);
    });

  return Array.from(batchMap.values())
    .filter(batch => batch.entries.length > 0)
    .sort((a, b) => Number(a.timestampKey) - Number(b.timestampKey));
}

function buildEndgachaKwerTopPlainJsonContent(payload) {
  const output = {};

  buildEndgachaKwerTopBatches(payload).forEach((batch, index) => {
    let timestampKey = batch.timestampKey;
    let duplicateOffset = 1;
    while (Object.prototype.hasOwnProperty.call(output, timestampKey)) {
      const nextTimestamp = Number(batch.timestampKey) + duplicateOffset / 1000;
      timestampKey = Number.isFinite(nextTimestamp)
        ? nextTimestamp.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
        : `${batch.timestampKey}-${index}-${duplicateOffset}`;
      duplicateOffset += 1;
    }

    output[timestampKey] = {
      p: batch.poolName,
      pi: batch.poolId,
      c: batch.entries
    };
  });

  return JSON.stringify(output, null, 4);
}

function buildEndgachaKwerTopPlainTxtContent(payload) {
  return buildEndgachaKwerTopBatches(payload)
    .map((batch) => {
      const entries = batch.entries
        .map(([name, rarity, isNew]) => `${name}-${rarity}-${isNew}`)
        .join('@');
      return `${batch.timestampKey},${batch.poolName},${entries}`;
    })
    .join('\n');
}

function buildEndgachaKwerTopFileName(extension) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `endgacha-kwer-top-export-${stamp}.${extension}`;
}

function normalizeEndfieldGachaLocalKeyPart(value, fallback = 'unknown') {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || fallback;
}

function buildEndfieldGachaLocalAccountKey(account = {}, gameUid = '') {
  const roleId = normalizeEndfieldGachaLocalKeyPart(account.gameUid || account.game_uid || gameUid, 'unknown');
  const legacyChannelMasterId = String(account.channelMasterId || account.channel_master_id || '').trim();
  const hgUid = normalizeEndfieldGachaLocalKeyPart(
    account.hgUid
      || account.hg_uid
      || account.uid
      || (!['1', '2'].includes(legacyChannelMasterId) ? legacyChannelMasterId : '')
      || account.serverId
      || account.server_id
      || 'import',
    'import'
  );
  return `${hgUid}_${roleId}`;
}

function normalizeEndfieldGachaPoolType(poolType) {
  switch (poolType) {
    case 'standard':
    case 'constant':
      return 'constant';
    case 'beginner':
      return 'beginner';
    case 'extra':
    case 'joint':
      return 'joint';
    default:
      return 'special';
  }
}

function getEndfieldGachaCharacterPoolBucket(poolType) {
  switch (normalizeEndfieldGachaPoolType(poolType)) {
    case 'constant':
      return 'E_CharacterGachaPoolType_Standard';
    case 'beginner':
      return 'E_CharacterGachaPoolType_Beginner';
    case 'joint':
      return 'E_CharacterGachaPoolType_Joint';
    default:
      return 'E_CharacterGachaPoolType_Special';
  }
}

function getEndfieldGachaRecordItemName(record) {
  return getHistoryRecordItemName(record);
}

function getEndfieldGachaRecordItemId(record) {
  return getHistoryRecordItemId(record);
}

function getEndfieldGachaTimestampText(record) {
  const timestamp = getHistoryTimestampMs(record);
  return timestamp > 0 ? String(timestamp) : String(Date.now());
}

function getEndfieldGachaMaxSeqId(records) {
  const maxSeqId = records.reduce((maxValue, record) => {
    const seqId = Number.parseInt(getHistorySeqId(record) || '', 10);
    return Number.isFinite(seqId) ? Math.max(maxValue, seqId) : maxValue;
  }, 0);
  return maxSeqId > 0 ? String(maxSeqId) : String(records.length);
}

function buildEndfieldGachaPoolInfo(payload, poolLookup) {
  const poolIds = new Set((payload.history || []).map(getHistoryPoolId).filter(Boolean));
  return Array.from(poolIds).map((poolId) => {
    const pool = poolLookup.get(poolId) || {};
    const isWeapon = pool?.type === 'weapon'
      || pool?.type === 'limited_weapon'
      || String(poolId).toLowerCase().startsWith('weaponbox')
      || String(poolId).toLowerCase().startsWith('weponbox');

    return {
      pool_gacha_type: isWeapon ? 'weapon' : 'char',
      pool_id: poolId,
      pool_name: pool.name || pool.pool_name || poolId,
      pool_type: normalizeEndfieldGachaPoolType(pool.type || pool.pool_type),
      up6_id: pool.up6_id || pool.upCharacterId || pool.up_character_id || pool.up_character || pool.upWeaponId || pool.up_weapon_id || ''
    };
  });
}

function buildEndfieldGachaUserDataRecords(payload, gameUid) {
  const poolLookup = buildPoolLookup(payload.pools || []);
  const character = {
    E_CharacterGachaPoolType_Beginner: [],
    E_CharacterGachaPoolType_Joint: [],
    E_CharacterGachaPoolType_Special: [],
    E_CharacterGachaPoolType_Standard: []
  };
  const weapon = {};
  const records = (payload.history || [])
    .filter(record => !isGiftRecord(record) && getHistoryGameUid(record) === gameUid)
    .sort((a, b) => {
      const timeDelta = getHistoryTimestampMs(b) - getHistoryTimestampMs(a);
      if (timeDelta !== 0) return timeDelta;
      return String(getHistorySeqId(b) || '').localeCompare(String(getHistorySeqId(a) || ''));
    });

  records.forEach((record) => {
    const poolId = getHistoryPoolId(record) || '';
    const pool = poolLookup.get(poolId);
    const poolName = pool?.name || pool?.pool_name || poolId;
    const base = {
      gachaTs: getEndfieldGachaTimestampText(record),
      isNew: normalizeIsNew(record),
      poolId,
      poolName,
      rarity: Number(record?.rarity || 0),
      seqId: getHistorySeqId(record) || ''
    };

    if (isWeaponExportRecord(record, poolLookup)) {
      if (!weapon[poolId]) {
        weapon[poolId] = [];
      }
      weapon[poolId].push({
        ...base,
        weaponId: getEndfieldGachaRecordItemId(record),
        weaponName: getEndfieldGachaRecordItemName(record),
        weaponType: record?.weapon_type || record?.weaponType || record?.item_type || record?.itemType || ''
      });
      return;
    }

    character[getEndfieldGachaCharacterPoolBucket(pool?.type)].push({
      charId: getEndfieldGachaRecordItemId(record),
      charName: getEndfieldGachaRecordItemName(record),
      ...base,
      isFree: normalizeIsFree(record)
    });
  });

  return {
    character,
    character_max_seqid: getEndfieldGachaMaxSeqId(Object.values(character).flat()),
    weapon,
    weapon_max_seqid: getEndfieldGachaMaxSeqId(Object.values(weapon).flat())
  };
}

function buildEndfieldGachaUserDataConfig(accounts) {
  return {
    currentUser: accounts[0]?.key || '',
    theme: 'system',
    updateSeenVersion: '',
    users: accounts.map(({ account, gameUid, key }) => {
      const serverId = String(account.serverId || account.server_id || '1');
      const provider = normalizeExportProvider(account);
      const legacyChannelMasterId = String(account.channelMasterId || account.channel_master_id || '').trim();
      const authUid = String(
        account.hgUid
          || account.hg_uid
          || account.uid
          || (!['1', '2'].includes(legacyChannelMasterId) ? legacyChannelMasterId : '')
          || ''
      );
      return {
        key,
        provider,
        roleId: {
          nickName: account.nickName || account.nick_name || gameUid,
          roleId: String(gameUid),
          serverId,
          serverName: account.region || account.serverTag || (provider === 'hypergryph' ? 'China' : '')
        },
        source: 'import',
        token: '',
        uid: authUid
      };
    }),
    webdav: {
      autoSync: false,
      basePath: '/endfield-gacha',
      baseUrl: '',
      password: '',
      silentAutoSync: true,
      username: ''
    },
    webdavState: {}
  };
}

function buildEndfieldGachaUserDataZipFileName(payload) {
  const account = getPrimaryExportAccount(payload);
  const nickName = sanitizeExportFileNamePart(account?.nickName || account?.nick_name, 'Unknown');
  const gameUid = sanitizeExportFileNamePart(account?.gameUid || account?.game_uid, 'unknown');
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `EndfieldGacha_userData_${nickName}(${gameUid})_${stamp}.zip`;
}

function buildEndfieldGachaUserDataZipContent(payload) {
  const poolLookup = buildPoolLookup(payload.pools || []);
  const accountLookup = new Map((payload.accounts || []).map(account => [account.gameUid || account.game_uid, account]));
  const gameUids = Array.from(new Set((payload.history || []).map(getHistoryGameUid).filter(Boolean)));
  const accounts = gameUids.map((gameUid) => {
    const account = accountLookup.get(gameUid) || { gameUid, nickName: gameUid };
    return {
      account,
      gameUid,
      key: buildEndfieldGachaLocalAccountKey(account, gameUid)
    };
  });

  const files = {
    'userData/config.json': strToU8(`${JSON.stringify(buildEndfieldGachaUserDataConfig(accounts), null, 2)}\n`),
    'userData/gachaData/poolInfo.json': strToU8(`${JSON.stringify(buildEndfieldGachaPoolInfo(payload, poolLookup), null, 2)}\n`)
  };

  accounts.forEach(({ gameUid, key }) => {
    files[`userData/gachaData/${key}.json`] = strToU8(`${JSON.stringify(buildEndfieldGachaUserDataRecords(payload, gameUid), null, 2)}\n`);
  });

  return zipSync(files, { level: 6 });
}

function normalizeExportProvider(account = {}) {
  const signal = `${account.serverTag || ''} ${account.channelName || ''} ${account.region || ''}`.toLowerCase();
  return /国际|intl|global|gryphline|asia|eu|na/.test(signal) ? 'gryphline' : 'hypergryph';
}

function getExportServerId(account = {}, fallback = '1') {
  return String(account.serverId || account.server_id || fallback || '1');
}

function pickExportText(...values) {
  return values
    .map(value => String(value ?? '').trim())
    .find(Boolean) || '';
}

function isLikelyEndfieldGachaHelperHgUid(value, gameUid = '') {
  const text = String(value ?? '').trim();
  const roleId = String(gameUid ?? '').trim();

  if (!text || text.includes(':') || text.includes('@')) {
    return false;
  }

  if (roleId && text === roleId) {
    return false;
  }

  return /^\d{5,}$/.test(text);
}

function resolveEndfieldGachaHelperHgUid(gameUid, ...sources) {
  const candidates = sources.flatMap(source => [
    source?.hgUid,
    source?.hg_uid,
    source?.bindingUid,
    source?.binding_uid,
    source?.uid,
    source?.channelUid,
    source?.channel_uid,
    source?.channelMasterId,
    source?.channel_master_id
  ]);

  return candidates
    .map(value => String(value ?? '').trim())
    .find(value => isLikelyEndfieldGachaHelperHgUid(value, gameUid)) || '';
}

function buildEndfieldGachaHelperUid(gameUid, account = {}) {
  const text = String(gameUid || '').trim();
  if (!text) {
    return '';
  }
  if (/^\d+:.+/.test(text)) {
    return text;
  }
  return `${getExportServerId(account)}:${text}`;
}

function buildEndfieldGachaHelperAccounts(payload) {
  const accountMap = new Map();
  const now = Date.now();

  (payload.accounts || []).forEach((account) => {
    const gameUid = account?.gameUid || account?.game_uid;
    if (!gameUid) {
      return;
    }

    const provider = normalizeExportProvider(account);
    const serverId = getExportServerId(account);
    const helperUid = buildEndfieldGachaHelperUid(gameUid, { ...account, serverId });
    const hgUid = resolveEndfieldGachaHelperHgUid(gameUid, account);
    const role = {
      roleId: gameUid,
      nickName: account.nickName || account.nick_name || gameUid,
      level: 0,
      serverId,
      serverName: account.region || account.serverTag || '',
      isDefault: true,
      isBanned: false,
      registerTs: 0
    };

    accountMap.set(gameUid, {
      uid: helperUid,
      provider,
      ...(hgUid ? { hgUid } : {}),
      roleId: gameUid,
      serverId,
      channelName: account.channelName || account.channel_name || provider,
      roles: [role],
      addedAt: now
    });
  });

  (payload.history || []).forEach((record) => {
    const gameUid = getHistoryGameUid(record);
    if (!gameUid || accountMap.has(gameUid)) {
      return;
    }

    const serverId = getExportServerId(record, '');
    const hgUid = resolveEndfieldGachaHelperHgUid(gameUid, record);
    accountMap.set(gameUid, {
      uid: buildEndfieldGachaHelperUid(gameUid, record),
      provider: 'hypergryph',
      ...(hgUid ? { hgUid } : {}),
      roleId: gameUid,
      serverId,
      channelName: record?.channel_name || record?.channelName || '',
      roles: [{
        roleId: gameUid,
        nickName: record?.nick_name || record?.nickName || gameUid,
        level: 0,
        serverId,
        serverName: record?.region || '',
        isDefault: true,
        isBanned: false,
        registerTs: 0
      }],
      addedAt: now
    });
  });

  return Array.from(accountMap.values());
}

function isWeaponExportRecord(record, poolLookup) {
  const pool = poolLookup.get(getHistoryPoolId(record));
  return pool?.type === 'weapon' || pool?.type === 'limited_weapon';
}

function buildEndfieldGachaHelperRecordGroups(payload) {
  const poolLookup = buildPoolLookup(payload.pools || []);
  const now = Date.now();
  const accountLookup = new Map((payload.accounts || []).map(account => [account.gameUid || account.game_uid, account]));
  const records = [];
  const weaponRecords = [];

  (payload.history || [])
    .filter(record => !isGiftRecord(record))
    .forEach((record, index) => {
      const poolId = getHistoryPoolId(record) || '';
      const pool = poolLookup.get(poolId);
      const isoTime = getHistoryTimestampIso(record) || new Date(now).toISOString();
      const rawGameUid = getHistoryGameUid(record) || 'unknown';
      const helperUid = buildEndfieldGachaHelperUid(rawGameUid, accountLookup.get(rawGameUid) || record);
      const recordUid = String(getHistoryId(record) || getHistorySeqId(record) || `${poolId}:${record?.item_name || record?.name || index}`);
      const seqId = getHistorySeqId(record) || '';
      const itemId = getHistoryRecordItemId(record);
      const itemName = record?.item_name || record?.itemName || record?.name || record?.character_name || record?.characterName || '';
      const base = {
        uid: helperUid,
        recordUid: `${helperUid}_${isWeaponExportRecord(record, poolLookup) ? 'weapon' : 'char'}_${recordUid}`,
        fetchedAt: now,
        poolId,
        poolName: pool?.name || poolId || '未知卡池',
        rarity: record?.rarity || 0,
        isNew: normalizeIsNew(record),
        gachaTs: String(new Date(isoTime).getTime()),
        seqId
      };

      if (isWeaponExportRecord(record, poolLookup)) {
        weaponRecords.push({
          ...base,
          category: 'weapon',
          weaponId: itemId,
          weaponName: itemName,
          weaponType: ''
        });
        return;
      }

      records.push({
        ...base,
        category: 'character',
        charId: itemId,
        charName: itemName,
        isFree: normalizeIsFree(record)
      });
    });

  return { records, weaponRecords };
}

function buildEndfieldGachaHelperJsonContent(payload) {
  const { records, weaponRecords } = buildEndfieldGachaHelperRecordGroups(payload);

  return JSON.stringify({
    schemaVersion: 2,
    exportedAt: Date.now(),
    accounts: buildEndfieldGachaHelperAccounts(payload),
    records,
    weaponRecords
  }, null, 2);
}

function buildEndfieldGachaHelperCsvContent(payload) {
  const { records, weaponRecords } = buildEndfieldGachaHelperRecordGroups(payload);
  const rows = [...records, ...weaponRecords].map(record => {
    const isWeapon = record.category === 'weapon';
    return [
      record.recordUid,
      record.uid,
      record.category,
      record.poolId,
      record.poolName,
      isWeapon ? record.weaponId : record.charId,
      isWeapon ? record.weaponName : record.charName,
      isWeapon ? record.weaponType || '' : '',
      record.rarity,
      record.isNew ? 1 : 0,
      record.isFree ? 1 : 0,
      record.gachaTs,
      record.seqId,
      record.fetchedAt
    ].map(escapeCsvValue).join(',');
  });
  const headers = [
    'recordUid',
    'uid',
    'category',
    'poolId',
    'poolName',
    'itemId',
    'itemName',
    'itemType',
    'rarity',
    'isNew',
    'isFree',
    'gachaTs',
    'seqId',
    'fetchedAt'
  ];

  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}`;
}

function buildEndfieldGachaHelperUserDataZipFileName(payload) {
  const account = getPrimaryExportAccount(payload);
  const nickName = sanitizeExportFileNamePart(account?.nickName || account?.nick_name, 'Unknown');
  const gameUid = sanitizeExportFileNamePart(account?.gameUid || account?.game_uid, 'unknown');
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `EndfieldGachaHelper_userdata_${nickName}(${gameUid})_${stamp}.zip`;
}

function runEndfieldGachaHelperSqliteStatement(db, sql, rows) {
  const stmt = db.prepare(sql);
  try {
    rows.forEach(row => stmt.run(row));
  } finally {
    stmt.free();
  }
}

function buildEndfieldGachaHelperSqliteBytes(SQL, payload) {
  const db = new SQL.Database();
  const accounts = buildEndfieldGachaHelperAccounts(payload);
  const { records, weaponRecords } = buildEndfieldGachaHelperRecordGroups(payload);

  db.run(`
    CREATE TABLE accounts (
      uid TEXT PRIMARY KEY,
      hg_uid TEXT,
      provider TEXT,
      channel_name TEXT NOT NULL,
      roles TEXT NOT NULL,
      added_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE gacha_records (
      record_uid TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      pool_id TEXT NOT NULL,
      pool_name TEXT NOT NULL,
      char_id TEXT NOT NULL,
      char_name TEXT NOT NULL,
      rarity INTEGER NOT NULL,
      is_new INTEGER NOT NULL,
      is_free INTEGER NOT NULL,
      gacha_ts TEXT NOT NULL,
      seq_id TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'character',
      FOREIGN KEY (uid) REFERENCES accounts(uid)
    )
  `);
  db.run(`
    CREATE TABLE weapon_records (
      record_uid TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      pool_id TEXT NOT NULL,
      pool_name TEXT NOT NULL,
      weapon_id TEXT NOT NULL,
      weapon_name TEXT NOT NULL,
      weapon_type TEXT NOT NULL,
      rarity INTEGER NOT NULL,
      is_new INTEGER NOT NULL,
      gacha_ts TEXT NOT NULL,
      seq_id TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'weapon',
      FOREIGN KEY (uid) REFERENCES accounts(uid)
    )
  `);

  runEndfieldGachaHelperSqliteStatement(
    db,
    'INSERT OR REPLACE INTO accounts (uid, hg_uid, provider, channel_name, roles, added_at) VALUES (?, ?, ?, ?, ?, ?)',
    accounts.map(account => [
      account.uid,
      account.hgUid || null,
      account.provider || 'hypergryph',
      pickExportText(account.channelName, account.channel_name, account.provider, 'hypergryph'),
      JSON.stringify(account.roles || []),
      Number(account.addedAt || Date.now())
    ])
  );

  runEndfieldGachaHelperSqliteStatement(
    db,
    `INSERT OR IGNORE INTO gacha_records
      (record_uid, uid, pool_id, pool_name, char_id, char_name, rarity, is_new, is_free, gacha_ts, seq_id, fetched_at, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    records.map(record => [
      record.recordUid,
      record.uid,
      record.poolId,
      record.poolName,
      record.charId || '',
      record.charName || '',
      Number(record.rarity || 0),
      record.isNew ? 1 : 0,
      record.isFree ? 1 : 0,
      String(record.gachaTs || ''),
      String(record.seqId || ''),
      Number(record.fetchedAt || Date.now()),
      'character'
    ])
  );

  runEndfieldGachaHelperSqliteStatement(
    db,
    `INSERT OR IGNORE INTO weapon_records
      (record_uid, uid, pool_id, pool_name, weapon_id, weapon_name, weapon_type, rarity, is_new, gacha_ts, seq_id, fetched_at, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    weaponRecords.map(record => [
      record.recordUid,
      record.uid,
      record.poolId,
      record.poolName,
      record.weaponId || '',
      record.weaponName || '',
      record.weaponType || '',
      Number(record.rarity || 0),
      record.isNew ? 1 : 0,
      String(record.gachaTs || ''),
      String(record.seqId || ''),
      Number(record.fetchedAt || Date.now()),
      'weapon'
    ])
  );

  db.run('CREATE INDEX idx_gacha_uid ON gacha_records(uid)');
  db.run('CREATE INDEX idx_gacha_ts ON gacha_records(gacha_ts)');
  db.run('CREATE INDEX idx_weapon_uid ON weapon_records(uid)');
  db.run('CREATE INDEX idx_weapon_ts ON weapon_records(gacha_ts)');

  const bytes = db.export();
  db.close();
  return bytes;
}

async function buildEndfieldGachaHelperUserDataZipContent(payload) {
  const SQL = await loadEndfieldGachaHelperSqlJs();
  const databaseBytes = buildEndfieldGachaHelperSqliteBytes(SQL, payload);

  return zipSync({
    'userdata/efgacha.db': databaseBytes
  }, { level: 6 });
}

export async function buildExportContent(formatId, payload) {
  const format = getDataFormatById(formatId);
  if (!format) {
    throw new Error(`不支持的导出格式: ${formatId}`);
  }

  if (formatId === EXPORT_FORMAT_ID) {
    return {
      content: buildExportJsonContent(payload),
      mimeType: 'application/json',
      extension: 'json',
      format,
    };
  }

  if (formatId === EXPORT_CSV_FORMAT_ID) {
    return {
      content: buildExportCsvContent(payload),
      mimeType: 'text/csv;charset=utf-8;',
      extension: 'csv',
      format,
    };
  }

  if (formatId === EXPORT_ENDFIELD_GACHA_XLSX_FORMAT_ID) {
    return {
      content: buildEndfieldGachaExcelContent(payload),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      fileName: buildEndfieldGachaFileName(payload),
      format,
    };
  }

  if (formatId === EXPORT_ENDFIELD_GACHA_USERDATA_ZIP_FORMAT_ID) {
    return {
      content: buildEndfieldGachaUserDataZipContent(payload),
      mimeType: 'application/zip',
      extension: 'zip',
      fileName: buildEndfieldGachaUserDataZipFileName(payload),
      format,
    };
  }

  if (formatId === EXPORT_EFGH_JSON_FORMAT_ID) {
    return {
      content: buildEndfieldGachaHelperJsonContent(payload),
      mimeType: 'application/json',
      extension: 'endfieldgacha.json',
      format,
    };
  }

  if (formatId === EXPORT_EFGH_CSV_FORMAT_ID) {
    return {
      content: buildEndfieldGachaHelperCsvContent(payload),
      mimeType: 'text/csv;charset=utf-8;',
      extension: 'csv',
      format,
    };
  }

  if (formatId === EXPORT_EFGH_USERDATA_ZIP_FORMAT_ID) {
    return {
      content: await buildEndfieldGachaHelperUserDataZipContent(payload),
      mimeType: 'application/zip',
      extension: 'zip',
      fileName: buildEndfieldGachaHelperUserDataZipFileName(payload),
      format,
    };
  }

  if (formatId === EXPORT_ENDGACHA_KWER_TOP_PLAIN_JSON_FORMAT_ID) {
    return {
      content: buildEndgachaKwerTopPlainJsonContent(payload),
      mimeType: 'application/json',
      extension: 'json',
      fileName: buildEndgachaKwerTopFileName('json'),
      format,
    };
  }

  if (formatId === EXPORT_ENDGACHA_KWER_TOP_PLAIN_TXT_FORMAT_ID) {
    return {
      content: buildEndgachaKwerTopPlainTxtContent(payload),
      mimeType: 'text/plain;charset=utf-8;',
      extension: 'txt',
      fileName: buildEndgachaKwerTopFileName('txt'),
      format,
    };
  }

  throw new Error(`导出格式尚未实现内容构建: ${formatId}`);
}
