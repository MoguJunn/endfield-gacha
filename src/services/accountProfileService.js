import { getSupabaseAccessToken } from './authFetchService.js';
import { fetchJsonWithTimeout } from './supabaseRequest.js';
import { normalizeUsername } from '../utils/usernameValidation.js';
import {
  CONTRIBUTOR_DEMO_USER,
  createContributorDemoReadonlyError,
  isContributorDemoSessionActive,
} from '../dev/contributorDemoMode.js';

async function buildAccountProfileHeaders(extraHeaders = {}) {
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

function throwAccountProfileError(data, response, fallbackMessage, fallbackCode) {
  const error = new Error(data?.error || `${fallbackMessage} (${response.status})`);
  error.code = data?.code || fallbackCode;
  error.status = response.status;
  throw error;
}

function mergeUpdatedUser(user, payloadUser, profile) {
  const username = profile?.username || payloadUser?.user_metadata?.username || user?.user_metadata?.username || '';
  return {
    ...(user || {}),
    ...(payloadUser || {}),
    user_metadata: {
      ...(user?.user_metadata || {}),
      ...(payloadUser?.user_metadata || {}),
      username,
      display_name: username,
    },
    profile_role: profile?.role || payloadUser?.profile_role || user?.profile_role || 'user',
  };
}

export async function loadCurrentAccountProfile() {
  if (isContributorDemoSessionActive()) {
    return {
      profile: {
        id: CONTRIBUTOR_DEMO_USER.id,
        username: CONTRIBUTOR_DEMO_USER.user_metadata.username,
        email: CONTRIBUTOR_DEMO_USER.email,
        role: 'super_admin',
        contributor_demo: true,
      },
      user: CONTRIBUTOR_DEMO_USER,
      source: 'contributor-demo',
    };
  }
  const headers = await buildAccountProfileHeaders();
  const { response, data } = await fetchJsonWithTimeout('/api/account-profile', {
    method: 'GET',
    credentials: 'same-origin',
    headers,
  }, {
    label: 'account-profile',
    timeoutMs: 15000,
    retries: 1,
  });

  if (!response.ok || data?.success !== true) {
    throwAccountProfileError(data, response, '账号资料读取失败', 'account_profile_load_failed');
  }

  return {
    profile: data?.profile || null,
    user: data?.user || null,
    source: data?.source || 'unknown',
  };
}

export async function updateOwnUsername(user, nextUsername) {
  if (isContributorDemoSessionActive()) {
    throw createContributorDemoReadonlyError('updateOwnUsername');
  }
  if (!user?.id) {
    throw new Error('当前登录态已失效，请重新登录后再试');
  }

  const normalizedUsername = normalizeUsername(nextUsername);
  const headers = await buildAccountProfileHeaders({
    'Content-Type': 'application/json',
  });

  const { response, data } = await fetchJsonWithTimeout('/api/account-profile', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ username: normalizedUsername }),
  }, {
    label: 'account-profile-update',
    timeoutMs: 15000,
    retries: 0,
  });

  if (!response.ok || data?.success !== true) {
    throwAccountProfileError(data, response, '用户名保存失败', 'account_profile_update_failed');
  }

  return mergeUpdatedUser(user, data?.user || null, data?.profile || null);
}

export default {
  loadCurrentAccountProfile,
  updateOwnUsername,
};
