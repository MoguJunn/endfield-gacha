// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  createSupabaseAccessTokenClient: vi.fn(),
  getBearerToken: vi.fn(() => 'token'),
  getSupabaseAdminClient: vi.fn(),
  loadAuthUserById: vi.fn(),
  resolveAuthenticatedRequestUser: vi.fn(),
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));

vi.mock('../_lib/authAdmin.js', () => ({
  createSupabaseAccessTokenClient: mocks.createSupabaseAccessTokenClient,
  getBearerToken: mocks.getBearerToken,
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
  loadAuthUserById: mocks.loadAuthUserById,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
}));

import accountSecurityStateHandler from '../_routes/root/account-security-state.js';

function createJsonResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function createRequest({
  method = 'GET',
  url = 'https://example.com/api/account-security-state',
  body,
  headers = { authorization: 'Bearer token' },
} = {}) {
  return {
    method,
    url,
    body,
    headers,
  };
}

function createAdminClient({
  profileRow = {
    id: 'user-1',
    email: 'user@example.com',
    role: 'user',
  },
  stateRow = {
    password_change_required: true,
    password_change_reason: 'account_recovery_temporary_password',
    password_change_source: 'account_recovery',
    password_change_requested_at: '2026-05-24T00:00:00.000Z',
    password_change_expires_at: '2026-05-25T00:00:00.000Z',
    password_change_recovery_request_id: 'recovery-1',
    email_verification_required: true,
    email_verification_reason: 'mail_verification_rollout_2026_05',
    email_verification_requested_at: '2026-05-26T00:00:00.000Z',
    email_verification_verified_at: null,
  },
  stateError = null,
  upsertError = null,
} = {}) {
  const stateMaybeSingle = vi.fn(async () => ({
    data: stateRow,
    error: stateError,
  }));
  const stateEq = vi.fn(() => ({ maybeSingle: stateMaybeSingle }));
  const stateSelect = vi.fn(() => ({ eq: stateEq }));
  const upsert = vi.fn(async () => ({ error: upsertError }));
  const profileMaybeSingle = vi.fn(async () => ({
    data: profileRow,
    error: null,
  }));
  const profileEq = vi.fn(() => ({ maybeSingle: profileMaybeSingle }));
  const profileSelect = vi.fn(() => ({ eq: profileEq }));

  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return {
          select: profileSelect,
        };
      }

      if (table === 'account_security_states') {
        return {
          select: stateSelect,
          upsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __securityStateMocks: {
      select: stateSelect,
      eq: stateEq,
      maybeSingle: stateMaybeSingle,
      upsert,
      profileSelect,
      profileEq,
      profileMaybeSingle,
    },
  };
}

describe('api/account-security-state handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBearerToken.mockReturnValue('token');
    mocks.loadAuthUserById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      email_confirmed_at: null,
      encrypted_password: null,
      user_metadata: {},
    });
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    });
    mocks.resolveAuthenticatedRequestUser.mockImplementation(async (req, { adminClient }) => {
      const token = mocks.getBearerToken(req);
      if (!token) {
        return { ok: false, status: 401, error: 'Missing access token' };
      }
      const callerClient = mocks.createSupabaseAccessTokenClient(token);
      const { data, error } = await callerClient.auth.getUser(token);
      if (error || !data?.user?.id) {
        return { ok: false, status: 401, error: 'Invalid access token' };
      }
      return {
        ok: true,
        source: 'supabase',
        user: data.user,
        adminClient,
        callerClient,
      };
    });
  });

  it('loads the current user password-change state from the private table', async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest();
    const res = createJsonResponseRecorder();

    await accountSecurityStateHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(adminClient.from).toHaveBeenCalledWith('account_security_states');
    expect(adminClient.__securityStateMocks.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(res.body).toEqual({
      success: true,
      state: {
        passwordChangeRequired: true,
        reason: 'account_recovery_temporary_password',
        source: 'account_recovery',
        requestedAt: '2026-05-24T00:00:00.000Z',
        expiresAt: '2026-05-25T00:00:00.000Z',
        recoveryRequestId: 'recovery-1',
        emailVerificationRequired: true,
        emailVerificationReason: 'mail_verification_rollout_2026_05',
        emailVerificationRequestedAt: '2026-05-26T00:00:00.000Z',
        emailVerificationVerifiedAt: null,
        emailVerificationTargetEmail: null,
        emailVerificationVersion: null,
        passwordSetupCapabilityStatus: null,
        passwordSetupLastErrorCode: null,
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('password_change_');
  });

  it('loads account security state through the caller client when admin secrets are absent', async () => {
    const callerClient = createAdminClient();
    callerClient.auth = {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1', email: 'user@example.com' } },
        error: null,
      })),
    };
    mocks.getSupabaseAdminClient.mockReturnValue(null);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(callerClient);

    const req = createRequest();
    const res = createJsonResponseRecorder();

    await accountSecurityStateHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(callerClient.auth.getUser).toHaveBeenCalledWith('token');
    expect(mocks.loadAuthUserById).not.toHaveBeenCalled();
    expect(callerClient.from).toHaveBeenCalledWith('account_security_states');
    expect(res.body.state).toMatchObject({
      passwordChangeRequired: true,
      emailVerificationRequired: true,
    });
  });

  it('does not treat a confirmed synthetic OAuth address as the verified site email', async () => {
    const adminClient = createAdminClient({
      profileRow: {
        id: 'user-1',
        email: 'site-user@example.com',
        role: 'user',
      },
      stateRow: {
        password_change_required: true,
        password_change_reason: 'oauth_password_setup_required:github',
        password_change_source: 'oauth',
        password_change_requested_at: '2026-07-24T00:00:00.000Z',
        password_change_expires_at: null,
        password_change_recovery_request_id: null,
        email_verification_required: true,
        email_verification_reason: 'oauth_email_setup_required',
        email_verification_requested_at: '2026-07-24T00:00:00.000Z',
        email_verification_verified_at: '2026-07-23T00:00:00.000Z',
      },
    });
    mocks.loadAuthUserById.mockResolvedValue({
      id: 'user-1',
      email: 'github.abcdef1234567890@oauth.local.invalid',
      email_confirmed_at: '2026-06-04T00:00:00.000Z',
      encrypted_password: null,
      user_metadata: {
        synthetic_oauth_email: true,
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest();
    const res = createJsonResponseRecorder();

    await accountSecurityStateHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.state).toMatchObject({
      passwordChangeRequired: true,
      emailVerificationRequired: true,
      emailVerificationReason: 'oauth_email_setup_required',
    });
  });

  it('does not keep blocking OAuth import when email and password setup are already complete', async () => {
    const adminClient = createAdminClient({
      profileRow: {
        id: 'user-1',
        email: 'site-user@example.com',
        role: 'user',
      },
      stateRow: {
        password_change_required: false,
        password_change_reason: null,
        password_change_source: null,
        password_change_requested_at: null,
        password_change_expires_at: null,
        password_change_recovery_request_id: null,
        email_verification_required: false,
        email_verification_reason: 'oauth_email_setup_required',
        email_verification_requested_at: '2026-06-04T00:00:00.000Z',
        email_verification_verified_at: '2026-06-04T01:00:00.000Z',
        email_verification_target_email: 'site-user@example.com',
        password_setup_capability_status: 'completed',
      },
    });
    mocks.loadAuthUserById.mockResolvedValue({
      id: 'user-1',
      email: 'site-user@example.com',
      email_confirmed_at: '2026-06-04T01:00:00.000Z',
      encrypted_password: '$2a$10$hashed',
      user_metadata: {
        site_password_set: true,
        email_bound_from_profile: true,
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest();
    const res = createJsonResponseRecorder();

    await accountSecurityStateHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.state).toMatchObject({
      passwordChangeRequired: false,
      reason: null,
      emailVerificationRequired: false,
      emailVerificationReason: 'oauth_email_setup_required',
      emailVerificationVerifiedAt: '2026-06-04T01:00:00.000Z',
    });
  });

  it('does not keep blocking super admin import because of stale OAuth completion state', async () => {
    const adminClient = createAdminClient({
      profileRow: {
        id: 'admin-1',
        email: 'admin@example.com',
        role: 'super_admin',
      },
      stateRow: {
        password_change_required: true,
        password_change_reason: 'oauth_password_setup_required:github',
        password_change_source: 'oauth',
        password_change_requested_at: '2026-06-04T00:00:00.000Z',
        password_change_expires_at: null,
        password_change_recovery_request_id: null,
        email_verification_required: true,
        email_verification_reason: 'oauth_email_setup_required',
        email_verification_requested_at: '2026-06-04T00:00:00.000Z',
        email_verification_verified_at: null,
      },
    });
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              id: 'admin-1',
              app_metadata: { role: 'super_admin' },
            },
          },
          error: null,
        })),
      },
    });
    mocks.loadAuthUserById.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      email_confirmed_at: null,
      encrypted_password: null,
      user_metadata: {},
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest();
    const res = createJsonResponseRecorder();

    await accountSecurityStateHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.state).toMatchObject({
      passwordChangeRequired: false,
      emailVerificationRequired: false,
    });
  });

  it('rejects direct attempts to clear the password-change requirement', async () => {
    const adminClient = createAdminClient({
      stateRow: {
        password_change_required: false,
        password_change_reason: null,
        password_change_source: null,
        password_change_requested_at: null,
        password_change_expires_at: null,
        password_change_recovery_request_id: null,
        email_verification_required: false,
        email_verification_reason: null,
        email_verification_requested_at: null,
        email_verification_verified_at: '2026-05-26T00:00:00.000Z',
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      method: 'POST',
      body: {
        action: 'clear_password_change_required',
      },
    });
    const res = createJsonResponseRecorder();

    await accountSecurityStateHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(adminClient.__securityStateMocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects requests without an access token', async () => {
    mocks.getBearerToken.mockReturnValue(null);
    mocks.getSupabaseAdminClient.mockReturnValue(createAdminClient());

    const req = createRequest();
    const res = createJsonResponseRecorder();

    await accountSecurityStateHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'Missing access token',
    });
  });
});
