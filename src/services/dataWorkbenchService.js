import { getSupabaseAccessToken } from './authFetchService.js';
import { fetchJsonWithTimeout } from './supabaseRequest.js';

const ENDPOINT = '/api/data-workbench';

export function normalizeWorkbenchRecord(record = {}) {
  return {
    ...record,
    id: record.id,
    entryId: record.entryId || record.entry_id || record.id,
    poolId: record.poolId ?? record.pool_id ?? '',
    values: record.values || {},
    timePrecision: record.timePrecision ?? record.time_precision ?? 'unknown',
    reviewState: record.reviewState ?? record.review_state ?? 'pending',
    revision: record.revision,
    updatedAt: record.updatedAt ?? record.updated_at,
  };
}

async function request(method, payload, query = '') {
  const token = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  }).catch(() => null);
  const { response, data } = await fetchJsonWithTimeout(`${ENDPOINT}${query}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  }, { label: 'data-workbench', retries: method === 'GET' ? 1 : 0 });
  if (!response.ok || data?.success === false) {
    const error = new Error(data?.error || `数据工作台请求失败 (${response.status})`);
    error.status = response.status;
    error.code = data?.code;
    error.issues = data?.issues || data?.preview?.issues || [];
    error.latest = data?.latest ? normalizeWorkbenchRecord(data.latest) : null;
    throw error;
  }
  return data;
}

export async function listWorkbenchEntries(scope) {
  const params = new URLSearchParams({ gameUid: scope.gameUid, serverScope: scope.serverScope });
  const data = await request('GET', null, `?${params}`);
  return (data?.entries || []).map(normalizeWorkbenchRecord);
}

export async function loadWorkbenchContext(scope) {
  const params = new URLSearchParams({ gameUid: scope.gameUid, serverScope: scope.serverScope, includeHistory: '1' });
  const data = await request('GET', null, `?${params}`);
  return { ...data, entries: (data.entries || []).map(normalizeWorkbenchRecord), history: data.history || [] };
}

export async function validateWorkbenchWorkspace(payload) {
  return request('POST', { ...payload, mode: 'pool-workspace', action: 'validate' });
}

export async function previewWorkbenchEntries(payload) {
  const data = await request('POST', { ...payload, action: 'preview' });
  return data.preview;
}

export async function commitWorkbenchEntries(payload) {
  const data = await request('POST', { ...payload, action: 'commit' });
  return data.result;
}

export async function getWorkbenchCommit(commitId) {
  const data = await request('GET', null, `?${new URLSearchParams({ commitId })}`);
  return data.result;
}

export async function updateWorkbenchEntry({ id, expectedRevision, entry }) {
  const data = await request('PATCH', { id, expectedRevision, entry });
  return normalizeWorkbenchRecord(data.entry);
}

export async function deleteWorkbenchEntry({ id, expectedRevision, reason }) {
  return request('DELETE', { id, expectedRevision, reason });
}

export async function listAccountDataRevisions() {
  return request('GET', null, '?mode=revisions');
}

export async function previewAccountDataRevert(targetId) {
  const data = await request('POST', { mode: 'revisions', action: 'preview-revert', targetId });
  return data.preview;
}

export async function revertAccountDataRevision({ targetId, token, requestId }) {
  const data = await request('POST', { mode: 'revisions', action: 'revert', targetId, token, requestId });
  return data.result;
}
