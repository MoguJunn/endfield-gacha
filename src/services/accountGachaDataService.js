import { getSupabaseAccessToken } from './authFetchService.js';
import { fetchJsonWithTimeout } from './supabaseRequest.js';

async function buildAccountGachaHeaders() {
  const accessToken = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  }).catch(() => null);

  const headers = {
    Accept: 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

function createAccountGachaDataError(data, response, fallbackMessage, fallbackCode) {
  const error = new Error(data?.error || `${fallbackMessage} (${response.status})`);
  error.code = data?.code || fallbackCode;
  error.status = response.status;
  throw error;
}

export async function loadAccountGachaData() {
  const headers = await buildAccountGachaHeaders();

  const { response, data } = await fetchJsonWithTimeout('/api/account-gacha-data', {
    method: 'GET',
    credentials: 'same-origin',
    headers,
  }, {
    label: 'account-gacha-data',
    retries: 1,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '账号抽卡数据读取失败', 'account_gacha_data_load_failed');
  }

  return {
    history: Array.isArray(data?.history) ? data.history : [],
    source: data?.source || 'unknown',
    meta: data?.meta || null,
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  };
}

export async function loadAccountGachaSeqKeys({ gameUid = '', accountKey = '', serverId = '', region = '' } = {}) {
  const headers = await buildAccountGachaHeaders();
  const params = new URLSearchParams({ mode: 'seq-keys' });
  if (gameUid) {
    params.set('gameUid', gameUid);
  }
  if (accountKey) {
    params.set('accountKey', accountKey);
  }
  if (serverId) {
    params.set('serverId', serverId);
  }
  if (region) {
    params.set('region', region);
  }

  const { response, data } = await fetchJsonWithTimeout(`/api/account-gacha-data?${params.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers,
  }, {
    label: 'account-gacha-data-seq-keys',
    retries: 1,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '账号抽卡记录查重失败', 'account_gacha_data_seq_keys_failed');
  }

  return {
    keys: Array.isArray(data?.keys) ? data.keys : [],
    source: data?.source || 'unknown',
    meta: data?.meta || null,
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  };
}

export async function saveAccountGachaData({ pools = [], history = [] } = {}) {
  const headers = await buildAccountGachaHeaders();
  headers['Content-Type'] = 'application/json';

  const { response, data } = await fetchJsonWithTimeout('/api/account-gacha-data', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ pools, history }),
  }, {
    label: 'account-gacha-data-save',
    retries: 1,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '账号抽卡数据保存失败', 'account_gacha_data_save_failed');
  }

  return {
    saved: data?.saved || { pools: 0, history: 0 },
    skipped: data?.skipped || { pools: 0, history: 0 },
  };
}

export async function updateAccountGachaServerLabel({
  gameUid = '',
  accountKey = '',
  currentServerId = '',
  currentRegion = '',
  serverId = '',
  region = '',
} = {}) {
  const headers = await buildAccountGachaHeaders();
  headers['Content-Type'] = 'application/json';

  const { response, data } = await fetchJsonWithTimeout('/api/account-gacha-data', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({
      action: 'updateServerLabel',
      gameUid,
      accountKey,
      currentServerId,
      currentRegion,
      serverId,
      region,
    }),
  }, {
    label: 'account-gacha-data-update-server-label',
    retries: 1,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '账号区服标签更新失败', 'account_gacha_data_server_label_failed');
  }

  return {
    updated: Number(data?.updated || 0),
    serverId: data?.serverId || null,
    region: data?.region || null,
  };
}

export async function resolveAccountGachaAliases({ poolIds = [], characterIds = [] } = {}) {
  const headers = await buildAccountGachaHeaders();
  headers['Content-Type'] = 'application/json';

  const { response, data } = await fetchJsonWithTimeout('/api/account-gacha-data', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({
      action: 'resolveAliases',
      poolIds,
      characterIds,
    }),
  }, {
    label: 'account-gacha-data-aliases',
    retries: 1,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '账号抽卡数据 ID 解析失败', 'account_gacha_data_alias_failed');
  }

  return {
    poolAliases: data?.poolAliases && typeof data.poolAliases === 'object' ? data.poolAliases : {},
    characterAliases: data?.characterAliases && typeof data.characterAliases === 'object' ? data.characterAliases : {},
  };
}

export async function deleteAccountGachaData(payload) {
  const headers = await buildAccountGachaHeaders();
  headers['Content-Type'] = 'application/json';

  const { response, data } = await fetchJsonWithTimeout('/api/account-gacha-data', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(payload || {}),
  }, {
    label: 'account-gacha-data-delete',
    retries: 1,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '账号抽卡数据删除失败', 'account_gacha_data_delete_failed');
  }

  return {
    deleted: data?.deleted || { pools: 0, history: 0 },
  };
}

export function deleteAccountGachaRecords(recordIds) {
  return deleteAccountGachaData({
    action: 'records',
    recordIds,
  });
}

export function deleteAccountGachaPoolHistory(poolId) {
  return deleteAccountGachaData({
    action: 'poolHistory',
    poolId,
  });
}

export function deleteAccountGachaPool(poolId) {
  return deleteAccountGachaData({
    action: 'pool',
    poolId,
  });
}

export function deleteAllAccountGachaData() {
  return deleteAccountGachaData({
    action: 'all',
  });
}

export default {
  deleteAccountGachaData,
  deleteAccountGachaPool,
  deleteAccountGachaPoolHistory,
  deleteAccountGachaRecords,
  deleteAllAccountGachaData,
  loadAccountGachaData,
  loadAccountGachaSeqKeys,
  resolveAccountGachaAliases,
  saveAccountGachaData,
  updateAccountGachaServerLabel,
};
