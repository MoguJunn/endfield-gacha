import { supabase } from '../supabaseClient.js';
import {
  getCurrentSiteSession,
  getKnownSiteSessionUserId,
  hasKnownAuthenticatedSiteSession,
} from './siteSessionService.js';

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
  }).catch(() => null);
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
  if (!supabase) {
    return null;
  }

  const currentSession = await supabase.auth.getSession().catch(() => null);
  const nativeSession = currentSession?.data?.session || null;
  const accessToken = nativeSession?.access_token || '';
  const sessionUserId = nativeSession?.user?.id || '';
  if (!accessToken || !sessionUserId) {
    return null;
  }

  const userResult = await supabase.auth.getUser(accessToken).catch((error) => ({
    error,
    data: null,
  }));
  const verifiedUser = userResult?.data?.user || null;
  if (userResult?.error || !verifiedUser?.id || verifiedUser.id !== sessionUserId) {
    await clearInvalidSupabaseSession();
    return null;
  }

  return {
    ...nativeSession,
    user: verifiedUser,
  };
}

export async function getSupabaseAccessToken({
  syncSiteSession = true,
  useSiteSessionCache = true,
  allowSiteSessionToken = true,
  preferSiteSessionToken = false,
} = {}) {
  if (!supabase) {
    return null;
  }

  if (syncSiteSession && allowSiteSessionToken && preferSiteSessionToken) {
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
    const isCompatToken = isSiteSessionCompatToken(nativeSession.access_token);
    if (isCompatToken && !allowSiteSessionToken) {
      return null;
    }
    if (syncSiteSession && allowSiteSessionToken && isCompatToken) {
      const siteSessionToken = await getSiteSessionAccessToken({
        useSiteSessionCache,
        allowSiteSessionToken,
      });
      if (siteSessionToken) {
        return siteSessionToken;
      }
    }
    return nativeSession.access_token;
  }

  if (syncSiteSession) {
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
