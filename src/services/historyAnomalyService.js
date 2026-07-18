import { getSupabaseAccessToken } from './authFetchService.js';
import { fetchJsonWithTimeout } from './supabaseRequest.js';

async function buildHeaders(withJson = false) {
  const token = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  }).catch(() => null);
  return {
    Accept: 'application/json',
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function throwRequestError(response, data, fallback, code) {
  const error = new Error(data?.error || `${fallback} (${response.status})`);
  error.code = data?.code || code;
  error.status = response.status;
  throw error;
}

export async function loadHistoryAnomalies({ gameUid = '', serverScope = '', poolId = '' } = {}) {
  const params = new URLSearchParams();
  if (gameUid) params.set('gameUid', gameUid);
  if (serverScope) params.set('serverScope', serverScope);
  if (poolId) params.set('poolId', poolId);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { response, data } = await fetchJsonWithTimeout(`/api/history-anomalies${suffix}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: await buildHeaders(),
  }, {
    label: 'history-anomalies-load',
    retries: 1,
  });
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '异常记录读取失败', 'history_anomalies_load_failed');
  }
  return Array.isArray(data?.anomalies) ? data.anomalies : [];
}

export async function updateHistoryAnomaly({ anomalyId, action, note = '' }) {
  const { response, data } = await fetchJsonWithTimeout('/api/history-anomalies', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: await buildHeaders(true),
    body: JSON.stringify({ anomalyId, action, note }),
  }, {
    label: 'history-anomalies-update',
    retries: 0,
  });
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '异常记录状态更新失败', 'history_anomalies_update_failed');
  }
  return data?.anomaly || null;
}

export async function loadAdminHistoryAnomalies(status = 'pending') {
  const params = new URLSearchParams({ status });
  const { response, data } = await fetchJsonWithTimeout(`/api/admin-history-anomalies?${params.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: await buildHeaders(),
  }, {
    label: 'admin-history-anomalies-load',
    retries: 1,
  });
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '管理员异常审阅读取失败', 'admin_history_anomalies_load_failed');
  }
  return Array.isArray(data?.anomalies) ? data.anomalies : [];
}

export async function updateAdminHistoryAnomaly({ anomalyId, action, note = '' }) {
  const { response, data } = await fetchJsonWithTimeout('/api/admin-history-anomalies', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: await buildHeaders(true),
    body: JSON.stringify({ anomalyId, action, note }),
  }, {
    label: 'admin-history-anomalies-update',
    retries: 0,
  });
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '管理员异常审阅更新失败', 'admin_history_anomalies_update_failed');
  }
  return data?.anomaly || null;
}

export default {
  loadAdminHistoryAnomalies,
  loadHistoryAnomalies,
  updateAdminHistoryAnomaly,
  updateHistoryAnomaly,
};
