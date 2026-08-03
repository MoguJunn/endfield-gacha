// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyCors: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
  resolveAuthenticatedRequestUser: vi.fn(),
  resolveBearerRequestUser: vi.fn(),
  clearSiteSessionCookies: vi.fn(),
  createSupabaseCompatAccessToken: vi.fn(),
  createSiteSessionFromBearer: vi.fn(),
  loadSiteSession: vi.fn(),
  revokeAllSiteSessionsForUser: vi.fn(),
  revokeSiteSession: vi.fn(),
}));

vi.mock('../_lib/http.js', () => ({
  applyCors: mocks.applyCors,
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
  resolveBearerRequestUser: mocks.resolveBearerRequestUser,
}));

vi.mock('../_lib/siteSession.js', () => ({
  clearSiteSessionCookies: mocks.clearSiteSessionCookies,
  createSupabaseCompatAccessToken: mocks.createSupabaseCompatAccessToken,
  createSiteSessionFromBearer: mocks.createSiteSessionFromBearer,
  loadSiteSession: mocks.loadSiteSession,
  revokeAllSiteSessionsForUser: mocks.revokeAllSiteSessionsForUser,
  revokeSiteSession: mocks.revokeSiteSession,
}));

import authSessionHandler, {
  authSessionLogoutHandler,
  authSessionRevokeAllHandler,
} from '../_routes/root/auth-session.js';

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
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
      return this;
    },
  };
}

describe('/api/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyCors.mockReturnValue({ allowed: true, origin: '' });
    mocks.getSupabaseAdminClient.mockReturnValue({ from: vi.fn() });
    mocks.createSupabaseCompatAccessToken.mockReturnValue(null);
    mocks.loadSiteSession.mockResolvedValue({ ok: true, authenticated: false });
    mocks.revokeAllSiteSessionsForUser.mockResolvedValue({ ok: true, revokedCount: 2 });
    mocks.revokeSiteSession.mockResolvedValue({ ok: true, revokedCount: 1 });
  });

  it('bootstraps exclusively from the bearer user even when another session cookie is present', async () => {
    const adminClient = mocks.getSupabaseAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.resolveBearerRequestUser.mockResolvedValue({
      ok: true,
      source: 'supabase',
      user: { id: 'bearer-user' },
      bearerTokenKind: 'native_supabase',
      sourceAuthSessionId: '10000000-0000-4000-8000-000000000001',
      bearerIssuedAt: 1784966400,
      bearerExpiresAt: 1784970000,
    });
    mocks.createSiteSessionFromBearer.mockResolvedValue({ ok: true, session: { id: 'new-session' } });
    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer bearer-token',
        cookie: '__Host-eg_session=cookie-user-session',
      },
    };
    const res = createResponseRecorder();

    await authSessionHandler(req, res);

    expect(mocks.resolveBearerRequestUser).toHaveBeenCalledWith(req, { adminClient });
    expect(mocks.loadSiteSession).not.toHaveBeenCalled();
    expect(mocks.createSiteSessionFromBearer).toHaveBeenCalledWith(adminClient, expect.objectContaining({
      userId: 'bearer-user',
      sourceAuthSessionId: '10000000-0000-4000-8000-000000000001',
      bearerIssuedAt: 1784966400,
      bearerExpiresAt: 1784970000,
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { bootstrapped: true, source: 'supabase' },
    });
  });

  it('rejects bootstrap when no valid bearer credential is supplied', async () => {
    mocks.resolveBearerRequestUser.mockResolvedValue({
      ok: false,
      status: 401,
      code: 'missing_access_token',
      error: 'Missing access token',
    });
    const req = {
      method: 'POST',
      headers: { cookie: '__Host-eg_session=existing-session' },
    };
    const res = createResponseRecorder();

    await authSessionHandler(req, res);

    expect(mocks.createSiteSessionFromBearer).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      code: 'missing_access_token',
    });
  });

  it('does not let a compatibility token derive another site session', async () => {
    mocks.resolveBearerRequestUser.mockResolvedValue({
      ok: true,
      source: 'supabase',
      user: { id: 'site-user' },
      bearerTokenKind: 'site_session_compat',
    });
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer compatibility-token' },
    };
    const res = createResponseRecorder();

    await authSessionHandler(req, res);

    expect(mocks.createSiteSessionFromBearer).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'native_bearer_required',
    });
  });

  it('revokes every site session owned by the authenticated user', async () => {
    const adminClient = mocks.getSupabaseAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      user: { id: 'user-1' },
    });
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer native-token' },
    };
    const res = createResponseRecorder();

    await authSessionRevokeAllHandler(req, res);

    expect(mocks.revokeAllSiteSessionsForUser).toHaveBeenCalledWith(adminClient, {
      userId: 'user-1',
      reason: 'credential_changed',
    });
    expect(mocks.clearSiteSessionCookies).toHaveBeenCalledWith(res, req);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { sessionsRevoked: true, revokedCount: 2 },
    });
  });

  it('reports logout success only after the database session family is revoked', async () => {
    const adminClient = mocks.getSupabaseAdminClient();
    const req = {
      method: 'POST',
      headers: { cookie: '__Secure-eg_refresh=refresh-token' },
    };
    const res = createResponseRecorder();

    await authSessionLogoutHandler(req, res);

    expect(mocks.revokeSiteSession).toHaveBeenCalledWith(adminClient, {
      req,
      res,
      reason: 'user_logout',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { signedOut: true, revokedCount: 1 },
    });
  });

  it('does not report logout success when database revocation fails', async () => {
    mocks.revokeSiteSession.mockResolvedValue({
      ok: false,
      code: 'site_session_revoke_failed',
      reason: 'database unavailable',
    });
    const req = {
      method: 'POST',
      headers: { cookie: '__Secure-eg_refresh=refresh-token' },
    };
    const res = createResponseRecorder();

    await authSessionLogoutHandler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      code: 'site_session_revoke_failed',
    });
  });
});
