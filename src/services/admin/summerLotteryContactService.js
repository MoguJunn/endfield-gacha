import { getSupabaseAccessToken } from '../authFetchService.js';
import { fetchJsonWithTimeout } from '../supabaseRequest.js';

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

export async function loadSummerLotteryContactTargets(campaignId = 'community-lottery') {
  const params = new URLSearchParams({ campaignId });
  const { response, data } = await fetchJsonWithTimeout(
    `/api/admin-summer-lottery-contacts?${params.toString()}`,
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: await buildHeaders(),
    },
    { label: 'admin-lottery-contact-targets', retries: 1 },
  );
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '中奖联系方式状态读取失败', 'lottery_contact_targets_failed');
  }
  return {
    campaign: data?.campaign || null,
    permissions: {
      canRead: data?.permissions?.canRead === true,
      canPurge: data?.permissions?.canPurge === true,
    },
    targets: Array.isArray(data?.targets) ? data.targets : [],
  };
}

export async function loadSummerLotteryOperationStatus(campaignId = 'community-lottery') {
  const params = new URLSearchParams({ campaignId });
  const { response, data } = await fetchJsonWithTimeout(
    `/api/admin-summer-lottery-operations?${params.toString()}`,
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: await buildHeaders(),
    },
    { label: 'admin-lottery-operation-status', retries: 1 },
  );
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '抽奖操作状态读取失败', 'lottery_operation_status_failed');
  }
  return data?.status || null;
}

export async function runSummerLotteryOperation({
  action,
  campaignId = 'community-lottery',
  confirmation,
}) {
  const { response, data } = await fetchJsonWithTimeout(
    '/api/admin-summer-lottery-operations',
    {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: await buildHeaders(true),
      body: JSON.stringify({ action, campaignId, confirmation }),
    },
    { label: `admin-lottery-${action}`, retries: 0 },
  );
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '抽奖操作未执行', 'lottery_operation_failed');
  }
  return data?.status || null;
}

export async function loadSummerLotteryOperatorGrants(campaignId = 'community-lottery') {
  const params = new URLSearchParams({ campaignId });
  const { response, data } = await fetchJsonWithTimeout(
    `/api/admin-summer-lottery-permissions?${params.toString()}`,
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: await buildHeaders(),
    },
    { label: 'admin-lottery-operator-grants', retries: 1 },
  );
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '兑奖授权读取失败', 'lottery_operator_grants_failed');
  }
  return Array.isArray(data?.grants) ? data.grants : [];
}

export async function setSummerLotteryOperatorCapability({
  campaignId = 'community-lottery',
  targetUserId,
  capability,
  enabled,
}) {
  const { response, data } = await fetchJsonWithTimeout(
    '/api/admin-summer-lottery-permissions',
    {
      method: enabled ? 'POST' : 'DELETE',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: await buildHeaders(true),
      body: JSON.stringify({ campaignId, targetUserId, capability }),
    },
    { label: 'admin-lottery-operator-grant-change', retries: 0 },
  );
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '兑奖授权未修改', 'lottery_operator_grant_failed');
  }
  return {
    result: data?.result || null,
    grants: Array.isArray(data?.grants) ? data.grants : null,
    grantsRefreshRequired: data?.grantsRefreshRequired === true,
  };
}

export async function readSummerLotteryContact({
  entryId,
  reason,
  campaignId = 'community-lottery',
}) {
  const { response, data } = await fetchJsonWithTimeout('/api/admin-summer-lottery-contacts', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: await buildHeaders(true),
    body: JSON.stringify({ entryId, reason, campaignId }),
  }, { label: 'admin-lottery-contact-read', retries: 0 });
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '中奖联系方式读取失败', 'lottery_contact_read_failed');
  }
  return data?.contact || null;
}

export async function purgeSummerLotteryContact(
  entryId,
  campaignId = 'community-lottery',
) {
  const { response, data } = await fetchJsonWithTimeout('/api/admin-summer-lottery-contacts', {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: await buildHeaders(true),
    body: JSON.stringify({
      entryId,
      campaignId,
      reason: 'manual_privacy_request',
    }),
  }, { label: 'admin-lottery-contact-purge', retries: 0 });
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '中奖联系方式删除失败', 'lottery_contact_purge_failed');
  }
  return data?.result || null;
}

export default {
  loadSummerLotteryContactTargets,
  loadSummerLotteryOperatorGrants,
  loadSummerLotteryOperationStatus,
  purgeSummerLotteryContact,
  readSummerLotteryContact,
  runSummerLotteryOperation,
  setSummerLotteryOperatorCapability,
};
