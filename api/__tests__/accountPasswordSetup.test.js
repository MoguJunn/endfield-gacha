// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  getSupabaseAdminClient: vi.fn(),
  loadAuthUserById: vi.fn(),
  findAuthUserByEmail: vi.fn(),
  resolveAuthenticatedRequestUser: vi.fn(),
  clearSiteSessionCookies: vi.fn(),
  createSiteSession: vi.fn(),
  revokeAllSiteSessionsForUser: vi.fn(),
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
  loadAuthUserById: mocks.loadAuthUserById,
  findAuthUserByEmail: mocks.findAuthUserByEmail,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
}));

vi.mock('../_lib/siteSession.js', () => ({
  clearSiteSessionCookies: mocks.clearSiteSessionCookies,
  createSiteSession: mocks.createSiteSession,
  revokeAllSiteSessionsForUser: mocks.revokeAllSiteSessionsForUser,
}));

import accountPasswordSetupHandler from '../_routes/root/account-password-setup.js';

function createResponseRecorder() {
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

function createRequest(body = {}) {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer token',
      origin: 'https://ef-gacha.mogujun.icu',
    },
    body,
  };
}

function createAdminClient({
  securityState,
  profile,
  completedFinishFailures = 0,
  commitCompletedBeforeFailure = false,
} = {}) {
  let remainingCompletedFinishFailures = completedFinishFailures;
  const updateUserById = vi.fn(async (_userId, payload) => ({
    data: {
      user: {
        id: 'user-1',
        email: payload.email || 'github.hash@oauth.local.invalid',
      },
    },
    error: null,
  }));
  const rpc = vi.fn(async (name, payload) => {
    if (name === 'claim_oauth_password_setup_capability') {
      securityState.password_setup_capability_status = 'claimed';
      return { data: 'claimed', error: null };
    }
    if (name === 'finish_oauth_password_setup_capability') {
      if (payload.p_outcome === 'completed' && remainingCompletedFinishFailures > 0) {
        remainingCompletedFinishFailures -= 1;
        if (commitCompletedBeforeFailure) {
          securityState.password_setup_capability_status = 'completed';
          securityState.password_change_required = false;
          securityState.password_change_reason = null;
        }
        return { data: null, error: { code: 'finish_failed', message: 'finish failed' } };
      }
      if (securityState.password_setup_capability_status === 'completed') {
        return { data: 'completed', error: null };
      }
      securityState.password_setup_capability_status = payload.p_outcome;
      securityState.password_change_required = payload.p_outcome !== 'completed';
      securityState.password_change_reason = payload.p_outcome === 'completed'
        ? null
        : securityState.password_change_reason;
      return { data: payload.p_outcome, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });

  return {
    rpc,
    auth: {
      admin: {
        updateUserById,
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
    from(table) {
      if (table === 'account_security_states') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: securityState, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: profile, error: null }),
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    __mocks: {
      updateUserById,
      rpc,
    },
  };
}

describe('api/account-password-setup handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      user: { id: 'user-1' },
    });
    mocks.loadAuthUserById.mockResolvedValue({
      id: 'user-1',
      email: 'github.hash@oauth.local.invalid',
      user_metadata: {
        synthetic_oauth_email: true,
      },
    });
    mocks.findAuthUserByEmail.mockResolvedValue(null);
    mocks.createSiteSession.mockResolvedValue({ ok: true, session: { id: 'new-session' } });
    mocks.revokeAllSiteSessionsForUser.mockResolvedValue({ ok: true, revokedCount: 2 });
  });

  it('rejects first password setup until the user verifies a site email', async () => {
    const adminClient = createAdminClient({
      securityState: {
        password_change_required: true,
        password_change_reason: 'oauth_password_setup_required',
        password_setup_capability_id: '00000000-0000-4000-8000-000000000001',
        password_setup_capability_status: 'available',
        email_verification_required: true,
        email_verification_verified_at: null,
      },
      profile: {
        id: 'user-1',
        email: null,
        role: 'user',
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createResponseRecorder();

    await accountPasswordSetupHandler(createRequest({ newPassword: 'StrongPass123' }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('verified_email_required');
    expect(adminClient.__mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('sets a site password and syncs verified site email for OAuth users', async () => {
    const adminClient = createAdminClient({
      securityState: {
        password_change_required: true,
        password_change_reason: 'oauth_password_setup_required_existing',
        password_setup_capability_id: '00000000-0000-4000-8000-000000000001',
        password_setup_capability_status: 'available',
        email_verification_required: false,
        email_verification_verified_at: '2026-06-03T00:00:00.000Z',
        email_verification_target_email: 'site-user@example.com',
      },
      profile: {
        id: 'user-1',
        email: 'site-user@example.com',
        role: 'user',
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createResponseRecorder();

    await accountPasswordSetupHandler(createRequest({ newPassword: 'StrongPass123' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(adminClient.__mocks.updateUserById).toHaveBeenCalledWith('user-1', expect.objectContaining({
      password: 'StrongPass123',
      email: 'site-user@example.com',
      email_confirm: true,
      user_metadata: expect.objectContaining({
        synthetic_oauth_email: false,
        email_bound_from_profile: true,
        site_password_set: true,
      }),
    }));
    expect(adminClient.__mocks.rpc).toHaveBeenCalledWith('claim_oauth_password_setup_capability', expect.any(Object));
    expect(adminClient.__mocks.rpc).toHaveBeenCalledWith('finish_oauth_password_setup_capability', expect.objectContaining({
      p_outcome: 'completed',
    }));
    expect(mocks.revokeAllSiteSessionsForUser).toHaveBeenCalledWith(adminClient, {
      userId: 'user-1',
      reason: 'password_setup_completed',
    });
    expect(mocks.createSiteSession).toHaveBeenCalledWith(adminClient, expect.objectContaining({
      userId: 'user-1',
      provider: 'password_setup',
    }));
    expect(res.body).toMatchObject({
      sessionsRevoked: true,
      revokedSessionCount: 2,
      currentSessionRecreated: true,
    });
  });

  it('keeps the one-time password setup capability consumed when session revocation fails', async () => {
    const securityState = {
      password_change_required: true,
      password_change_reason: 'oauth_password_setup_required_existing',
      password_setup_capability_id: '00000000-0000-4000-8000-000000000001',
      password_setup_capability_status: 'available',
      email_verification_required: false,
      email_verification_verified_at: '2026-06-03T00:00:00.000Z',
      email_verification_target_email: 'site-user@example.com',
    };
    const adminClient = createAdminClient({
      securityState,
      profile: {
        id: 'user-1',
        email: 'site-user@example.com',
        role: 'user',
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.revokeAllSiteSessionsForUser.mockResolvedValue({
      ok: false,
      code: 'site_session_revoke_failed',
      reason: 'session database unavailable',
    });
    const res = createResponseRecorder();

    await accountPasswordSetupHandler(createRequest({ newPassword: 'StrongPass123' }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      passwordUpdated: true,
      code: 'site_session_revoke_failed',
      state: {
        passwordChangeRequired: false,
        passwordSetupCapabilityStatus: 'completed',
      },
    });
    expect(mocks.createSiteSession).not.toHaveBeenCalled();
  });

  it('retries an idempotent completion when the committed response is lost', async () => {
    const securityState = {
      password_change_required: true,
      password_change_reason: 'oauth_password_setup_required_existing',
      password_setup_capability_id: '00000000-0000-4000-8000-000000000001',
      password_setup_capability_status: 'available',
      email_verification_required: false,
      email_verification_verified_at: '2026-06-03T00:00:00.000Z',
      email_verification_target_email: 'site-user@example.com',
    };
    const adminClient = createAdminClient({
      securityState,
      profile: { id: 'user-1', email: 'site-user@example.com', role: 'user' },
      completedFinishFailures: 1,
      commitCompletedBeforeFailure: true,
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createResponseRecorder();

    await accountPasswordSetupHandler(createRequest({ newPassword: 'StrongPass123' }), res);

    expect(res.statusCode).toBe(200);
    expect(securityState).toMatchObject({
      password_change_required: false,
      password_setup_capability_status: 'completed',
    });
    expect(adminClient.__mocks.rpc.mock.calls.filter(([name, payload]) => (
      name === 'finish_oauth_password_setup_capability' && payload.p_outcome === 'completed'
    ))).toHaveLength(2);
  });

  it('persists coordination state when completion cannot be confirmed', async () => {
    const securityState = {
      password_change_required: true,
      password_change_reason: 'oauth_password_setup_required_existing',
      password_setup_capability_id: '00000000-0000-4000-8000-000000000001',
      password_setup_capability_status: 'available',
      email_verification_required: false,
      email_verification_verified_at: '2026-06-03T00:00:00.000Z',
      email_verification_target_email: 'site-user@example.com',
    };
    const adminClient = createAdminClient({
      securityState,
      profile: { id: 'user-1', email: 'site-user@example.com', role: 'user' },
      completedFinishFailures: 2,
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createResponseRecorder();

    await accountPasswordSetupHandler(createRequest({ newPassword: 'StrongPass123' }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      passwordUpdated: true,
      capabilityConsumed: true,
      state: {
        passwordChangeRequired: true,
        passwordSetupCapabilityStatus: 'coordination_required',
      },
    });
    expect(adminClient.__mocks.rpc).toHaveBeenCalledWith(
      'finish_oauth_password_setup_capability',
      expect.objectContaining({ p_outcome: 'coordination_required' })
    );
  });
});
