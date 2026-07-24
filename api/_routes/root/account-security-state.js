import {
  getSupabaseAdminClient,
  loadAuthUserById,
} from '../../_lib/authAdmin.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';
import {
  rejectDisallowedBrowserOrigin,
} from '../../_lib/http.js';
import {
  buildClearedPasswordChangeState,
} from '../../../src/utils/accountRecoveryFlow.js';

const SYNTHETIC_OAUTH_EMAIL_SUFFIX = '@oauth.local.invalid';

function parseRequestBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

function toClientSecurityState(row) {
  return {
    passwordChangeRequired: Boolean(row?.password_change_required),
    reason: row?.password_change_reason || null,
    source: row?.password_change_source || null,
    requestedAt: row?.password_change_requested_at || null,
    expiresAt: row?.password_change_expires_at || null,
    recoveryRequestId: row?.password_change_recovery_request_id || null,
    emailVerificationRequired: Boolean(row?.email_verification_required),
    emailVerificationReason: row?.email_verification_reason || null,
    emailVerificationRequestedAt: row?.email_verification_requested_at || null,
    emailVerificationVerifiedAt: row?.email_verification_verified_at || null,
  };
}

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized.length > 320) {
    return '';
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function isAuthEmailConfirmed(user) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

function isSyntheticOAuthEmail(value) {
  return String(value || '').trim().toLowerCase().endsWith(SYNTHETIC_OAUTH_EMAIL_SUFFIX);
}

function isMatchingConfirmedEmail(user, expectedEmail) {
  const userEmail = normalizeEmail(user?.email);
  return Boolean(
    expectedEmail
    && userEmail
    && !isSyntheticOAuthEmail(userEmail)
    && userEmail === expectedEmail
    && isAuthEmailConfirmed(user)
  );
}

function isSuperAdminUser(user, profile = null) {
  return user?.app_metadata?.role === 'super_admin'
    || user?.profile_role === 'super_admin'
    || profile?.role === 'super_admin';
}

function hasSitePassword(authUser = null) {
  const metadata = authUser?.user_metadata || authUser?.raw_user_meta_data || {};
  return Boolean(
    authUser?.encrypted_password
    || metadata?.site_password_set === true
    || metadata?.email_bound_from_profile === true
  );
}

async function loadProfile(adminClient, userId) {
  const { data, error } = await adminClient
    .from('profiles')
    .select('id, email, role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

function normalizeEffectiveSecurityState(row, {
  currentUser,
  profile,
  authUser,
} = {}) {
  if (!row) {
    return null;
  }

  const next = { ...row };
  const superAdmin = isSuperAdminUser(currentUser, profile);
  const profileEmail = normalizeEmail(profile?.email);
  const authEmail = normalizeEmail(authUser?.email);
  const currentEmail = normalizeEmail(currentUser?.email);
  const effectiveEmail = profileEmail
    || (!isSyntheticOAuthEmail(authEmail) ? authEmail : '')
    || (!isSyntheticOAuthEmail(currentEmail) ? currentEmail : '');
  const hasUsableEmail = Boolean(effectiveEmail);
  const emailVerified = Boolean(
    (row.email_verification_required !== true && row.email_verification_verified_at)
    || isMatchingConfirmedEmail(authUser, effectiveEmail)
    || isMatchingConfirmedEmail(currentUser, effectiveEmail)
  );
  const emailReason = String(row.email_verification_reason || '');
  const passwordReason = String(row.password_change_reason || '');
  const isOAuthEmailSetup = emailReason.startsWith('oauth_email_setup_required');
  const isOAuthPasswordSetup = passwordReason.startsWith('oauth_password_setup_required');

  if (
    (superAdmin && isOAuthEmailSetup)
    || (
      row.email_verification_required === true
      && isOAuthEmailSetup
      && hasUsableEmail
      && emailVerified
    )
  ) {
    next.email_verification_required = false;
  }

  if (
    (superAdmin && isOAuthPasswordSetup)
    || (
      row.password_change_required === true
      && isOAuthPasswordSetup
      && hasSitePassword(authUser)
    )
  ) {
    next.password_change_required = false;
  }

  return next;
}

async function resolveCurrentUser(req, {
  adminClient,
} = {}) {
  const authResult = await resolveAuthenticatedRequestUser(req, { adminClient });
  if (!authResult.ok) {
    return {
      ok: false,
      status: authResult.status || 401,
      error: authResult.error || 'Authentication required',
    };
  }

  return {
    ok: true,
    currentUser: authResult.user,
    authResult,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, Authorization' })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const adminClient = getSupabaseAdminClient();

  try {
    const userResult = await resolveCurrentUser(req, {
      adminClient,
    });
    if (!userResult.ok) {
      return res.status(userResult.status || 401).json({
        success: false,
        error: userResult.error || 'Authentication required',
      });
    }
    const currentUser = userResult.currentUser;
    const dbClient = adminClient || userResult.authResult?.callerClient;
    if (!dbClient) {
      return res.status(503).json({
        success: false,
        error: 'Account security state service not configured',
      });
    }

    if (req.method === 'POST') {
      const { action } = parseRequestBody(req);
      if (action !== 'clear_password_change_required') {
        return res.status(400).json({
          success: false,
          error: 'Invalid account security action',
        });
      }

      const { error: upsertError } = await dbClient
        .from('account_security_states')
        .upsert({
          user_id: currentUser.id,
          ...buildClearedPasswordChangeState(),
        }, {
          onConflict: 'user_id',
        });

      if (upsertError) {
        throw upsertError;
      }
    }

    const [
      profile,
      authUser,
    ] = await Promise.all([
      loadProfile(dbClient, currentUser.id),
      adminClient ? loadAuthUserById(adminClient, currentUser.id) : currentUser,
    ]);

    const { data: stateRow, error: stateError } = await dbClient
      .from('account_security_states')
      .select('password_change_required, password_change_reason, password_change_source, password_change_requested_at, password_change_expires_at, password_change_recovery_request_id, email_verification_required, email_verification_reason, email_verification_requested_at, email_verification_verified_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (stateError) {
      throw stateError;
    }

    const effectiveStateRow = normalizeEffectiveSecurityState(stateRow, {
      currentUser,
      profile,
      authUser,
    });

    const fallbackEmail = normalizeEmail(profile?.email || currentUser?.email);
    const fallbackEmailVerificationRequired = !effectiveStateRow
      && !isMatchingConfirmedEmail(currentUser, fallbackEmail)
      && !isSuperAdminUser(currentUser, profile);

    return res.status(200).json({
      success: true,
      state: toClientSecurityState(effectiveStateRow || (fallbackEmailVerificationRequired ? {
        email_verification_required: true,
        email_verification_reason: 'unverified_email',
        email_verification_requested_at: null,
        email_verification_verified_at: null,
      } : null)),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to load account security state',
    });
  }
}
