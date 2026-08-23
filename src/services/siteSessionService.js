import { supabase } from '../supabaseClient.js';
import { fetchJsonWithTimeout } from './supabaseRequest.js';

let cachedSiteSession = null;
let cachedSiteSessionSyncedAt = 0;
let pendingSiteSessionRequest = null;
let pendingSiteSessionSyncSupabase = false;

const SITE_SESSION_CACHE_MS = 15 * 1000;

function buildSupabaseSessionPayload(payload) {
  const accessToken = payload?.supabase?.accessToken;
  const user = payload?.user;
  if (!accessToken || !user?.id) {
    return null;
  }

  return {
    access_token: accessToken,
    token_type: payload.supabase.tokenType || 'bearer',
    expires_in: payload.supabase.expiresIn || 3600,
    expires_at: payload.supabase.expiresAt || Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'site_session_compat',
    user,
  };
}

export async function syncSiteSessionToSupabase(payload) {
  const sessionPayload = buildSupabaseSessionPayload(payload);
  if (!supabase || !sessionPayload) {
    return false;
  }

  try {
    const { error } = await supabase.auth.setSession(sessionPayload);
    return !error;
  } catch {
    return false;
  }
}

export function clearSiteSessionCache() {
  cachedSiteSession = null;
  cachedSiteSessionSyncedAt = 0;
  pendingSiteSessionRequest = null;
  pendingSiteSessionSyncSupabase = false;
}

export function hasKnownAuthenticatedSiteSession(now = Date.now()) {
  if (cachedSiteSession?.authenticated !== true) {
    return false;
  }

  const expiresAt = new Date(cachedSiteSession?.session?.expiresAt || 0).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > now;
}

export function getKnownSiteSessionUserId(now = Date.now()) {
  return hasKnownAuthenticatedSiteSession(now)
    ? String(cachedSiteSession?.user?.id || '')
    : '';
}

function getCachedSiteSession({ syncSupabase = true } = {}) {
  if (
    cachedSiteSession
    && cachedSiteSession.authenticated
    && (!syncSupabase || cachedSiteSession.supabaseSessionSynced)
    && Date.now() - cachedSiteSessionSyncedAt < SITE_SESSION_CACHE_MS
  ) {
    return cachedSiteSession;
  }

  return null;
}

export async function bootstrapSiteSessionFromSupabaseToken(accessToken = '') {
  if (!supabase) {
    return {
      bootstrapped: false,
      authenticated: false,
      source: null,
    };
  }

  const token = String(accessToken || '').trim();
  if (!token) {
    const sessionResult = await supabase.auth.getSession().catch(() => null);
    const currentToken = sessionResult?.data?.session?.access_token || '';
    if (!currentToken) {
      return {
        bootstrapped: false,
        authenticated: false,
        source: null,
      };
    }
    return bootstrapSiteSessionFromSupabaseToken(currentToken);
  }

  const { response, data } = await fetchJsonWithTimeout('/api/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }, {
    label: 'auth-session-bootstrap',
    timeoutMs: 15000,
    retries: 0,
  });

  if (!response.ok || data?.success !== true) {
    return {
      bootstrapped: false,
      authenticated: false,
      source: null,
      error: data?.error || data?.message || 'auth_session_bootstrap_failed',
    };
  }

  return {
    bootstrapped: data?.data?.bootstrapped === true,
    authenticated: true,
    source: data?.data?.source || 'supabase',
  };
}

export async function revokeAllSiteSessions(accessToken = '') {
  const token = String(accessToken || '').trim();
  const headers = {
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { response, data } = await fetchJsonWithTimeout('/api/auth/session/revoke-all', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
  }, {
    label: 'auth-session-revoke-all',
    timeoutMs: 15000,
    retries: 0,
  });

  if (!response.ok || data?.success !== true) {
    throw new Error(data?.message || data?.error || 'site_session_revoke_failed');
  }

  clearSiteSessionCache();
  return {
    sessionsRevoked: data?.data?.sessionsRevoked === true,
    revokedCount: Number(data?.data?.revokedCount || 0),
  };
}

export async function getCurrentSiteSession({
  syncSupabase = false,
  useCache = false,
} = {}) {
  if (useCache) {
    const cached = getCachedSiteSession({ syncSupabase });
    if (cached) {
      return cached;
    }
  }

  if (pendingSiteSessionRequest && (!syncSupabase || pendingSiteSessionSyncSupabase)) {
    return pendingSiteSessionRequest;
  }

  pendingSiteSessionSyncSupabase = syncSupabase;
  pendingSiteSessionRequest = (async () => {
    const sessionEndpoint = useCache
      ? '/api/auth/session'
      : `/api/auth/session?_=${Date.now()}`;
    const { response, data } = await fetchJsonWithTimeout(sessionEndpoint, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    }, {
      label: 'auth-session',
      timeoutMs: 15000,
      retries: 0,
    });

    if (!response.ok || data?.success !== true || data?.authenticated !== true) {
      clearSiteSessionCache();
      return {
        authenticated: false,
        user: null,
        profile: null,
        identities: [],
        supabaseSessionSynced: false,
      };
    }

    const payload = data.data || {};
    const supabaseSessionSynced = syncSupabase
      ? await syncSiteSessionToSupabase(payload)
      : false;

    const result = {
      authenticated: true,
      user: payload.user || null,
      profile: payload.profile || null,
      identities: Array.isArray(payload.identities) ? payload.identities : [],
      session: payload.session || null,
      supabase: payload.supabase || null,
      supabaseSessionSynced,
    };

    cachedSiteSession = result;
    cachedSiteSessionSyncedAt = Date.now();
    return result;
  })();

  try {
    return await pendingSiteSessionRequest;
  } finally {
    pendingSiteSessionRequest = null;
    pendingSiteSessionSyncSupabase = false;
  }
}

export async function logoutSiteSession() {
  try {
    await fetchJsonWithTimeout('/api/auth/session/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
    }, {
      label: 'auth-session-logout',
      timeoutMs: 10000,
      retries: 0,
    });
  } catch {
    // Supabase sign-out and local state cleanup should still continue.
  }
  clearSiteSessionCache();
}

export default {
  bootstrapSiteSessionFromSupabaseToken,
  clearSiteSessionCache,
  getCurrentSiteSession,
  getKnownSiteSessionUserId,
  hasKnownAuthenticatedSiteSession,
  logoutSiteSession,
  revokeAllSiteSessions,
  syncSiteSessionToSupabase,
};
