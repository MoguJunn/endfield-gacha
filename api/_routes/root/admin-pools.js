import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { requireSuperAdminUser } from '../../_lib/siteAuth.js';
import { buildManualCharacterId, buildManualPoolId } from '../../../src/utils/canonicalEntityUtils.js';
import { resolvePoolCapabilities } from '../../../src/utils/poolCapabilities.js';
import { isTargetSixStarHistoryRecord } from '../../../src/utils/poolScopedHistory.js';
import {
  buildCharacterSelfAliasRows,
  buildPoolSelfAliasRows,
  inferPoolAliasSource,
} from '../../../shared/idAliasService.js';
import {
  getCanonicalExtraPoolMetadata,
  getCanonicalExtraPoolSubtype,
} from '../../../shared/extraPoolSubtype.js';

const HISTORY_RECALCULATE_BATCH_SIZE = 50;

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

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePoolType(type) {
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  return type || 'limited';
}

function normalizePoolExtraFields(poolData = {}) {
  const type = normalizePoolType(poolData.type);
  const extraMetadata = getCanonicalExtraPoolMetadata(poolData);

  return {
    ...poolData,
    type,
    ...extraMetadata,
  };
}

function uniqueAliasRows(rows = []) {
  const deduped = new Map();
  rows.forEach((row) => {
    const source = normalizeName(row?.source);
    const aliasId = normalizeName(row?.alias_id);
    const poolId = normalizeName(row?.pool_id);
    if (!source || !aliasId || !poolId) return;
    deduped.set(`${source}:${aliasId}`, {
      ...row,
      source,
      alias_id: aliasId,
      pool_id: poolId,
      is_primary: Boolean(row?.is_primary),
      note: row?.note || null,
    });
  });
  return Array.from(deduped.values());
}

function buildNameSet(items = []) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => normalizeName(item))
      .filter(Boolean)
  );
}

function buildCharacterLookup(characters = []) {
  const byId = new Map();
  (Array.isArray(characters) ? characters : []).forEach((character) => {
    if (character?.id) byId.set(character.id, character);
  });
  return { byId };
}

function normalizePoolCharacterRows(rows = [], characters = [], poolData = {}) {
  const poolType = normalizePoolType(poolData?.type);
  const { byId } = buildCharacterLookup(characters);
  const featuredNames = buildNameSet(poolData?.featured_characters);
  const featuredIds = new Set(
    (Array.isArray(poolData?.featured_characters) ? poolData.featured_characters : [])
      .map((value) => normalizeName(value))
      .filter(Boolean)
  );
  const upCharacterName = normalizeName(poolData?.up_character);
  const dedupedRows = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const characterId = normalizeName(row?.character_id);
    if (!characterId) return;

    const character = byId.get(characterId);
    const isUp = poolType === 'extra'
      ? featuredIds.has(characterId) || featuredNames.has(normalizeName(character?.name))
      : Boolean(row?.is_up) || (upCharacterName && normalizeName(character?.name) === upCharacterName);

    dedupedRows.set(characterId, {
      character_id: characterId,
      is_up: Boolean(isUp),
    });
  });

  return Array.from(dedupedRows.values());
}

function validatePoolExtraContract(poolData, poolCharacterRows, characters) {
  const poolType = normalizePoolType(poolData?.type);
  const extraFields = [
    poolData?.extra_subtype,
    poolData?.extra_rule_profile,
    poolData?.extra_series_key,
    poolData?.extra_series_phase,
  ];

  if (poolType !== 'extra') {
    if (extraFields.some((value) => value !== null && value !== undefined && value !== '')) {
      return {
        ok: false,
        error: '非附加寻访不能保存附加寻访模板字段',
        code: 'extra_pool_fields_not_allowed',
      };
    }
    return { ok: true };
  }

  const subtype = poolData.extra_subtype;
  const profile = poolData.extra_rule_profile;
  const featuredValues = (Array.isArray(poolData.featured_characters) ? poolData.featured_characters : [])
    .map((value) => normalizeName(value))
    .filter(Boolean);
  const featuredSet = new Set(featuredValues);
  const characterById = new Map(
    (Array.isArray(characters) ? characters : [])
      .filter((character) => character?.id)
      .map((character) => [character.id, character])
  );
  const upRows = (Array.isArray(poolCharacterRows) ? poolCharacterRows : []).filter((row) => row?.is_up);
  const upCandidates = upRows.map((row) => characterById.get(row.character_id)).filter(Boolean);

  if (subtype === 'special' && profile === 'brilliance_festival_v1') {
    if (poolData.extra_series_key !== null || poolData.extra_series_phase !== null) {
      return {
        ok: false,
        error: '辉光庆典不能保存重构系列字段',
        code: 'brilliance_series_fields_not_allowed',
      };
    }
    if (featuredValues.length !== 4 || featuredSet.size !== 4 || upRows.length !== 4 || upCandidates.length !== 4) {
      return {
        ok: false,
        error: '辉光庆典必须配置恰好 4 名不重复的 6★角色并全部标记为 UP',
        code: 'brilliance_featured_roster_invalid',
      };
    }
    const invalidCandidate = upCandidates.some((character) => (
      character.type !== 'character'
      || Number(character.rarity) !== 6
      || (!featuredSet.has(character.id) && !featuredSet.has(normalizeName(character.name)))
    ));
    if (invalidCandidate) {
      return {
        ok: false,
        error: '辉光庆典的 4 名 UP 必须都是已登记的 6★角色',
        code: 'brilliance_featured_character_invalid',
      };
    }
    return { ok: true };
  }

  const reconstructionSubtypeByProfile = {
    reconstruction_character_v1: 'reconstruction',
    reconstruction_weapon_v1: 'reconstruction_claim',
  };
  if (!reconstructionSubtypeByProfile[profile] || subtype !== reconstructionSubtypeByProfile[profile]) {
    return {
      ok: false,
      error: '附加寻访必须选择重构角色、重构申领或辉光庆典模板',
      code: 'extra_pool_template_required',
    };
  }

  if (!poolData.extra_series_key) {
    return {
      ok: false,
      error: '重构寻访必须填写系列 key',
      code: 'reconstruction_series_key_required',
    };
  }
  if (!Number.isInteger(poolData.extra_series_phase) || poolData.extra_series_phase <= 0) {
    return {
      ok: false,
      error: '重构寻访阶段必须是正整数',
      code: 'reconstruction_series_phase_invalid',
    };
  }
  if (featuredValues.length !== 1 || featuredSet.size !== 1 || upRows.length !== 1 || upCandidates.length !== 1) {
    return {
      ok: false,
      error: '重构寻访必须配置且仅配置 1 个 UP 项',
      code: 'reconstruction_up_roster_invalid',
    };
  }

  const expectedType = profile === 'reconstruction_weapon_v1' ? 'weapon' : 'character';
  const upCandidate = upCandidates[0];
  const upCharacter = normalizeName(poolData.up_character);
  if (
    upCandidate.type !== expectedType
    || Number(upCandidate.rarity) !== 6
    || (!featuredSet.has(upCandidate.id) && !featuredSet.has(normalizeName(upCandidate.name)))
    || (upCharacter !== upCandidate.id && upCharacter !== normalizeName(upCandidate.name))
  ) {
    return {
      ok: false,
      error: `重构寻访的单 UP 必须是已登记的 6★${expectedType === 'weapon' ? '武器' : '角色'}`,
      code: 'reconstruction_up_candidate_invalid',
    };
  }

  return { ok: true };
}

function buildPoolAliasRowsForSave({
  canonicalPoolId,
  editingPool = null,
  poolData = {},
  preferredSource = null,
} = {}) {
  const normalizedCanonicalId = normalizeName(canonicalPoolId);
  if (!normalizedCanonicalId) return [];

  const rows = [...buildPoolSelfAliasRows(normalizedCanonicalId, preferredSource)];
  const previousIds = [
    poolData?.pool_id,
    editingPool?.pool_id,
  ]
    .map((value) => normalizeName(value))
    .filter((value) => value && value !== normalizedCanonicalId);

  previousIds.forEach((aliasId) => {
    rows.push({
      pool_id: normalizedCanonicalId,
      source: inferPoolAliasSource(aliasId) || 'admin_manual',
      alias_id: aliasId,
      is_primary: false,
      note: 'Pool previous id alias',
    });
  });

  return uniqueAliasRows(rows);
}

async function loadPools(adminClient) {
  const { data, error } = await adminClient
    .from('pools')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((pool) => ({
    ...pool,
    extra_subtype: getCanonicalExtraPoolSubtype(pool),
  }));
}

async function loadCharacters(adminClient) {
  const { data, error } = await adminClient
    .from('characters')
    .select('id, name, rarity, type, is_limited, aliases, pool_config, created_at, updated_at')
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('rarity', { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadAllPoolCharacters(adminClient) {
  const { data, error } = await adminClient
    .from('pool_characters')
    .select('pool_id, character_id, is_up');
  if (error) throw error;

  const grouped = {};
  (Array.isArray(data) ? data : []).forEach((row) => {
    if (!grouped[row.pool_id]) grouped[row.pool_id] = [];
    grouped[row.pool_id].push({
      character_id: row.character_id,
      is_up: row.is_up,
    });
  });
  return grouped;
}

async function loadPoolCharactersForEdit(adminClient, poolId) {
  if (!poolId) return [];
  const { data, error } = await adminClient
    .from('pool_characters')
    .select('character_id, is_up')
    .eq('pool_id', poolId);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function saveManagedCharacterWithAliases(adminClient, characterData) {
  const { error } = await adminClient.rpc('admin_upsert_character_with_aliases', {
    p_character_id: characterData.id,
    p_insert_payload: characterData,
    p_update_payload: characterData,
    p_alias_rows: buildCharacterSelfAliasRows(characterData.id),
  });

  if (!error) return;
  if (error.code === 'PGRST202' || /admin_upsert_character_with_aliases/i.test(error.message || '')) {
    throw new Error('缺少数据库迁移 078，请先执行 078_harden_admin_entity_upsert_rpcs.sql');
  }
  throw error;
}

async function upsertPoolWithAliases(adminClient, {
  actorUserId,
  poolId,
  insertPayload,
  updatePayload,
  aliasRows,
  poolCharacterRows = [],
}) {
  const { error } = await adminClient.rpc('admin_upsert_pool_with_aliases', {
    p_pool_id: poolId,
    p_insert_payload: insertPayload,
    p_update_payload: updatePayload,
    p_alias_rows: aliasRows,
    p_pool_character_rows: poolCharacterRows,
    p_actor_user_id: actorUserId || null,
  });

  if (!error) return;
  if (error.code === 'PGRST202' || /admin_upsert_pool_with_aliases/i.test(error.message || '')) {
    throw new Error('缺少数据库迁移 078，请先执行 078_harden_admin_entity_upsert_rpcs.sql');
  }
  throw error;
}

async function replacePoolCharacters(adminClient, poolId, rows = []) {
  const { error: deleteError } = await adminClient
    .from('pool_characters')
    .delete()
    .eq('pool_id', poolId);
  if (deleteError) throw deleteError;
  if (rows.length === 0) return;

  const { error: insertError } = await adminClient
    .from('pool_characters')
    .upsert(
      rows.map((row) => ({
        pool_id: poolId,
        character_id: row.character_id,
        is_up: Boolean(row.is_up),
      })),
      { onConflict: 'pool_id,character_id' }
    );
  if (insertError) throw insertError;
}

async function handleGet(req, res, adminClient) {
  const url = getRequestUrl(req);
  const mode = String(url.searchParams.get('mode') || 'pools').trim();
  const poolId = normalizeName(url.searchParams.get('poolId') || url.searchParams.get('pool_id'));

  if (mode === 'pools') {
    return res.status(200).json({ success: true, data: await loadPools(adminClient) });
  }
  if (mode === 'characters') {
    return res.status(200).json({ success: true, data: await loadCharacters(adminClient) });
  }
  if (mode === 'pool-characters') {
    return res.status(200).json({ success: true, data: await loadAllPoolCharacters(adminClient) });
  }
  if (mode === 'pool-characters-for-edit') {
    return res.status(200).json({ success: true, data: await loadPoolCharactersForEdit(adminClient, poolId) });
  }

  return sendError(res, 400, 'Unsupported admin pools mode', 'admin_pools_mode_invalid');
}

async function handleCreateUpCharacter(res, adminClient, body) {
  const characterName = normalizeName(body.characterName || body.character_name);
  if (!characterName) {
    return sendError(res, 400, 'Character name is required', 'character_name_required');
  }

  const poolType = normalizePoolType(body.poolType || body.pool_type);
  const extraRuleProfile = normalizeName(body.extraRuleProfile || body.extra_rule_profile);
  const reconstructionTypeByProfile = {
    reconstruction_character_v1: 'character',
    reconstruction_weapon_v1: 'weapon',
  };
  if (poolType === 'extra' && !reconstructionTypeByProfile[extraRuleProfile]) {
    return sendError(
      res,
      400,
      '附加寻访仅能在显式选择合法重构模板后自动创建 UP 项',
      'extra_up_character_profile_required'
    );
  }
  const requestedItemType = normalizeName(body.itemType || body.item_type);
  const profileItemType = reconstructionTypeByProfile[extraRuleProfile] || null;
  const characterType = profileItemType
    || (['character', 'weapon'].includes(requestedItemType)
      ? requestedItemType
      : poolType === 'weapon'
        ? 'weapon'
        : 'character');
  if (profileItemType && requestedItemType && requestedItemType !== profileItemType) {
    return sendError(res, 400, '重构模板与 UP 项对象类型不一致', 'reconstruction_item_type_mismatch');
  }
  const charId = buildManualCharacterId(characterName, characterType);
  const safeRotationBaseCount = Number(body.rotationBaseCount || body.rotation_base_count) || 0;
  const newCharacter = {
    id: charId,
    name: characterName,
    rarity: 6,
    type: characterType,
    is_limited: poolType === 'limited' || poolType === 'weapon' || Boolean(profileItemType),
    aliases: [],
    avatar_url: null,
    pool_config: {
      pools: [poolType],
      limited_rotation_count: safeRotationBaseCount,
      removes_after: null,
      is_active_in_limited: poolType === 'limited',
      introduced_at: body.poolStartTime || body.pool_start_time || new Date().toISOString(),
    },
  };

  await saveManagedCharacterWithAliases(adminClient, newCharacter);
  return res.status(200).json({ success: true, character: newCharacter });
}

async function handleSavePool(res, adminClient, authResult, body) {
  const poolData = normalizePoolExtraFields(body.poolData || body.pool_data || {});
  const editingPool = body.editingPool || body.editing_pool || null;
  const characters = Array.isArray(body.characters) ? body.characters : [];
  const editingPoolCharacters = Array.isArray(body.editingPoolCharacters)
    ? body.editingPoolCharacters
    : [];
  const poolCharacterRows = normalizePoolCharacterRows(editingPoolCharacters, characters, poolData);
  const extraContract = validatePoolExtraContract(poolData, poolCharacterRows, characters);
  if (!extraContract.ok) {
    return sendError(res, 400, extraContract.error, extraContract.code);
  }

  if (editingPool) {
    const targetPoolId = normalizeName(poolData.pool_id || editingPool.pool_id);
    if (!targetPoolId) {
      return sendError(res, 400, 'Pool ID is required', 'pool_id_required');
    }

    await upsertPoolWithAliases(adminClient, {
      actorUserId: authResult.user.id,
      poolId: targetPoolId,
      insertPayload: {
        ...poolData,
        user_id: authResult.user.id,
        pool_id: targetPoolId,
      },
      updatePayload: poolData,
      aliasRows: buildPoolAliasRowsForSave({
        canonicalPoolId: targetPoolId,
        editingPool,
        poolData,
      }),
      poolCharacterRows,
    });
    await replacePoolCharacters(adminClient, targetPoolId, poolCharacterRows);
    return res.status(200).json({
      success: true,
      isNew: false,
      addedCount: poolCharacterRows.length,
      poolId: targetPoolId,
    });
  }

  const poolId = buildManualPoolId({
    type: poolData.type,
    name: poolData.name,
    upCharacter: poolData.up_character,
    startTime: poolData.start_time,
    endTime: poolData.end_time,
  });
  const newPoolData = {
    ...poolData,
    user_id: authResult.user.id,
    pool_id: poolId,
    locked: Boolean(poolData.locked),
  };

  await upsertPoolWithAliases(adminClient, {
    actorUserId: authResult.user.id,
    poolId,
    insertPayload: newPoolData,
    updatePayload: newPoolData,
    aliasRows: buildPoolAliasRowsForSave({
      canonicalPoolId: poolId,
      poolData: newPoolData,
    }),
    poolCharacterRows,
  });
  await replacePoolCharacters(adminClient, poolId, poolCharacterRows);

  return res.status(200).json({
    success: true,
    isNew: true,
    addedCount: poolCharacterRows.length,
    poolId,
  });
}

async function handleAddCharacterToPool(res, adminClient, body) {
  const poolId = normalizeName(body.poolId || body.pool_id);
  const characterId = normalizeName(body.characterId || body.character_id);
  if (!poolId || !characterId) {
    return sendError(res, 400, 'Pool ID and character ID are required', 'pool_character_required');
  }

  const { error } = await adminClient
    .from('pool_characters')
    .upsert(
      {
        pool_id: poolId,
        character_id: characterId,
        is_up: Boolean(body.isUp || body.is_up),
      },
      { onConflict: 'pool_id,character_id' }
    );
  if (error) throw error;

  return res.status(200).json({
    success: true,
    poolId,
    characterId,
  });
}

async function handleRemoveCharacterFromPool(res, adminClient, body) {
  const poolId = normalizeName(body.poolId || body.pool_id);
  const characterId = normalizeName(body.characterId || body.character_id);
  if (!poolId || !characterId) {
    return sendError(res, 400, 'Pool ID and character ID are required', 'pool_character_required');
  }

  const { error } = await adminClient
    .from('pool_characters')
    .delete()
    .eq('pool_id', poolId)
    .eq('character_id', characterId);
  if (error) throw error;

  return res.status(200).json({
    success: true,
    poolId,
    characterId,
  });
}

function buildRecalculationPoolLookup(pools) {
  const poolInfoMap = new Map();
  (Array.isArray(pools) ? pools : []).forEach((pool) => {
    const poolId = pool?.id || pool?.pool_id;
    if (!poolId) return;

    const poolInfo = {
      ...pool,
      id: poolId,
      type: pool?.type || pool?.pool_type,
      up_character: pool?.up_character ?? pool?.upCharacter,
      extra_subtype: getCanonicalExtraPoolSubtype(pool),
      extra_rule_profile: pool?.extra_rule_profile ?? pool?.extraRuleProfile,
      extra_series_key: pool?.extra_series_key ?? pool?.extraSeriesKey,
      extra_series_phase: pool?.extra_series_phase ?? pool?.extraSeriesPhase,
    };
    poolInfoMap.set(String(poolId), poolInfo);
  });

  return poolInfoMap;
}

function calculateIsStandard(record, poolInfoMap) {
  const poolInfo = poolInfoMap.get(String(record.pool_id));
  if (!poolInfo) return record.is_standard ?? false;

  const capabilities = resolvePoolCapabilities(poolInfo);
  if (!capabilities.isResolved) {
    return record.is_standard;
  }
  if (capabilities.targetMode === 'none') {
    return true;
  }
  return !isTargetSixStarHistoryRecord(record, poolInfo);
}

async function handleRecalculateIsStandard(res, adminClient, body) {
  const pools = Array.isArray(body.pools) ? body.pools : [];
  if (pools.length === 0) {
    return sendError(res, 400, '没有找到卡池信息，请先创建卡池', 'pools_required');
  }

  const { data: records, error: fetchError } = await adminClient
    .from('history')
    .select('record_id, pool_id, rarity, character_name, item_name, is_standard')
    .eq('rarity', 6);
  if (fetchError) throw fetchError;

  if (!records || records.length === 0) {
    return res.status(200).json({
      success: true,
      changedCount: 0,
      message: '没有找到6星记录',
    });
  }

  const poolInfoMap = buildRecalculationPoolLookup(pools);
  const updates = [];
  records.forEach((record) => {
    const nextIsStandard = calculateIsStandard(record, poolInfoMap);
    if (nextIsStandard !== record.is_standard) {
      updates.push({
        record_id: record.record_id,
        is_standard: nextIsStandard,
      });
    }
  });

  for (let index = 0; index < updates.length; index += HISTORY_RECALCULATE_BATCH_SIZE) {
    const batch = updates.slice(index, index + HISTORY_RECALCULATE_BATCH_SIZE);
    for (const update of batch) {
      const { error: updateError } = await adminClient
        .from('history')
        .update({ is_standard: update.is_standard })
        .eq('record_id', update.record_id);
      if (updateError) {
        throw updateError;
      }
    }
  }

  return res.status(200).json({
    success: true,
    changedCount: updates.length,
    ...(updates.length === 0 ? { message: '所有记录已是最新状态' } : {}),
  });
}

async function handlePost(req, res, adminClient, authResult) {
  const body = parseRequestBody(req);
  const action = String(body.action || '').trim();

  if (action === 'createUpCharacter') {
    return handleCreateUpCharacter(res, adminClient, body);
  }
  if (action === 'savePool') {
    return handleSavePool(res, adminClient, authResult, body);
  }
  if (action === 'addCharacterToPool') {
    return handleAddCharacterToPool(res, adminClient, body);
  }
  if (action === 'removeCharacterFromPool') {
    return handleRemoveCharacterFromPool(res, adminClient, body);
  }
  if (action === 'recalculateIsStandard') {
    return handleRecalculateIsStandard(res, adminClient, body);
  }

  return sendError(res, 400, 'Unsupported admin pools action', 'admin_pools_action_invalid');
}

async function handleDelete(req, res, adminClient) {
  const body = parseRequestBody(req);
  const poolId = normalizeName(body.poolId || body.pool_id);
  if (!poolId) {
    return sendError(res, 400, 'Pool ID is required', 'pool_id_required');
  }

  const { error: rosterError } = await adminClient
    .from('pool_characters')
    .delete()
    .eq('pool_id', poolId);
  if (rosterError) throw rosterError;

  const { error } = await adminClient
    .from('pools')
    .delete()
    .eq('pool_id', poolId);
  if (error) throw error;

  return res.status(200).json({
    success: true,
    poolId,
  });
}

export default async function adminPoolsHandler(req, res) {
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
  if (!adminClient) {
    sendError(res, 503, 'Auth service not configured', 'auth_service_not_configured');
    return;
  }

  const authResult = await requireSuperAdminUser(req, {
    adminClient,
    touch: true,
  });
  if (!authResult.ok) {
    sendError(
      res,
      authResult.status || 401,
      authResult.error || 'Super admin role required',
      authResult.code || 'super_admin_required'
    );
    return;
  }

  try {
    if (req.method === 'GET') {
      await handleGet(req, res, adminClient);
      return;
    }
    if (req.method === 'POST') {
      await handlePost(req, res, adminClient, authResult);
      return;
    }
    await handleDelete(req, res, adminClient);
  } catch (error) {
    const code = req.method === 'GET'
      ? 'admin_pools_load_failed'
      : req.method === 'POST'
        ? 'admin_pools_update_failed'
        : 'admin_pools_delete_failed';
    sendError(res, 500, error?.message || 'Failed to process admin pools', code);
  }
}

export const __internal = {
  buildPoolAliasRowsForSave,
  calculateIsStandard,
  normalizePoolCharacterRows,
};
