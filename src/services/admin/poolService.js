import { buildPoolSelfAliasRows, inferPoolAliasSource } from '../../../shared/idAliasService.js';
import { getSupabaseAccessToken } from '../authFetchService.js';
import { fetchJsonWithTimeout } from '../supabaseRequest.js';

const ADMIN_POOLS_TIMEOUT_MS = 60000;

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueAliasRows(rows = []) {
  const deduped = new Map();

  rows.forEach((row) => {
    const source = normalizeName(row?.source);
    const aliasId = normalizeName(row?.alias_id);
    const poolId = normalizeName(row?.pool_id);
    if (!source || !aliasId || !poolId) {
      return;
    }

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

async function buildAdminPoolsHeaders(extraHeaders = {}) {
  const accessToken = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  }).catch(() => null);

  const headers = {
    Accept: 'application/json',
    ...extraHeaders,
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

function throwAdminPoolsError(data, response, fallbackMessage, fallbackCode) {
  const error = new Error(data?.error || `${fallbackMessage} (${response.status})`);
  error.code = data?.code || fallbackCode;
  error.status = response.status;
  throw error;
}

async function requestAdminPools({
  method = 'GET',
  params = null,
  body = null,
  label = 'admin-pools',
  retries = method === 'GET' ? 1 : 0,
} = {}) {
  const query = params instanceof URLSearchParams && params.toString()
    ? `?${params.toString()}`
    : '';
  const headers = await buildAdminPoolsHeaders(
    body ? { 'Content-Type': 'application/json' } : {}
  );
  const { response, data } = await fetchJsonWithTimeout(`/api/admin-pools${query}`, {
    method,
    credentials: 'same-origin',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, {
    label,
    timeoutMs: ADMIN_POOLS_TIMEOUT_MS,
    retries,
  });

  if (!response.ok || data?.success !== true) {
    throwAdminPoolsError(data, response, '后台卡池操作失败', 'admin_pools_request_failed');
  }

  return data;
}

export function buildPoolAliasRowsForSave({
  canonicalPoolId,
  editingPool = null,
  poolData = {},
  preferredSource = null,
} = {}) {
  const normalizedCanonicalId = normalizeName(canonicalPoolId);
  if (!normalizedCanonicalId) {
    return [];
  }

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

export const loadPools = async () => {
  try {
    const params = new URLSearchParams({ mode: 'pools' });
    const result = await requestAdminPools({ params, label: 'admin-pools-load' });
    return { success: true, data: Array.isArray(result.data) ? result.data : [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const loadCharacters = async () => {
  try {
    const params = new URLSearchParams({ mode: 'characters' });
    const result = await requestAdminPools({ params, label: 'admin-pools-characters-load' });
    return { success: true, data: Array.isArray(result.data) ? result.data : [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const loadAllPoolCharacters = async () => {
  try {
    const params = new URLSearchParams({ mode: 'pool-characters' });
    const result = await requestAdminPools({ params, label: 'admin-pool-characters-load' });
    return { success: true, data: result.data && typeof result.data === 'object' ? result.data : {} };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const loadPoolCharactersForEdit = async (poolId) => {
  if (!poolId) return { success: false, data: [] };

  try {
    const params = new URLSearchParams({
      mode: 'pool-characters-for-edit',
      poolId,
    });
    const result = await requestAdminPools({ params, label: 'admin-pool-characters-edit-load' });
    return { success: true, data: Array.isArray(result.data) ? result.data : [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
};

export const addCharacterToPool = async (poolId, characterId, isUp = false) => {
  try {
    await requestAdminPools({
      method: 'POST',
      body: {
        action: 'addCharacterToPool',
        poolId,
        characterId,
        isUp,
      },
      label: 'admin-pool-character-add',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const removeCharacterFromPool = async (poolId, characterId) => {
  try {
    await requestAdminPools({
      method: 'POST',
      body: {
        action: 'removeCharacterFromPool',
        poolId,
        characterId,
      },
      label: 'admin-pool-character-remove',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const createUpCharacter = async (
  characterName,
  poolType,
  poolStartTime,
  rotationBaseCount = 0,
  itemType = null,
  extraRuleProfile = null
) => {
  const result = await requestAdminPools({
    method: 'POST',
    body: {
      action: 'createUpCharacter',
      characterName,
      poolType,
      poolStartTime,
      rotationBaseCount,
      ...(itemType ? { itemType } : {}),
      ...(extraRuleProfile ? { extraRuleProfile } : {}),
    },
    label: 'admin-pool-create-up-character',
  });
  return result.character;
};

export const savePool = async (poolData, editingPool, characters, editingPoolCharacters = []) => {
  try {
    const result = await requestAdminPools({
      method: 'POST',
      body: {
        action: 'savePool',
        poolData,
        editingPool,
        characters,
        editingPoolCharacters,
      },
      label: 'admin-pool-save',
    });
    return {
      success: true,
      isNew: Boolean(result.isNew),
      addedCount: Number(result.addedCount) || 0,
      poolId: result.poolId || null,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const deletePool = async (poolId) => {
  try {
    await requestAdminPools({
      method: 'DELETE',
      body: { poolId },
      label: 'admin-pool-delete',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const recalculateIsStandard = async (pools) => {
  try {
    const result = await requestAdminPools({
      method: 'POST',
      body: {
        action: 'recalculateIsStandard',
        pools,
      },
      label: 'admin-pool-recalculate-is-standard',
      retries: 0,
    });
    return {
      success: true,
      changedCount: Number(result.changedCount) || 0,
      message: result.message || '',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
