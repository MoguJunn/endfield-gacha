import { getSupabaseAdminClient, loadAuthUserById, findAuthUserByEmail } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';
import { inspectOAuthEmailArtifactMerge } from '../../_lib/oauthEmailArtifactMerge.js';
import {
  clearSiteSessionCookies,
  createSiteSession,
  revokeAllSiteSessionsForUser,
} from '../../_lib/siteSession.js';
import {
  getPrimaryAccountPasswordError,
  validateAccountPassword,
} from '../../../src/utils/authSecurity.js';

const SYNTHETIC_OAUTH_EMAIL_SUFFIX = '@oauth.local.invalid';

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized.length > 320) {
    return '';
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function isSyntheticOAuthAuthUser(authUser) {
  const email = String(authUser?.email || '').trim().toLowerCase();
  const metadata = authUser?.user_metadata || authUser?.raw_user_meta_data || {};
  return email.endsWith(SYNTHETIC_OAUTH_EMAIL_SUFFIX)
    || metadata?.synthetic_oauth_email === true;
}

function getPasswordErrorCode(password) {
  const validation = validateAccountPassword(password);
  if (validation.isValid) {
    return '';
  }
  return getPrimaryAccountPasswordError(validation) || 'invalid_password';
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
    emailVerificationTargetEmail: row?.email_verification_target_email || null,
    passwordSetupCapabilityStatus: row?.password_setup_capability_status || null,
    passwordSetupLastErrorCode: row?.password_setup_last_error_code || null,
  };
}

async function loadSecurityState(adminClient, userId) {
  const { data, error } = await adminClient
    .from('account_security_states')
    .select('password_change_required, password_change_reason, password_change_source, password_change_requested_at, password_change_expires_at, password_change_recovery_request_id, password_change_set_by, email_verification_required, email_verification_reason, email_verification_requested_at, email_verification_verified_at, email_verification_target_email, email_verification_version, password_setup_capability_id, password_setup_capability_status, password_setup_last_error_code')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data || null;
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

async function runPasswordSetupCapabilityRpc(adminClient, name, payload) {
  if (typeof adminClient?.rpc !== 'function') {
    const error = new Error('Password setup capability service unavailable');
    error.code = 'password_setup_capability_unavailable';
    throw error;
  }
  const { data, error } = await adminClient.rpc(name, payload);
  if (error) {
    const wrapped = new Error(error.message || 'Password setup capability update failed');
    wrapped.code = String(error.message || '').includes('verified_email_ownership_required')
      ? 'verified_email_required'
      : (String(error.message || '').includes('password_setup_capability')
        ? 'password_setup_capability_unavailable'
        : (error.code || 'password_setup_capability_failed'));
    throw wrapped;
  }
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'POST, OPTIONS', headers: 'Content-Type, Authorization' })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return res.status(503).json({
      success: false,
      error: 'Account password setup service is not configured',
      code: 'password_setup_unavailable',
    });
  }

  try {
    const authResult = await resolveAuthenticatedRequestUser(req, { adminClient });
    if (!authResult.ok || !authResult.user?.id) {
      return res.status(authResult.status || 401).json({
        success: false,
        error: authResult.error || 'Authentication required',
        code: 'auth_required',
      });
    }

    const userId = authResult.user.id;
    const body = parseRequestBody(req);
    const newPassword = String(body.newPassword || body.new_password || '');
    const passwordError = getPasswordErrorCode(newPassword);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        error: 'Password does not meet the security requirements',
        code: passwordError,
      });
    }

    const securityState = await loadSecurityState(adminClient, userId);
    const canSetPassword = securityState?.password_change_required === true
      && String(securityState?.password_change_reason || '').startsWith('oauth_password_setup_required')
      && securityState?.password_setup_capability_status === 'available'
      && Boolean(securityState?.password_setup_capability_id);
    if (!canSetPassword) {
      return res.status(403).json({
        success: false,
        error: 'This account is not in first password setup state',
        code: 'password_setup_not_allowed',
      });
    }

    const profile = await loadProfile(adminClient, userId);
    const profileEmail = normalizeEmail(profile?.email);
    const emailVerified = securityState?.email_verification_required !== true
      && Boolean(securityState?.email_verification_verified_at)
      && profileEmail === normalizeEmail(securityState?.email_verification_target_email);
    if (!profileEmail || !emailVerified) {
      return res.status(409).json({
        success: false,
        error: 'Verify a site email before setting a password for this OAuth account',
        code: 'verified_email_required',
      });
    }

    const authUser = await loadAuthUserById(adminClient, userId);
    if (!authUser?.id) {
      return res.status(404).json({
        success: false,
        error: 'Auth user not found',
        code: 'auth_user_not_found',
      });
    }

    const updatePayload = {
      password: newPassword,
      user_metadata: {
        ...(authUser?.user_metadata || authUser?.raw_user_meta_data || {}),
        synthetic_oauth_email: false,
        email_bound_from_profile: true,
        site_password_set: true,
      },
    };

    if (isSyntheticOAuthAuthUser(authUser)) {
      if (typeof adminClient?.auth?.admin?.listUsers === 'function') {
        const existingAuthUser = await findAuthUserByEmail(adminClient, profileEmail);
        if (existingAuthUser?.id && existingAuthUser.id !== userId) {
          const inspection = await inspectOAuthEmailArtifactMerge(adminClient, {
            sourceUserId: userId,
            targetEmail: profileEmail,
          }).catch(() => ({ eligible: false }));
          if (inspection.eligible && inspection.artifactUserId === existingAuthUser.id) {
            return res.status(409).json({
              success: false,
              error: 'This email is blocked by an empty account created by the previous verification flow',
              code: 'oauth_email_merge_available',
              details: {
                mergeAvailable: true,
                maskedEmail: inspection.maskedEmail,
              },
            });
          }
          return res.status(409).json({
            success: false,
            error: 'Email is already used by another auth account',
            code: 'auth_email_already_used',
          });
        }
      }
      updatePayload.email = profileEmail;
      updatePayload.email_confirm = true;
    }

    const capabilityId = securityState.password_setup_capability_id;
    try {
      await runPasswordSetupCapabilityRpc(adminClient, 'claim_oauth_password_setup_capability', {
        p_user_id: userId,
        p_capability_id: capabilityId,
      });
    } catch (claimError) {
      return res.status(claimError.code === 'verified_email_required' ? 409 : 403).json({
        success: false,
        error: claimError.message || 'Password setup capability is no longer available',
        code: claimError.code || 'password_setup_capability_unavailable',
      });
    }

    const { data: updateData, error: updateError } = await adminClient.auth.admin.updateUserById(userId, updatePayload);
    if (updateError) {
      await runPasswordSetupCapabilityRpc(adminClient, 'finish_oauth_password_setup_capability', {
        p_user_id: userId,
        p_capability_id: capabilityId,
        p_outcome: 'coordination_required',
        p_error_code: updateError.code || 'auth_password_update_failed',
      }).catch(() => null);
      return res.status(500).json({
        success: false,
        error: updateError.message || 'Failed to set account password',
        code: updateError.code || 'password_setup_failed',
        capabilityConsumed: true,
      });
    }

    try {
      await runPasswordSetupCapabilityRpc(adminClient, 'finish_oauth_password_setup_capability', {
        p_user_id: userId,
        p_capability_id: capabilityId,
        p_outcome: 'completed',
        p_error_code: null,
      });
    } catch (finishError) {
      let recoveredStatus = null;
      let recoveryError = finishError;
      try {
        recoveredStatus = await runPasswordSetupCapabilityRpc(
          adminClient,
          'finish_oauth_password_setup_capability',
          {
            p_user_id: userId,
            p_capability_id: capabilityId,
            p_outcome: 'completed',
            p_error_code: null,
          }
        );
      } catch (retryError) {
        recoveryError = retryError;
        try {
          recoveredStatus = await runPasswordSetupCapabilityRpc(
            adminClient,
            'finish_oauth_password_setup_capability',
            {
              p_user_id: userId,
              p_capability_id: capabilityId,
              p_outcome: 'coordination_required',
              p_error_code: retryError.code || 'password_setup_finish_failed',
            }
          );
        } catch (coordinationError) {
          recoveryError = coordinationError;
        }
      }

      if (recoveredStatus !== 'completed') {
        const latestState = await loadSecurityState(adminClient, userId).catch(() => null);
        return res.status(500).json({
          success: false,
          passwordUpdated: true,
          capabilityConsumed: true,
          error: recoveryError.message || 'Password was updated but account state requires coordination',
          code: recoveryError.code || 'password_setup_coordination_required',
          state: toClientSecurityState(latestState),
        });
      }
    }

    const revokeResult = await revokeAllSiteSessionsForUser(adminClient, {
      userId,
      reason: 'password_setup_completed',
    });
    if (!revokeResult.ok) {
      return res.status(500).json({
        success: false,
        passwordUpdated: true,
        error: revokeResult.reason || 'Password was updated but existing site sessions could not be revoked',
        code: revokeResult.code || 'site_session_revoke_failed',
        state: toClientSecurityState(await loadSecurityState(adminClient, userId)),
      });
    }

    const currentSession = await createSiteSession(adminClient, {
      userId,
      req,
      res,
      provider: 'password_setup',
    });
    const nextState = await loadSecurityState(adminClient, userId);
    if (!currentSession.ok) {
      clearSiteSessionCookies(res, req);
      return res.status(500).json({
        success: false,
        passwordUpdated: true,
        sessionsRevoked: true,
        currentSessionRecreated: false,
        error: currentSession.reason || 'Password was updated but the current browser session could not be recreated',
        code: currentSession.code || 'site_session_create_failed',
        state: toClientSecurityState(nextState),
      });
    }
    return res.status(200).json({
      success: true,
      user: updateData?.user || updateData || null,
      state: toClientSecurityState(nextState),
      sessionsRevoked: true,
      revokedSessionCount: revokeResult.revokedCount,
      currentSessionRecreated: true,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to set account password',
      code: error?.code || 'password_setup_failed',
    });
  }
}
