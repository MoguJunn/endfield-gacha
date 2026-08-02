// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkMemoryRateLimit: vi.fn(() => ({ allowed: true, retryAfter: 0 })),
  createSupabaseAccessTokenClient: vi.fn(),
  getRequesterKey: vi.fn(() => 'test-requester'),
  getBearerToken: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
  resolveAuthenticatedRequestUser: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  createSupabaseAccessTokenClient: mocks.createSupabaseAccessTokenClient,
  getBearerToken: mocks.getBearerToken,
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/http.js', () => ({
  checkMemoryRateLimit: mocks.checkMemoryRateLimit,
  getRequesterKey: mocks.getRequesterKey,
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
}));

vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
}));

import accountEmailVerifyHandler, { __internal } from '../_routes/root/account-email-verify.js';

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
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
      this.ended = true;
      return this;
    },
  };
}

function createRequest(token = 'a'.repeat(43)) {
  return {
    method: 'GET',
    query: { token },
    headers: {
      host: 'ef-gacha.example',
      'x-forwarded-proto': 'https',
    },
  };
}

function createPostRequest({ code = '123456', authorization = 'Bearer access-token' } = {}) {
  return {
    method: 'POST',
    body: { code },
    query: {},
    headers: {
      authorization,
      origin: 'https://ef-gacha.mogujun.icu',
      host: 'ef-gacha.example',
      'x-forwarded-proto': 'https',
    },
  };
}

function createAdminClient({
  stateRow,
  loadError = null,
  updateError = null,
} = {}) {
  const rpc = vi.fn(async (_name, payload) => {
    const expiresAt = payload.p_kind === 'code'
      ? stateRow?.email_verification_code_expires_at
      : stateRow?.email_verification_token_expires_at;
    const expired = !expiresAt || new Date(expiresAt).getTime() <= Date.now();
    const wrongUser = payload.p_user_id && stateRow?.user_id !== payload.p_user_id;
    return {
      data: !loadError && !updateError && stateRow?.user_id && !expired && !wrongUser
        ? {
          user_id: stateRow.user_id,
          target_email: stateRow.target_email || 'verified@example.com',
          challenge_id: 'challenge-1',
          verified_at: new Date().toISOString(),
        }
        : null,
      error: loadError || updateError,
    };
  });

  return {
    from: vi.fn(),
    rpc,
    __mocks: {
      rpc,
    },
  };
}

describe('api/account-email-verify handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
    mocks.getBearerToken.mockReturnValue('access-token');
    mocks.createSupabaseAccessTokenClient.mockReturnValue({
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
    });
    mocks.resolveAuthenticatedRequestUser.mockImplementation(async (req, { adminClient }) => {
      const token = mocks.getBearerToken(req);
      if (!token) {
        return {
          ok: false,
          status: 401,
          code: 'missing_access_token',
          error: 'Missing access token',
        };
      }
      const callerClient = mocks.createSupabaseAccessTokenClient(token);
      const { data, error } = await callerClient.auth.getUser(token);
      if (error || !data?.user?.id) {
        return { ok: false, status: 401, code: 'invalid_access_token', error: 'Invalid access token' };
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

  it('clears the rollout email verification requirement for a valid token', async () => {
    const token = 'valid-token-value-that-is-long-enough-123';
    const tokenHash = __internal.hashEmailVerificationToken(token);
    const adminClient = createAdminClient({
      stateRow: {
        user_id: 'user-1',
        email_verification_required: true,
        email_verification_token_expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest(token);
    const res = createResponseRecorder();

    await accountEmailVerifyHandler(req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe('https://ef-gacha.example/settings?email_verification=success');
    expect(adminClient.__mocks.rpc).toHaveBeenCalledWith('consume_account_email_challenge', {
      p_kind: 'token',
      p_hash: tokenHash,
      p_user_id: null,
    });
  });

  it('redirects to a failure state when the token is expired', async () => {
    const adminClient = createAdminClient({
      stateRow: {
        user_id: 'user-1',
        email_verification_required: true,
        email_verification_token_expires_at: new Date(Date.now() - 60000).toISOString(),
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest('expired-token-value-that-is-long-enough-123');
    const res = createResponseRecorder();

    await accountEmailVerifyHandler(req, res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe('https://ef-gacha.example/settings?email_verification=failed&reason=token_not_found');
  });

  it('verifies the current user email with a valid code', async () => {
    const code = '551331';
    const codeHash = __internal.hashEmailVerificationCode(code, 'user-1');
    const adminClient = createAdminClient({
      stateRow: {
        user_id: 'user-1',
        email_verification_required: true,
        email_verification_code_expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createPostRequest({ code });
    const res = createResponseRecorder();

    await accountEmailVerifyHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        status: 'verified',
        email: 'verified@example.com',
      },
    });
    expect(adminClient.__mocks.rpc).toHaveBeenCalledWith('consume_account_email_challenge', {
      p_kind: 'code',
      p_hash: codeHash,
      p_user_id: 'user-1',
    });
  });

  it('rejects code verification without a current session', async () => {
    mocks.getBearerToken.mockReturnValue('');
    mocks.getSupabaseAdminClient.mockReturnValue(createAdminClient());

    const req = createPostRequest({ authorization: '' });
    const res = createResponseRecorder();

    await accountEmailVerifyHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      code: 'missing_access_token',
    });
  });

  it('rate limits repeated verification code attempts for the current session', async () => {
    mocks.checkMemoryRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 120 });
    mocks.getSupabaseAdminClient.mockReturnValue(createAdminClient());

    const req = createPostRequest();
    const res = createResponseRecorder();

    await accountEmailVerifyHandler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      success: false,
      code: 'rate_limited',
      retry_after: 120,
    });
  });

  it('rejects a valid code for a different user', async () => {
    const adminClient = createAdminClient({
      stateRow: {
        user_id: 'other-user',
        email_verification_required: true,
        email_verification_code_expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createPostRequest();
    const res = createResponseRecorder();

    await accountEmailVerifyHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'code_not_found',
    });
    expect(adminClient.__mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired verification code', async () => {
    const adminClient = createAdminClient({
      stateRow: {
        user_id: 'user-1',
        email_verification_required: true,
        email_verification_code_expires_at: new Date(Date.now() - 60000).toISOString(),
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createPostRequest();
    const res = createResponseRecorder();

    await accountEmailVerifyHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'code_not_found',
    });
    expect(adminClient.__mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
