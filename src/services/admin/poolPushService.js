import { getSupabaseAccessToken } from '../authFetchService.js';
import { fetchJsonWithTimeout } from '../supabaseRequest.js';

const POOL_PUSH_TIMEOUT_MS = 30000;

function isHttpHeaderSafeValue(value) {
  return /^[\x20-\x7E]+$/.test(value);
}

function createAuthorizationHeader(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token || !isHttpHeaderSafeValue(token)) {
    return null;
  }
  return `Bearer ${token}`;
}

async function buildAdminPoolPushHeaders(extraHeaders = {}) {
  const accessToken = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  }).catch(() => null);

  const headers = {
    Accept: 'application/json',
    ...extraHeaders,
  };
  const authorization = createAuthorizationHeader(accessToken);
  if (authorization) {
    headers.Authorization = authorization;
  }
  return headers;
}

function throwPoolPushError(data, response, fallbackMessage, fallbackCode) {
  const error = new Error(data?.error || `${fallbackMessage} (${response.status})`);
  error.code = data?.code || fallbackCode;
  error.status = response.status;
  throw error;
}

async function requestPoolPush({ action, selectedTargets, dedupeKey, pool, confirmationToken } = {}) {
  const headers = await buildAdminPoolPushHeaders({ 'Content-Type': 'application/json' });
  const body = { action };
  if (Array.isArray(selectedTargets) && selectedTargets.length > 0) {
    body.selectedTargets = selectedTargets;
  }
  if (dedupeKey) {
    body.dedupeKey = dedupeKey;
  }
  if (pool && typeof pool === 'object') {
    body.pool = pool;
  }
  if (confirmationToken) {
    body.confirmationToken = confirmationToken;
  }

  const { response, data } = await fetchJsonWithTimeout(
    '/api/admin-pool-push',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(body),
    },
    {
      label: `admin-pool-push-${action}`,
      timeoutMs: POOL_PUSH_TIMEOUT_MS,
      retries: 0,
    }
  );

  if (!response.ok || data?.success !== true) {
    throwPoolPushError(data, response, '卡池推送操作失败', 'pool_push_request_failed');
  }

  return data.data || null;
}

export async function previewPoolPush(options = {}) {
  try {
    const data = await requestPoolPush({
      action: 'previewPoolPush',
      selectedTargets: options.selectedTargets,
      dedupeKey: options.dedupeKey,
      pool: options.pool,
    });
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
}

export async function sendPoolPush(options = {}) {
  try {
    const data = await requestPoolPush({
      action: 'sendPoolPush',
      confirmationToken: options.confirmationToken,
    });
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
}
