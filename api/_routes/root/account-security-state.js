import {
  getSupabaseAdminClient,
  loadAuthUserById,
} from '../../_lib/authAdmin.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';
import {
  rejectDisallowedBrowserOrigin,
} from '../../_lib/http.js';

const SYNTHETIC_OAUTH_EMAIL_SUFFIX = '@oauth.local.invalid';

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
    emailVerificationTargetEmail: row?.email_verification_target_email || null,
    emailVerificationVersion: row?.email_verification_version || null,
    passwordSetupCapabilityStatus: row?.password_setup_capability_status || null,
    passwordSetupLastErrorCode: row?.password_setup_last_error_code || null,
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

  if (
    (superAdmin && isOAuthEmailSetup)
    || (
      row.email_verification_required === true
      && isOAuthEmailSetup
      && hasUsableEmail
      && emailVerified
      && (!row.email_verification_target_email || row.email_verification_target_email === effectiveEmail)
    )
  ) {
    next.email_verification_required = false;
  }

  if (superAdmin && passwordReason.startsWith('oauth_password_setup_required')) {
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

  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'GET, OPTIONS', headers: 'Content-Type, Authorization' })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
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

    const [
      profile,
      authUser,
    ] = await Promise.all([
      loadProfile(dbClient, currentUser.id),
      adminClient ? loadAuthUserById(adminClient, currentUser.id) : currentUser,
    ]);

    const { data: stateRow, error: stateError } = await dbClient
      .from('account_security_states')
      .select('password_change_required, password_change_reason, password_change_source, password_change_requested_at, password_change_expires_at, password_change_recovery_request_id, email_verification_required, email_verification_reason, email_verification_requested_at, email_verification_verified_at, email_verification_target_email, email_verification_version, password_setup_capability_status, password_setup_last_error_code')
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
