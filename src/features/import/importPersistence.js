import { normalizeIsStandard } from '../../utils/poolUtils.js';
import { clampHistoryPity } from '../../utils/historyRecordUtils.js';
import { classifyCharacterIdSource } from '../../utils/canonicalEntityUtils.js';
import {
  buildGameAccountKey,
  buildHistorySeqDedupeKeys,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
} from '../../utils/gameAccountMetadata.js';

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
    const rawPoolId = record?.pool_id || record?.poolId;
    const canonicalPoolId = resolveAliasValue(poolAliasMap, rawPoolId);
    if (!canonicalPoolId || entryMap.has(canonicalPoolId)) {
      return;
    }

    entryMap.set(canonicalPoolId, {
      id: canonicalPoolId,
      name: record.pool_name || record.poolName || canonicalPoolId,
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
    const rawPoolId = record.pool_id || record.poolId;
    const rawCharacterId = record.character_id || record.item_id || record.charId || record.weaponId;
    const canonicalPoolId = resolveAliasValue(poolAliasMap, rawPoolId);
    const canonicalCharacterId = normalizeCharacterIdForStorage(
      rawCharacterId,
      resolveAliasValue(characterAliasMap, rawCharacterId)
    );

    const poolHash = simpleStringHash(rawPoolId || 'unknown');
    const seqNum = record.seqId ? parseInt(record.seqId, 10) : index;
    const numericId = (poolHash * 10000000) + seqNum;
    const poolType = poolTypeMap.get(rawPoolId)
      || poolTypeMap.get(canonicalPoolId)
      || inferPoolTypeFromId(canonicalPoolId || rawPoolId);
    const upCharacter = poolUpCharacterMap.get(rawPoolId) || poolUpCharacterMap.get(canonicalPoolId);
    const isStandard = normalizeIsStandard(record, poolType, upCharacter);

    return {
      id: numericId,
      poolId: canonicalPoolId,
      name: record.name,
      character_name: record.name,
      character_id: canonicalCharacterId,
      rarity: record.rarity,
      isStandard,
      isLimited: record.isLimited,
      batchId: record.batchId,
      seqId: record.seqId,
      pity: clampHistoryPity(record.pity),
      isNew: record.isNew || false,
      isFree: record.isFree || false,
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
      timestamp: record.timestamp,
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
  };
}

export function filterImportedHistoryRecords(historyRecords, existingSeqIds) {
  const newRecords = historyRecords.filter((record) => {
    if (!record.seqId) {
      return true;
    }

    const compositeKeys = buildHistorySeqDedupeKeys(record);
    return !compositeKeys.some(key => existingSeqIds.has(key));
  });

  return {
    newRecords,
    duplicateCount: historyRecords.length - newRecords.length,
  };
}
