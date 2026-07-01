import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';
import {
  resolveAliasValue,
  resolveCharacterAliasMap,
  resolvePoolAliasMap,
} from '../../../shared/idAliasService.js';
import {
  serializeHistoryForUpsert,
  serializePoolForUpsert,
  upsertHistoryRowsWithOptionalColumnFallback,
} from '../../../src/utils/cloudDataWriteRows.js';
import {
  buildGameAccountKey,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
} from '../../../src/utils/gameAccountMetadata.js';
import { clampHistoryPity } from '../../../src/utils/historyRecordUtils.js';
import {
  reconcileOfficialCharacterIds,
  reconcileOfficialPoolIds,
} from '../../../backend/lib/officialIdReconciliation.js';

const PAGE_SIZE = 1000;
const MAX_PAGES = 500;
const MAX_WRITE_POOLS = 200;
const MAX_WRITE_HISTORY = 1000;
const MAX_DELETE_IDS = 1000;
const MAX_SERVER_LABEL_WRITE_IDS = 100;

function getRequestUrl(req) {
  try {
    return new URL(req.url || '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function sendError(res, status, error, code = error) {
  return res.status(status).json({
    success: false,
    error,
    code,
  });
}

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function normalizeRecordIds(recordIds) {
  return [...new Set((Array.isArray(recordIds) ? recordIds : [])
    .map((value) => {
      const number = Number.parseInt(String(value || ''), 10);
      return Number.isFinite(number) ? number : null;
    })
    .filter(value => value != null))]
    .slice(0, MAX_DELETE_IDS);
}

function normalizePoolId(value) {
  return String(value || '').trim().slice(0, 160);
}

function normalizeAccountText(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

async function loadAllHistoryForUser(adminClient, userId) {
  const allHistory = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await adminClient
      .from('history')
      .select('*')
      .eq('user_id', userId)
      .order('record_id', { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    allHistory.push(...rows);
    if (rows.length < PAGE_SIZE) {
      return {
        rows: allHistory,
        truncated: false,
      };
    }
  }

  return {
    rows: allHistory,
    truncated: true,
  };
}

async function loadHistorySeqKeysForUser(adminClient, userId, {
  gameUid = '',
  serverId = '',
  region = '',
} = {}) {
  const keys = [];
  const normalizedGameUid = String(gameUid || '').trim();
  const normalizedServerId = String(serverId || '').trim();
  const normalizedRegion = String(region || '').trim();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let query = adminClient
      .from('history')
      .select('seq_id, game_uid, pool_id, server_id, region')
      .eq('user_id', userId)
      .not('seq_id', 'is', null);

    if (normalizedGameUid) {
      query = query.eq('game_uid', normalizedGameUid);
    }
    if (normalizedServerId) {
      query = query.eq('server_id', normalizedServerId);
    }
    if (normalizedRegion) {
      query = query.eq('region', normalizedRegion);
    }

    const { data, error } = await query
      .order('record_id', { ascending: true })
      .range(from, to);
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    keys.push(...rows.map((row) => {
      const keyRow = {
        seqId: row.seq_id,
        seq_id: row.seq_id,
        gameUid: row.game_uid,
        game_uid: row.game_uid,
        poolId: row.pool_id,
        pool_id: row.pool_id,
        serverId: row.server_id,
        server_id: row.server_id,
        region: row.region,
      };

      return {
        ...keyRow,
        accountKey: buildGameAccountKey(keyRow),
        account_key: buildGameAccountKey(keyRow),
      };
    }));

    if (rows.length < PAGE_SIZE) {
      return {
        keys,
        truncated: false,
      };
    }
  }

  return {
    keys,
    truncated: true,
  };
}

async function loadHistoryDedupeRowsForUser(adminClient, userId) {
  const rowsForDedupe = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await adminClient
      .from('history')
      .select('seq_id, game_uid, pool_id, server_id, region, timestamp, character_name, item_name, character_id, rarity, is_free')
      .eq('user_id', userId)
      .order('record_id', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    rowsForDedupe.push(...rows);
    if (rows.length < PAGE_SIZE) {
      return rowsForDedupe;
    }
  }

  return rowsForDedupe;
}

function normalizeDedupeValue(value) {
  return String(value || '').trim();
}

function normalizeDedupeTimestamp(value) {
  const normalized = normalizeDedupeValue(value);
  if (!normalized) return '';

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

function getDedupeSeqId(row) {
  return normalizeDedupeValue(row?.seq_id || row?.seqId);
}

function getDedupeGameUid(row) {
  return normalizeDedupeValue(row?.game_uid || row?.gameUid);
}

function getDedupePoolId(row) {
  return normalizeDedupeValue(row?.pool_id || row?.poolId);
}

function getDedupeServerId(row) {
  return normalizeDedupeValue(row?.server_id || row?.serverId);
}

function getDedupeRegion(row) {
  return normalizeDedupeValue(row?.region || row?.serverRegion);
}

function getDedupeAccountKey(row) {
  const gameUid = getDedupeGameUid(row);
  if (!gameUid) {
    return '';
  }

  return buildGameAccountKey({
    gameUid,
    serverId: getDedupeServerId(row),
    region: getDedupeRegion(row),
  }) || gameUid;
}

function getDedupeItemIdentities(row) {
  return [...new Set([
    row?.character_id,
    row?.item_id,
    row?.charId,
    row?.weaponId,
    row?.character_name,
    row?.characterName,
    row?.item_name,
    row?.name,
  ].map(value => normalizeDedupeValue(value)).filter(Boolean))];
}

function buildHistoryDedupeKeys(row) {
  const gameUid = getDedupeGameUid(row);
  const accountKey = getDedupeAccountKey(row);
  const isServerScoped = Boolean(accountKey && accountKey !== gameUid);
  const poolId = getDedupePoolId(row);
  const seqId = getDedupeSeqId(row);
  const timestamp = normalizeDedupeTimestamp(row?.timestamp);
  const itemIdentities = getDedupeItemIdentities(row);
  const rarity = normalizeDedupeValue(row?.rarity);
  const isFree = row?.is_free === true || row?.isFree === true ? 'free' : 'paid';
  const keys = [];

  if (seqId) {
    if (!gameUid && poolId) keys.push(`pool-seq:${poolId}:${seqId}`);
    if (isServerScoped && poolId) keys.push(`account-pool-seq:${accountKey}:${poolId}:${seqId}`);
    if (!isServerScoped && gameUid && poolId) keys.push(`game-pool-seq:${gameUid}:${poolId}:${seqId}`);
  }

  itemIdentities.forEach((itemIdentity) => {
    if (seqId && timestamp && rarity) {
      // kwer 旧 JSON 可能没有 gameUid 或仍使用旧池 ID；同一用户内 seq + 时间 + 物品足以兜底识别同一条历史。
      keys.push(`seq-time-item:${seqId}:${timestamp}:${itemIdentity}:${rarity}`);
    }

    if (isServerScoped && seqId && timestamp && rarity) {
      keys.push(`account-seq-time-item:${accountKey}:${seqId}:${timestamp}:${itemIdentity}:${rarity}`);
    }

    if (!isServerScoped && gameUid && seqId && timestamp && rarity) {
      // 跨来源导入时旧 JSON 可能缺少可映射池 ID，但 seq + 时间 + 物品身份仍能稳定指向同一抽卡记录。
      keys.push(`game-seq-time-item:${gameUid}:${seqId}:${timestamp}:${itemIdentity}:${rarity}`);
    }

    if (!seqId && isServerScoped && poolId && timestamp && rarity) {
      keys.push(`account-pool-time-item:${accountKey}:${poolId}:${timestamp}:${itemIdentity}:${rarity}:${isFree}`);
    }

    if (!seqId && !isServerScoped && gameUid && poolId && timestamp && rarity) {
      keys.push(`game-pool-time-item:${gameUid}:${poolId}:${timestamp}:${itemIdentity}:${rarity}:${isFree}`);
    }

    if (!seqId && isServerScoped && timestamp && rarity) {
      keys.push(`account-time-item:${accountKey}:${timestamp}:${itemIdentity}:${rarity}:${isFree}`);
    }

    if (!seqId && !isServerScoped && gameUid && timestamp && rarity) {
      keys.push(`game-time-item:${gameUid}:${timestamp}:${itemIdentity}:${rarity}:${isFree}`);
    }
  });

  return keys;
}

function createHistoryDedupeSet(rows) {
  const dedupeKeys = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    buildHistoryDedupeKeys(row).forEach(key => dedupeKeys.add(key));
  });
  return dedupeKeys;
}

function filterDuplicateHistoryRows(rows, existingRows) {
  const dedupeKeys = createHistoryDedupeSet(existingRows);
  const newRows = [];
  let duplicateCount = 0;

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rowKeys = buildHistoryDedupeKeys(row);
    const duplicate = rowKeys.some(key => dedupeKeys.has(key));

    if (duplicate) {
      duplicateCount += 1;
      return;
    }

    newRows.push(row);
    rowKeys.forEach(key => dedupeKeys.add(key));
  });

  return {
    newRows,
    duplicateCount,
  };
}

function formatHistoryRows(historyRows, {
  poolAliasMap,
  characterAliasMap,
} = {}) {
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
    gameUid: row.game_uid,
    game_uid: row.game_uid,
    nickName: row.nick_name,
    nick_name: row.nick_name,
    serverId: row.server_id,
    server_id: row.server_id,
    region: row.region,
  }));
}

function normalizeTextValues(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))]
    .slice(0, 1000);
}

async function resolveAliasMapOptional(resolver, supabaseClient, ids, preferredSource, { optional = false } = {}) {
  try {
    return await resolver(supabaseClient, ids, preferredSource);
  } catch (error) {
    if (optional) {
      return new Map();
    }
    throw error;
  }
}

async function handleResolveAccountGachaAliases(body, res, adminClient, { optionalAliases = false } = {}) {
  const poolIds = normalizeTextValues(body.poolIds);
  const characterIds = normalizeTextValues(body.characterIds);
  const [poolAliasMap, characterAliasMap] = await Promise.all([
    resolveAliasMapOptional(resolvePoolAliasMap, adminClient, poolIds, 'official_api', { optional: optionalAliases }),
    resolveAliasMapOptional(resolveCharacterAliasMap, adminClient, characterIds, 'official_api', { optional: optionalAliases }),
  ]);

  return res.status(200).json({
    success: true,
    poolAliases: Object.fromEntries(poolAliasMap),
    characterAliases: Object.fromEntries(characterAliasMap),
  });
}

function buildHistoryAccountKeyFromRow(row) {
  const gameUid = normalizeAccountText(row?.game_uid || row?.gameUid);
  if (!gameUid) {
    return '';
  }

  return buildGameAccountKey({
    gameUid,
    serverId: row?.server_id || row?.serverId,
    region: row?.region || row?.serverRegion,
  }) || gameUid;
}

function matchesServerLabelUpdateTarget(row, {
  accountKey = '',
  currentServerId = '',
  currentRegion = '',
} = {}) {
  const rowServerId = normalizeAccountText(row?.server_id || row?.serverId);
  const rowRegion = normalizeAccountText(row?.region || row?.serverRegion, 80);

  if (accountKey) {
    return buildHistoryAccountKeyFromRow(row) === accountKey || (!rowServerId && !rowRegion);
  }

  if (currentServerId) {
    return rowServerId === currentServerId;
  }

  if (currentRegion) {
    return rowRegion === currentRegion;
  }

  return !rowServerId && !rowRegion;
}

async function loadHistoryRowsForServerLabelUpdate(adminClient, userId, gameUid) {
  const rows = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await adminClient
      .from('history')
      .select('record_id, game_uid, server_id, region, seq_id, pool_id, timestamp, character_name, item_name, character_id, rarity, is_free')
      .eq('user_id', userId)
      .eq('game_uid', gameUid)
      .order('record_id', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) {
      return rows;
    }
  }

  return rows;
}

function getHistoryRecordId(row) {
  const recordId = row?.record_id ?? row?.recordId;
  return recordId === null || recordId === undefined ? null : recordId;
}

function collectDuplicateHistoryRecordIdsForServerMerge(rows, { serverId, region } = {}) {
  const seenKeys = new Set();
  const duplicateIds = [];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const mergedRow = {
      ...row,
      serverId,
      server_id: serverId,
      region,
    };
    const rowKeys = buildHistoryDedupeKeys(mergedRow);
    if (rowKeys.length === 0) {
      return;
    }

    const isDuplicate = rowKeys.some(key => seenKeys.has(key));
    if (isDuplicate) {
      const recordId = getHistoryRecordId(row);
      if (recordId !== null) {
        duplicateIds.push(recordId);
      }
      return;
    }

    rowKeys.forEach(key => seenKeys.add(key));
  });

  return duplicateIds;
}

async function updateHistoryServerLabelByRecordIds(adminClient, userId, recordIds, { serverId, region } = {}) {
  let updated = 0;

  for (let index = 0; index < recordIds.length; index += MAX_SERVER_LABEL_WRITE_IDS) {
    const chunk = recordIds.slice(index, index + MAX_SERVER_LABEL_WRITE_IDS);
    const { error } = await adminClient
      .from('history')
      .update({
        server_id: serverId,
        region,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .in('record_id', chunk);

    if (error) throw error;
    updated += chunk.length;
  }

  return updated;
}

async function deleteHistoryRowsByRecordIds(adminClient, userId, recordIds) {
  let deleted = 0;

  for (let index = 0; index < recordIds.length; index += MAX_SERVER_LABEL_WRITE_IDS) {
    const chunk = recordIds.slice(index, index + MAX_SERVER_LABEL_WRITE_IDS);
    const { error } = await adminClient
      .from('history')
      .delete()
      .eq('user_id', userId)
      .in('record_id', chunk);

    if (error) throw error;
    deleted += chunk.length;
  }

  return deleted;
}

async function handleUpdateAccountServerLabel(body, res, adminClient, userId) {
  const gameUid = normalizeAccountText(body.gameUid || body.game_uid);
  const accountKey = normalizeAccountText(body.accountKey || body.account_key, 240);
  const currentServerId = normalizeAccountText(body.currentServerId || body.current_server_id, 80);
  const currentRegion = normalizeAccountText(body.currentRegion || body.current_region, 80);
  const mergeGameUid = body.mergeGameUid === true || body.merge_game_uid === true;
  const serverId = normalizeGameAccountServerId({
    serverId: body.serverId || body.server_id,
    region: body.region,
  });
  const region = normalizeGameAccountRegion({
    serverId,
    region: body.region,
  });

  if (!gameUid) {
    return sendError(res, 400, 'Missing game uid', 'game_uid_required');
  }

  if (!serverId || !region) {
    return sendError(res, 400, 'Missing server label', 'server_label_required');
  }

  const rows = await loadHistoryRowsForServerLabelUpdate(adminClient, userId, gameUid);
  const targetRows = rows
    .filter(row => mergeGameUid || matchesServerLabelUpdateTarget(row, { accountKey, currentServerId, currentRegion }));
  const duplicateIds = mergeGameUid
    ? collectDuplicateHistoryRecordIdsForServerMerge(targetRows, { serverId, region })
    : [];
  const duplicateIdSet = new Set(duplicateIds);
  const targetIds = targetRows
    .map(row => getHistoryRecordId(row))
    .filter(value => !duplicateIdSet.has(value))
    .filter(value => value !== null && value !== undefined);

  if (targetIds.length === 0 && duplicateIds.length === 0) {
    return res.status(200).json({
      success: true,
      updated: 0,
      deletedDuplicates: 0,
      serverId,
      region,
      mergeGameUid,
    });
  }

  const deletedDuplicates = await deleteHistoryRowsByRecordIds(adminClient, userId, duplicateIds);
  const updated = await updateHistoryServerLabelByRecordIds(adminClient, userId, targetIds, { serverId, region });

  return res.status(200).json({
    success: true,
    updated,
    deletedDuplicates,
    serverId,
    region,
    mergeGameUid,
  });
}

async function handleSaveAccountGachaData(body, res, adminClient, userId, {
  reconcile = true,
  optionalAliases = false,
} = {}) {
  const pools = Array.isArray(body.pools) ? body.pools.slice(0, MAX_WRITE_POOLS) : [];
  const history = Array.isArray(body.history) ? body.history.slice(0, MAX_WRITE_HISTORY) : [];

  if (pools.length === 0 && history.length === 0) {
    return res.status(200).json({
      success: true,
      saved: {
        pools: 0,
        history: 0,
      },
      skipped: {
        pools: 0,
        history: 0,
      },
    });
  }

  if (pools.length > 0) {
    if (reconcile) {
      await reconcileOfficialPoolIds(adminClient, pools, {
        userId,
      });
    }

    const poolAliasMap = await resolveAliasMapOptional(
      resolvePoolAliasMap,
      adminClient,
      pools.map(pool => pool?.id || pool?.pool_id || pool?.poolId),
      'official_api',
      { optional: optionalAliases }
    );
    const rows = pools.map(pool => ({
      ...serializePoolForUpsert(
        pool,
        userId,
        resolveAliasValue(poolAliasMap, pool?.id || pool?.pool_id || pool?.poolId)
      ),
      user_id: userId,
    }));
    const { error } = await adminClient
      .from('pools')
      .upsert(rows, { onConflict: 'pool_id' });
    if (error) throw error;
  }

  if (history.length > 0) {
    if (reconcile) {
      await reconcileOfficialPoolIds(adminClient, history.map(record => ({
        ...record,
        pool_id: record?.poolId || record?.pool_id,
        name: record?.pool_name || record?.poolName,
        type: record?.poolType || record?.type,
      })), {
        userId,
      });
      await reconcileOfficialCharacterIds(adminClient, history);
    }

    const [poolAliasMap, characterAliasMap] = await Promise.all([
      resolveAliasMapOptional(
        resolvePoolAliasMap,
        adminClient,
        history.map(record => record?.poolId || record?.pool_id),
        'official_api',
        { optional: optionalAliases }
      ),
      resolveAliasMapOptional(
        resolveCharacterAliasMap,
        adminClient,
        history.map(record => record?.character_id || record?.item_id || record?.charId || record?.weaponId),
        'official_api',
        { optional: optionalAliases }
      ),
    ]);
    const rows = history.map(record => ({
      ...serializeHistoryForUpsert(
        record,
        userId,
        resolveAliasValue(poolAliasMap, record?.poolId || record?.pool_id),
        resolveAliasValue(characterAliasMap, record?.character_id || record?.item_id || record?.charId || record?.weaponId)
      ),
      user_id: userId,
    }));
    const existingRows = await loadHistoryDedupeRowsForUser(adminClient, userId);
    const { newRows, duplicateCount } = filterDuplicateHistoryRows(rows, existingRows);

    if (newRows.length > 0) {
      await upsertHistoryRowsWithOptionalColumnFallback(newRows, (pendingRows, onConflict) => (
        adminClient
          .from('history')
          .upsert(pendingRows, { onConflict })
      ));
    }

    return res.status(200).json({
      success: true,
      saved: {
        pools: pools.length,
        history: newRows.length,
      },
      skipped: {
        pools: Math.max(0, (Array.isArray(body.pools) ? body.pools.length : 0) - pools.length),
        history: Math.max(0, (Array.isArray(body.history) ? body.history.length : 0) - history.length) + duplicateCount,
      },
    });
  }

  return res.status(200).json({
    success: true,
    saved: {
      pools: pools.length,
      history: history.length,
    },
    skipped: {
      pools: Math.max(0, (Array.isArray(body.pools) ? body.pools.length : 0) - pools.length),
      history: Math.max(0, (Array.isArray(body.history) ? body.history.length : 0) - history.length),
    },
  });
}

async function handleDeleteAccountGachaData(req, res, adminClient, userId) {
  const body = parseRequestBody(req);
  const action = String(body.action || '').trim();

  if (action === 'records') {
    const recordIds = normalizeRecordIds(body.recordIds);
    if (recordIds.length === 0) {
      return res.status(200).json({
        success: true,
        deleted: {
          history: 0,
          pools: 0,
        },
      });
    }

    const { error } = await adminClient
      .from('history')
      .delete()
      .eq('user_id', userId)
      .in('record_id', recordIds);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      deleted: {
        history: recordIds.length,
        pools: 0,
      },
    });
  }

  if (action === 'poolHistory') {
    const poolId = normalizePoolId(body.poolId);
    if (!poolId) {
      return sendError(res, 400, 'Missing pool id', 'pool_id_required');
    }

    const { error } = await adminClient
      .from('history')
      .delete()
      .eq('user_id', userId)
      .eq('pool_id', poolId);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      deleted: {
        history: null,
        pools: 0,
      },
    });
  }

  if (action === 'pool') {
    const poolId = normalizePoolId(body.poolId);
    if (!poolId) {
      return sendError(res, 400, 'Missing pool id', 'pool_id_required');
    }

    const { error } = await adminClient
      .from('pools')
      .delete()
      .eq('user_id', userId)
      .eq('pool_id', poolId);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      deleted: {
        history: 0,
        pools: 1,
      },
    });
  }

  if (action === 'all') {
    const { error: historyError } = await adminClient
      .from('history')
      .delete()
      .eq('user_id', userId);
    if (historyError) throw historyError;

    const { error: poolError } = await adminClient
      .from('pools')
      .delete()
      .eq('user_id', userId);
    if (poolError) throw poolError;

    return res.status(200).json({
      success: true,
      deleted: {
        history: null,
        pools: null,
      },
    });
  }

  return sendError(res, 400, 'Unsupported delete action', 'unsupported_delete_action');
}

export default async function accountGachaDataHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, POST, DELETE, OPTIONS',
    headers: 'Content-Type, Authorization',
  })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    sendError(res, 405, 'Method not allowed', 'method_not_allowed');
    return;
  }

  const adminClient = getSupabaseAdminClient();
  const authResult = await resolveAuthenticatedRequestUser(req, {
    adminClient,
    touch: Boolean(adminClient),
  });

  if (!authResult.ok) {
    sendError(
      res,
      authResult.status || 401,
      authResult.error || 'Authentication required',
      authResult.code || 'authentication_required'
    );
    return;
  }

  try {
    const dbClient = adminClient || authResult.callerClient;
    if (!dbClient) {
      sendError(res, 503, 'Auth service not configured', 'auth_service_not_configured');
      return;
    }
    const useAdminFeatures = Boolean(adminClient);

    if (req.method === 'POST') {
      const body = parseRequestBody(req);
      if (body.action === 'resolveAliases') {
        await handleResolveAccountGachaAliases(body, res, dbClient, {
          optionalAliases: !useAdminFeatures,
        });
        return;
      }
      if (body.action === 'updateServerLabel') {
        await handleUpdateAccountServerLabel(body, res, dbClient, authResult.user.id);
        return;
      }
      await handleSaveAccountGachaData(body, res, dbClient, authResult.user.id, {
        reconcile: useAdminFeatures,
        optionalAliases: !useAdminFeatures,
      });
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteAccountGachaData(req, res, dbClient, authResult.user.id);
      return;
    }

    const url = getRequestUrl(req);
    if (url.searchParams.get('mode') === 'seq-keys') {
      const { keys, truncated } = await loadHistorySeqKeysForUser(
        dbClient,
        authResult.user.id,
        {
          gameUid: url.searchParams.get('gameUid') || '',
          serverId: url.searchParams.get('serverId') || '',
          region: url.searchParams.get('region') || '',
        }
      );
      res.status(200).json({
        success: true,
        source: authResult.source || 'unknown',
        keys,
        meta: {
          count: keys.length,
          pageSize: PAGE_SIZE,
          truncated,
        },
        warnings: truncated
          ? [{ code: 'history_seq_key_page_limit_reached' }]
          : [],
      });
      return;
    }

    const { rows, truncated } = await loadAllHistoryForUser(dbClient, authResult.user.id);
    const [poolAliasMap, characterAliasMap] = await Promise.all([
      resolveAliasMapOptional(
        resolvePoolAliasMap,
        dbClient,
        rows.map(row => row?.pool_id),
        'official_api',
        { optional: !useAdminFeatures }
      ),
      resolveAliasMapOptional(
        resolveCharacterAliasMap,
        dbClient,
        rows.map(row => row?.character_id),
        'official_api',
        { optional: !useAdminFeatures }
      ),
    ]);

    res.status(200).json({
      success: true,
      source: authResult.source || 'unknown',
      history: formatHistoryRows(rows, {
        poolAliasMap,
        characterAliasMap,
      }),
      meta: {
        count: rows.length,
        pageSize: PAGE_SIZE,
        truncated,
      },
      warnings: truncated
        ? [{ code: 'history_page_limit_reached' }]
        : [],
    });
  } catch (error) {
    sendError(
      res,
      500,
      error?.message || 'Failed to process account gacha data',
      req.method === 'GET'
        ? 'account_gacha_data_load_failed'
        : req.method === 'POST'
          ? 'account_gacha_data_save_failed'
          : 'account_gacha_data_delete_failed'
    );
  }
}

export const __internal = {
  formatHistoryRows,
  handleDeleteAccountGachaData,
  handleResolveAccountGachaAliases,
  handleSaveAccountGachaData,
  loadAllHistoryForUser,
  loadHistorySeqKeysForUser,
};
