import { supabase } from '../supabaseClient.js';
import {
  getCurrentSiteSession,
  getKnownSiteSessionUserId,
  hasKnownAuthenticatedSiteSession,
} from './siteSessionService.js';
import { isContributorDemoModeEnabled } from '../dev/contributorDemoMode.js';

let pendingNativeSessionRefresh = null;

function isInvalidSessionError(error) {
  return [400, 401, 403].includes(error?.status)
    || ['bad_jwt', 'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used'].includes(error?.code);
}

async function refreshNativeSession() {
  if (!pendingNativeSessionRefresh) {
    pendingNativeSessionRefresh = supabase.auth.refreshSession()
      .finally(() => { pendingNativeSessionRefresh = null; });
  }
  return pendingNativeSessionRefresh;
}

async function clearInvalidSupabaseSession() {
  await supabase?.auth?.signOut?.({ scope: 'local' }).catch(() => null);
}

function decodeJwtPayload(accessToken = '') {
  const [, payloadPart] = String(accessToken || '').split('.');
  if (!payloadPart) {
    return null;
  }

  try {
    const normalized = payloadPart
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const decoded = typeof atob === 'function'
      ? atob(normalized)
      : globalThis.Buffer?.from?.(normalized, 'base64')?.toString?.('binary');
    if (!decoded) {
      return null;
    }
    const json = decodeURIComponent(
      Array.from(decoded, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isSiteSessionCompatToken(accessToken = '') {
  const payload = decodeJwtPayload(accessToken);
  return Boolean(
    payload?.user_metadata?.site_session === true
    || payload?.app_metadata?.provider === 'site_session'
  );
}

async function getSiteSessionAccessToken({
  useSiteSessionCache = true,
  allowSiteSessionToken = true,
} = {}) {
  const siteSession = await getCurrentSiteSession({
    syncSupabase: false,
    useCache: useSiteSessionCache,
  });
  const siteSessionToken = allowSiteSessionToken ? siteSession?.supabase?.accessToken || null : null;
  if (siteSessionToken) {
    return siteSessionToken;
  }
  if (siteSession?.authenticated) {
    return null;
  }
  return null;
}

export async function getValidatedSupabaseSession() {
  if (isContributorDemoModeEnabled() || !supabase) {
    return null;
  }

  const currentSession = await supabase.auth.getSession();
  if (currentSession?.error) {
    if (!isInvalidSessionError(currentSession.error)) throw currentSession.error;
    await clearInvalidSupabaseSession();
    return null;
  }
  const nativeSession = currentSession?.data?.session || null;
  const accessToken = nativeSession?.access_token || '';
  const sessionUserId = nativeSession?.user?.id || '';
  // 兼容令牌的有效身份必须来自站内会话，不能在 Cookie 失效后继续使用本地副本。
  if (!accessToken || !sessionUserId || isSiteSessionCompatToken(accessToken)) {
    return null;
  }

  let session = nativeSession;
  let userResult = await supabase.auth.getUser(accessToken);
  if (userResult?.error && isInvalidSessionError(userResult.error)) {
    const refreshed = await refreshNativeSession();
    if (refreshed?.error && !isInvalidSessionError(refreshed.error)) throw refreshed.error;
    session = refreshed?.data?.session;
    if (refreshed?.error || !session?.access_token || session.user?.id !== sessionUserId) {
      await clearInvalidSupabaseSession();
      return null;
    }
    userResult = await supabase.auth.getUser(session.access_token);
  }
  if (userResult?.error && !isInvalidSessionError(userResult.error)) throw userResult.error;
  const verifiedUser = userResult?.data?.user || null;
  if (userResult?.error || !verifiedUser?.id || verifiedUser.id !== sessionUserId) {
    await clearInvalidSupabaseSession();
    return null;
  }

  return {
    ...session,
    user: verifiedUser,
  };
}

export async function getSupabaseAccessToken({
  syncSiteSession = true,
  useSiteSessionCache = true,
  allowSiteSessionToken = true,
  preferSiteSessionToken = false,
} = {}) {
  if (isContributorDemoModeEnabled() || !supabase) {
    return null;
  }

  const siteSessionChecked = syncSiteSession && allowSiteSessionToken && preferSiteSessionToken;
  if (siteSessionChecked) {
    const siteSessionToken = await getSiteSessionAccessToken({
      useSiteSessionCache,
      allowSiteSessionToken,
    });
    if (siteSessionToken) {
      return siteSessionToken;
    }
  }

  const nativeSession = await getValidatedSupabaseSession();
  if (nativeSession?.access_token) {
    return nativeSession.access_token;
  }

  if (syncSiteSession && allowSiteSessionToken && !siteSessionChecked) {
    const siteSessionToken = await getSiteSessionAccessToken({
      useSiteSessionCache,
      allowSiteSessionToken,
    });
    if (siteSessionToken) {
      return siteSessionToken;
    }
  }

  return null;
}

export async function getAuthFetchHeaders(baseHeaders = {}, {
  requireToken = false,
  syncSiteSession = true,
  useSiteSessionCache = true,
  allowSiteSessionToken = true,
  preferSiteSessionToken = false,
} = {}) {
  if (isContributorDemoModeEnabled()) {
    if (requireToken) {
      throw new Error('贡献者内容沙盒不提供真实认证凭据');
    }
    return { headers: { ...baseHeaders }, accessToken: null };
  }
  const headers = {
    ...baseHeaders,
  };
  const accessToken = await getSupabaseAccessToken({
    syncSiteSession,
    useSiteSessionCache,
    allowSiteSessionToken,
    preferSiteSessionToken,
  });

  if (accessToken && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (requireToken && !accessToken) {
    throw new Error('当前登录已失效，请重新登录后重试');
  }

  return {
    headers,
    accessToken,
  };
}

export async function getSameOriginAuthHeaders(baseHeaders = {}, options = {}) {
  if (isContributorDemoModeEnabled()) {
    return {
      headers: { ...baseHeaders },
      accessToken: null,
      credentialSource: 'contributor_sandbox',
      credentialOwnerId: null,
    };
  }
  if (hasKnownAuthenticatedSiteSession()) {
    return {
      headers: {
        ...baseHeaders,
      },
      accessToken: null,
      credentialSource: 'site_session',
      credentialOwnerId: getKnownSiteSessionUserId(),
    };
  }

  const result = await getAuthFetchHeaders(baseHeaders, options);
  return {
    ...result,
    credentialSource: result.accessToken ? 'supabase' : 'cookie',
    credentialOwnerId: null,
  };
}

export async function buildAuthenticatedFetchInit(init = {}, options = {}) {
  const { headers } = await getAuthFetchHeaders(init.headers || {}, options);
  return {
    ...init,
    credentials: init.credentials || 'same-origin',
    headers,
  };
}

export async function withAuthenticatedSupabaseRequest(buildRequest, options = {}) {
  if (isContributorDemoModeEnabled()) {
    throw new Error('贡献者内容沙盒不执行真实 Supabase 请求');
  }
  const { accessToken } = await getAuthFetchHeaders({}, options);
  let request = await buildRequest();

  if (accessToken && typeof request?.setHeader === 'function') {
    request = request.setHeader('Authorization', `Bearer ${accessToken}`);
  }

  return request;
}

export async function getCurrentAuthenticatedUser({
  requireUser = false,
  syncSiteSession = true,
  useSiteSessionCache = true,
} = {}) {
  if (isContributorDemoModeEnabled()) {
    if (requireUser) throw new Error('贡献者内容沙盒不提供真实认证用户');
    return null;
  }
  if (syncSiteSession) {
    const siteSession = await getCurrentSiteSession({
      syncSupabase: true,
      useCache: useSiteSessionCache,
    }).catch(() => null);
    if (siteSession?.authenticated && siteSession.user) {
      return siteSession.user;
    }
    if (siteSession?.authenticated) {
      if (requireUser) {
        throw new Error('请先登录');
      }
      return null;
    }
  }

  const nativeSession = await getValidatedSupabaseSession();
  const user = nativeSession?.user || null;

  if (requireUser && !user) {
    throw new Error('请先登录');
  }

  return user;
}

export default {
  buildAuthenticatedFetchInit,
  getAuthFetchHeaders,
  getCurrentAuthenticatedUser,
  getSameOriginAuthHeaders,
  getSupabaseAccessToken,
  getValidatedSupabaseSession,
  withAuthenticatedSupabaseRequest,
};
