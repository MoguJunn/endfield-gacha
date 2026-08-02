// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseAccessTokenClient: vi.fn(),
  getBearerToken: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
  createSupabaseCompatAccessToken: vi.fn(),
  checkAccountCredentialAllowed: vi.fn(),
  loadActiveSiteSessionById: vi.fn(),
  loadSiteSession: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  createSupabaseAccessTokenClient: mocks.createSupabaseAccessTokenClient,
  getBearerToken: mocks.getBearerToken,
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/siteSession.js', () => ({
  checkAccountCredentialAllowed: mocks.checkAccountCredentialAllowed,
  createSupabaseCompatAccessToken: mocks.createSupabaseCompatAccessToken,
  loadActiveSiteSessionById: mocks.loadActiveSiteSessionById,
  loadSiteSession: mocks.loadSiteSession,
}));

import { resolveAuthenticatedRequestUser, resolveBearerRequestUser } from '../_lib/siteAuth.js';

function createNativeToken(overrides = {}) {
  const payload = Buffer.from(JSON.stringify({
    session_id: '10000000-0000-4000-8000-000000000001',
    iat: 1784966400,
    exp: 1784970000,
    ...overrides,
  })).toString('base64url');
  return `header.${payload}.signature`;
}

function createAllowedAdminClient() {
  return {
    from: vi.fn(),
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
}

describe('siteAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAdminClient.mockReturnValue(null);
    mocks.getBearerToken.mockReturnValue(null);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(null);
    mocks.createSupabaseCompatAccessToken.mockReturnValue(null);
    mocks.checkAccountCredentialAllowed.mockResolvedValue({ ok: true, allowed: true });
    mocks.loadActiveSiteSessionById.mockResolvedValue({ ok: true, active: true });
    mocks.loadSiteSession.mockResolvedValue(null);
  });

  it('authenticates native bearer tokens only after the Auth session remains allowed', async () => {
    const callerClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              id: 'user-1',
            },
          },
          error: null,
        })),
      },
    };
    const token = createNativeToken();
    const adminClient = createAllowedAdminClient();
    mocks.getBearerToken.mockReturnValue(token);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(callerClient);

    await expect(
      resolveAuthenticatedRequestUser(
        {
          headers: { authorization: `Bearer ${token}` },
        },
        {
          adminClient,
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      source: 'supabase',
      user: {
        id: 'user-1',
      },
      adminClient,
      callerClient,
      accessToken: token,
    });

    expect(mocks.loadSiteSession).toHaveBeenCalledWith(adminClient, expect.objectContaining({
      touch: true,
    }));
    expect(callerClient.auth.getUser).toHaveBeenCalledWith(token);
    expect(adminClient.rpc).toHaveBeenCalledWith('is_bearer_auth_session_allowed', expect.objectContaining({
      p_user_id: 'user-1',
      p_auth_session_id: '10000000-0000-4000-8000-000000000001',
    }));
  });

  it('uses only the bearer identity for session bootstrap resolution', async () => {
    const callerClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'bearer-user' } },
          error: null,
        })),
      },
    };
    const token = createNativeToken();
    mocks.getBearerToken.mockReturnValue(token);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(callerClient);

    await expect(
      resolveBearerRequestUser(
        {
          headers: {
            authorization: `Bearer ${token}`,
            cookie: '__Host-eg_session=another-user-session',
          },
        },
        { adminClient: createAllowedAdminClient() }
      )
    ).resolves.toMatchObject({
      ok: true,
      source: 'supabase',
      user: { id: 'bearer-user' },
    });

    expect(mocks.loadSiteSession).not.toHaveBeenCalled();
  });

  it('rejects native bearer tokens from Auth sessions before the revocation boundary', async () => {
    const token = createNativeToken();
    const adminClient = createAllowedAdminClient();
    adminClient.rpc.mockResolvedValue({ data: false, error: null });
    mocks.getBearerToken.mockReturnValue(token);
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    });

    await expect(resolveBearerRequestUser({
      headers: { authorization: `Bearer ${token}` },
    }, { adminClient })).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: 'auth_session_revoked',
    });
  });

  it('rejects bearer authentication after an issued temporary password expires', async () => {
    const token = createNativeToken();
    mocks.getBearerToken.mockReturnValue(token);
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'recovery-user' } },
          error: null,
        })),
      },
    });
    mocks.checkAccountCredentialAllowed.mockResolvedValueOnce({
      ok: true,
      allowed: false,
      code: 'temporary_password_expired',
    });

    await expect(resolveBearerRequestUser({
      headers: { authorization: `Bearer ${token}` },
    }, { adminClient: createAllowedAdminClient() })).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: 'temporary_password_expired',
    });
  });

  it('accepts matching cookie and bearer users after validating both credentials', async () => {
    const callerClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'same-user' } },
          error: null,
        })),
      },
    };
    const token = createNativeToken();
    mocks.getBearerToken.mockReturnValue(token);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(callerClient);
    mocks.loadSiteSession.mockResolvedValue({
      authenticated: true,
      user: { id: 'same-user' },
      session: { id: 'session-1' },
      profile: { id: 'same-user' },
      identities: [],
    });

    await expect(
      resolveAuthenticatedRequestUser(
        {
          headers: { authorization: `Bearer ${token}` },
        },
        { adminClient: createAllowedAdminClient() }
      )
    ).resolves.toMatchObject({
      ok: true,
      source: 'site_session',
      user: { id: 'same-user' },
      callerClient,
      credentialSources: ['site_session', 'supabase'],
    });
  });

  it('rejects requests whose cookie and bearer belong to different users', async () => {
    const token = createNativeToken();
    mocks.getBearerToken.mockReturnValue(token);
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'bearer-user' } },
          error: null,
        })),
      },
    });
    mocks.loadSiteSession.mockResolvedValue({
      authenticated: true,
      user: { id: 'cookie-user' },
      session: { id: 'session-1' },
    });

    await expect(
      resolveAuthenticatedRequestUser(
        {
          headers: { authorization: `Bearer ${token}` },
        },
        { adminClient: createAllowedAdminClient() }
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 409,
      code: 'auth_identity_conflict',
    });
  });

  it('does not let a valid cookie hide an invalid bearer token', async () => {
    mocks.getBearerToken.mockReturnValue('invalid-token');
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'invalid token' },
        })),
      },
    });
    mocks.loadSiteSession.mockResolvedValue({
      authenticated: true,
      user: { id: 'cookie-user' },
    });

    await expect(
      resolveAuthenticatedRequestUser(
        {
          headers: { authorization: 'Bearer invalid-token' },
        },
        { adminClient: {} }
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: 'invalid_access_token',
    });
    expect(mocks.loadSiteSession).not.toHaveBeenCalled();
  });

  it('requires a compatibility bearer token to reference an active session owned by the same user', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        app_metadata: { provider: 'site_session' },
        user_metadata: { site_session: true },
        session_id: 'session-1',
      })
    ).toString('base64url');
    const token = `header.${payload}.signature`;
    mocks.getBearerToken.mockReturnValue(token);
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    });

    await expect(
      resolveBearerRequestUser(
        {
          headers: { authorization: `Bearer ${token}` },
        },
        { adminClient: { from: vi.fn() } }
      )
    ).resolves.toMatchObject({
      ok: true,
      user: { id: 'user-1' },
    });
    expect(mocks.loadActiveSiteSessionById).toHaveBeenCalledWith(expect.any(Object), {
      sessionId: 'session-1',
      userId: 'user-1',
    });
  });

  it('rejects a compatibility bearer token after its bound session is revoked', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        app_metadata: { provider: 'site_session' },
        user_metadata: { site_session: true },
        session_id: 'revoked-session',
      })
    ).toString('base64url');
    const token = `header.${payload}.signature`;
    mocks.getBearerToken.mockReturnValue(token);
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    });
    mocks.loadActiveSiteSessionById.mockResolvedValue({ ok: true, active: false });

    await expect(
      resolveBearerRequestUser(
        {
          headers: { authorization: `Bearer ${token}` },
        },
        { adminClient: { from: vi.fn() } }
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: 'site_session_revoked',
    });
  });

  it('still reports service configuration errors without admin client or bearer token', async () => {
    await expect(
      resolveAuthenticatedRequestUser(
        { headers: {} },
        {
          adminClient: null,
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: 'auth_service_not_configured',
    });
  });
});
