import { getSameOriginAuthHeaders } from './authFetchService.js';
import { fetchJsonWithTimeout } from './supabaseRequest.js';

const PERSONAL_ANALYSIS_TIMEOUT_MS = 120000;

async function buildAccountGachaHeaders() {
  const baseHeaders = {
    Accept: 'application/json',
  };
  const result = await getSameOriginAuthHeaders(baseHeaders, {
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  }).catch(() => ({ headers: baseHeaders }));

  return result.headers;
}

function createAccountGachaDataError(data, response, fallbackMessage, fallbackCode) {
  const error = new Error(data?.error || `${fallbackMessage} (${response.status})`);
  error.code = data?.code || fallbackCode;
  error.status = response.status;
  error.requestId = data?.requestId || response?.headers?.get?.('x-request-id') || null;
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

export async function loadAccountGachaAnalysis({ accountKey = '', viewKey = '', locale = 'zh-CN' } = {}) {
  const headers = await buildAccountGachaHeaders();
  const params = new URLSearchParams({ mode: 'analysis' });
  if (accountKey) {
    params.set('accountKey', accountKey);
  }
  if (viewKey) {
    params.set('viewKey', viewKey);
  }
  if (locale) {
    params.set('locale', locale);
  }

  const { response, data } = await fetchJsonWithTimeout(`/api/account-gacha-data?${params.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers,
  }, {
    label: 'account-gacha-data-analysis',
    // 本地 transient fallback 需要读取完整 owner 历史并构建全部视图，
    // 数据量较大时可能超过普通 GET 的 45 秒预算。Abort 后服务端任务仍可能
    // 继续执行，因此这里也不能自动重试，避免并行重复计算。
    timeoutMs: PERSONAL_ANALYSIS_TIMEOUT_MS,
    retries: 0,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '账号抽卡分析读取失败', 'account_gacha_analysis_load_failed');
  }

  const availability = data?.availability;
  if (!['ready', 'stale', 'building', 'empty'].includes(availability)) {
    createAccountGachaDataError(
      {
        code: 'personal_analysis_response_invalid',
        error: '账号抽卡分析返回了无法识别的快照状态',
        requestId: data?.requestId,
      },
      response,
      '账号抽卡分析响应无效',
      'personal_analysis_response_invalid'
    );
  }

  return {
    availability,
    schemaVersion: Math.max(1, Number(data?.schemaVersion) || 1),
    owner: data?.owner && typeof data.owner === 'object' ? data.owner : null,
    scope: data?.scope && typeof data.scope === 'object' ? data.scope : null,
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

export async function loadAccountGachaHistoryPage({
  gameUid = '',
  accountKey = '',
  serverScope = '',
  poolId = '',
  region = '',
  cursor = '',
  limit = 50,
} = {}) {
  const headers = await buildAccountGachaHeaders();
  const params = new URLSearchParams({
    mode: 'history',
    gameUid: String(gameUid || '').trim(),
    serverScope: String(serverScope || '').trim(),
    limit: String(limit || 50),
  });
  if (accountKey) {
    params.set('accountKey', accountKey);
  }
  if (poolId) {
    params.set('poolId', poolId);
  }
  if (region) {
    params.set('region', region);
  }
  if (cursor) {
    params.set('cursor', cursor);
  }

  const { response, data } = await fetchJsonWithTimeout(`/api/account-gacha-data?${params.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers,
  }, {
    label: 'account-gacha-data-history-page',
    retries: 1,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '账号抽卡记录读取失败', 'account_gacha_history_page_failed');
  }

  const pageTotal = data?.page?.total;

  return {
    records: Array.isArray(data?.records) ? data.records : [],
    page: {
      limit: Number(data?.page?.limit || limit || 50),
      nextCursor: data?.page?.nextCursor || null,
      hasMore: data?.page?.hasMore === true,
      total: pageTotal !== null && pageTotal !== undefined && Number.isFinite(Number(pageTotal))
        ? Number(pageTotal)
        : null,
      revision: data?.page?.revision !== null && data?.page?.revision !== undefined
        ? String(data.page.revision)
        : data?.meta?.revision !== null && data?.meta?.revision !== undefined
          ? String(data.meta.revision)
          : null,
    },
    scope: data?.scope || null,
    source: data?.source || 'unknown',
    meta: data?.meta || null,
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  };
}

function createHistoryExportError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeHistoryExportAccount(account, accountIndex) {
  const normalized = {
    ...(account && typeof account === 'object' ? account : {}),
    accountKey: String(account?.accountKey || account?.account_key || '').trim(),
    gameUid: String(account?.gameUid || account?.game_uid || '').trim(),
    serverScope: String(account?.serverScope || account?.server_scope || '').trim(),
    region: String(account?.region || '').trim(),
  };

  if (!normalized.accountKey || !normalized.gameUid || !normalized.serverScope) {
    throw createHistoryExportError(
      `第 ${accountIndex + 1} 个导出账号缺少 accountKey、gameUid 或 serverScope`,
      'account_gacha_history_account_invalid'
    );
  }

  return normalized;
}

function buildHistoryExportRecordKey(record) {
  return JSON.stringify([
    record?.id ?? record?.recordId ?? record?.record_id ?? '',
    record?.gameUid ?? record?.game_uid ?? '',
    record?.serverScope ?? record?.server_scope ?? '',
    record?.poolId ?? record?.pool_id ?? '',
    record?.seqId ?? record?.seq_id ?? '',
  ].map((value) => String(value ?? '')));
}

export async function loadAllAccountGachaHistoryForAccounts({
  accounts = [],
  expectedOwnerId = '',
  onProgress = null,
  pageLimit = 200,
  maxPagesPerAccount = 5000,
} = {}) {
  const normalizedAccounts = (Array.isArray(accounts) ? accounts : [])
    .map(normalizeHistoryExportAccount);

  if (normalizedAccounts.length === 0) {
    return { history: [], accounts: [], warnings: [] };
  }

  const normalizedExpectedOwnerId = String(expectedOwnerId || '').trim();
  if (!normalizedExpectedOwnerId) {
    throw createHistoryExportError(
      '全量读取抽卡记录时缺少 expectedOwnerId',
      'account_gacha_history_owner_required'
    );
  }

  const normalizedPageLimit = Math.max(1, Number.parseInt(String(pageLimit || ''), 10) || 200);
  const normalizedMaxPages = Math.max(
    1,
    Number.parseInt(String(maxPagesPerAccount || ''), 10) || 5000
  );
  const declaredTotal = normalizedAccounts.every((account) => (
    Number.isFinite(Number(account.recordCount)) && Number(account.recordCount) >= 0
  ))
    ? normalizedAccounts.reduce((sum, account) => sum + Number(account.recordCount), 0)
    : null;
  const history = [];
  const historyKeys = new Set();
  const warnings = [];

  for (let accountIndex = 0; accountIndex < normalizedAccounts.length; accountIndex += 1) {
    const account = normalizedAccounts[accountIndex];
    let revisionRetryUsed = false;

    while (true) {
      const accountHistory = [];
      const accountHistoryKeys = new Set();
      const accountWarnings = [];
      const seenCursors = new Set();
      let cursor = '';
      let pageCount = 0;
      let accountRevision = null;
      let accountTotal = null;

      try {
        while (true) {
          if (pageCount >= normalizedMaxPages) {
            throw createHistoryExportError(
              `第 ${accountIndex + 1} 个账号的抽卡记录超过分页读取上限`,
              'account_gacha_history_page_limit_exceeded'
            );
          }

          // eslint-disable-next-line no-await-in-loop -- export pages must remain ordered and cursor-bound
          const result = await loadAccountGachaHistoryPage({
            accountKey: account.accountKey,
            gameUid: account.gameUid,
            serverScope: account.serverScope,
            region: account.region,
            cursor,
            limit: normalizedPageLimit,
          });
          pageCount += 1;

          const responseOwnerId = String(result?.meta?.ownerId || '').trim();
          if (responseOwnerId !== normalizedExpectedOwnerId) {
            throw createHistoryExportError(
              '分页读取返回了不属于当前用户的抽卡记录',
              'account_gacha_history_owner_mismatch'
            );
          }

          const pageRevision = result?.page?.revision === null || result?.page?.revision === undefined
            ? null
            : String(result.page.revision);
          if (accountRevision !== null && pageRevision !== accountRevision) {
            throw createHistoryExportError(
              '抽卡记录在分页读取期间发生变化，请重新导出',
              'history_revision_changed'
            );
          }
          if (accountRevision === null) {
            accountRevision = pageRevision;
          }
          if (pageCount === 1 && Number.isFinite(Number(result?.page?.total))) {
            accountTotal = Math.max(0, Number(result.page.total));
          }

          (Array.isArray(result?.records) ? result.records : []).forEach((record) => {
            const recordKey = buildHistoryExportRecordKey(record);
            if (!accountHistoryKeys.has(recordKey)) {
              accountHistoryKeys.add(recordKey);
              accountHistory.push(record);
            }
          });
          accountWarnings.push(...(Array.isArray(result?.warnings) ? result.warnings : []));

          onProgress?.({
            accountIndex,
            accountCount: normalizedAccounts.length,
            loaded: history.length + accountHistory.length,
            total: declaredTotal ?? (history.length + (accountTotal ?? accountHistory.length)),
          });

          if (result?.page?.hasMore !== true) {
            break;
          }

          const nextCursor = String(result?.page?.nextCursor || '').trim();
          if (!nextCursor || seenCursors.has(nextCursor)) {
            throw createHistoryExportError(
              `第 ${accountIndex + 1} 个账号返回了重复的分页游标`,
              'account_gacha_history_cursor_repeated'
            );
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }

        accountHistory.forEach((record) => {
          const recordKey = buildHistoryExportRecordKey(record);
          if (!historyKeys.has(recordKey)) {
            historyKeys.add(recordKey);
            history.push(record);
          }
        });
        warnings.push(...accountWarnings);
        break;
      } catch (error) {
        if (error?.code === 'history_revision_changed' && !revisionRetryUsed) {
          revisionRetryUsed = true;
          continue;
        }
        throw error;
      }
    }
  }

  return {
    history,
    accounts: normalizedAccounts,
    warnings,
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
  mergeGameUid = false,
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
      mergeGameUid,
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
    deletedDuplicates: Number(data?.deletedDuplicates || 0),
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

export async function updateAccountGachaRecord({
  recordId,
  gameUid,
  serverScope,
  currentPoolId,
  seqId,
  editVersion,
  changes,
  reason = '',
} = {}) {
  const headers = await buildAccountGachaHeaders();
  headers['Content-Type'] = 'application/json';

  const { response, data } = await fetchJsonWithTimeout('/api/account-gacha-data', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({
      recordId,
      gameUid,
      serverScope,
      currentPoolId,
      seqId,
      editVersion,
      changes,
      reason,
    }),
  }, {
    label: 'account-gacha-data-record-update',
    retries: 0,
  });

  if (!response.ok || data?.success === false) {
    createAccountGachaDataError(data, response, '抽卡记录更新失败', 'account_gacha_record_update_failed');
  }

  return {
    updated: Number(data?.updated || 0),
    record: data?.record || null,
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

export function deleteAccountGachaRecord({
  recordId,
  gameUid,
  serverScope,
  currentPoolId,
  seqId,
  reason = '',
} = {}) {
  return deleteAccountGachaData({
    action: 'record',
    recordId,
    gameUid,
    serverScope,
    currentPoolId,
    seqId,
    reason,
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
  deleteAccountGachaRecord,
  deleteAccountGachaRecords,
  deleteAllAccountGachaData,
  loadAccountGachaAnalysis,
  loadAccountGachaData,
  loadAllAccountGachaHistoryForAccounts,
  loadAccountGachaHistoryPage,
  loadAccountGachaSeqKeys,
  resolveAccountGachaAliases,
  saveAccountGachaData,
  updateAccountGachaServerLabel,
  updateAccountGachaRecord,
};
