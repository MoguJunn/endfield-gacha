// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  checkMemoryRateLimit: vi.fn(() => ({ allowed: true, retryAfter: 0 })),
  getRequesterKey: vi.fn(() => 'requester'),
  resolveAuthenticatedRequestUser: vi.fn(),
  verifyOAuthEmailArtifactMerge: vi.fn(),
  completeOAuthEmailArtifactMerge: vi.fn(),
  maskAccountMergeEmail: vi.fn(() => 'l***y@example.com'),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
  checkMemoryRateLimit: mocks.checkMemoryRateLimit,
  getRequesterKey: mocks.getRequesterKey,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
}));

vi.mock('../_lib/oauthEmailArtifactMerge.js', () => ({
  verifyOAuthEmailArtifactMerge: mocks.verifyOAuthEmailArtifactMerge,
  completeOAuthEmailArtifactMerge: mocks.completeOAuthEmailArtifactMerge,
  maskAccountMergeEmail: mocks.maskAccountMergeEmail,
}));

import handler from '../_routes/root/account-email-merge.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
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
      return this;
    },
  };
}

function createRequest(body) {
  return {
    method: 'POST',
    body,
    headers: {
      origin: 'https://ef-gacha.mogujun.icu',
      authorization: 'Bearer access-token',
    },
  };
}

describe('api/account-email-merge handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAdminClient.mockReturnValue({ id: 'admin-client' });
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      user: { id: 'source-user' },
      session: { id: 'session-1' },
    });
  });

  it('verifies a one-time code without changing account ownership', async () => {
    mocks.verifyOAuthEmailArtifactMerge.mockResolvedValue({
      id: 'intent-1',
      target_email: 'legacy@example.com',
      status: 'verified',
    });
    const req = createRequest({
      action: 'verify',
      intentId: 'intent-1',
      code: '123456',
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        status: 'verified',
        intentId: 'intent-1',
        preview: {
          businessDataMoved: false,
          loginIdentityPreserved: true,
        },
      },
    });
    expect(mocks.verifyOAuthEmailArtifactMerge).toHaveBeenCalledWith(
      { id: 'admin-client' },
      {
        intentId: 'intent-1',
        sourceUserId: 'source-user',
        verificationCode: '123456',
      }
    );
    expect(mocks.completeOAuthEmailArtifactMerge).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before applying the repair', async () => {
    const res = createResponse();
    await handler(createRequest({
      action: 'confirm',
      intentId: 'intent-1',
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('oauth_email_merge_confirmation_required');
    expect(mocks.completeOAuthEmailArtifactMerge).not.toHaveBeenCalled();
  });

  it('completes the repair for the authenticated source user', async () => {
    mocks.completeOAuthEmailArtifactMerge.mockResolvedValue({
      ok: true,
      status: 'completed',
      intentId: 'intent-1',
      email: 'legacy@example.com',
      currentSessionRecreated: true,
    });
    const req = createRequest({
      action: 'confirm',
      intentId: 'intent-1',
      confirmation: 'merge',
    });
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        ok: true,
        status: 'completed',
        currentSessionRecreated: true,
      },
    });
    expect(mocks.completeOAuthEmailArtifactMerge).toHaveBeenCalledWith(
      { id: 'admin-client' },
      {
        intentId: 'intent-1',
        sourceUserId: 'source-user',
        startedSessionId: 'session-1',
        req,
        res,
      }
    );
  });

  it('rejects confirmation without an active site session', async () => {
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      user: { id: 'source-user' },
      session: null,
    });
    const res = createResponse();

    await handler(createRequest({
      action: 'confirm',
      intentId: 'intent-1',
      confirmation: 'merge',
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('oauth_email_merge_site_session_required');
    expect(mocks.completeOAuthEmailArtifactMerge).not.toHaveBeenCalled();
  });

  it('surfaces protected coordination state without exposing internal errors', async () => {
    mocks.completeOAuthEmailArtifactMerge.mockResolvedValue({
      ok: false,
      code: 'oauth_email_merge_coordination_required',
    });
    const res = createResponse();

    await handler(createRequest({
      action: 'confirm',
      intentId: 'intent-1',
      confirmation: 'merge',
    }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: 'Account state requires support coordination',
      code: 'oauth_email_merge_coordination_required',
      details: {
        mergeCompleted: false,
        compensated: false,
      },
    });
  });
});
