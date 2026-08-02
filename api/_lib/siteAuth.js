import { createSupabaseAccessTokenClient, getBearerToken, getSupabaseAdminClient } from './authAdmin.js';
import {
  checkAccountCredentialAllowed,
  createSupabaseCompatAccessToken,
  loadActiveSiteSessionById,
  loadSiteSession,
} from './siteSession.js';

function decodeJwtPayload(token) {
  const [, encodedPayload] = String(token || '').split('.');
  if (!encodedPayload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function buildSiteSessionAuthResult(siteSession, adminClient, bearerResult = null) {
  const compatToken = createSupabaseCompatAccessToken({
    user: siteSession.user,
    profile: siteSession.profile || null,
    sessionId: siteSession.session?.id || '',
  });

  return {
    ok: true,
    source: 'site_session',
    user: siteSession.user,
    profile: siteSession.profile || null,
    session: siteSession.session || null,
    identities: siteSession.identities || [],
    accessToken: compatToken?.accessToken || null,
    adminClient,
    callerClient: bearerResult?.callerClient || null,
    credentialSources: bearerResult ? ['site_session', 'supabase'] : ['site_session'],
  };
}

export async function resolveBearerRequestUser(req, {
  adminClient = getSupabaseAdminClient(),
} = {}) {
  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Missing access token',
      code: 'missing_access_token',
    };
  }

  const callerClient = createSupabaseAccessTokenClient(token);
  if (!callerClient?.auth) {
    return {
      ok: false,
      status: 503,
      error: 'Auth service not configured',
      code: 'auth_service_not_configured',
    };
  }

  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return {
      ok: false,
      status: 401,
      error: userError?.message || 'Invalid access token',
      code: 'invalid_access_token',
    };
  }

  const credentialGate = await checkAccountCredentialAllowed(adminClient, userData.user.id);
  if (!credentialGate.ok) {
    return {
      ok: false,
      status: 503,
      error: credentialGate.reason || 'Failed to verify account credential state',
      code: credentialGate.code || 'credential_state_lookup_failed',
    };
  }
  if (!credentialGate.allowed) {
    return {
      ok: false,
      status: 401,
      error: 'Temporary password has expired',
      code: 'temporary_password_expired',
    };
  }

  const tokenPayload = decodeJwtPayload(token);
  const isSiteSessionCompatToken = tokenPayload?.app_metadata?.provider === 'site_session'
    && tokenPayload?.user_metadata?.site_session === true;
  if (isSiteSessionCompatToken) {
    if (!adminClient?.from || !tokenPayload?.session_id) {
      return {
        ok: false,
        status: adminClient ? 401 : 503,
        error: adminClient
          ? 'Site session token is missing its session binding'
          : 'Auth service not configured',
        code: adminClient ? 'site_session_id_missing' : 'auth_service_not_configured',
      };
    }

    const activeSession = await loadActiveSiteSessionById(adminClient, {
      sessionId: tokenPayload.session_id,
      userId: userData.user.id,
    });
    if (!activeSession.ok) {
      return {
        ok: false,
        status: 503,
        error: activeSession.reason || 'Failed to verify site session',
        code: activeSession.code || 'site_session_lookup_failed',
      };
    }
    if (!activeSession.active) {
      return {
        ok: false,
        status: 401,
        error: 'Site session is no longer active',
        code: 'site_session_revoked',
      };
    }
  } else {
    const sourceAuthSessionId = String(tokenPayload?.session_id || '').trim();
    const issuedAt = Number(tokenPayload?.iat || 0);
    if (!adminClient?.rpc || !sourceAuthSessionId || !Number.isFinite(issuedAt) || issuedAt <= 0) {
      return {
        ok: false,
        status: adminClient ? 401 : 503,
        error: adminClient
          ? 'Native access token is missing its Auth session binding'
          : 'Auth service not configured',
        code: adminClient ? 'auth_session_binding_missing' : 'auth_service_not_configured',
      };
    }

    const { data: bearerAllowed, error: bearerCheckError } = await adminClient.rpc(
      'is_bearer_auth_session_allowed',
      {
        p_user_id: userData.user.id,
        p_auth_session_id: sourceAuthSessionId,
        p_bearer_issued_at: new Date(issuedAt * 1000).toISOString(),
      }
    );
    if (bearerCheckError) {
      return {
        ok: false,
        status: 503,
        error: bearerCheckError.message || 'Failed to verify Auth session',
        code: bearerCheckError.code || 'auth_session_lookup_failed',
      };
    }
    if (bearerAllowed !== true) {
      return {
        ok: false,
        status: 401,
        error: 'Auth session is no longer active',
        code: 'auth_session_revoked',
      };
    }
  }

  return {
    ok: true,
    source: 'supabase',
    user: userData.user,
    profile: null,
    session: null,
    identities: [],
    adminClient: adminClient || null,
    callerClient,
    accessToken: token,
    bearerTokenKind: isSiteSessionCompatToken ? 'site_session_compat' : 'native_supabase',
    sourceAuthSessionId: String(tokenPayload?.session_id || '').trim(),
    bearerIssuedAt: Number(tokenPayload?.iat || 0),
    bearerExpiresAt: Number(tokenPayload?.exp || 0),
  };
}

export async function resolveAuthenticatedRequestUser(req, {
  adminClient = getSupabaseAdminClient(),
  touch = true,
} = {}) {
  const authorizationHeader = String(
    req?.headers?.authorization || req?.headers?.Authorization || ''
  ).trim();
  let bearerResult = null;
  if (authorizationHeader) {
    bearerResult = await resolveBearerRequestUser(req, { adminClient });
    if (!bearerResult.ok) {
      return bearerResult;
    }
  }

  const siteSession = adminClient
    ? await loadSiteSession(adminClient, {
      req,
      touch,
    }).catch(() => null)
    : null;

  if (siteSession?.authenticated && siteSession.user?.id) {
    if (bearerResult?.user?.id && bearerResult.user.id !== siteSession.user.id) {
      return {
        ok: false,
        status: 409,
        error: 'Cookie and bearer credentials belong to different users',
        code: 'auth_identity_conflict',
      };
    }
    return buildSiteSessionAuthResult(siteSession, adminClient, bearerResult);
  }

  if (siteSession?.code === 'temporary_password_expired') {
    return {
      ok: false,
      status: 401,
      error: 'Temporary password has expired',
      code: 'temporary_password_expired',
    };
  }

  if (bearerResult?.ok) {
    return bearerResult;
  }

  return {
    ok: false,
    status: adminClient ? 401 : 503,
    error: adminClient ? 'Missing access token' : 'Auth service not configured',
    code: adminClient ? 'missing_access_token' : 'auth_service_not_configured',
  };
}

export async function requireSuperAdminUser(req, {
  adminClient = getSupabaseAdminClient(),
  touch = true,
} = {}) {
  const authResult = await resolveAuthenticatedRequestUser(req, {
    adminClient,
    touch,
  });

  if (!authResult.ok) {
    return authResult;
  }

  if (!authResult.adminClient) {
    return {
      ok: false,
      status: 503,
      error: 'Auth service not configured',
      code: 'auth_service_not_configured',
    };
  }

  const { data: profile, error: profileError } = await authResult.adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', authResult.user.id)
    .single();

  if (profileError) {
    return {
      ok: false,
      status: 500,
      error: profileError.message || 'Failed to load caller profile',
      code: 'profile_load_failed',
    };
  }

  if (profile?.role !== 'super_admin') {
    return {
      ok: false,
      status: 403,
      error: 'Super admin role required',
      code: 'super_admin_required',
    };
  }

  return {
    ...authResult,
    profile,
  };
}

export default {
  requireSuperAdminUser,
  resolveBearerRequestUser,
  resolveAuthenticatedRequestUser,
};
