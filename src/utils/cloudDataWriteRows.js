import { clampHistoryPity, splitHistoryUpsertGroups } from './historyRecordUtils.js';
import { classifyCharacterIdSource } from './canonicalEntityUtils.js';
import {
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
} from './gameAccountMetadata.js';

function resolveOwnerId(explicitUserId, currentUserId) {
  return explicitUserId || currentUserId || null;
}

function normalizeTimestamp(timestamp) {
  if (!timestamp) {
    return new Date().toISOString();
  }

  const date = typeof timestamp === 'number'
    ? new Date(timestamp)
    : new Date(timestamp);

  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeRecordId(record) {
  let recordId = record.id || record.record_id;

  if (typeof recordId === 'string') {
    recordId = parseInt(recordId, 10);
    if (Number.isNaN(recordId)) {
      recordId = parseInt(record.seqId || record.seq_id, 10) || Date.now();
    }
  }

  return recordId;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function normalizeCharacterIdForStorage(record, resolvedCharacterId) {
  const rawCharacterId = normalizeText(record.character_id || record.item_id || record.charId || record.weaponId);
  const candidateId = normalizeText(resolvedCharacterId || rawCharacterId);

  if (!candidateId) {
    return null;
  }

  if (rawCharacterId && candidateId === rawCharacterId && classifyCharacterIdSource(rawCharacterId) === 'source_raw') {
    return null;
  }

  return candidateId;
}

export function serializePoolForUpsert(pool, currentUserId, resolvedPoolId = null) {
  const ownerId = resolveOwnerId(pool.user_id, currentUserId);

  return {
    user_id: ownerId,
    pool_id: resolvedPoolId || pool.id || pool.pool_id,
    name: pool.name,
    name_en: pool.name_en || null,
    type: pool.type,
    locked: pool.locked || false,
    is_limited_weapon: pool.isLimitedWeapon !== undefined ? pool.isLimitedWeapon : (pool.is_limited_weapon !== false),
    up_character: pool.upCharacter || pool.up_character || null,
    description: pool.description || null,
    banner_url: pool.banner_url || pool.bannerUrl || null,
    start_time: pool.start_time || pool.startTime || null,
    end_time: pool.end_time || pool.endTime || null,
    featured_characters: pool.featured_characters || null,
    updated_at: new Date().toISOString(),
  };
}

export function serializeHistoryForUpsert(
  record,
  currentUserId,
  resolvedPoolId = null,
  resolvedCharacterId = null
) {
  const serverId = normalizeGameAccountServerId(record);

  return {
    user_id: resolveOwnerId(record.user_id, currentUserId),
    record_id: normalizeRecordId(record),
    pool_id: String(resolvedPoolId || record.poolId || record.pool_id),
    rarity: typeof record.rarity === 'number' ? record.rarity : parseInt(record.rarity, 10) || 4,
    is_standard: Boolean(record.isStandard || record.is_standard),
    special_type: record.specialType || record.special_type || null,
    character_name: record.character_name || record.characterName || record.name || null,
    item_name: record.item_name || record.name || record.character_name || record.characterName || null,
    character_id: normalizeCharacterIdForStorage(record, resolvedCharacterId),
    batch_id: record.batchId || record.batch_id || null,
    seq_id: record.seqId || record.seq_id || null,
    pity: clampHistoryPity(record.pity),
    is_new: Boolean(record.isNew || record.is_new),
    is_free: Boolean(record.isFree || record.is_free),
    game_uid: record.gameUid || record.game_uid || null,
    nick_name: record.nickName || record.nick_name || null,
    server_id: serverId,
    region: normalizeGameAccountRegion({ ...record, serverId }),
    timestamp: normalizeTimestamp(record.timestamp),
    updated_at: new Date().toISOString(),
  };
}

export function detectMissingHistoryOptionalColumn(error) {
  const message = String(error?.message || '');

  for (const column of ['character_id', 'server_id', 'server_scope', 'region']) {
    if (
      message.includes(`history.${column} does not exist`)
      || message.includes(`Could not find the '${column}' column`)
    ) {
      return column;
    }
  }

  return null;
}

export function omitHistoryColumns(rows, omittedColumns) {
  return rows.map((row) => {
    const nextRow = { ...row };
    omittedColumns.forEach((column) => {
      delete nextRow[column];
    });
    return nextRow;
  });
}

function isMissingConflictTargetError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P10'
    || message.includes('no unique or exclusion constraint matching the on conflict specification')
    || message.includes('there is no unique or exclusion constraint matching the on conflict specification');
}

export async function upsertHistoryRowsWithOptionalColumnFallback(rows, executeUpsert) {
  const { serverScopedCompositeKeyRecords, compositeKeyRecords, legacyRecords } = splitHistoryUpsertGroups(rows);
  const unifiedCompositeKeyRecords = [
    ...serverScopedCompositeKeyRecords,
    ...compositeKeyRecords,
  ];
  const upsertGroups = [
    {
      rows: unifiedCompositeKeyRecords,
      onConflict: 'user_id,game_uid,server_scope,pool_id,seq_id',
      serverScopeKey: true,
    },
    { rows: legacyRecords, onConflict: 'user_id,record_id' },
  ];
  const supportedOptionalColumns = new Set(['character_id', 'server_id', 'server_scope', 'region']);

  for (const group of upsertGroups) {
    if (group.rows.length === 0) continue;

    let onConflict = group.onConflict;
    let pendingRows = omitHistoryColumns(
      group.rows,
      ['character_id', 'server_id', 'region'].filter(column => !supportedOptionalColumns.has(column))
    );

    while (true) {
      // eslint-disable-next-line no-await-in-loop -- optional-column fallback mutates rows between sequential retries
      const { error } = await executeUpsert(pendingRows, onConflict);

      if (!error) {
        break;
      }

      const missingColumn = detectMissingHistoryOptionalColumn(error);
      if (!missingColumn && group.serverScopeKey && onConflict !== 'user_id,game_uid,pool_id,seq_id' && isMissingConflictTargetError(error)) {
        onConflict = 'user_id,game_uid,pool_id,seq_id';
        continue;
      }

      if (!missingColumn || !supportedOptionalColumns.has(missingColumn)) {
        throw error;
      }

      supportedOptionalColumns.delete(missingColumn);
      if (group.serverScopeKey && (missingColumn === 'server_id' || missingColumn === 'server_scope')) {
        onConflict = 'user_id,game_uid,pool_id,seq_id';
      }

      pendingRows = omitHistoryColumns(group.rows, ['character_id', 'server_id', 'region'].filter(
        column => !supportedOptionalColumns.has(column)
      ));
    }
  }
}
