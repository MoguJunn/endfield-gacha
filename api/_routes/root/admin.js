import { randomUUID } from 'node:crypto';
import {
  checkMemoryRateLimit,
  getRequesterKey,
  rejectDisallowedBrowserOrigin,
} from '../../_lib/http.js';
import {
  findAuthUserByEmail,
  getSupabaseAdminClient,
  listMergedAdminUsers,
} from '../../_lib/authAdmin.js';
import { requireSuperAdminUser } from '../../_lib/siteAuth.js';
import { revokeAllSiteSessionsForUser } from '../../_lib/siteSession.js';
import {
  createApiKeySecret,
  createVerifierSecret,
  encryptRevealSecret,
} from '../../_lib/devApiSecrets.js';
import { parseRequestedJobIds } from '../../_lib/opsAutomation.js';
import {
  bumpPublicCacheEpoch,
  refreshPublicAnalyticsCache,
} from '../../_lib/publicCache.js';
import { getRequesterIp } from '../../_lib/authSecurityGuards.js';
import { enqueueMailOutboxEvent } from '../../_lib/mailOutbox.js';
import { MAIL_EVENT_TYPES } from '../../_lib/mailAbuseGuards.js';
import {
  buildOpsAutomationHttpPayload,
  runOpsAutomationJobs,
} from '../../_lib/runOpsAutomation.js';
import { runMailOutboxWorker } from '../../_lib/mailOutboxWorker.js';
import { sendMailSmokeTest } from '../../_lib/mailSmokeTest.js';
import {
  buildMailRuntimeControls,
  isRuntimeEventEnabled,
  loadMailRuntimeState,
  sanitizeMailRuntimeUpdate,
  saveMailRuntimeConfig,
} from '../../_lib/mailRuntimeConfig.js';
import { serverLogger } from '../../_lib/serverLogger.js';
import {
  getPrimaryAccountPasswordError,
  validateAccountPassword,
} from '../../../src/utils/authSecurity.js';
import {
  appendRecoveryAuditEvent,
  buildTemporaryPasswordIssueMetadata,
} from '../../../src/utils/accountRecoveryFlow.js';
import { buildAdminSiteHealth } from '../../_lib/adminSiteHealth.js';

const PASSWORD_RESET_LIMIT = {
  windowMs: 10 * 60 * 1000,
  max: 20,
};
const SYNTHETIC_OAUTH_EMAIL_SUFFIX = '@oauth.local.invalid';
const ADMIN_USER_HISTORY_SAMPLE_LIMIT = 500;

function normalizeAuthEmail(value) {
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

async function loadAdminAuthUser(adminClient, userId) {
  const getUserById = adminClient?.auth?.admin?.getUserById;
  if (typeof getUserById !== 'function') {
    return null;
  }

  const { data, error } = await getUserById.call(adminClient.auth.admin, userId);
  if (error) {
    throw error;
  }
  return data?.user || data || null;
}

async function loadProfileEmailForAuthSync(adminClient, userId) {
  const query = adminClient
    .from('profiles')
    .select('id, email')
    .eq('id', userId);

  const { data, error } = typeof query.maybeSingle === 'function'
    ? await query.maybeSingle()
    : await query.single();

  if (error) {
    throw error;
  }
  return normalizeAuthEmail(data?.email);
}

async function buildTemporaryPasswordAuthUpdate(adminClient, userId, temporaryPassword, {
  issueMetadata,
  issueId = randomUUID(),
} = {}) {
  const authUser = await loadAdminAuthUser(adminClient, userId);
  const temporaryPasswordAppMetadata = issueMetadata ? {
    ...(authUser?.app_metadata || authUser?.raw_app_meta_data || {}),
    temporary_password_issue_id: issueId,
    temporary_password_force_change: true,
    temporary_password_issued_at: issueMetadata.issuedAt,
    temporary_password_expires_at: issueMetadata.expiresAt,
  } : null;
  const payload = {
    password: temporaryPassword,
    ...(temporaryPasswordAppMetadata ? {
      app_metadata: temporaryPasswordAppMetadata,
    } : {}),
  };
  if (!isSyntheticOAuthAuthUser(authUser)) {
    return {
      payload,
      emailSynced: false,
      email: null,
    };
  }

  const profileEmail = await loadProfileEmailForAuthSync(adminClient, userId);
  if (!profileEmail) {
    return {
      payload,
      emailSynced: false,
      email: null,
    };
  }

  if (typeof adminClient?.auth?.admin?.listUsers === 'function') {
    const existingAuthUser = await findAuthUserByEmail(adminClient, profileEmail);
    if (existingAuthUser?.id && existingAuthUser.id !== userId) {
      const error = new Error('Profile email is already used by another auth account');
      error.status = 409;
      error.code = 'auth_email_already_used';
      throw error;
    }
  }

  const metadata = {
    ...(authUser?.user_metadata || authUser?.raw_user_meta_data || {}),
    synthetic_oauth_email: false,
    email_bound_from_profile: true,
  };

  return {
    payload: {
      ...payload,
      email: profileEmail,
      email_confirm: true,
      user_metadata: metadata,
    },
    emailSynced: true,
    email: profileEmail,
  };
}

function getTemporaryPasswordError(password) {
  const validation = validateAccountPassword(password);
  if (validation.isValid) {
    return null;
  }

  switch (getPrimaryAccountPasswordError(validation)) {
    case 'required':
    case 'too_short':
      return 'Temporary password must be at least 8 characters';
    case 'too_long':
      return 'Temporary password must be 100 characters or fewer';
    case 'too_simple':
      return 'Temporary password must include at least two character groups';
    default:
      return 'Temporary password does not meet the security requirements';
  }
}

function normalizeAdminEditableRole(value, {
  allowSuperAdmin = false,
} = {}) {
  const normalized = String(value || '').trim();
  const allowed = allowSuperAdmin ? new Set(['user', 'admin', 'super_admin']) : new Set(['user', 'admin']);
  return allowed.has(normalized) ? normalized : '';
}

function normalizeAdminCreateUserPayload(raw = {}) {
  const email = normalizeAuthEmail(raw.email);
  const password = String(raw.password || '');
  const username = String(raw.username || '').trim().slice(0, 80) || email.split('@')[0];
  const role = normalizeAdminEditableRole(raw.role || 'user');

  if (!email) {
    throw Object.assign(new Error('Email is required'), { status: 400 });
  }

  const passwordError = getTemporaryPasswordError(password);
  if (passwordError) {
    throw Object.assign(new Error(passwordError), { status: 400 });
  }

  if (!role) {
    throw Object.assign(new Error('Invalid role'), { status: 400 });
  }

  return {
    email,
    password,
    username,
    role,
  };
}

function normalizeAdminProfileUpdatePayload(raw = {}) {
  const userId = normalizeAdminUserId(raw.userId || raw.user_id);
  const username = String(raw.username || '').trim().slice(0, 80);
  const role = normalizeAdminEditableRole(raw.role);

  if (!userId) {
    throw Object.assign(new Error('User ID is required'), { status: 400 });
  }
  if (!username) {
    throw Object.assign(new Error('Username is required'), { status: 400 });
  }
  if (!role) {
    throw Object.assign(new Error('Invalid role'), { status: 400 });
  }

  return {
    userId,
    username,
    role,
  };
}

const RECOVERY_REQUEST_STATUSES = new Set(['pending', 'processing', 'verified', 'rejected', 'closed']);

function normalizeAccountRecoveryPatch(raw = {}) {
  const requestId = String(raw.requestId || raw.request_id || raw.id || '').trim();
  const status = String(raw.status || '').trim();
  const adminNote = String(raw.admin_note ?? raw.adminNote ?? '').trim();

  if (!requestId) {
    throw Object.assign(new Error('Recovery request ID is required'), { status: 400 });
  }

  if (status && !RECOVERY_REQUEST_STATUSES.has(status)) {
    throw Object.assign(new Error('Invalid recovery request status'), { status: 400 });
  }

  return {
    requestId,
    patch: {
      ...(status ? { status } : {}),
      admin_note: adminNote,
    },
  };
}

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

function getRequestUrl(req) {
  try {
    return new URL(req.url || '', 'https://example.com');
  } catch {
    return new URL('https://example.com/');
  }
}

function normalizeAdminUserId(value) {
  return String(value || '').trim().slice(0, 160);
}

function normalizePoolId(value) {
  return String(value || '').trim().slice(0, 160);
}

function readEnvironment() {
  return globalThis.process?.env || {};
}

function parseBoolean(value, defaultValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

async function safeLoadMailRuntimeState(adminClient) {
  try {
    return await loadMailRuntimeState(adminClient);
  } catch (error) {
    serverLogger.warn('mail.runtime-config.load-failed', {
      code: 'mail_runtime_config_load_failed',
      message: String(error?.message || error || 'mail_runtime_config_load_failed').slice(0, 200),
    });
    return null;
  }
}

function readAdminRoute(req) {
  try {
    const url = new URL(req.url || '', 'https://example.com');
    const explicitRoute = String(url.searchParams.get('route') || '').trim();
    if (explicitRoute) {
      return explicitRoute;
    }

    const normalizedPath = url.pathname.replace(/\/+$/, '');
    const pathnameRouteMap = {
      '/api/admin': 'users',
      '/api/admin-users': 'users',
      '/api/admin-account-recovery': 'account-recovery',
      '/api/admin-delete-user': 'delete-user',
      '/api/admin-announcements': 'announcements',
      '/api/admin-user-reset-password': 'user-reset-password',
      '/api/admin-reset-recovery-password': 'reset-recovery-password',
      '/api/admin-ops-automation': 'ops-automation',
      '/api/admin-public-cache-bump': 'public-cache-bump',
      '/api/admin-site-health': 'site-health',
      '/api/admin-mail-outbox-drain': 'mail-outbox-drain',
      '/api/admin-mail-smoke-test': 'mail-smoke-test',
      '/api/admin-mail-alert': 'mail-alert',
      '/api/admin-mail-budget-config': 'mail-budget-config',
      '/api/admin-mail-runtime-config': 'mail-runtime-config',
      '/api/admin-user-data': 'user-data',
    };

    return pathnameRouteMap[normalizedPath] || '';
  } catch {
    return '';
  }
}

function getAdminRouteConfig(route) {
  switch (route) {
    case 'users':
      return {
        methods: 'GET, POST, PATCH, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
    case 'announcements':
      return {
        methods: 'GET, POST, PATCH, DELETE, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
    case 'user-data':
      return {
        methods: 'GET, DELETE, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
    case 'account-recovery':
      return {
        methods: 'GET, PATCH, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
    case 'delete-user':
    case 'user-reset-password':
    case 'reset-recovery-password':
    case 'public-cache-bump':
    case 'mail-outbox-drain':
    case 'mail-smoke-test':
    case 'mail-alert':
    case 'mail-budget-config':
    case 'mail-runtime-config':
    case 'api-clients-review':
    case 'api-clients-rotate-key':
    case 'api-clients-revoke-key':
    case 'api-clients-delete-key':
    case 'api-clients-rotate-verifier':
      return {
        methods: 'POST, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
    case 'ops-automation':
      return {
        methods: 'GET, POST, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
    case 'api-clients':
    case 'site-health':
      return {
        methods: 'GET, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
    case 'site-config':
      return {
        methods: 'GET, POST, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
    default:
      return {
        methods: 'GET, POST, OPTIONS',
        headers: 'Content-Type, Authorization',
      };
  }
}

async function verifySuperAdmin(req, adminClient) {
  const authResult = await requireSuperAdminUser(req, { adminClient });
  if (!authResult.ok) {
    return {
      error: { status: authResult.status || 401, message: authResult.error || 'Invalid access token' },
    };
  }

  return {
    callerUser: authResult.user,
    profile: authResult.profile,
  };
}

async function handleUsers(req, res, adminClient) {
  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  if (req.method === 'GET') {
    try {
    const users = await listMergedAdminUsers(adminClient, {
      repairProfiles: true,
    });

      return res.status(200).json({
        success: true,
        users,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to load admin users',
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const payload = normalizeAdminCreateUserPayload(parseRequestBody(req));
      const createUser = adminClient?.auth?.admin?.createUser;
      if (typeof createUser !== 'function') {
        return res.status(503).json({
          success: false,
          error: 'Auth admin create user is unavailable',
        });
      }

      const { data, error } = await createUser.call(adminClient.auth.admin, {
        email: payload.email,
        password: payload.password,
        email_confirm: true,
        user_metadata: {
          username: payload.username,
        },
      });

      if (error || !data?.user?.id) {
        throw error || new Error('Create user failed');
      }

      const userId = data.user.id;
      const { error: profileError } = await adminClient
        .from('profiles')
        .upsert({
          id: userId,
          username: payload.username,
          email: payload.email,
          role: payload.role,
        }, {
          onConflict: 'id',
        });

      if (profileError) {
        const deleteUser = adminClient?.auth?.admin?.deleteUser;
        if (typeof deleteUser === 'function') {
          await deleteUser.call(adminClient.auth.admin, userId).catch(() => null);
        }
        throw profileError;
      }

      return res.status(200).json({
        success: true,
        user: {
          id: userId,
          email: payload.email,
          username: payload.username,
          role: payload.role,
        },
      });
    } catch (error) {
      return res.status(error?.status || 400).json({
        success: false,
        error: error?.message || 'Create user failed',
      });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const payload = normalizeAdminProfileUpdatePayload(parseRequestBody(req));
      if (payload.userId === authResult.callerUser.id && payload.role !== 'super_admin') {
        return res.status(400).json({
          success: false,
          error: 'Cannot change current super admin role here',
        });
      }

      const { data, error } = await adminClient.rpc('admin_update_profile', {
        p_target_user_id: payload.userId,
        p_username: payload.username,
        p_role: payload.role,
        p_actor_user_id: authResult.callerUser.id,
      });

      if (error) {
        throw error;
      }

      return res.status(200).json({
        success: true,
        profile: data,
      });
    } catch (error) {
      return res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to update user profile',
      });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function loadAdminUserPools(adminClient, userId) {
  const { data, error } = await adminClient
    .from('pools')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

async function loadAdminUserHistorySample(adminClient, userId) {
  const query = adminClient
    .from('history')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(ADMIN_USER_HISTORY_SAMPLE_LIMIT);

  const { data, error, count } = await query;
  if (error) {
    throw error;
  }

  const history = Array.isArray(data) ? data : [];
  const totalCount = typeof count === 'number' ? count : history.length;
  return {
    history,
    meta: {
      sampleLimit: ADMIN_USER_HISTORY_SAMPLE_LIMIT,
      totalCount,
      loadedCount: history.length,
      isTruncated: totalCount > history.length,
    },
  };
}

async function handleUserData(req, res, adminClient) {
  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  if (req.method === 'GET') {
    const url = getRequestUrl(req);
    const userId = normalizeAdminUserId(url.searchParams.get('userId') || url.searchParams.get('user_id'));
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required',
      });
    }

    try {
      const [pools, historyResult] = await Promise.all([
        loadAdminUserPools(adminClient, userId),
        loadAdminUserHistorySample(adminClient, userId),
      ]);

      return res.status(200).json({
        success: true,
        userId,
        pools,
        history: historyResult.history,
        historyMeta: historyResult.meta,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to load user data',
      });
    }
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = parseRequestBody(req);
  const action = String(body.action || '').trim();
  const userId = normalizeAdminUserId(body.userId || body.user_id);
  const poolId = normalizePoolId(body.poolId || body.pool_id);

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'User ID is required',
    });
  }

  if (!['purgeUserData', 'purgePoolRecords', 'deletePool'].includes(action)) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported user data action',
    });
  }

  if (['purgePoolRecords', 'deletePool'].includes(action) && !poolId) {
    return res.status(400).json({
      success: false,
      error: 'Pool ID is required',
    });
  }

  try {
    const historyDelete = adminClient
      .from('history')
      .delete()
      .eq('user_id', userId);
    const { error: historyError } = poolId
      ? await historyDelete.eq('pool_id', poolId)
      : await historyDelete;

    if (historyError) {
      throw historyError;
    }

    let poolsDeleted = false;
    if (action !== 'purgePoolRecords') {
      const poolsDelete = adminClient
        .from('pools')
        .delete()
        .eq('user_id', userId);
      const { error: poolsError } = poolId
        ? await poolsDelete.eq('pool_id', poolId)
        : await poolsDelete;

      if (poolsError) {
        throw poolsError;
      }
      poolsDeleted = true;
    }

    return res.status(200).json({
      success: true,
      action,
      userId,
      poolId: poolId || null,
      deleted: {
        history: true,
        pools: poolsDeleted,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update user data',
    });
  }
}

async function handleAccountRecovery(req, res, adminClient) {
  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  if (req.method === 'GET') {
    try {
      const { data, error } = await adminClient
        .from('account_recovery_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      const requests = Array.isArray(data) ? data : [];
      const handledByIds = [...new Set(requests.map(item => item?.handled_by).filter(Boolean))];
      let profileMap = new Map();
      if (handledByIds.length > 0) {
        const { data: profiles, error: profileError } = await adminClient
          .from('public_profiles')
          .select('id, username, role')
          .in('id', handledByIds);

        if (!profileError && Array.isArray(profiles)) {
          profileMap = new Map(profiles.map(profile => [profile.id, profile]));
        }
      }

      return res.status(200).json({
        success: true,
        requests: requests.map(item => ({
          ...item,
          handlerProfile: profileMap.get(item?.handled_by) || null,
        })),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to load account recovery requests',
      });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { requestId, patch } = normalizeAccountRecoveryPatch(parseRequestBody(req));
      const nowIso = new Date().toISOString();
      const payload = {
        ...patch,
        updated_at: nowIso,
      };

      if (payload.status && payload.status !== 'pending') {
        payload.handled_by = authResult.callerUser.id;
        payload.handled_at = nowIso;
      }

      const { data, error } = await adminClient
        .from('account_recovery_requests')
        .update(payload)
        .eq('id', requestId)
        .select('*')
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return res.status(404).json({
          success: false,
          error: 'Recovery request not found',
        });
      }

      return res.status(200).json({
        success: true,
        request: data,
      });
    } catch (error) {
      return res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to update account recovery request',
      });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function handleDeleteUser(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const { userId } = parseRequestBody(req);
  const normalizedUserId = String(userId || '').trim();

  if (!normalizedUserId) {
    return res.status(400).json({
      success: false,
      error: 'User ID is required',
    });
  }

  if (normalizedUserId === authResult.callerUser.id) {
    return res.status(400).json({
      success: false,
      error: 'Cannot delete current super admin',
    });
  }

  try {
    const cleanupOperations = [
      adminClient.from('announcements').update({ created_by: null }).eq('created_by', normalizedUserId),
      adminClient.from('site_config').update({ updated_by: null }).eq('updated_by', normalizedUserId),
      adminClient.from('puzzles').update({ uploader_id: null }).eq('uploader_id', normalizedUserId),
    ];

    for (const operation of cleanupOperations) {
      const { error } = await operation;
      if (error) {
        throw error;
      }
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(normalizedUserId);
    if (deleteError) {
      throw deleteError;
    }

    return res.status(200).json({
      success: true,
      userId: normalizedUserId,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to delete user',
    });
  }
}

async function handleUserResetPassword(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const { userId, temporaryPassword } = parseRequestBody(req);
  const normalizedUserId = String(userId || '').trim();
  const normalizedPassword = String(temporaryPassword || '').trim();

  if (!normalizedUserId) {
    return res.status(400).json({
      success: false,
      error: 'User ID is required',
    });
  }

  if (normalizedUserId === authResult.callerUser.id) {
    return res.status(400).json({
      success: false,
      error: 'Cannot reset current super admin password here',
    });
  }

  const passwordError = getTemporaryPasswordError(normalizedPassword);
  if (passwordError) {
    return res.status(400).json({
      success: false,
      error: passwordError,
    });
  }

  try {
    const issueMetadata = buildTemporaryPasswordIssueMetadata({
      actorUserId: authResult.callerUser.id,
      reason: 'admin_temporary_password',
    });
    const authUpdate = await buildTemporaryPasswordAuthUpdate(
      adminClient,
      normalizedUserId,
      normalizedPassword,
      { issueMetadata }
    );
    const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(
      normalizedUserId,
      authUpdate.payload
    );

    if (updateAuthError) {
      throw updateAuthError;
    }

    const { error: securityStateError } = await adminClient
      .from('account_security_states')
      .upsert({
        user_id: normalizedUserId,
        ...issueMetadata.securityState,
      }, {
        onConflict: 'user_id',
      });
    if (securityStateError) {
      return res.status(500).json({
        success: false,
        partial: true,
        passwordUpdated: true,
        userId: normalizedUserId,
        emailSynced: authUpdate.emailSynced,
        error: securityStateError.message || 'Password was reset but its expiry state could not be stored',
        code: 'account_security_state_update_failed',
      });
    }

    const revokeResult = await revokeAllSiteSessionsForUser(adminClient, {
      userId: normalizedUserId,
      reason: 'admin_password_reset',
    });
    if (!revokeResult.ok) {
      return res.status(500).json({
        success: false,
        partial: true,
        passwordUpdated: true,
        userId: normalizedUserId,
        emailSynced: authUpdate.emailSynced,
        error: revokeResult.reason || 'Password was reset but existing site sessions could not be revoked',
        code: revokeResult.code || 'site_session_revoke_failed',
      });
    }

    return res.status(200).json({
      success: true,
      userId: normalizedUserId,
      emailSynced: authUpdate.emailSynced,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      error: error?.message || 'Failed to reset user password',
      code: error?.code || undefined,
    });
  }
}

async function handleResetRecoveryPassword(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const requesterKey = getRequesterKey(req);
  const rateLimitResult = checkMemoryRateLimit(`admin-reset-recovery:${requesterKey}`, PASSWORD_RESET_LIMIT);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      retry_after: rateLimitResult.retryAfter,
    });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const {
    requestId,
    userId,
    temporaryPassword,
    adminNote,
  } = parseRequestBody(req);

  const normalizedRequestId = String(requestId || '').trim();
  const normalizedUserId = String(userId || '').trim();
  const normalizedPassword = String(temporaryPassword || '').trim();
  const normalizedAdminNote = String(adminNote || '').trim();

  if (!normalizedRequestId || !normalizedUserId) {
    return res.status(400).json({
      success: false,
      error: 'Missing requestId or userId',
    });
  }

  const passwordError = getTemporaryPasswordError(normalizedPassword);
  if (passwordError) {
    return res.status(400).json({
      success: false,
      error: passwordError,
    });
  }

  try {
    const { data: recoveryRequest, error: requestError } = await adminClient
      .from('account_recovery_requests')
      .select('id, matched_user_id, request_type, status, admin_note, recovery_audit')
      .eq('id', normalizedRequestId)
      .single();

    if (requestError) {
      throw requestError;
    }

    if (!recoveryRequest) {
      return res.status(404).json({
        success: false,
        error: 'Recovery request not found',
      });
    }

    if (recoveryRequest.request_type !== 'password_reset') {
      return res.status(400).json({
        success: false,
        error: 'Request type does not support password reset',
      });
    }

    if (recoveryRequest.matched_user_id !== normalizedUserId) {
      return res.status(400).json({
        success: false,
        error: 'Matched user mismatch',
      });
    }

    if (recoveryRequest.status !== 'verified') {
      return res.status(400).json({
        success: false,
        error: 'Recovery request must be verified first',
      });
    }

    const issueMetadata = buildTemporaryPasswordIssueMetadata({
      actorUserId: authResult.callerUser.id,
      requestId: normalizedRequestId,
    });
    const authUpdate = await buildTemporaryPasswordAuthUpdate(
      adminClient,
      normalizedUserId,
      normalizedPassword,
      { issueMetadata }
    );
    const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(
      normalizedUserId,
      authUpdate.payload
    );

    if (updateAuthError) {
      throw updateAuthError;
    }

    const revokeResult = await revokeAllSiteSessionsForUser(adminClient, {
      userId: normalizedUserId,
      reason: 'admin_recovery_password_reset',
    });

    const warnings = [];
    if (!revokeResult.ok) {
      warnings.push({
        code: revokeResult.code || 'site_session_revoke_failed',
        message: revokeResult.reason || 'Password was reset but existing site sessions could not be revoked',
      });
    }

    const { error: securityStateError } = await adminClient
      .from('account_security_states')
      .upsert({
        user_id: normalizedUserId,
        ...issueMetadata.securityState,
      }, {
        onConflict: 'user_id',
      });

    if (securityStateError) {
      warnings.push({
        code: 'account_security_state_update_failed',
        message: securityStateError.message || 'Failed to mark password change as required',
      });
    }

    const finalAdminNote = [
      normalizedAdminNote,
      `已通过超管操作设置临时密码。临时密码将在 ${issueMetadata.expiresAt} 过期；请通过线下已确认的沟通渠道告知用户，并要求其登录后立即到设置页修改密码。`,
    ].filter(Boolean).join('\n\n');
    const nextAudit = appendRecoveryAuditEvent(
      recoveryRequest.recovery_audit,
      {
        ...issueMetadata.auditEvent,
        warnings,
      }
    );

    const { error: updateRequestError } = await adminClient
      .from('account_recovery_requests')
      .update({
        status: 'closed',
        admin_note: finalAdminNote,
        handled_by: authResult.callerUser.id,
        handled_at: issueMetadata.issuedAt,
        updated_at: issueMetadata.issuedAt,
        ...issueMetadata.recoveryRequestPatch,
        recovery_audit: nextAudit,
      })
      .eq('id', normalizedRequestId);

    if (updateRequestError) {
      warnings.push({
        code: 'recovery_request_update_failed',
        message: updateRequestError.message || 'Failed to close recovery request',
      });
    }

    return res.status(200).json({
      success: true,
      partial: warnings.length > 0,
      warnings,
      deliveryChannel: issueMetadata.deliveryChannel,
      nextStep: issueMetadata.nextStep,
      expiresAt: issueMetadata.expiresAt,
      forceChangeRequired: issueMetadata.forceChangeRequired,
      emailSynced: authUpdate.emailSynced,
      securityStateUpdated: !securityStateError,
      recoveryRequestUpdated: !updateRequestError,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      error: error?.message || 'Failed to reset recovery password',
      code: error?.code || undefined,
    });
  }
}

function readRequestedJobs(req) {
  const body = parseRequestBody(req);
  if (body?.job) {
    return body.job;
  }

  try {
    const url = new URL(req.url || '', 'https://example.com');
    return url.searchParams.get('job') || 'all';
  } catch {
    return 'all';
  }
}

function readForceRefresh(req) {
  const body = parseRequestBody(req);
  if (typeof body?.forceRefresh === 'boolean') {
    return body.forceRefresh;
  }

  if (typeof body?.force_refresh === 'boolean') {
    return body.force_refresh;
  }

  try {
    const url = new URL(req.url || '', 'https://example.com');
    const value = url.searchParams.get('forceRefresh') || url.searchParams.get('force_refresh') || '';
    return ['1', 'true', 'yes', 'force'].includes(String(value).toLowerCase());
  } catch {
    return false;
  }
}

function readAnnouncementRefreshMode(req) {
  const body = parseRequestBody(req);
  const bodyValue = body?.refreshMode || body?.refresh_mode || body?.announcementRefreshMode;
  if (bodyValue) {
    return String(bodyValue);
  }

  try {
    const url = new URL(req.url || '', 'https://example.com');
    return url.searchParams.get('refreshMode') || url.searchParams.get('refresh_mode') || '';
  } catch {
    return '';
  }
}

function readAnnouncementLimit(req) {
  const body = parseRequestBody(req);
  const bodyValue = body?.announcementLimit || body?.announcement_limit || body?.limit;
  if (bodyValue != null && bodyValue !== '') {
    return bodyValue;
  }

  try {
    const url = new URL(req.url || '', 'https://example.com');
    return url.searchParams.get('announcementLimit')
      || url.searchParams.get('announcement_limit')
      || url.searchParams.get('limit')
      || null;
  } catch {
    return null;
  }
}

async function handleOpsAutomation(req, res, adminClient) {
  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  if (req.method === 'GET') {
    try {
      const url = getRequestUrl(req);
      const safeLimit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 200);
      const jobId = String(url.searchParams.get('jobId') || url.searchParams.get('job_id') || '').trim();
      const status = String(url.searchParams.get('status') || '').trim();
      const triggerType = String(url.searchParams.get('triggerType') || url.searchParams.get('trigger_type') || '').trim();

      let query = adminClient
        .from('ops_automation_runs')
        .select([
          'id',
          'job_id',
          'job_label',
          'trigger_type',
          'status',
          'dry_run',
          'dedupe_key',
          'source_tag',
          'source_url',
          'summary',
          'top_changed_fields',
          'preview',
          'review_bundle',
          'error_message',
          'started_at',
          'finished_at',
          'created_at',
          'updated_at',
        ].join(', '))
        .order('created_at', { ascending: false })
        .limit(safeLimit);

      if (jobId && jobId !== 'all') {
        query = query.eq('job_id', jobId);
      }
      if (status && status !== 'all') {
        query = query.eq('status', status);
      }
      if (triggerType && triggerType !== 'all') {
        query = query.eq('trigger_type', triggerType);
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }

      return res.status(200).json({
        success: true,
        runs: Array.isArray(data) ? data : [],
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to load ops automation runs',
      });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const requestedJobIds = parseRequestedJobIds(readRequestedJobs(req));
    const forceRefresh = readForceRefresh(req);
    const refreshMode = readAnnouncementRefreshMode(req);
    const announcementLimit = readAnnouncementLimit(req);
    const runResult = await runOpsAutomationJobs({
      requestedJobIds,
      triggerType: 'manual',
      createdBy: authResult.callerUser.id,
      forceRefresh,
      refreshMode,
      announcementLimit,
    });

    if (!runResult.ok && runResult.status === 503) {
      return res.status(503).json({ success: false, error: runResult.error });
    }

    return res.status(runResult.status).json(buildOpsAutomationHttpPayload(runResult));
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

async function handlePublicCacheBump(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const body = parseRequestBody(req);
  const scope = String(body?.scope || 'public').trim() || 'public';
  const reason = String(body?.reason || 'admin').trim() || 'admin';
  const shouldRefreshAnalytics = ['pools', 'stats'].includes(scope);
  const analyticsRefresh = shouldRefreshAnalytics
    ? await refreshPublicAnalyticsCache(adminClient, { reason })
    : null;
  const result = await bumpPublicCacheEpoch(adminClient, {
    scope,
    reason,
  });

  if (!result.ok) {
    return res.status(500).json({
      success: false,
      error: result.error || 'Failed to bump public cache epoch',
    });
  }

  return res.status(200).json({
    success: true,
    cacheVersion: result.version,
    scope: result.scope,
    reason: result.reason,
    updatedAt: result.updatedAt,
    ...(analyticsRefresh ? { analyticsRefresh } : {}),
  });
}

function serializeAnnouncementRow(row) {
  return {
    id: row?.id,
    title: row?.title || '',
    title_en: row?.title_en || null,
    content: row?.content || '',
    content_en: row?.content_en || null,
    version: row?.version || '',
    announcement_type: row?.announcement_type || 'update',
    severity: row?.severity || 'info',
    is_active: row?.is_active !== false,
    priority: Number(row?.priority) || 0,
    source_id: row?.source_id || null,
    source_url: row?.source_url || null,
    published_at: row?.published_at || null,
    summary: row?.summary || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

function applyManualAnnouncementSourceFilter(query) {
  if (typeof query?.or === 'function') {
    return query.or('source_id.is.null,source_id.eq.');
  }
  return query.is('source_id', null);
}

function normalizeAnnouncementPatch(body = {}, {
  partial = false,
} = {}) {
  const patch = {};

  const readText = (key, maxLength) => {
    if (!(key in body)) {
      return undefined;
    }
    return String(body?.[key] ?? '').trim().slice(0, maxLength);
  };

  const title = readText('title', 240);
  if (title !== undefined) {
    if (!title) {
      return { ok: false, error: 'Announcement title is required' };
    }
    patch.title = title;
  }

  const content = readText('content', 80_000);
  if (content !== undefined) {
    if (!content) {
      return { ok: false, error: 'Announcement content is required' };
    }
    patch.content = content;
  }

  const titleEn = readText('title_en', 240);
  if (titleEn !== undefined) {
    patch.title_en = titleEn || null;
  }

  const contentEn = readText('content_en', 80_000);
  if (contentEn !== undefined) {
    patch.content_en = contentEn || null;
  }

  const version = readText('version', 80);
  if (version !== undefined) {
    patch.version = version || '1.0.0';
  }

  const announcementType = readText('announcement_type', 40);
  if (announcementType !== undefined) {
    patch.announcement_type = announcementType || 'update';
  }

  const severity = readText('severity', 40);
  if (severity !== undefined) {
    patch.severity = severity || 'info';
  }

  if ('is_active' in body) {
    patch.is_active = body?.is_active !== false;
  }

  if ('priority' in body) {
    const priority = Number.parseInt(body?.priority, 10);
    patch.priority = Number.isFinite(priority) ? priority : 0;
  }

  if (!partial) {
    if (!patch.title) {
      return { ok: false, error: 'Announcement title is required' };
    }
    if (!patch.content) {
      return { ok: false, error: 'Announcement content is required' };
    }
    patch.version = patch.version || '1.0.0';
    patch.announcement_type = patch.announcement_type || 'update';
    patch.severity = patch.severity || 'info';
    patch.is_active = patch.is_active !== false;
    patch.priority = Number.isFinite(patch.priority) ? patch.priority : 0;
  }

  return {
    ok: true,
    patch,
  };
}

async function handleAnnouncements(req, res, adminClient) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  if (req.method === 'GET') {
    try {
      const query = adminClient
        .from('announcements')
        .select('*');
      const { data, error } = await applyManualAnnouncementSourceFilter(query)
        .order('priority', { ascending: false })
        .order('updated_at', { ascending: false });

      if (error) {
        throw error;
      }

      return res.status(200).json({
        success: true,
        announcements: Array.isArray(data) ? data.map(serializeAnnouncementRow) : [],
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to load announcements',
      });
    }
  }

  const body = parseRequestBody(req);
  const announcementId = String(body?.id || body?.announcementId || body?.announcement_id || '').trim();

  if (req.method === 'POST') {
    const normalized = normalizeAnnouncementPatch(body);
    if (!normalized.ok) {
      return res.status(400).json({
        success: false,
        error: normalized.error,
      });
    }

    const nowIso = new Date().toISOString();
    const insertPayload = {
      ...normalized.patch,
      source_id: null,
      updated_at: nowIso,
    };

    try {
      const { data, error } = await adminClient
        .from('announcements')
        .insert(insertPayload)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      return res.status(200).json({
        success: true,
        announcement: serializeAnnouncementRow(data || insertPayload),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to create announcement',
      });
    }
  }

  if (!announcementId) {
    return res.status(400).json({
      success: false,
      error: 'Announcement ID is required',
    });
  }

  if (req.method === 'PATCH') {
    const action = String(body?.action || '').trim();
    const normalized = action === 'setActive'
      ? { ok: true, patch: { is_active: body?.isActive ?? body?.is_active } }
      : normalizeAnnouncementPatch(body, { partial: true });
    if (!normalized.ok) {
      return res.status(400).json({
        success: false,
        error: normalized.error,
      });
    }

    const patch = {
      ...normalized.patch,
      updated_at: new Date().toISOString(),
    };
    if ('is_active' in patch) {
      patch.is_active = patch.is_active !== false;
    }

    try {
      const updateQuery = adminClient
        .from('announcements')
        .update(patch)
        .eq('id', announcementId);
      const { data: updatedData, error: updateError } = await applyManualAnnouncementSourceFilter(updateQuery)
        .select('*')
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }
      if (!updatedData) {
        return res.status(404).json({
          success: false,
          error: 'Announcement not found',
        });
      }

      return res.status(200).json({
        success: true,
        announcement: serializeAnnouncementRow(updatedData),
        updated_at: updatedData.updated_at || patch.updated_at,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to update announcement',
      });
    }
  }

  try {
    const deleteQuery = adminClient
      .from('announcements')
      .delete()
      .eq('id', announcementId);
    const { data, error } = await applyManualAnnouncementSourceFilter(deleteQuery)
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Announcement not found',
      });
    }

    return res.status(200).json({
      success: true,
      id: data.id || announcementId,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to delete announcement',
    });
  }
}

function serializeSiteConfigRow(row) {
  return {
    key: String(row?.key || ''),
    value: row?.value == null ? '' : String(row.value),
    label: row?.label == null ? '' : String(row.label),
    category: row?.category == null ? 'general' : String(row.category || 'general'),
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || null,
  };
}

function normalizeSiteConfigPatch(body = {}) {
  const key = String(body?.key || '').trim();
  const value = body?.value == null ? '' : String(body.value);
  const label = body?.label == null ? '' : String(body.label).trim();
  const category = body?.category == null ? '' : String(body.category).trim();

  if (!key || key.length > 120 || !/^[a-zA-Z0-9_.:-]+$/.test(key)) {
    return { ok: false, error: 'Invalid site config key' };
  }

  if (value.length > 200_000) {
    return { ok: false, error: 'Site config value is too large' };
  }

  if (label.length > 120) {
    return { ok: false, error: 'Site config label is too long' };
  }

  if (category.length > 80 || (category && !/^[a-zA-Z0-9_-]+$/.test(category))) {
    return { ok: false, error: 'Invalid site config category' };
  }

  return {
    ok: true,
    patch: {
      key,
      value,
      label,
      category,
    },
  };
}

async function handleSiteConfig(req, res, adminClient) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  if (req.method === 'GET') {
    try {
      const { data, error } = await adminClient
        .from('site_config')
        .select('*')
        .order('category', { ascending: true })
        .order('key', { ascending: true });

      if (error) {
        throw error;
      }

      return res.status(200).json({
        success: true,
        items: Array.isArray(data) ? data.map(serializeSiteConfigRow) : [],
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to load site config',
      });
    }
  }

  const normalized = normalizeSiteConfigPatch(parseRequestBody(req));
  if (!normalized.ok) {
    return res.status(400).json({
      success: false,
      error: normalized.error,
    });
  }

  const { key, value, label, category } = normalized.patch;

  try {
    const existingQuery = adminClient
      .from('site_config')
      .select('key, label, category')
      .eq('key', key)
      .limit(1);
    const existingResult = typeof existingQuery.maybeSingle === 'function'
      ? await existingQuery.maybeSingle()
      : await existingQuery;

    if (existingResult?.error) {
      throw existingResult.error;
    }

    const existingRow = Array.isArray(existingResult?.data)
      ? existingResult.data[0] || null
      : existingResult?.data || null;
    const nowIso = new Date().toISOString();
    const payload = {
      key,
      value,
      label: label || existingRow?.label || key,
      category: category || existingRow?.category || 'general',
      updated_at: nowIso,
      updated_by: authResult.callerUser.id,
    };

    const upsertQuery = adminClient
      .from('site_config')
      .upsert(payload, { onConflict: 'key' })
      .select('*');
    const upsertResult = typeof upsertQuery.maybeSingle === 'function'
      ? await upsertQuery.maybeSingle()
      : await upsertQuery;

    if (upsertResult?.error) {
      throw upsertResult.error;
    }

    const savedRow = Array.isArray(upsertResult?.data)
      ? upsertResult.data[0] || payload
      : upsertResult?.data || payload;

    return res.status(200).json({
      success: true,
      item: serializeSiteConfigRow(savedRow),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update site config',
    });
  }
}

function serializeApiKeyRow(keyRow) {
  return {
    id: keyRow.id,
    client_id: keyRow.client_id,
    key_prefix: keyRow.key_prefix,
    label: keyRow.label,
    status: keyRow.status,
    last_used_at: keyRow.last_used_at || null,
    expires_at: keyRow.expires_at || null,
    created_at: keyRow.created_at || null,
    revoked_at: keyRow.revoked_at || null,
    secret_revealed_at: keyRow.secret_revealed_at || null,
  };
}

function serializeApiClientRow(clientRow, ownerProfile, approvedByProfile, keyRows = []) {
  return {
    id: clientRow.id,
    owner_user_id: clientRow.owner_user_id,
    client_type: clientRow.client_type,
    provider: clientRow.provider,
    name: clientRow.name,
    use_case: clientRow.use_case,
    status: clientRow.status,
    requested_scopes: clientRow.requested_scopes || [],
    granted_scopes: clientRow.granted_scopes || [],
    rate_limit_tier: clientRow.rate_limit_tier,
    review_note: clientRow.review_note || '',
    approved_at: clientRow.approved_at || null,
    verifier_secret_prefix: clientRow.verifier_secret_prefix || null,
    verifier_last_used_at: clientRow.verifier_last_used_at || null,
    verifier_rotated_at: clientRow.verifier_rotated_at || null,
    created_at: clientRow.created_at || null,
    updated_at: clientRow.updated_at || null,
    owner: ownerProfile ? {
      id: ownerProfile.id,
      username: ownerProfile.username,
      email: ownerProfile.email,
      role: ownerProfile.role,
    } : null,
    approved_by_profile: approvedByProfile ? {
      id: approvedByProfile.id,
      username: approvedByProfile.username,
      email: approvedByProfile.email,
      role: approvedByProfile.role,
    } : null,
    keys: keyRows.map(serializeApiKeyRow),
  };
}

async function loadProfileById(adminClient, userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return null;
  }

  const query = adminClient
    .from('profiles')
    .select('id, username, email, role')
    .eq('id', normalizedUserId);

  const profileResult = typeof query.maybeSingle === 'function'
    ? await query.maybeSingle()
    : (typeof query.single === 'function' ? await query.single() : await query);

  if (profileResult.error) {
    throw profileResult.error;
  }

  return Array.isArray(profileResult.data)
    ? profileResult.data[0] || null
    : profileResult.data || null;
}

async function loadApiClientsWithRelations(adminClient) {
  const { data: clients, error: clientsError } = await adminClient
    .from('api_clients')
    .select('*')
    .order('client_type', { ascending: true })
    .order('created_at', { ascending: false });

  if (clientsError) {
    throw clientsError;
  }

  const clientIds = (clients || []).map((client) => client.id);
  const userIds = [
    ...new Set(
      (clients || [])
        .flatMap((client) => [client.owner_user_id, client.approved_by])
        .filter(Boolean)
    ),
  ];

  const [keysResult, profilesResult] = await Promise.all([
    clientIds.length > 0
      ? adminClient
        .from('api_client_keys')
        .select('*')
        .in('client_id', clientIds)
        .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    userIds.length > 0
      ? adminClient
        .from('profiles')
        .select('id, username, email, role')
        .in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (keysResult.error) {
    throw keysResult.error;
  }
  if (profilesResult.error) {
    throw profilesResult.error;
  }

  const keysByClientId = new Map();
  (keysResult.data || []).forEach((keyRow) => {
    if (!keysByClientId.has(keyRow.client_id)) {
      keysByClientId.set(keyRow.client_id, []);
    }
    keysByClientId.get(keyRow.client_id).push(keyRow);
  });

  const profilesById = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));

  return (clients || []).map((clientRow) => serializeApiClientRow(
    clientRow,
    profilesById.get(clientRow.owner_user_id) || null,
    profilesById.get(clientRow.approved_by) || null,
    keysByClientId.get(clientRow.id) || []
  ));
}

function isDeveloperApiReviewMailEnabled(env = readEnvironment(), runtimeState = null) {
  if (runtimeState) {
    return isRuntimeEventEnabled(runtimeState, 'developerApiReview');
  }

  return parseBoolean(env.DEVELOPER_API_REVIEW_MAIL_OUTBOX_ENABLED, false)
    && parseBoolean(env.MAIL_OUTBOX_WORKER_ENABLED || env.MAIL_WORKER_ENABLED, false);
}

function summarizeMailNotification(result, {
  enabled,
  attempted,
  disabledCode = 'developer_api_review_mail_disabled',
  skippedCode = 'developer_api_review_mail_skipped',
} = {}) {
  if (!enabled) {
    return {
      enabled: false,
      attempted: false,
      status: 'disabled',
      code: disabledCode,
    };
  }

  if (!attempted) {
    return {
      enabled: true,
      attempted: false,
      status: 'skipped',
      code: result?.code || skippedCode,
    };
  }

  if (result?.queued) {
    return {
      enabled: true,
      attempted: true,
      status: 'queued',
      code: result.code || 'mail_outbox_queued',
      outboxId: result.outboxId || null,
    };
  }

  if (result?.deduped) {
    return {
      enabled: true,
      attempted: true,
      status: 'deduped',
      code: result.code || 'mail_idempotency_hit',
      outboxId: result.outboxId || null,
    };
  }

  if (result?.action === 'block') {
    return {
      enabled: true,
      attempted: true,
      status: 'blocked',
      code: result.code || 'mail_enqueue_blocked',
    };
  }

  return {
    enabled: true,
    attempted: true,
    status: 'error',
    code: result?.code || 'mail_enqueue_failed',
  };
}

async function enqueueDeveloperApiReviewMail({
  req,
  adminClient,
  clientRow,
  previousClientRow,
  reviewerUserId,
  status,
  reviewNote,
  nowIso,
  runtimeState,
} = {}) {
  const enabled = isDeveloperApiReviewMailEnabled(readEnvironment(), runtimeState);
  if (!enabled) {
    return summarizeMailNotification(null, { enabled, attempted: false });
  }

  const ownerUserId = clientRow?.owner_user_id || previousClientRow?.owner_user_id || '';
  let ownerProfile = null;
  try {
    ownerProfile = await loadProfileById(adminClient, ownerUserId);
  } catch (error) {
    serverLogger.warn('developer-api.review-mail.owner-load-failed', {
      clientId: clientRow?.id || previousClientRow?.id || '',
      status,
      code: 'owner_profile_load_failed',
      message: String(error?.message || error || 'owner_profile_load_failed').slice(0, 200),
    });
    return summarizeMailNotification({
      code: 'owner_profile_load_failed',
    }, { enabled, attempted: false });
  }

  if (!ownerProfile?.email) {
    return summarizeMailNotification({
      code: 'owner_email_unavailable',
    }, { enabled, attempted: false });
  }

  let mailResult;
  try {
    mailResult = await enqueueMailOutboxEvent({
      adminClient,
      eventType: MAIL_EVENT_TYPES.DEVELOPER_API_REVIEW,
      recipientEmail: ownerProfile.email,
      requesterIp: getRequesterIp(req),
      userId: ownerUserId,
      templateKey: 'developer-api.review',
      locale: 'zh-CN',
      relatedEntityType: 'api_client',
      relatedEntityId: clientRow.id,
      purposeKey: `${status}:${clientRow.updated_at || nowIso}`,
      payload: {
        status,
        previousStatus: previousClientRow?.status || null,
        clientName: clientRow.name || previousClientRow?.name || 'unnamed',
        clientType: clientRow.client_type || previousClientRow?.client_type || 'developer',
        hasReviewNote: Boolean(reviewNote),
        grantedScopesCount: Array.isArray(clientRow.granted_scopes) ? clientRow.granted_scopes.length : 0,
        reviewedAt: nowIso,
        reviewedBy: reviewerUserId ? '[redacted]' : null,
      },
      priority: status === 'active' ? 4 : 5,
      controls: buildMailRuntimeControls(runtimeState, 'developerApiReview'),
    });
  } catch (error) {
    mailResult = {
      ok: false,
      queued: false,
      deduped: false,
      action: 'error',
      code: 'mail_enqueue_exception',
      reason: error?.message || 'Mail enqueue failed.',
    };
  }

  const notification = summarizeMailNotification(mailResult, {
    enabled,
    attempted: true,
  });

  if (!['queued', 'deduped'].includes(notification.status)) {
    serverLogger.warn('developer-api.review-mail.not-queued', {
      clientId: clientRow?.id || '',
      status,
      mailStatus: notification.status,
      code: notification.code,
    });
  }

  return notification;
}

function isAdminAlertMailEnabled(env = readEnvironment(), runtimeState = null) {
  if (runtimeState) {
    return isRuntimeEventEnabled(runtimeState, 'adminAlert');
  }

  return parseBoolean(env.ADMIN_ALERT_MAIL_OUTBOX_ENABLED, false)
    && parseBoolean(env.MAIL_OUTBOX_WORKER_ENABLED || env.MAIL_WORKER_ENABLED, false);
}

async function enqueueAdminAlertMail({
  req,
  adminClient,
  actorUserId,
  summary,
  secondary,
  locale,
  nowIso,
  runtimeState,
} = {}) {
  const enabled = isAdminAlertMailEnabled(readEnvironment(), runtimeState);
  const summaryCodes = {
    disabledCode: 'admin_alert_mail_disabled',
    skippedCode: 'admin_alert_mail_skipped',
  };
  if (!enabled) {
    return summarizeMailNotification(null, { enabled, attempted: false, ...summaryCodes });
  }

  let actorProfile = null;
  try {
    actorProfile = await loadProfileById(adminClient, actorUserId);
  } catch (error) {
    serverLogger.warn('admin.alert-mail.actor-load-failed', {
      actorUserId: actorUserId || '',
      code: 'actor_profile_load_failed',
      message: String(error?.message || error || 'actor_profile_load_failed').slice(0, 200),
    });
    return summarizeMailNotification({ code: 'actor_profile_load_failed' }, {
      enabled,
      attempted: false,
      ...summaryCodes,
    });
  }

  if (!actorProfile?.email || actorProfile.role !== 'super_admin') {
    return summarizeMailNotification({ code: 'admin_alert_recipient_unavailable' }, {
      enabled,
      attempted: false,
      ...summaryCodes,
    });
  }

  let mailResult;
  try {
    mailResult = await enqueueMailOutboxEvent({
      adminClient,
      eventType: MAIL_EVENT_TYPES.ADMIN_ALERT,
      recipientEmail: actorProfile.email,
      requesterIp: getRequesterIp(req),
      userId: actorProfile.id,
      templateKey: 'admin.alert',
      locale,
      relatedEntityType: 'profile',
      relatedEntityId: actorProfile.id,
      purposeKey: `manual-admin-alert:${nowIso}`,
      payload: {
        summary,
        secondary,
        source: 'admin-mail-status-panel',
        generatedAt: nowIso,
      },
      priority: 3,
      controls: buildMailRuntimeControls(runtimeState, 'adminAlert'),
    });
  } catch (error) {
    mailResult = {
      ok: false,
      queued: false,
      deduped: false,
      action: 'error',
      code: 'mail_enqueue_exception',
      reason: error?.message || 'Mail enqueue failed.',
    };
  }

  const notification = summarizeMailNotification(mailResult, {
    enabled,
    attempted: true,
    ...summaryCodes,
  });

  if (!['queued', 'deduped'].includes(notification.status)) {
    serverLogger.warn('admin.alert-mail.not-queued', {
      actorUserId: actorUserId || '',
      mailStatus: notification.status,
      code: notification.code,
    });
  }

  return notification;
}

async function createClientKey(adminClient, clientId, {
  label = 'primary',
  ownerReveal = false,
} = {}) {
  const { secret, keyPrefix, keyHash } = createApiKeySecret();
  const payload = {
    client_id: clientId,
    key_prefix: keyPrefix,
    key_hash: keyHash,
    label,
    status: 'active',
    expires_at: null,
    encrypted_secret: ownerReveal ? encryptRevealSecret(secret) : null,
    secret_revealed_at: ownerReveal ? null : new Date().toISOString(),
  };

  const { data, error } = await adminClient
    .from('api_client_keys')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return {
    secret,
    key: data,
  };
}

async function revokeActiveClientKeys(adminClient, clientId) {
  const nowIso = new Date().toISOString();
  await adminClient
    .from('api_client_keys')
    .update({
      status: 'revoked',
      revoked_at: nowIso,
    })
    .eq('client_id', clientId)
    .eq('status', 'active');
}

async function handleApiClients(req, res, adminClient) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  try {
    const clients = await loadApiClientsWithRelations(adminClient);
    return res.status(200).json({
      success: true,
      clients,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to load API clients',
    });
  }
}

async function handleApiClientReview(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const { clientId, status, reviewNote } = parseRequestBody(req);
  const normalizedClientId = String(clientId || '').trim();
  const normalizedStatus = String(status || '').trim();
  const normalizedNote = String(reviewNote || '').trim();

  if (!normalizedClientId) {
    return res.status(400).json({ success: false, error: 'Missing clientId' });
  }

  if (!['active', 'rejected', 'revoked'].includes(normalizedStatus)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  try {
    const { data: clientRow, error: clientError } = await adminClient
      .from('api_clients')
      .select('*')
      .eq('id', normalizedClientId)
      .limit(1)
      .maybeSingle();

    if (clientError) {
      throw clientError;
    }

    if (!clientRow) {
      return res.status(404).json({ success: false, error: 'API client not found' });
    }

    if (clientRow.client_type !== 'developer') {
      return res.status(400).json({ success: false, error: 'Only developer clients can be reviewed here' });
    }

    const nowIso = new Date().toISOString();
    const nextUpdate = {
      status: normalizedStatus,
      review_note: normalizedNote || null,
      approved_by: authResult.callerUser.id,
      updated_at: nowIso,
      granted_scopes: normalizedStatus === 'active' ? ['public.read'] : [],
      approved_at: normalizedStatus === 'active' ? nowIso : null,
    };

    const { data: updatedClient, error: updateError } = await adminClient
      .from('api_clients')
      .update(nextUpdate)
      .eq('id', normalizedClientId)
      .select('*')
      .single();

    if (updateError) {
      throw updateError;
    }

    let bootstrapKey = null;
    if (normalizedStatus === 'active') {
      const { data: activeKeys, error: activeKeyError } = await adminClient
        .from('api_client_keys')
        .select('id')
        .eq('client_id', normalizedClientId)
        .eq('status', 'active')
        .limit(1);

      if (activeKeyError) {
        throw activeKeyError;
      }

      if (!Array.isArray(activeKeys) || activeKeys.length === 0) {
        const created = await createClientKey(adminClient, normalizedClientId, {
          label: 'bootstrap',
          ownerReveal: true,
        });
        bootstrapKey = {
          secret: created.secret,
          key: serializeApiKeyRow(created.key),
        };
      }
    }

    if (normalizedStatus === 'revoked') {
      await revokeActiveClientKeys(adminClient, normalizedClientId);
    }

    const runtimeState = await safeLoadMailRuntimeState(adminClient);
    const mailNotification = await enqueueDeveloperApiReviewMail({
      req,
      adminClient,
      clientRow: updatedClient,
      previousClientRow: clientRow,
      reviewerUserId: authResult.callerUser.id,
      status: normalizedStatus,
      reviewNote: normalizedNote,
      nowIso,
      runtimeState,
    });

    return res.status(200).json({
      success: true,
      client: {
        id: updatedClient.id,
        status: updatedClient.status,
        review_note: updatedClient.review_note || '',
        granted_scopes: updatedClient.granted_scopes || [],
        approved_at: updatedClient.approved_at || null,
      },
      bootstrapKey,
      mailNotification,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to review API client',
    });
  }
}

async function handleApiClientRotateKey(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const { clientId, label } = parseRequestBody(req);
  const normalizedClientId = String(clientId || '').trim();
  const normalizedLabel = String(label || '').trim() || 'rotated';

  if (!normalizedClientId) {
    return res.status(400).json({ success: false, error: 'Missing clientId' });
  }

  try {
    const { data: clientRow, error: clientError } = await adminClient
      .from('api_clients')
      .select('*')
      .eq('id', normalizedClientId)
      .limit(1)
      .maybeSingle();

    if (clientError) {
      throw clientError;
    }

    if (!clientRow) {
      return res.status(404).json({ success: false, error: 'API client not found' });
    }

    await revokeActiveClientKeys(adminClient, normalizedClientId);
    const created = await createClientKey(adminClient, normalizedClientId, {
      label: normalizedLabel,
      ownerReveal: clientRow.client_type === 'developer',
    });

    return res.status(200).json({
      success: true,
      key: {
        ...serializeApiKeyRow(created.key),
        secret: created.secret,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to rotate API key',
    });
  }
}

async function handleApiClientRevokeKey(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const { keyId } = parseRequestBody(req);
  const normalizedKeyId = String(keyId || '').trim();

  if (!normalizedKeyId) {
    return res.status(400).json({ success: false, error: 'Missing keyId' });
  }

  try {
    const { data: revokedKey, error } = await adminClient
      .from('api_client_keys')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      })
      .eq('id', normalizedKeyId)
      .select('*')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!revokedKey) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    return res.status(200).json({
      success: true,
      key: serializeApiKeyRow(revokedKey),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to revoke API key',
    });
  }
}

async function handleApiClientDeleteKey(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const { keyId } = parseRequestBody(req);
  const normalizedKeyId = String(keyId || '').trim();

  if (!normalizedKeyId) {
    return res.status(400).json({ success: false, error: 'Missing keyId' });
  }

  try {
    const { data: deletedKey, error } = await adminClient
      .from('api_client_keys')
      .delete()
      .eq('id', normalizedKeyId)
      .select('id, client_id, key_prefix, label, status')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!deletedKey) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    return res.status(200).json({
      success: true,
      key: {
        id: deletedKey.id,
        client_id: deletedKey.client_id,
        key_prefix: deletedKey.key_prefix,
        label: deletedKey.label,
        status: deletedKey.status,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to delete API key',
    });
  }
}

async function handleApiClientRotateVerifier(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const { clientId } = parseRequestBody(req);
  const normalizedClientId = String(clientId || '').trim();

  if (!normalizedClientId) {
    return res.status(400).json({ success: false, error: 'Missing clientId' });
  }

  try {
    const { data: clientRow, error: clientError } = await adminClient
      .from('api_clients')
      .select('*')
      .eq('id', normalizedClientId)
      .limit(1)
      .maybeSingle();

    if (clientError) {
      throw clientError;
    }

    if (!clientRow) {
      return res.status(404).json({ success: false, error: 'API client not found' });
    }

    if (clientRow.client_type !== 'official_bot' || !clientRow.provider) {
      return res.status(400).json({ success: false, error: 'Only official bot clients can rotate verifier secrets' });
    }

    const { secret, secretHash, secretPrefix } = createVerifierSecret(clientRow.provider);
    const { data: updatedClient, error: updateError } = await adminClient
      .from('api_clients')
      .update({
        verifier_secret_prefix: secretPrefix,
        verifier_secret_hash: secretHash,
        verifier_rotated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalizedClientId)
      .select('*')
      .single();

    if (updateError) {
      throw updateError;
    }

    return res.status(200).json({
      success: true,
      verifier: {
        client_id: updatedClient.id,
        provider: updatedClient.provider,
        verifier_secret_prefix: updatedClient.verifier_secret_prefix,
        verifier_rotated_at: updatedClient.verifier_rotated_at,
        secret,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to rotate verifier secret',
    });
  }
}

async function handleSiteHealth(req, res, adminClient) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  try {
    const health = await buildAdminSiteHealth({ adminClient });
    return res.status(200).json({
      success: true,
      health,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to load site health',
    });
  }
}

async function handleMailOutboxDrain(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  try {
    const result = await runMailOutboxWorker({ adminClient });
    return res.status(200).json({
      success: true,
      partial: result.ok === false,
      result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to drain mail outbox',
    });
  }
}

async function handleMailSmokeTest(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const body = parseRequestBody(req);
  const recipientEmail = String(body?.recipientEmail || body?.recipient_email || '').trim();
  const locale = String(body?.locale || body?.lang || 'zh-CN').trim() || 'zh-CN';

  if (!recipientEmail) {
    return res.status(400).json({
      success: false,
      error: 'Recipient email is required',
    });
  }

  try {
    const result = await sendMailSmokeTest({
      adminClient,
      recipientEmail,
      locale,
      actorUserId: authResult.callerUser.id,
    });

    return res.status(200).json({
      success: true,
      partial: result.ok === false,
      result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to send mail smoke test',
    });
  }
}

async function handleMailAlert(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const body = parseRequestBody(req);
  const rawSummary = String(body?.summary || '').trim();
  const rawSecondary = String(body?.secondary || '').trim();
  const locale = String(body?.locale || body?.lang || 'zh-CN').trim() || 'zh-CN';
  const summary = rawSummary.slice(0, 240) || '管理员手动告警测试';
  const secondary = rawSecondary.slice(0, 360)
    || '这是一条由后台邮件状态面板触发的受控告警，用于验证 admin.alert outbox 链路。';
  const nowIso = new Date().toISOString();

  try {
    const runtimeState = await safeLoadMailRuntimeState(adminClient);
    const mailNotification = await enqueueAdminAlertMail({
      req,
      adminClient,
      actorUserId: authResult.callerUser.id,
      summary,
      secondary,
      locale,
      nowIso,
      runtimeState,
    });

    return res.status(200).json({
      success: true,
      partial: mailNotification.status === 'error',
      mailNotification,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to enqueue admin alert mail',
    });
  }
}

async function handleMailRuntimeConfig(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const body = parseRequestBody(req);
  const nextConfig = sanitizeMailRuntimeUpdate({
    events: body?.events,
    controls: body?.controls,
    note: body?.note,
  });

  try {
    await saveMailRuntimeConfig(adminClient, nextConfig, {
      actorUserId: authResult.callerUser.id,
      now: new Date(),
    });
    const runtime = await loadMailRuntimeState(adminClient);
    return res.status(200).json({
      success: true,
      runtime,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update mail runtime config',
    });
  }
}

const MAIL_BUDGET_SCOPES = new Set(['global', 'event', 'recipient', 'domain', 'ip', 'user', 'related']);
const MAIL_BUDGET_EVENTS = new Set(['*', ...Object.values(MAIL_EVENT_TYPES)]);

function normalizeMailBudgetConfigPatch(rawItem = {}) {
  const scope = String(rawItem.scope || '').trim();
  const eventType = String(rawItem.eventType || rawItem.event_type || '').trim();
  const windowSeconds = Number.parseInt(rawItem.windowSeconds ?? rawItem.window_seconds, 10);
  const maxAttempts = Number.parseInt(rawItem.maxAttempts ?? rawItem.max_attempts, 10);
  const enabled = rawItem.enabled === false || String(rawItem.enabled).toLowerCase() === 'false'
    ? false
    : true;

  if (!MAIL_BUDGET_SCOPES.has(scope)) {
    return { ok: false, error: 'Invalid mail budget scope' };
  }
  if (!MAIL_BUDGET_EVENTS.has(eventType)) {
    return { ok: false, error: 'Invalid mail budget event type' };
  }
  if (scope === 'global' && eventType !== '*') {
    return { ok: false, error: 'Global mail budget must use * event type' };
  }
  if (scope !== 'global' && eventType === '*') {
    return { ok: false, error: 'Only global mail budget can use * event type' };
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds < 60 || windowSeconds > 31_536_000) {
    return { ok: false, error: 'Mail budget window must be between 60 and 31536000 seconds' };
  }
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 1_000_000) {
    return { ok: false, error: 'Mail budget max attempts must be between 1 and 1000000' };
  }

  return {
    ok: true,
    item: {
      scope,
      event_type: eventType,
      window_seconds: windowSeconds,
      max_attempts: maxAttempts,
      enabled,
    },
  };
}

async function handleMailBudgetConfig(req, res, adminClient) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authResult = await verifySuperAdmin(req, adminClient);
  if (authResult.error) {
    return res.status(authResult.error.status).json({
      success: false,
      error: authResult.error.message,
    });
  }

  const body = parseRequestBody(req);
  const rawItems = Array.isArray(body?.items)
    ? body.items
    : [body?.item || body].filter(Boolean);
  if (rawItems.length === 0 || rawItems.length > 40) {
    return res.status(400).json({
      success: false,
      error: 'Mail budget update requires 1 to 40 items',
    });
  }

  const normalizedItems = [];
  for (const rawItem of rawItems) {
    const normalized = normalizeMailBudgetConfigPatch(rawItem);
    if (!normalized.ok) {
      return res.status(400).json({
        success: false,
        error: normalized.error,
      });
    }
    normalizedItems.push({
      ...normalized.item,
      updated_by_user_id: authResult.callerUser.id,
      updated_at: new Date().toISOString(),
    });
  }

  try {
    const { data, error } = await adminClient
      .from('mail_abuse_budget_config')
      .upsert(normalizedItems, { onConflict: 'scope,event_type' })
      .select('scope, event_type, window_seconds, max_attempts, enabled, updated_at');

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      updated: (data || []).map((row) => ({
        scope: row.scope,
        eventType: row.event_type,
        windowSeconds: row.window_seconds,
        maxAttempts: row.max_attempts,
        enabled: row.enabled,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update mail budget config',
    });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const route = readAdminRoute(req);
  if (!route) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported admin route',
    });
  }

  if (rejectDisallowedBrowserOrigin(req, res, getAdminRouteConfig(route))) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return res.status(503).json({
      success: false,
      error: 'Auth admin not configured',
    });
  }

  switch (route) {
    case 'users':
      return handleUsers(req, res, adminClient);
    case 'account-recovery':
      return handleAccountRecovery(req, res, adminClient);
    case 'announcements':
      return handleAnnouncements(req, res, adminClient);
    case 'user-data':
      return handleUserData(req, res, adminClient);
    case 'delete-user':
      return handleDeleteUser(req, res, adminClient);
    case 'user-reset-password':
      return handleUserResetPassword(req, res, adminClient);
    case 'reset-recovery-password':
      return handleResetRecoveryPassword(req, res, adminClient);
    case 'ops-automation':
      return handleOpsAutomation(req, res, adminClient);
    case 'public-cache-bump':
      return handlePublicCacheBump(req, res, adminClient);
    case 'site-config':
      return handleSiteConfig(req, res, adminClient);
    case 'api-clients':
      return handleApiClients(req, res, adminClient);
    case 'api-clients-review':
      return handleApiClientReview(req, res, adminClient);
    case 'api-clients-rotate-key':
      return handleApiClientRotateKey(req, res, adminClient);
    case 'api-clients-revoke-key':
      return handleApiClientRevokeKey(req, res, adminClient);
    case 'api-clients-delete-key':
      return handleApiClientDeleteKey(req, res, adminClient);
    case 'api-clients-rotate-verifier':
      return handleApiClientRotateVerifier(req, res, adminClient);
    case 'site-health':
      return handleSiteHealth(req, res, adminClient);
    case 'mail-outbox-drain':
      return handleMailOutboxDrain(req, res, adminClient);
    case 'mail-smoke-test':
      return handleMailSmokeTest(req, res, adminClient);
    case 'mail-alert':
      return handleMailAlert(req, res, adminClient);
    case 'mail-budget-config':
      return handleMailBudgetConfig(req, res, adminClient);
    case 'mail-runtime-config':
      return handleMailRuntimeConfig(req, res, adminClient);
    default:
      return res.status(400).json({
        success: false,
        error: 'Unsupported admin route',
      });
  }
}
