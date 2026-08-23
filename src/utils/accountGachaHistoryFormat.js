import { resolveAliasValue } from '../../shared/idAliasService.js';
import { clampHistoryPity } from './historyRecordUtils.js';

/**
 * Convert private history database rows into the shared browser/worker model.
 * Alias maps are optional so deployments without admin alias access can still
 * preserve the original IDs.
 */
export function formatAccountGachaHistoryRows(
  historyRows,
  { poolAliasMap, characterAliasMap } = {}
) {
  return (Array.isArray(historyRows) ? historyRows : []).map((row) => ({
    id: row.record_id,
    rarity: row.rarity,
    isStandard: row.is_standard,
    specialType: row.special_type,
    timestamp: row.timestamp,
    poolId: resolveAliasValue(poolAliasMap, row.pool_id),
    user_id: row.user_id,
    name: row.character_name || row.item_name,
    character_name: row.character_name,
    item_name: row.item_name,
    character_id: resolveAliasValue(characterAliasMap, row.character_id),
    batchId: row.batch_id,
    batch_id: row.batch_id,
    seqId: row.seq_id,
    seq_id: row.seq_id,
    pity: clampHistoryPity(row.pity),
    isNew: row.is_new || false,
    is_new: row.is_new,
    isFree: row.is_free || false,
    is_free: row.is_free,
    isInfoBook: row.is_info_book || false,
    is_info_book: row.is_info_book,
    editVersion: Number(row.edit_version || 1),
    edit_version: Number(row.edit_version || 1),
    gameUid: row.game_uid,
    game_uid: row.game_uid,
    nickName: row.nick_name,
    nick_name: row.nick_name,
    serverId: row.server_id,
    server_id: row.server_id,
    serverScope: row.server_scope,
    server_scope: row.server_scope,
    region: row.region,
  }));
}

export default formatAccountGachaHistoryRows;
