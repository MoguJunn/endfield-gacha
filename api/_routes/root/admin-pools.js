import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { requireSuperAdminUser } from '../../_lib/siteAuth.js';
import { readCompletePoolRoster } from '../../_lib/poolRosterRead.js';
import { buildManualCharacterId, buildManualPoolId } from '../../../src/utils/canonicalEntityUtils.js';
import { resolvePoolCapabilities } from '../../../src/utils/poolCapabilities.js';
import { isReservedPoolTypeId } from '../../../shared/poolIdValidation.js';
import { POOL_ROSTER_STATUSES, resolvePoolRosterStatus } from '../../../shared/poolRosterStatus.js';
import {
  buildCharacterSelfAliasRows,
  buildPoolSelfAliasRows,
  inferPoolAliasSource,
} from '../../../shared/idAliasService.js';
import {
  getCanonicalExtraPoolMetadata,
  getCanonicalExtraPoolSubtype,
} from '../../../shared/extraPoolSubtype.js';

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
      : upCharacterName === characterId || (upCharacterName && normalizeName(character?.name) === upCharacterName);

    dedupedRows.set(characterId, {
      character_id: characterId,
      is_up: Boolean(isUp),
    });
  });

  return Array.from(dedupedRows.values());
}

function validatePoolContract(poolData, rows, characters, body) {
  const fail = (error, code) => ({ ok: false, error, code });
  if (!normalizeName(poolData.name) || poolData.name.length > 120) {
    return fail('卡池名称不能为空且不能超过 120 字', 'pool_name_invalid');
  }
  if (!['limited', 'weapon', 'standard', 'beginner', 'extra'].includes(poolData.type)) {
    return fail('卡池类型无效', 'pool_type_invalid');
  }
  for (const field of ['start_time', 'end_time']) {
    if (poolData[field] != null && poolData[field] !== '' && !Number.isFinite(Date.parse(poolData[field]))) {
      return fail('卡池时间格式无效', 'pool_time_invalid');
    }
  }
  if (poolData.start_time && poolData.end_time && Date.parse(poolData.start_time) >= Date.parse(poolData.end_time)) {
    return fail('结束时间必须晚于开始时间', 'pool_time_range_invalid');
  }
  if (!POOL_ROSTER_STATUSES.includes(poolData.roster_status)) {
    return fail('名单完整性状态无效', 'pool_roster_status_invalid');
  }
  if (poolData.roster_status === 'complete' && body.confirmRosterComplete !== true) {
    return fail('请明确确认本期完整名单已核对', 'pool_roster_confirmation_required');
  }
  if (poolData.roster_status === 'missing' && rows.length > 0) {
    return fail('已有名单请标记为不完整或确认完整', 'pool_roster_status_mismatch');
  }
  if (poolData.roster_status === 'partial' && rows.length === 0) {
    return fail('尚未录入名单，请标记为名单缺失', 'pool_roster_status_mismatch');
  }
  const expectedType = poolData.type === 'weapon' || poolData.extra_rule_profile === 'reconstruction_weapon_v1'
    ? 'weapon' : 'character';
  const byId = new Map(characters.map((character) => [character.id, character]));
  if (rows.some((row) => !byId.has(row.character_id) || byId.get(row.character_id).type !== expectedType)) {
    return fail('名单包含未登记项目或对象类型与卡池不一致', 'pool_roster_entity_invalid');
  }
  if (poolData.roster_status === 'complete' && !rows.some((row) => Number(byId.get(row.character_id)?.rarity) === 6)) {
    return fail('完整名单必须包含本期可获得的六星项目', 'pool_roster_complete_empty');
  }
  if (poolData.type !== 'extra') {
    const up = normalizeName(poolData.up_character);
    const upRows = rows.filter((row) => row.is_up);
    if (poolData.featured_characters != null && (
      !Array.isArray(poolData.featured_characters) || poolData.featured_characters.length > 0
    )) {
      return fail('普通卡池请使用单个 UP 项，不能配置附加寻访名单', 'pool_featured_not_allowed');
    }
    if (['standard', 'beginner'].includes(poolData.type) && up) {
      return fail('常驻和新手卡池不能配置 UP 项', 'pool_up_not_allowed');
    }
    if (up && (upRows.length !== 1 || Number(byId.get(upRows[0].character_id)?.rarity) !== 6)) {
      return fail('UP 项必须是名单中唯一匹配的已登记六星项目', 'pool_up_roster_invalid');
    }
  }
  return validatePoolExtraContract(poolData, rows, characters);
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
  const data = await readCompletePoolRoster(adminClient);

  const grouped = {};
  data.forEach((row) => {
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
  const rows = await readCompletePoolRoster(adminClient, [poolId]);
  return rows.map(({ character_id, is_up }) => ({ character_id, is_up }));
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
  const { error } = await adminClient.rpc('admin_save_pool_catalog', {
    p_pool_id: poolId,
    p_insert_payload: insertPayload,
    p_update_payload: updatePayload,
    p_alias_rows: aliasRows,
    p_pool_character_rows: poolCharacterRows,
    p_actor_user_id: actorUserId || null,
  });

  if (!error) return;
  if (error.code === 'PGRST202') {
    throw new Error('缺少目录管理数据库迁移，请先执行 2026100912_admin_pool_catalog_roster_and_recalculation.sql');
  }
  throw error;
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
  // Entity metadata is authoritative server data, never the browser's copy.
  const characters = await loadCharacters(adminClient);
  if (!Array.isArray(body.editingPoolCharacters)) {
    return sendError(res, 400, '请提交已核对的卡池名单，可显式提交空名单', 'pool_roster_required');
  }
  const editingPoolCharacters = Array.isArray(body.editingPoolCharacters)
    ? body.editingPoolCharacters
    : [];
  if (editingPoolCharacters.some((row) => !normalizeName(row?.character_id))) {
    return sendError(res, 400, '名单项目 ID 不能为空', 'pool_roster_entity_invalid');
  }
  poolData.name = normalizeName(poolData.name);
  // Store a catalog name consistently, even when an administrator supplied its ID.
  const resolveEntityName = (value) => {
    const reference = normalizeName(value);
    return characters.find((character) => character.id === reference)?.name || reference;
  };
  poolData.up_character = resolveEntityName(poolData.up_character) || null;
  if (Array.isArray(poolData.featured_characters)) {
    poolData.featured_characters = poolData.featured_characters.map(resolveEntityName);
  }
  poolData.roster_status = poolData.roster_status ?? resolvePoolRosterStatus(null, editingPoolCharacters);
  const poolCharacterRows = normalizePoolCharacterRows(editingPoolCharacters, characters, poolData);
  const extraContract = validatePoolContract(poolData, poolCharacterRows, characters, body);
  if (!extraContract.ok) {
    return sendError(res, 400, extraContract.error, extraContract.code);
  }

  const targetPoolId = normalizeName(poolData.pool_id || editingPool?.pool_id) || (!editingPool && buildManualPoolId({
    type: poolData.type, name: poolData.name, upCharacter: poolData.up_character,
    startTime: poolData.start_time, endTime: poolData.end_time,
  }));
  if (!targetPoolId || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/u.test(targetPoolId) || isReservedPoolTypeId(targetPoolId)) {
    return sendError(res, 400, '卡池 ID 无效或使用了类型保留字', 'pool_id_invalid');
    }
  if (editingPool && normalizeName(editingPool.pool_id) !== targetPoolId) {
    return sendError(res, 400, '已有卡池 ID 不可更改', 'pool_id_immutable');
  }
  const { data: existing, error: existingError } = await adminClient.from('pools').select('pool_id').eq('pool_id', targetPoolId);
  if (existingError) throw existingError;
  if (editingPool && !existing?.length) return sendError(res, 404, '卡池不存在', 'pool_not_found');
  if (!editingPool && existing?.length) return sendError(res, 409, '卡池 ID 已存在', 'pool_id_exists');

  if (editingPool) {

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
    return res.status(200).json({
      success: true,
      isNew: false,
      addedCount: poolCharacterRows.length,
      poolId: targetPoolId,
    });
  }

  const poolId = targetPoolId;
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

  return res.status(200).json({
    success: true,
    isNew: true,
    addedCount: poolCharacterRows.length,
    poolId,
  });
}

async function handleAddCharacterToPool(res, adminClient, authResult, body) {
  const poolId = normalizeName(body.poolId || body.pool_id);
  const characterId = normalizeName(body.characterId || body.character_id);
  if (!poolId || !characterId) {
    return sendError(res, 400, 'Pool ID and character ID are required', 'pool_character_required');
  }

  const { data, error } = await adminClient.from('pools').select('*').eq('pool_id', poolId);
  if (error) throw error;
  if (!data?.[0]) return sendError(res, 404, '卡池不存在', 'pool_not_found');
  const rows = await loadPoolCharactersForEdit(adminClient, poolId);
  return handleSavePool(res, adminClient, authResult, {
    editingPool: data[0],
    poolData: { ...data[0], roster_status: 'partial' },
    editingPoolCharacters: [...rows.filter((row) => row.character_id !== characterId), { character_id: characterId }],
  });
}

async function handleRemoveCharacterFromPool(res, adminClient, authResult, body) {
  const poolId = normalizeName(body.poolId || body.pool_id);
  const characterId = normalizeName(body.characterId || body.character_id);
  if (!poolId || !characterId) {
    return sendError(res, 400, 'Pool ID and character ID are required', 'pool_character_required');
  }

  const { data, error } = await adminClient.from('pools').select('*').eq('pool_id', poolId);
  if (error) throw error;
  if (!data?.[0]) return sendError(res, 404, '卡池不存在', 'pool_not_found');
  const rows = (await loadPoolCharactersForEdit(adminClient, poolId)).filter((row) => row.character_id !== characterId);
  return handleSavePool(res, adminClient, authResult, {
    editingPool: data[0],
    poolData: { ...data[0], roster_status: rows.length ? 'partial' : 'missing' },
    editingPoolCharacters: rows,
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
  if (!poolInfo) return record.is_standard;

  const capabilities = resolvePoolCapabilities(poolInfo);
  if (!capabilities.isResolved) {
    return record.is_standard;
  }
  if (capabilities.targetMode === 'none') {
    return true;
  }
  if (capabilities.targetMode === 'four-target-equal') return false;
  if (capabilities.targetMode !== 'single-up') return record.is_standard;
  const targetNames = new Set([
    poolInfo.up_character,
    ...(Array.isArray(poolInfo.up_character_aliases) ? poolInfo.up_character_aliases : []),
  ].map(normalizeName).filter(Boolean));
  if (!targetNames.size) return record.is_standard;
  if (poolInfo.up_character_id && record.character_id) {
    return poolInfo.up_character_id !== record.character_id;
  }
  const recordName = normalizeName(record.character_name || record.item_name);
  if (!recordName) return record.is_standard;
  return !targetNames.has(recordName);
}

async function handleRecalculateIsStandard(res, adminClient, body) {
  const mode = body.mode || 'preview';
  if (!['preview', 'apply'].includes(mode)) {
    return sendError(res, 400, '请选择预览或应用', 'recalculate_mode_invalid');
  }
  if (mode === 'apply' && !body.previewToken) {
    return sendError(res, 400, '请先预览全服重算范围', 'recalculate_preview_required');
  }
  const { data: snapshot, error: fetchError } = await adminClient.rpc('admin_pool_recalculation_snapshot');
  if (fetchError) throw fetchError;
  if (mode === 'apply' && snapshot.previewToken !== body.previewToken) {
    return sendError(res, 409, '预览后卡池或记录已变化，请重新预览', 'recalculate_preview_stale');
  }
  const { pools = [], records = [] } = snapshot;
  const poolInfoMap = buildRecalculationPoolLookup(pools);
  const updates = [];
  records.forEach((record) => {
    const nextIsStandard = calculateIsStandard(record, poolInfoMap);
    if (nextIsStandard !== record.is_standard) {
      updates.push({
        id: record.id,
        user_id: record.user_id,
        game_uid: record.game_uid,
        server_id: record.server_id,
        pool_id: record.pool_id,
        record_id: record.record_id,
        is_standard: nextIsStandard,
      });
    }
  });

  const scope = {
    kind: 'all-users-six-star',
    recordCount: records.length,
    affectedPoolIds: [...new Set(updates.map((record) => record.pool_id))].sort(),
    affectedUserCount: new Set(updates.map((record) => record.user_id)).size,
  };
  if (mode === 'apply') {
    const { error } = await adminClient.rpc('admin_apply_pool_recalculation', {
      p_preview_token: body.previewToken,
      p_updates: updates,
    });
    if (error?.message?.includes('recalculate_preview_stale')) {
      return sendError(res, 409, '预览后卡池或记录已变化，请重新预览', 'recalculate_preview_stale');
    }
    if (error) throw error;
  }
  return res.status(200).json({
    success: true,
    mode,
    previewToken: snapshot.previewToken,
    scope,
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
    return handleAddCharacterToPool(res, adminClient, authResult, body);
  }
  if (action === 'removeCharacterFromPool') {
    return handleRemoveCharacterFromPool(res, adminClient, authResult, body);
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
    if (error?.message?.includes('pool_alias_conflict')) {
      return sendError(res, 409, '卡池别名已关联其他卡池，请先核对别名归属', 'pool_alias_conflict');
    }
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
