import {
  classifyCharacterIdSource,
  classifyPoolIdSource,
  normalizeEntityNameForMatch,
  normalizePoolType,
} from './canonicalEntityUtils.js';
import {
  buildCharacterSelfAliasRows,
  buildPoolSelfAliasRows,
  upsertCharacterAliases,
  upsertPoolAliases,
} from './idAliasService.js';
import {
  getCanonicalExtraPoolMetadata,
  getCanonicalExtraPoolSubtype,
} from '../../shared/extraPoolSubtype.js';

const MAX_CATALOG_ROWS = 2000;
const MIN_POOL_MATCH_SCORE = 40;
const MIN_CHARACTER_MATCH_SCORE = 50;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function uniqueById(rows, getId) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = normalizeText(getId(row));
    if (!id || map.has(id)) {
      continue;
    }
    map.set(id, row);
  }
  return Array.from(map.values());
}

function stripPreviewNoise(value) {
  return normalizeText(value)
    .replace(/（[^）]*(前瞻|不准确)[^）]*）/g, '')
    .replace(/\([^)]*(前瞻|不准确)[^)]*\)/g, '')
    .replace(/前瞻|六星不准确|不准确/g, '');
}

function normalizeNameKey(value) {
  return normalizeEntityNameForMatch(stripPreviewNoise(value));
}

function isGenericPoolName(value) {
  const key = normalizeNameKey(value);
  return new Set(['限定角色池', '限定池', '武器池', '附加寻访', '基础寻访', '启程寻访', 'standard', 'beginner']).has(
    key
  );
}

function normalizeDateKey(value) {
  return normalizeText(value).slice(0, 10);
}

function isOfficialImportPoolId(poolId, { allowUnknownOfficialIds = false } = {}) {
  const source = classifyPoolIdSource(poolId);
  if (source === 'official') {
    return true;
  }

  return allowUnknownOfficialIds
    && source !== 'unknown'
    && source !== 'manual_placeholder'
    && source !== 'legacy_manual_seed';
}

function isManualPoolId(poolId) {
  const source = classifyPoolIdSource(poolId);
  return source === 'manual_placeholder' || source === 'legacy_manual_seed';
}

function isOfficialImportCharacterId(characterId) {
  const source = classifyCharacterIdSource(characterId);
  return Boolean(characterId) && (source === 'seeded' || source === 'source_raw');
}

function isStableOfficialCharacterId(characterId) {
  return classifyCharacterIdSource(characterId) === 'seeded';
}

function isRawOfficialImportCharacterAliasId(characterId) {
  return classifyCharacterIdSource(characterId) === 'source_raw';
}

function isManualCharacterId(characterId) {
  return classifyCharacterIdSource(characterId) === 'manual_placeholder';
}

async function resolveQueryResult(query, fallbackData = []) {
  if (!query) {
    return { data: fallbackData, error: null, skipped: true };
  }

  if (typeof query.then === 'function') {
    return query;
  }

  if ('data' in query || 'error' in query) {
    return query;
  }

  return { data: fallbackData, error: null, skipped: true };
}

async function loadTableRows(adminClient, tableName, columns) {
  if (!adminClient?.from) {
    return [];
  }

  const query = adminClient.from(tableName).select(columns);
  const limitedQuery = typeof query?.limit === 'function' ? query.limit(MAX_CATALOG_ROWS) : query;
  const { data, error } = await resolveQueryResult(limitedQuery, []);
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

async function selectEq(adminClient, tableName, columns, columnName, value) {
  const table = adminClient?.from?.(tableName);
  const query = table?.select?.(columns);
  const filteredQuery = typeof query?.eq === 'function' ? query.eq(columnName, value) : null;
  const { data, error } = await resolveQueryResult(filteredQuery, []);
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

async function upsertRows(adminClient, tableName, rows, options = {}) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
  if (normalizedRows.length === 0) {
    return;
  }

  const { error } = await adminClient.from(tableName).upsert(normalizedRows, options);

  if (error) {
    throw error;
  }
}

async function updateEq(adminClient, tableName, values, columnName, value) {
  const table = adminClient?.from?.(tableName);
  const query = table?.update?.(values);
  const filteredQuery = typeof query?.eq === 'function' ? query.eq(columnName, value) : null;
  const { error } = await resolveQueryResult(filteredQuery, null);
  if (error) {
    throw error;
  }
}

async function deleteEq(adminClient, tableName, columnName, value) {
  const table = adminClient?.from?.(tableName);
  const query = table?.delete?.();
  const filteredQuery = typeof query?.eq === 'function' ? query.eq(columnName, value) : null;
  const { error } = await resolveQueryResult(filteredQuery, null);
  if (error) {
    throw error;
  }
}

function normalizePoolCandidate(pool, options = {}) {
  const poolId = normalizeText(pool?.pool_id || pool?.id || pool?.poolId);
  if (!poolId || !isOfficialImportPoolId(poolId, options)) {
    return null;
  }
  const type = normalizePoolType(pool?.type || pool?.pool_type || pool?.poolType);
  const extraMetadata = type === 'extra'
    ? getCanonicalExtraPoolMetadata(pool)
    : {
        extra_subtype: null,
        extra_rule_profile: null,
        extra_series_key: null,
        extra_series_phase: null,
      };

  return {
    pool_id: poolId,
    name: normalizeText(pool?.name || pool?.pool_name || pool?.poolName) || poolId,
    type,
    ...extraMetadata,
    start_time: pool?.start_time || pool?.startTime || null,
    end_time: pool?.end_time || pool?.endTime || null,
    up_character: normalizeText(pool?.up_character || pool?.upCharacter || pool?.currentUpCharacter) || null,
    featured_characters: Array.isArray(pool?.featured_characters)
      ? pool.featured_characters
      : (Array.isArray(pool?.featuredCharacters) ? pool.featuredCharacters : null),
    description: normalizeText(pool?.description) || null,
    banner_url: normalizeText(pool?.banner_url || pool?.bannerUrl) || null,
    locked: Boolean(pool?.locked),
    user_id: pool?.user_id || null,
  };
}

function normalizeCharacterCandidate(record) {
  const id = normalizeText(record?.id || record?.character_id || record?.item_id || record?.charId || record?.weaponId);
  if (!id || !isOfficialImportCharacterId(id)) {
    return null;
  }

  const explicitType = normalizeText(record?.type || record?.recordType);
  const inferredType =
    explicitType === 'weapon' || record?.weaponId || id.startsWith('weapon_') ? 'weapon' : 'character';

  return {
    id,
    idSource: classifyCharacterIdSource(id),
    name:
      normalizeText(
        record?.name || record?.character_name || record?.item_name || record?.charName || record?.weaponName
      ) || id,
    type: inferredType,
    rarity: Number.parseInt(String(record?.rarity || record?.qualityLevel || ''), 10) || null,
  };
}

function scorePoolCandidate(officialPool, manualPool) {
  const officialType = normalizePoolType(officialPool?.type);
  const manualType = normalizePoolType(manualPool?.type);
  const manualProfile = normalizeText(manualPool?.extra_rule_profile);
  const isReconstructionCharacterMatch =
    new Set(['extra', 'limited']).has(officialType)
    && manualType === 'extra'
    && getCanonicalExtraPoolSubtype(manualPool) === 'reconstruction'
    && manualProfile === 'reconstruction_character_v1';
  const isReconstructionWeaponMatch =
    new Set(['extra', 'weapon']).has(officialType)
    && manualType === 'extra'
    && getCanonicalExtraPoolSubtype(manualPool) === 'reconstruction_claim'
    && manualProfile === 'reconstruction_weapon_v1';

  if (officialType !== manualType && !isReconstructionCharacterMatch && !isReconstructionWeaponMatch) {
    return 0;
  }

  let score = 0;
  const officialUpKey = normalizeNameKey(officialPool?.up_character);
  const manualUpKey = normalizeNameKey(manualPool?.up_character);
  const officialNameKey = normalizeNameKey(officialPool?.name);
  const manualNameKey = normalizeNameKey(manualPool?.name);

  if (officialUpKey && manualUpKey && officialUpKey === manualUpKey) {
    score += 60;
  }

  if (officialNameKey && manualNameKey && officialNameKey === manualNameKey && !isGenericPoolName(officialPool?.name)) {
    score += 45;
  }

  const officialStart = normalizeDateKey(officialPool?.start_time);
  const manualStart = normalizeDateKey(manualPool?.start_time);
  if (officialStart && manualStart) {
    score += officialStart === manualStart ? 10 : -25;
  }

  return Math.max(0, score);
}

function scoreCharacterCandidate(officialCharacter, manualCharacter) {
  if (normalizeText(officialCharacter?.type) !== normalizeText(manualCharacter?.type)) {
    return 0;
  }

  const officialNameKey = normalizeNameKey(officialCharacter?.name);
  const manualNameKey = normalizeNameKey(manualCharacter?.name);
  if (!officialNameKey || !manualNameKey || officialNameKey !== manualNameKey) {
    return 0;
  }

  let score = 80;
  const officialRarity = Number.parseInt(String(officialCharacter?.rarity || ''), 10);
  const candidateRarity = Number.parseInt(String(manualCharacter?.rarity || ''), 10);
  if (Number.isFinite(officialRarity) && Number.isFinite(candidateRarity)) {
    score += officialRarity === candidateRarity ? 8 : -12;
  }

  const candidateId = normalizeText(manualCharacter?.id).toLowerCase();
  const candidateSource = classifyCharacterIdSource(candidateId);
  if (candidateSource === 'manual_placeholder') {
    score -= 10;
  }
  if (candidateId.startsWith('chr_') || candidateId.startsWith('wpn_')) {
    score += 8;
  } else if (candidateId.startsWith('char_') || candidateId.startsWith('weapon_')) {
    score += 2;
  }
  if (normalizeText(manualCharacter?.avatar_url)) {
    score += 4;
  }

  return Math.max(0, score);
}

function findUniqueMatch(target, candidates, scorer, minScore) {
  const scored = candidates
    .map((candidate) => ({ candidate, score: scorer(target, candidate) }))
    .filter((item) => item.score >= minScore)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return { match: null, reason: 'no_match' };
  }

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { match: null, reason: 'ambiguous_match' };
  }

  return { match: scored[0].candidate, reason: 'matched', score: scored[0].score };
}

function buildMergedPoolRow(officialPool, manualPool, userId) {
  const manualSubtype = getCanonicalExtraPoolSubtype(manualPool);
  const preserveReconstructionContract =
    normalizePoolType(manualPool?.type) === 'extra'
    && ['reconstruction', 'reconstruction_claim'].includes(manualSubtype);

  return {
    pool_id: officialPool.pool_id,
    name: officialPool.name || manualPool?.name || officialPool.pool_id,
    type: preserveReconstructionContract ? 'extra' : (officialPool.type || manualPool?.type || 'standard'),
    extra_subtype: preserveReconstructionContract
      ? manualSubtype
      : getCanonicalExtraPoolSubtype(officialPool),
    extra_rule_profile: manualPool?.extra_rule_profile || officialPool.extra_rule_profile || null,
    extra_series_key: manualPool?.extra_series_key || officialPool.extra_series_key || null,
    extra_series_phase: manualPool?.extra_series_phase || officialPool.extra_series_phase || null,
    start_time: officialPool.start_time || manualPool?.start_time || null,
    end_time: officialPool.end_time || manualPool?.end_time || null,
    up_character: officialPool.up_character || manualPool?.up_character || null,
    featured_characters: officialPool.featured_characters || manualPool?.featured_characters || null,
    description: manualPool?.description || officialPool.description || null,
    banner_url: manualPool?.banner_url || officialPool.banner_url || null,
    locked: manualPool ? Boolean(manualPool.locked) : Boolean(officialPool.locked),
    user_id: manualPool ? (manualPool.user_id ?? null) : (officialPool.user_id || userId || null),
    updated_at: new Date().toISOString(),
  };
}

function isPromotionRpcMissing(error) {
  return normalizeText(error?.code) === 'PGRST202';
}

function requiresAtomicPoolPromotion(pool) {
  return normalizePoolType(pool?.type) === 'extra'
    && normalizeText(pool?.extra_subtype) === 'reconstruction'
    && new Set(['reconstruction_character_v1', 'reconstruction_weapon_v1']).has(
      normalizeText(pool?.extra_rule_profile)
    );
}

async function promoteManualPoolWithRpc(adminClient, manualPoolId, officialPool) {
  if (typeof adminClient?.rpc !== 'function') {
    throw new Error('Supabase admin client does not support RPC pool promotion');
  }

  const { error } = await adminClient.rpc('promote_manual_pool_to_official_id', {
    p_manual_pool_id: manualPoolId,
    p_official_pool: officialPool,
  });

  if (!error) {
    return { promoted: true, fallback: false };
  }

  if (isPromotionRpcMissing(error)) {
    return { promoted: false, fallback: true };
  }

  throw error;
}

function getPoolConfigWeight(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return 0;
  }
  const pools = Array.isArray(config.pools) ? config.pools.length : 0;
  return pools + Object.keys(config).length;
}

function mergeCharacterPoolConfig(...configs) {
  const sortedConfigs = configs
    .filter((config) => config && typeof config === 'object' && !Array.isArray(config))
    .sort((left, right) => getPoolConfigWeight(right) - getPoolConfigWeight(left));
  for (const config of sortedConfigs) {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      return config;
    }
  }
  return null;
}

function buildMergedCharacterRow(officialCharacter, manualCharacter, existingTarget = null) {
  const aliases = new Set(
    [
      ...(Array.isArray(existingTarget?.aliases) ? existingTarget.aliases : []),
      ...(Array.isArray(manualCharacter?.aliases) ? manualCharacter.aliases : []),
      existingTarget?.id,
      manualCharacter?.id,
      officialCharacter?.name,
    ]
      .map(normalizeText)
      .filter(Boolean)
  );
  const createdAt = existingTarget?.created_at || manualCharacter?.created_at;

  const row = {
    id: officialCharacter.id,
    name: officialCharacter.name || existingTarget?.name || manualCharacter?.name || officialCharacter.id,
    type: officialCharacter.type || existingTarget?.type || manualCharacter?.type || 'character',
    rarity: officialCharacter.rarity || existingTarget?.rarity || manualCharacter?.rarity || null,
    avatar_url: existingTarget?.avatar_url || manualCharacter?.avatar_url || null,
    is_limited: Boolean(existingTarget?.is_limited || manualCharacter?.is_limited),
    release_date: existingTarget?.release_date || manualCharacter?.release_date || null,
    pool_config: mergeCharacterPoolConfig(existingTarget?.pool_config, manualCharacter?.pool_config),
    aliases: Array.from(aliases),
    updated_at: new Date().toISOString(),
  };

  if (createdAt) {
    row.created_at = createdAt;
  }

  return row;
}

function isCanonicalCharacterMatchCandidate(character) {
  const source = classifyCharacterIdSource(character?.id);
  return source === 'seeded' || source === 'manual_placeholder';
}

function buildRawOfficialCharacterAliasRow(rawCharacter, targetCharacterId) {
  return {
    source: 'official_api',
    alias_id: rawCharacter.id,
    character_id: targetCharacterId,
    is_primary: false,
    note: `Official import raw character id ${rawCharacter.id} resolved by name ${rawCharacter.name || ''}`.trim(),
  };
}

async function copyPoolCharactersToTarget(adminClient, sourcePoolId, targetPoolId) {
  const rows = await selectEq(
    adminClient,
    'pool_characters',
    'pool_id, character_id, is_up, created_at',
    'pool_id',
    sourcePoolId
  );

  if (rows.length > 0) {
    await upsertRows(
      adminClient,
      'pool_characters',
      rows.map((row) => ({
        ...row,
        pool_id: targetPoolId,
      })),
      { onConflict: 'pool_id,character_id' }
    );
  }

  await deleteEq(adminClient, 'pool_characters', 'pool_id', sourcePoolId);
}

async function copyCharacterPoolRosterToTarget(adminClient, sourceCharacterId, targetCharacterId) {
  const rows = await selectEq(
    adminClient,
    'pool_characters',
    'pool_id, character_id, is_up, created_at',
    'character_id',
    sourceCharacterId
  );

  if (rows.length > 0) {
    const existingRows = await selectEq(
      adminClient,
      'pool_characters',
      'pool_id, character_id, is_up, created_at',
      'character_id',
      targetCharacterId
    );
    const existingRowsByPoolId = new Map(existingRows.map((row) => [normalizeText(row.pool_id), row]));
    const rowsToUpsert = rows
      .map((row) => {
        const existing = existingRowsByPoolId.get(normalizeText(row.pool_id));
        if (!existing) {
          return {
            ...row,
            character_id: targetCharacterId,
          };
        }

        if (Boolean(existing.is_up) === true || Boolean(row.is_up) !== true) {
          return null;
        }

        return {
          ...existing,
          is_up: true,
        };
      })
      .filter(Boolean);

    await upsertRows(adminClient, 'pool_characters', rowsToUpsert, { onConflict: 'pool_id,character_id' });
  }

  await deleteEq(adminClient, 'pool_characters', 'character_id', sourceCharacterId);
}

async function replaceFeaturedCharacterRefs(adminClient, sourceCharacterId, targetCharacterId) {
  const pools = await loadTableRows(adminClient, 'pools', 'pool_id, featured_characters');
  const updates = pools
    .filter((pool) => Array.isArray(pool.featured_characters) && pool.featured_characters.includes(sourceCharacterId))
    .map((pool) => ({
      pool_id: pool.pool_id,
      featured_characters: Array.from(
        new Set(pool.featured_characters.map((item) => (item === sourceCharacterId ? targetCharacterId : item)))
      ),
    }));

  for (const update of updates) {
    await updateEq(
      adminClient,
      'pools',
      {
        featured_characters: update.featured_characters,
        updated_at: new Date().toISOString(),
      },
      'pool_id',
      update.pool_id
    );
  }
}

async function updateHistoryCharacterIdIfPresent(adminClient, sourceCharacterId, targetCharacterId) {
  try {
    await updateEq(
      adminClient,
      'history',
      {
        character_id: targetCharacterId,
        updated_at: new Date().toISOString(),
      },
      'character_id',
      sourceCharacterId
    );
  } catch (error) {
    const message = String(error?.message || '');
    if (
      message.includes('history.character_id does not exist') ||
      message.includes("Could not find the 'character_id' column")
    ) {
      return;
    }
    throw error;
  }
}

async function migratePoolPlaceholder(adminClient, sourcePool, targetPoolId) {
  await upsertPoolAliases(adminClient, [
    ...buildPoolSelfAliasRows(targetPoolId, 'official_api'),
    {
      source: 'manual_placeholder',
      alias_id: sourcePool.pool_id,
      pool_id: targetPoolId,
      is_primary: false,
      note: `Official import retired manual pool id ${sourcePool.pool_id}`,
    },
  ]);

  await updateEq(
    adminClient,
    'history',
    {
      pool_id: targetPoolId,
      updated_at: new Date().toISOString(),
    },
    'pool_id',
    sourcePool.pool_id
  );

  await copyPoolCharactersToTarget(adminClient, sourcePool.pool_id, targetPoolId);
  await deleteEq(adminClient, 'pools', 'pool_id', sourcePool.pool_id);
}

async function migrateCharacterPlaceholder(adminClient, sourceCharacter, targetCharacterId) {
  await upsertCharacterAliases(adminClient, [
    ...buildCharacterSelfAliasRows(targetCharacterId, 'official_api'),
    {
      source: 'manual_placeholder',
      alias_id: sourceCharacter.id,
      character_id: targetCharacterId,
      is_primary: false,
      note: `Official import retired manual character id ${sourceCharacter.id}`,
    },
  ]);

  await updateHistoryCharacterIdIfPresent(adminClient, sourceCharacter.id, targetCharacterId);
  await copyCharacterPoolRosterToTarget(adminClient, sourceCharacter.id, targetCharacterId);
  await replaceFeaturedCharacterRefs(adminClient, sourceCharacter.id, targetCharacterId);
  await deleteEq(adminClient, 'characters', 'id', sourceCharacter.id);
}

async function retireRawCharacterDuplicate(adminClient, sourceCharacter, targetCharacterId) {
  await updateEq(
    adminClient,
    'character_id_aliases',
    {
      character_id: targetCharacterId,
      is_primary: false,
      updated_at: new Date().toISOString(),
    },
    'character_id',
    sourceCharacter.id
  );
  await updateHistoryCharacterIdIfPresent(adminClient, sourceCharacter.id, targetCharacterId);
  await copyCharacterPoolRosterToTarget(adminClient, sourceCharacter.id, targetCharacterId);
  await replaceFeaturedCharacterRefs(adminClient, sourceCharacter.id, targetCharacterId);
  await deleteEq(adminClient, 'characters', 'id', sourceCharacter.id);
}

export async function reconcileOfficialPoolIds(
  adminClient,
  pools,
  { userId = null, allowUnknownOfficialIds = false } = {}
) {
  const officialPools = uniqueById(
    (Array.isArray(pools) ? pools : [])
      .map((pool) => normalizePoolCandidate(pool, { allowUnknownOfficialIds }))
      .filter(Boolean),
    (row) => row.pool_id
  );

  if (officialPools.length === 0) {
    return { created: 0, migrated: 0, skipped: 0, operations: [] };
  }

  const existingPools = await loadTableRows(
    adminClient,
    'pools',
    'pool_id, name, type, extra_subtype, extra_rule_profile, extra_series_key, extra_series_phase, start_time, end_time, up_character, featured_characters, description, banner_url, locked, user_id'
  );
  const byId = new Map(existingPools.map((row) => [normalizeText(row.pool_id), row]));
  const manualPools = existingPools.filter((row) => isManualPoolId(row.pool_id));
  const operations = [];
  const targetRows = [];

  for (const officialPool of officialPools) {
    const existingTarget = byId.get(officialPool.pool_id);
    const { match, reason, score } = findUniqueMatch(
      officialPool,
      manualPools.filter((row) => normalizeText(row.pool_id) !== officialPool.pool_id),
      scorePoolCandidate,
      MIN_POOL_MATCH_SCORE
    );

    if (!match) {
      if (!existingTarget) {
        targetRows.push(buildMergedPoolRow(officialPool, null, userId));
      }
      operations.push({
        kind: 'pool',
        officialId: officialPool.pool_id,
        action: existingTarget ? 'already_official' : 'created_official',
        reason,
      });
      continue;
    }

    const mergedPool = buildMergedPoolRow(officialPool, match, userId);
    const useAtomicPromotion = requiresAtomicPoolPromotion(match);
    const promotion = useAtomicPromotion
      ? await promoteManualPoolWithRpc(adminClient, match.pool_id, mergedPool)
      : { promoted: false, fallback: true };

    if (!promotion.promoted) {
      targetRows.push(mergedPool);
    }

    operations.push({
      kind: 'pool',
      officialId: officialPool.pool_id,
      manualId: match.pool_id,
      action: 'migrated_manual_placeholder',
      promotionMode: promotion.promoted ? 'rpc' : (useAtomicPromotion ? 'compatibility' : 'legacy'),
      score,
    });
  }

  await upsertRows(adminClient, 'pools', targetRows, { onConflict: 'pool_id' });

  for (const operation of operations) {
    if (operation.action !== 'migrated_manual_placeholder' || operation.promotionMode === 'rpc') {
      continue;
    }
    const sourcePool = byId.get(operation.manualId);
    await migratePoolPlaceholder(adminClient, sourcePool, operation.officialId);
  }

  await upsertPoolAliases(
    adminClient,
    officialPools.flatMap((pool) => buildPoolSelfAliasRows(pool.pool_id, 'official_api'))
  );

  return {
    created: operations.filter((item) => item.action === 'created_official').length,
    migrated: operations.filter((item) => item.action === 'migrated_manual_placeholder').length,
    skipped: operations.filter((item) => item.reason === 'ambiguous_match').length,
    operations,
  };
}

export async function reconcileOfficialCharacterIds(adminClient, records) {
  const importCharacters = uniqueById(
    (Array.isArray(records) ? records : []).map(normalizeCharacterCandidate).filter(Boolean),
    (row) => row.id
  );
  const officialCharacters = importCharacters.filter((character) => isStableOfficialCharacterId(character.id));
  const rawAliasCharacters = importCharacters.filter((character) => isRawOfficialImportCharacterAliasId(character.id));

  if (officialCharacters.length === 0 && rawAliasCharacters.length === 0) {
    return { created: 0, migrated: 0, aliased: 0, rawDuplicatesRetired: 0, skipped: 0, operations: [] };
  }

  const existingCharacters = await loadTableRows(
    adminClient,
    'characters',
    'id, name, type, rarity, aliases, avatar_url, is_limited, release_date, pool_config, created_at'
  );
  const byId = new Map(existingCharacters.map((row) => [normalizeText(row.id), row]));
  const manualCharacters = existingCharacters.filter((row) => isManualCharacterId(row.id));
  const operations = [];
  const targetRows = [];

  for (const officialCharacter of officialCharacters) {
    const existingTarget = byId.get(officialCharacter.id);
    const { match, reason, score } = findUniqueMatch(
      officialCharacter,
      manualCharacters.filter((row) => normalizeText(row.id) !== officialCharacter.id),
      scoreCharacterCandidate,
      MIN_CHARACTER_MATCH_SCORE
    );

    if (!existingTarget || match) {
      targetRows.push(buildMergedCharacterRow(officialCharacter, match, existingTarget));
    }

    if (!match) {
      operations.push({
        kind: 'character',
        officialId: officialCharacter.id,
        action: existingTarget ? 'already_official' : 'created_official',
        reason,
      });
      continue;
    }

    operations.push({
      kind: 'character',
      officialId: officialCharacter.id,
      manualId: match.id,
      action: 'migrated_manual_placeholder',
      score,
    });
  }

  await upsertRows(adminClient, 'characters', targetRows, { onConflict: 'id' });

  for (const operation of operations) {
    if (operation.action !== 'migrated_manual_placeholder') {
      continue;
    }
    const sourceCharacter = byId.get(operation.manualId);
    await migrateCharacterPlaceholder(adminClient, sourceCharacter, operation.officialId);
  }

  const canonicalCandidates = [...existingCharacters, ...targetRows].filter(isCanonicalCharacterMatchCandidate);
  const characterAliasRows = officialCharacters.flatMap((character) =>
    buildCharacterSelfAliasRows(character.id, 'official_api')
  );

  for (const rawCharacter of rawAliasCharacters) {
    const existingRawDuplicate = byId.get(rawCharacter.id);
    const { match, reason, score } = findUniqueMatch(
      rawCharacter,
      canonicalCandidates.filter((row) => normalizeText(row.id) !== rawCharacter.id),
      scoreCharacterCandidate,
      MIN_CHARACTER_MATCH_SCORE
    );

    if (!match) {
      operations.push({
        kind: 'character',
        officialId: rawCharacter.id,
        action: 'skipped_raw_alias',
        reason,
      });
      continue;
    }

    characterAliasRows.push(buildRawOfficialCharacterAliasRow(rawCharacter, match.id));
    operations.push({
      kind: 'character',
      officialId: rawCharacter.id,
      canonicalId: match.id,
      action: existingRawDuplicate ? 'retired_raw_duplicate' : 'aliased_raw_id',
      score,
    });

    if (existingRawDuplicate) {
      await retireRawCharacterDuplicate(adminClient, existingRawDuplicate, match.id);
    }
  }

  await upsertCharacterAliases(adminClient, characterAliasRows);

  return {
    created: operations.filter((item) => item.action === 'created_official').length,
    migrated: operations.filter((item) => item.action === 'migrated_manual_placeholder').length,
    aliased: operations.filter((item) => item.action === 'aliased_raw_id').length,
    rawDuplicatesRetired: operations.filter((item) => item.action === 'retired_raw_duplicate').length,
    skipped: operations.filter((item) => item.reason === 'ambiguous_match').length,
    operations,
  };
}

export default {
  reconcileOfficialCharacterIds,
  reconcileOfficialPoolIds,
};
