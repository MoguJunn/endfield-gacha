import { readStorageValue, STORAGE_KEYS, writeStorageValue } from './storageUtils.js';

function safeParseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

export function normalizeMetadataTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const numericValue = value < 1e12 ? value * 1000 : value;
    return new Date(numericValue).toISOString();
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const numericValue = numeric < 1e12 ? numeric * 1000 : numeric;
    return new Date(numericValue).toISOString();
  }

  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return new Date(parsed).toISOString();
}

export function getHistoryRecordGameUid(record) {
  return normalizeString(record?.game_uid || record?.gameUid || record?.hg_uid || record?.hgUid);
}

export function normalizeGameAccountServerId(metadata = {}) {
  const serverId = normalizeString(metadata.serverId || metadata.server_id);
  const normalizedServerId = (serverId || '').toLowerCase();
  const channelMasterId = normalizeString(metadata.channelMasterId || metadata.channel_master_id);
  const source = normalizeString(metadata.source || metadata.importSource || metadata.lastImportSource);
  const region = normalizeString(metadata.region || metadata.serverRegion || metadata.serverName);
  const serverTag = normalizeString(
    metadata.serverTag
      || metadata.server_tag
      || metadata.serverLabel
      || metadata.server_label
  );
  const signal = `${source || ''} ${region || ''} ${serverTag || ''}`.toLowerCase();

  if (
    normalizedServerId === 'bilibili'
    || normalizedServerId === 'bili'
    || normalizedServerId === 'cn-b'
    || ((normalizedServerId === '1' || !normalizedServerId) && channelMasterId === '2')
    || /b服|bilibili|bili/.test(signal)
  ) {
    return 'bilibili';
  }

  if (/(^|[^a-z])(cn|china|mainland)([^a-z]|$)|国服|官服|b服|大陆|官方/.test(signal)) {
    return '1';
  }

  if (/(^|[^a-z])(eu|na|us)([^a-z]|$)|america|europe|global|欧\/美|欧美|欧服|美服/.test(signal)) {
    return '3';
  }

  if (/(^|[^a-z])(asia|sea|jp|kr|tw|hk|mo|sg)([^a-z]|$)|亚服|亚洲/.test(signal)) {
    return '2';
  }

  if (serverId) {
    return serverId;
  }

  return null;
}

export function normalizeGameAccountRegion(metadata = {}) {
  const rawRegion = normalizeString(metadata.region || metadata.serverRegion || metadata.serverName);
  const serverId = normalizeGameAccountServerId(metadata);
  const channelName = normalizeString(metadata.channelName || metadata.channel_name);
  const source = normalizeString(metadata.source || metadata.importSource || metadata.lastImportSource);
  const signal = `${rawRegion || ''} ${serverId || ''} ${channelName || ''} ${source || ''}`.toLowerCase();

  if (
    serverId === '1'
    || serverId === 'bilibili'
    || /(^|[^a-z])(cn|china|mainland)([^a-z]|$)|国服|官服|b服|大陆|官方/.test(signal)
  ) {
    return 'cn';
  }

  if (
    serverId === '2'
    || serverId === '3'
    || /intl|international|global|asia|sea|jp|kr|tw|hk|mo|sg|亚服|亚洲|(^|[^a-z])(eu|na|us)([^a-z]|$)|america|欧\/美|欧美|欧服|美服|国际/.test(signal)
  ) {
    return 'intl';
  }

  return rawRegion || null;
}

function buildAccountDiscriminator(metadata = {}) {
  const channelMasterId = normalizeString(metadata.channelMasterId || metadata.channel_master_id);
  const serverId = normalizeGameAccountServerId(metadata);
  const region = normalizeGameAccountRegion(metadata);

  if (serverId === '2' || serverId === '3') {
    return `server:${serverId}`;
  }

  if (channelMasterId === '2' || serverId === 'bilibili') {
    return 'channel:2';
  }

  if (serverId) {
    return `server:${serverId}`;
  }

  if (region === 'cn' || region === 'intl') {
    return `region:${region}`;
  }

  return null;
}

export function buildGameAccountKey(metadata = {}) {
  const gameUid = getHistoryRecordGameUid(metadata) || normalizeString(metadata.uid);
  if (!gameUid) {
    return null;
  }

  const discriminator = buildAccountDiscriminator(metadata);
  return discriminator ? `${gameUid}::${discriminator}` : gameUid;
}

export function getHistoryRecordAccountKey(record) {
  return buildGameAccountKey(record);
}

export function getGameAccountSelectionValue(account = {}) {
  return normalizeString(account.accountKey || account.account_key)
    || buildGameAccountKey(account)
    || getHistoryRecordGameUid(account)
    || normalizeString(account.uid);
}

export function isGameAccountSelectionMatch(target = {}, selectedValue = null) {
  const selected = normalizeString(selectedValue);
  if (!selected) {
    return false;
  }

  const accountKey = getGameAccountSelectionValue(target);
  const gameUid = getHistoryRecordGameUid(target) || normalizeString(target.uid);
  return selected === accountKey || selected === gameUid;
}

export function buildHistorySeqDedupeKey(record = {}) {
  return buildHistorySeqDedupeKeys(record)[0] || null;
}

export function buildHistorySeqDedupeKeys(record = {}) {
  const seqId = normalizeString(record.seqId || record.seq_id);
  if (!seqId) {
    return [];
  }

  const accountValue = getGameAccountSelectionValue(record) || 'unknown';
  const poolId = normalizeString(record.poolId || record.pool_id) || 'unknown';
  const legacyGameUid = getHistoryRecordGameUid(record) || normalizeString(record.uid) || 'unknown';
  if (accountValue && accountValue !== legacyGameUid) {
    return [`${accountValue}:${poolId}:${seqId}`];
  }

  return [`${legacyGameUid}:${poolId}:${seqId}`];
}

export function getHistoryRecordTimestampMs(record) {
  const raw = record?.timestamp ?? record?.gacha_time ?? record?.created_at;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw < 1e12 ? raw * 1000 : raw;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }

  const parsed = new Date(raw || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeGameAccountMetadata(metadata = {}) {
  const gameUid = normalizeString(metadata.gameUid || metadata.game_uid || metadata.hgUid || metadata.hg_uid);
  if (!gameUid) {
    return null;
  }

  const rawHgUid = normalizeString(metadata.hgUid || metadata.hg_uid || metadata.bindingUid || metadata.binding_uid);
  const hgUid = rawHgUid && rawHgUid !== gameUid ? rawHgUid : null;
  const channelMasterId = normalizeString(metadata.channelMasterId || metadata.channel_master_id);
  const channelName = normalizeString(metadata.channelName || metadata.channel_name);
  const serverId = normalizeGameAccountServerId({ ...metadata, channelMasterId, channelName });
  const region = normalizeGameAccountRegion({ ...metadata, serverId, channelMasterId, channelName });
  const nickName = normalizeString(metadata.nickName || metadata.nick_name) || gameUid;
  const lastImportedAt = normalizeMetadataTimestamp(
    metadata.lastImportedAt
      || metadata.last_imported_at
      || metadata.lastImportAt
  );
  const lastImportedRecordAt = normalizeMetadataTimestamp(
    metadata.lastImportedRecordAt
      || metadata.last_imported_record_at
      || metadata.latestRecordAt
      || metadata.latest_record_at
  );
  const lastImportSource = normalizeString(
    metadata.lastImportSource
      || metadata.last_import_source
      || metadata.importSource
      || metadata.import_source
  );
  const isOfficial = metadata.isOfficial === true || metadata.is_official === true
    ? true
    : metadata.isOfficial === false || metadata.is_official === false
      ? false
      : null;

  return {
    accountKey: buildGameAccountKey({ ...metadata, gameUid, serverId, region, channelMasterId, channelName }),
    gameUid,
    nickName,
    hgUid,
    channelMasterId,
    channelName,
    serverId,
    region,
    isOfficial,
    lastImportedAt,
    lastImportedRecordAt,
    lastImportSource
  };
}

export function loadGameAccountMetadataMap() {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  return safeParseJSON(readStorageValue(STORAGE_KEYS.ACCOUNT_METADATA, null, { raw: true }), {}) || {};
}

export function saveGameAccountMetadata(metadata) {
  if (typeof localStorage === 'undefined') {
    return false;
  }

  const normalized = normalizeGameAccountMetadata(metadata);
  if (!normalized) {
    return false;
  }

  const currentMap = loadGameAccountMetadataMap();
  const accountKey = normalized.accountKey || normalized.gameUid;
  const previousAccountKey = normalizeString(metadata.accountKey || metadata.account_key);
  if (previousAccountKey && previousAccountKey !== accountKey && previousAccountKey !== normalized.gameUid) {
    delete currentMap[previousAccountKey];
  }
  currentMap[accountKey] = {
    ...(currentMap[normalized.gameUid] || {}),
    ...(currentMap[accountKey] || {}),
    ...normalized
  };
  if (accountKey === normalized.gameUid) {
    currentMap[normalized.gameUid] = {
      ...(currentMap[normalized.gameUid] || {}),
      ...normalized
    };
  } else if (!currentMap[normalized.gameUid]) {
    currentMap[normalized.gameUid] = {
      ...normalized,
      accountKey
    };
  } else {
    currentMap[normalized.gameUid] = {
      ...(currentMap[normalized.gameUid] || {}),
      lastImportedAt: normalized.lastImportedAt || currentMap[normalized.gameUid]?.lastImportedAt || null,
      lastImportedRecordAt: normalized.lastImportedRecordAt || currentMap[normalized.gameUid]?.lastImportedRecordAt || null,
      lastImportSource: normalized.lastImportSource || currentMap[normalized.gameUid]?.lastImportSource || null
    };
  }
  writeStorageValue(STORAGE_KEYS.ACCOUNT_METADATA, JSON.stringify(currentMap), { raw: true });
  return true;
}

function buildAccountMetadataFromHistoryRecord(record) {
  return normalizeGameAccountMetadata({
    gameUid: getHistoryRecordGameUid(record),
    nickName: record?.nick_name || record?.nickName,
    channelName: record?.channel_name || record?.channelName,
    hgUid: record?.hg_uid || record?.hgUid,
    channelMasterId: record?.channel_master_id || record?.channelMasterId,
    serverId: record?.server_id || record?.serverId,
    region: record?.region || record?.serverRegion,
    isOfficial: record?.is_official ?? record?.isOfficial
  });
}

function getMetadataTimestampMs(value) {
  const normalized = normalizeMetadataTimestamp(value);
  if (!normalized) {
    return null;
  }

  return new Date(normalized).getTime();
}

export function buildImportedGameAccountMetadataEntries({
  accounts = [],
  historyRecords = [],
  importedAt = null,
  importSource = null
} = {}) {
  const accountMap = new Map();
  const normalizedImportedAt = normalizeMetadataTimestamp(importedAt) || new Date().toISOString();
  const normalizedImportSource = normalizeString(importSource);

  const upsertAccount = (seedMetadata) => {
    const normalized = normalizeGameAccountMetadata(seedMetadata);
    if (!normalized) {
      return null;
    }

    const accountKey = normalized.accountKey || normalized.gameUid;
    const existing = accountMap.get(accountKey) || accountMap.get(normalized.gameUid);
    const merged = normalizeGameAccountMetadata({
      ...(existing || {}),
      ...normalized,
      lastImportedAt: normalized.lastImportedAt || existing?.lastImportedAt || normalizedImportedAt,
      lastImportedRecordAt: normalized.lastImportedRecordAt || existing?.lastImportedRecordAt,
      lastImportSource: normalized.lastImportSource || existing?.lastImportSource || normalizedImportSource
    });

    accountMap.set(merged.accountKey || merged.gameUid, merged);
    return merged;
  };

  (Array.isArray(accounts) ? accounts : []).forEach((account) => {
    upsertAccount(account);
  });

  (Array.isArray(historyRecords) ? historyRecords : []).forEach((record) => {
    const gameUid = getHistoryRecordGameUid(record);
    if (!gameUid) {
      return;
    }

    const merged = upsertAccount({
      ...(accountMap.get(buildGameAccountKey(record) || gameUid) || accountMap.get(gameUid) || {}),
      ...(buildAccountMetadataFromHistoryRecord(record) || {}),
      gameUid
    });

    if (!merged) {
      return;
    }

    const recordTimestampMs = getHistoryRecordTimestampMs(record);
    if (!recordTimestampMs) {
      return;
    }

    const currentLatestMs = getMetadataTimestampMs(merged.lastImportedRecordAt);
    if (!currentLatestMs || recordTimestampMs > currentLatestMs) {
      accountMap.set(merged.accountKey || merged.gameUid, {
        ...merged,
        lastImportedRecordAt: new Date(recordTimestampMs).toISOString()
      });
    }
  });

  return Array.from(accountMap.values());
}

export function buildGameAccountServerTag(metadata = {}) {
  const normalized = normalizeGameAccountMetadata(metadata);
  if (!normalized) {
    return null;
  }

  const channelName = (normalized.channelName || '').toLowerCase();
  const serverId = (normalized.serverId || '').toLowerCase();
  const region = (normalized.region || '').toLowerCase();
  const signal = `${channelName} ${serverId} ${region}`;

  if (serverId === '2') {
    return '国际服·亚服';
  }

  if (serverId === '3') {
    return '国际服·欧/美服';
  }

  if (normalized.channelMasterId === '2' || serverId === 'bilibili' || /b服|bilibili|bili/.test(signal)) {
    return 'B服';
  }

  if (
    /asia|sea|jp|kr|tw|hk|mo|sg|亚服|亚洲/.test(signal)
  ) {
    return '国际服·亚服';
  }

  if (
    /(^|[^a-z])(eu|na|us)([^a-z]|$)|america|europe|global|欧\/美|欧美|欧服|美服/.test(signal)
  ) {
    return '国际服·欧/美服';
  }

  if (region === 'intl' || /intl|international|global|国际|海外/.test(signal)) {
    return '国际服';
  }

  if (
    normalized.channelMasterId === '1' ||
    normalized.isOfficial === true ||
    /官服|official|gryphline|hypergryph|鹰角/.test(signal)
  ) {
    return '官服';
  }

  if (serverId && serverId !== '1') {
    return '国际服';
  }

  if (/intl|international|global|国际|海外/.test(signal)) {
    return '国际服';
  }

  return null;
}

export function localizeGameAccountServerTag(serverTag, locale = 'zh-CN') {
  const normalizedTag = normalizeString(serverTag);
  if (!normalizedTag) {
    return null;
  }

  const normalizedLocale = String(locale || '').toLowerCase();
  if (!normalizedLocale.startsWith('en')) {
    return normalizedTag;
  }

  const tagMap = {
    官服: 'Official',
    B服: 'Bilibili',
    国际服: 'Intl',
    '国际服·亚服': 'Intl Asia',
    '国际服·欧/美服': 'Intl EU/NA'
  };

  return tagMap[normalizedTag] || normalizedTag;
}

export function classifyGameAccountRegionBucket(metadata = {}) {
  const serverTag = buildGameAccountServerTag(metadata);
  if (!serverTag) {
    const normalized = normalizeGameAccountMetadata(metadata);
    if (!normalized) {
      return null;
    }

    const serverId = (normalized.serverId || '').toLowerCase();
    const region = (normalized.region || '').toLowerCase();
    const channelName = (normalized.channelName || '').toLowerCase();
    const signal = `${serverId} ${region} ${channelName}`;

    if (
      serverId === '1' ||
      /(^|[^a-z])(cn|china|mainland)([^a-z]|$)|国服|大陆/.test(signal)
    ) {
      return 'cn';
    }

    if (
      serverId === '2' ||
      serverId === '3' ||
      /intl|international|global|asia|sea|jp|kr|tw|hk|mo|sg|亚服|亚洲|(^|[^a-z])(eu|na|us)([^a-z]|$)|america|欧\/美|欧美|欧服|美服/.test(signal)
    ) {
      return 'intl';
    }

    return null;
  }

  if (serverTag.startsWith('国际服')) {
    return 'intl';
  }

  if (serverTag === '官服' || serverTag === 'B服') {
    return 'cn';
  }

  return null;
}
