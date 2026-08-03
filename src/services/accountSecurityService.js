import { supabase } from '../supabaseClient.js';
import { fetchJsonWithTimeout } from './supabaseRequest.js';
import { getSupabaseAccessToken } from './authFetchService.js';
import {
  bootstrapSiteSessionFromSupabaseToken,
} from './siteSessionService.js';

export class AuthRateLimitError extends Error {
  constructor(retryAfter = 60) {
    super('Auth action rate limited');
    this.name = 'AuthRateLimitError';
    this.code = 'auth_rate_limited';
    this.retryAfter = Number(retryAfter || 60);
  }
}

export async function checkAuthActionRateLimit(action) {
  const { response, data: payload } = await fetchJsonWithTimeout('/api/auth-rate-limit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action }),
  }, {
    label: `auth-rate-limit:${action}`,
    timeoutMs: 15000,
    retries: 1,
  });

  if (!response.ok && payload?.allowed !== false) {
    throw new Error(payload?.error || 'Failed to check auth rate limit');
  }

  if (payload?.allowed === false) {
    throw new AuthRateLimitError(payload.retry_after);
  }

  return payload || { allowed: true };
}

const EMPTY_ACCOUNT_SECURITY_STATE = Object.freeze({
  passwordChangeRequired: false,
  reason: null,
  source: null,
  requestedAt: null,
  expiresAt: null,
  recoveryRequestId: null,
  emailVerificationRequired: false,
  emailVerificationReason: null,
  emailVerificationRequestedAt: null,
  emailVerificationVerifiedAt: null,
  emailVerificationTargetEmail: null,
  emailVerificationVersion: null,
  passwordSetupCapabilityStatus: null,
  passwordSetupLastErrorCode: null,
});

export async function loadAccountSecurityState() {
  const accessToken = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  });
  const headers = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const { response, data: payload } = await fetchJsonWithTimeout('/api/account-security-state', {
    method: 'GET',
    credentials: 'same-origin',
    headers,
  }, {
    label: 'account-security-state',
    timeoutMs: 20000,
    retries: 1,
  });

  if (!response.ok || payload?.success !== true) {
    if (response.status === 401 || response.status === 403) {
      return EMPTY_ACCOUNT_SECURITY_STATE;
    }
    throw new Error(payload?.error || 'Failed to load account security state');
  }

  return payload.state || EMPTY_ACCOUNT_SECURITY_STATE;
}

export async function updatePasswordWithCurrentPassword({
  email,
  currentPassword,
  newPassword,
  clearTemporaryPasswordState = true,
}) {
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) {
    throw new Error('Current user email is required');
  }

  await checkAuthActionRateLimit('change_password');

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: currentPassword,
  });

  if (reauthError) {
    throw reauthError;
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    throw error;
  }

  const { data: newSessionData, error: newSignInError } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: newPassword,
  });
  if (newSignInError) {
    throw newSignInError;
  }
  const accessToken = newSessionData?.session?.access_token || '';
  const bootstrapResult = accessToken
    ? await bootstrapSiteSessionFromSupabaseToken(accessToken)
    : { bootstrapped: false, authenticated: false };

  let securityStateUpdated = false;
  let securityStateError = null;
  let state = null;
  try {
    if (clearTemporaryPasswordState) {
      state = await loadAccountSecurityState();
      securityStateUpdated = true;
    }
  } catch (clearError) {
    securityStateError = clearError;
  }

  return {
    securityStateUpdated,
    state,
    securityStateError,
    sessionsRevoked: true,
    revokedSessionCount: null,
    currentSessionRecreated: bootstrapResult.authenticated === true,
  };
}

export function isOAuthPasswordSetupRequired(state) {
  return Boolean(
    state?.passwordChangeRequired
    && String(state?.reason || '').startsWith('oauth_password_setup_required')
  );
}

export function isOAuthEmailSetupRequired(state) {
  return Boolean(
    state?.emailVerificationRequired
    && String(state?.emailVerificationReason || '').startsWith('oauth_email_setup_required')
  );
}

export function isOAuthAccountCompletionRequired(state) {
  return Boolean(
    isOAuthEmailSetupRequired(state)
    || isOAuthPasswordSetupRequired(state)
  );
}

export async function setupPasswordForOAuthAccount({
  newPassword,
}) {
  await checkAuthActionRateLimit('change_password');

  const accessToken = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  });
  const headers = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const { response, data: payload } = await fetchJsonWithTimeout('/api/account-password-setup', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({
      newPassword,
    }),
  }, {
    label: 'account-password-setup',
    timeoutMs: 20000,
    retries: 0,
  });

  if (!response.ok || payload?.success !== true) {
    const error = new Error(payload?.error || 'Failed to set account password');
    error.code = payload?.code || `http_${response.status}`;
    error.status = response.status;
    error.details = payload?.details || null;
    throw error;
  }

  return {
    securityStateUpdated: true,
    state: payload.state || EMPTY_ACCOUNT_SECURITY_STATE,
    securityStateError: null,
  };
}
