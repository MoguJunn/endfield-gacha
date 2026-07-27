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
    targets: Array.isArray(data?.targets) ? data.targets : [],
  };
}

export async function readSummerLotteryContact({ entryId, reason }) {
  const { response, data } = await fetchJsonWithTimeout('/api/admin-summer-lottery-contacts', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: await buildHeaders(true),
    body: JSON.stringify({ entryId, reason }),
  }, { label: 'admin-lottery-contact-read', retries: 0 });
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '中奖联系方式读取失败', 'lottery_contact_read_failed');
  }
  return data?.contact || null;
}

export async function purgeSummerLotteryContact(entryId) {
  const { response, data } = await fetchJsonWithTimeout('/api/admin-summer-lottery-contacts', {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: await buildHeaders(true),
    body: JSON.stringify({ entryId, reason: 'manual_privacy_request' }),
  }, { label: 'admin-lottery-contact-purge', retries: 0 });
  if (!response.ok || data?.success === false) {
    throwRequestError(response, data, '中奖联系方式删除失败', 'lottery_contact_purge_failed');
  }
  return data?.result || null;
}

export default {
  loadSummerLotteryContactTargets,
  purgeSummerLotteryContact,
  readSummerLotteryContact,
};
