import { normalizeIsStandard } from '../../utils/poolUtils.js';
import { clampHistoryPity } from '../../utils/historyRecordUtils.js';
import { classifyCharacterIdSource } from '../../utils/canonicalEntityUtils.js';
import {
  buildGameAccountKey,
  buildHistorySeqDedupeKeys,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
} from '../../utils/gameAccountMetadata.js';
import {
  normalizeOfficialImportRecord,
  summarizeOfficialImportIssues,
} from '../../../shared/officialImportRecordNormalizer.js';

function resolveAliasValue(aliasMap, inputValue) {
  const normalized = typeof inputValue === 'string' ? inputValue.trim() : String(inputValue || '').trim();
  if (!normalized) {
    return null;
  }
  return aliasMap?.[normalized] || normalized;
}

function normalizeCharacterIdForStorage(rawCharacterId, resolvedCharacterId) {
  const rawId = typeof rawCharacterId === 'string' ? rawCharacterId.trim() : String(rawCharacterId || '').trim();
  const candidateId = typeof resolvedCharacterId === 'string' ? resolvedCharacterId.trim() : String(resolvedCharacterId || '').trim();

  if (!candidateId) {
    return null;
  }

  if (rawId && rawId === candidateId && classifyCharacterIdSource(rawId) === 'source_raw') {
    return null;
  }

  return candidateId;
}

function inferPoolTypeFromId(poolId) {
  if (!poolId) return 'standard';

  const prefix = String(poolId).split('_')[0].toLowerCase();
  const typeMap = {
    joint: 'extra',
    extra: 'extra',
    special: 'limited',
    standard: 'standard',
    beginner: 'beginner',
    weponbox: 'weapon',
    weaponbox: 'weapon',
  };

  return typeMap[prefix] || 'standard';
}

function simpleStringHash(value) {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }

  return Math.abs(hash % 1000);
}

function buildPoolLookups(pools = []) {
  const poolUpCharacterMap = new Map();
  const poolTypeMap = new Map();

  pools.forEach((pool) => {
    if (pool.up_character) {
      if (pool.pool_id) poolUpCharacterMap.set(pool.pool_id, pool.up_character);
      if (pool.id) poolUpCharacterMap.set(pool.id, pool.up_character);
    }

    if (pool.pool_id) poolTypeMap.set(pool.pool_id, pool.type);
    if (pool.id) poolTypeMap.set(pool.id, pool.type);
  });

  return { poolUpCharacterMap, poolTypeMap };
}

function buildCanonicalPoolEntries(records, poolAliasMap = {}) {
  const entryMap = new Map();

  records.forEach((record) => {
    const normalized = normalizeOfficialImportRecord(record, {
      gameUid: record?.gameUid || record?.game_uid || 'catalog-only',
      serverId: record?.serverId || record?.server_id || 'catalog-only',
    });
    const rawPoolId = normalized.poolId;
    const canonicalPoolId = resolveAliasValue(poolAliasMap, rawPoolId);
    if (!canonicalPoolId || entryMap.has(canonicalPoolId)) {
      return;
    }

    entryMap.set(canonicalPoolId, {
      id: canonicalPoolId,
      name: normalized.poolName || canonicalPoolId,
      type: inferPoolTypeFromId(canonicalPoolId),
      locked: false,
    });
  });

  return Array.from(entryMap.values());
}

function buildImportedHistoryRecords({
  records,
  userInfo,
  poolAliasMap,
  characterAliasMap,
  poolUpCharacterMap,
  poolTypeMap,
}) {
  const gameUid = userInfo?.gameUid || userInfo?.hgUid || null;
  const resolvedServerId = normalizeGameAccountServerId(userInfo) || null;
  const resolvedRegion = normalizeGameAccountRegion({ ...userInfo, serverId: resolvedServerId }) || null;
  const accountKey = buildGameAccountKey({
    ...userInfo,
    gameUid,
    serverId: resolvedServerId,
    region: resolvedRegion,
  });

  return records.map((record, index) => {
    const normalized = normalizeOfficialImportRecord(record, {
      gameUid,
      serverId: resolvedServerId,
      region: resolvedRegion,
      poolType: record?.pool || record?.recordType,
    });
    const rawPoolId = normalized.poolId;
    const rawCharacterId = normalized.rawItemId;
    const canonicalPoolId = resolveAliasValue(poolAliasMap, rawPoolId);
    const canonicalCharacterId = normalizeCharacterIdForStorage(
      rawCharacterId,
      resolveAliasValue(characterAliasMap, rawCharacterId)
    );

    const poolHash = simpleStringHash(rawPoolId || 'unknown');
    const recordId = /^\d+$/.test(normalized.seqId || '')
      ? (BigInt(poolHash) * 10000000n + BigInt(normalized.seqId)).toString()
      : `${poolHash}:${normalized.seqId || index}`;
    const poolType = poolTypeMap.get(rawPoolId)
      || poolTypeMap.get(canonicalPoolId)
      || inferPoolTypeFromId(canonicalPoolId || rawPoolId);
    const upCharacter = poolUpCharacterMap.get(rawPoolId) || poolUpCharacterMap.get(canonicalPoolId);
    const isStandard = normalizeIsStandard(record, poolType, upCharacter);

    return {
      id: recordId,
      poolId: canonicalPoolId,
      name: normalized.itemName,
      character_name: normalized.itemName,
      item_name: normalized.itemName,
      character_id: canonicalCharacterId,
      rarity: normalized.quality,
      isStandard,
      isLimited: record.isLimited,
      batchId: record.batchId,
      seqId: normalized.seqId,
      pity: clampHistoryPity(record.pity),
      isNew: normalized.isNew,
      isFree: normalized.isFree,
      isInfoBook: normalized.isInfoBook,
      accountKey,
      account_key: accountKey,
      gameUid,
      hgUid: userInfo?.hgUid || null,
      hg_uid: userInfo?.hgUid || null,
      nickName: userInfo?.nickName || null,
      channelName: userInfo?.channelName || null,
      channel_name: userInfo?.channelName || null,
      channelMasterId: userInfo?.channelMasterId || null,
      channel_master_id: userInfo?.channelMasterId || null,
      serverId: resolvedServerId,
      server_id: resolvedServerId,
      region: resolvedRegion,
      timestamp: normalized.timestamp,
      importIssues: normalized.issues,
      importBlocked: normalized.blocked,
      sourceRawMin: normalized.rawMin,
      created_at: new Date().toISOString(),
    };
  });
}

export async function prepareOfficialImportPersistenceData({
  records,
  userInfo,
  pools,
  poolAliasMap = null,
  characterAliasMap = null,
  poolAliases = null,
  characterAliases = null,
}) {
  const resolvedPoolAliasMap = poolAliasMap || poolAliases || {};
  const resolvedCharacterAliasMap = characterAliasMap || characterAliases || {};
  const currentGameUid = userInfo?.gameUid || userInfo?.hgUid || null;
  const currentServerId = normalizeGameAccountServerId(userInfo) || null;
  const currentRegion = normalizeGameAccountRegion({ ...userInfo, serverId: currentServerId }) || null;
  const currentAccountKey = buildGameAccountKey({
    ...userInfo,
    gameUid: currentGameUid,
    serverId: currentServerId,
    region: currentRegion,
  });

  if (!Array.isArray(records) || records.length === 0) {
    return {
      currentGameUid,
      currentAccountKey,
      poolEntries: [],
      historyRecords: [],
    };
  }

  const { poolUpCharacterMap, poolTypeMap } = buildPoolLookups(pools);
  const normalizedRecords = records.map((record) => normalizeOfficialImportRecord(record, {
    gameUid: currentGameUid,
    serverId: currentServerId,
    region: currentRegion,
    poolType: record?.pool || record?.recordType,
  }));
  const reviewSummary = summarizeOfficialImportIssues(normalizedRecords);

  return {
    currentGameUid,
    currentAccountKey,
    poolEntries: buildCanonicalPoolEntries(records, resolvedPoolAliasMap),
    historyRecords: buildImportedHistoryRecords({
      records,
      userInfo,
      poolAliasMap: resolvedPoolAliasMap,
      characterAliasMap: resolvedCharacterAliasMap,
      poolUpCharacterMap,
      poolTypeMap,
    }),
    normalizedRecords,
    reviewSummary,
    reviewRequired: reviewSummary.issueRecords > 0,
  };
}

export function filterImportedHistoryRecords(historyRecords, existingSeqIds) {
  const safeRecords = historyRecords.filter((record) => record.importBlocked !== true);
  const blockedCount = historyRecords.length - safeRecords.length;
  const newRecords = safeRecords.filter((record) => {
    if (!record.seqId) {
      return true;
    }

    const compositeKeys = buildHistorySeqDedupeKeys(record);
    return !compositeKeys.some(key => existingSeqIds.has(key));
  });

  return {
    newRecords,
    duplicateCount: safeRecords.length - newRecords.length,
    blockedCount,
  };
}
