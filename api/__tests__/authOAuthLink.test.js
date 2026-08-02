// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  linkOAuthIdentityToSiteSession: vi.fn(),
  loadSiteSession: vi.fn(),
  persistOAuthTransaction: vi.fn(),
  consumeOAuthTransaction: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/siteSession.js', async () => {
  const actual = await vi.importActual('../_lib/siteSession.js');
  return {
    ...actual,
    createOrLinkOAuthUserAndSession: vi.fn(),
    linkOAuthIdentityToSiteSession: mocks.linkOAuthIdentityToSiteSession,
    loadSiteSession: mocks.loadSiteSession,
  };
});

vi.mock('../_lib/oauthState.js', async () => {
  const actual = await vi.importActual('../_lib/oauthState.js');
  return {
    ...actual,
    persistOAuthTransaction: mocks.persistOAuthTransaction,
    consumeOAuthTransaction: mocks.consumeOAuthTransaction,
  };
});

const {
  githubOAuthCallbackHandler,
  githubOAuthStartHandler,
} = await import('../_routes/root/auth-oauth.js');
const {
  createOAuthState,
  getOAuthTransactionCookieName,
  verifyOAuthState,
} = await import('../_lib/oauthState.js');

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

function createRequest({
  query = {},
  headers = {},
} = {}) {
  return {
    method: 'GET',
    query,
    headers: {
      host: 'ef-gacha.mogujun.icu',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.20',
      'user-agent': 'Vitest',
      cookie: '__Host-eg_session=session-token',
      ...headers,
    },
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
}

function setGithubEnv() {
  process.env.APP_URL = 'https://ef-gacha.mogujun.icu';
  process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret';
  process.env.AUTH_IDENTITY_HASH_KEY_CURRENT = 'test-identity-hash-key-current-1234567890';
  process.env.AUTH_IDENTITY_HASH_KEY_CURRENT_VERSION = 'v2';
  process.env.AUTH_OAUTH_GITHUB_ENABLED = 'true';
  process.env.AUTH_OAUTH_GITHUB_CLIENT_ID = 'github-client-id';
  process.env.AUTH_OAUTH_GITHUB_CLIENT_SECRET = 'github-client-secret';
  process.env.AUTH_OAUTH_GITHUB_REDIRECT_URI = 'https://ef-gacha.mogujun.icu/api/auth/oauth/github/callback';
}

function getStatePayload(state) {
  const result = verifyOAuthState(state, {
    secret: 'test-oauth-state-secret',
  });
  expect(result.ok).toBe(true);
  return result.payload;
}

function createTransactionCookie(state) {
  const payload = getStatePayload(state);
  return `${getOAuthTransactionCookieName(payload.transactionId, { secure: true })}=browser-binding`;
}

function mockLinkTransaction(state, overrides = {}) {
  const payload = getStatePayload(state);
  mocks.consumeOAuthTransaction.mockResolvedValueOnce({
    ok: true,
    transaction: {
      id: payload.transactionId,
      provider: 'github',
      intent: 'link',
      return_to: '/settings',
      pkce_code_verifier: 'test-pkce-code-verifier-123456789012345678901234567890',
      started_session_id: 'session-1',
      started_user_id: 'user-1',
      ...overrides,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  [
    'APP_URL',
    'OAUTH_STATE_SECRET',
    'AUTH_IDENTITY_HASH_KEY_CURRENT',
    'AUTH_IDENTITY_HASH_KEY_CURRENT_VERSION',
    'AUTH_OAUTH_GITHUB_ENABLED',
    'AUTH_OAUTH_GITHUB_CLIENT_ID',
    'AUTH_OAUTH_GITHUB_CLIENT_SECRET',
    'AUTH_OAUTH_GITHUB_REDIRECT_URI',
  ].forEach((key) => {
    delete process.env[key];
  });
  const adminClient = { from: vi.fn() };
  mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
  mocks.loadSiteSession.mockResolvedValue({
    ok: true,
    authenticated: true,
    session: { id: 'session-1' },
    user: { id: 'user-1' },
  });
  mocks.persistOAuthTransaction.mockImplementation(async (_client, transaction) => ({
    ok: true,
    transaction: { id: transaction.transactionId },
  }));
});

describe('auth OAuth bridge link intent', () => {
  it('records the initiating site session and user in the link transaction', async () => {
    setGithubEnv();
    const req = createRequest({
      query: {
        intent: 'link',
        returnTo: '/settings',
      },
    });
    const res = createResponseRecorder();

    await githubOAuthStartHandler(req, res);

    expect(mocks.loadSiteSession).toHaveBeenCalledWith(expect.any(Object), {
      req,
      env: process.env,
      touch: false,
    });
    const location = new URL(res.headers.Location);
    const statePayload = getStatePayload(location.searchParams.get('state'));
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(mocks.persistOAuthTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        transactionId: statePayload.transactionId,
        provider: 'github',
        intent: 'link',
        startedSessionId: 'session-1',
        startedUserId: 'user-1',
      })
    );
    expect(String(res.headers['Set-Cookie'] || '')).toContain('__Host-eg_oauth_tx_');
  });

  it('does not start link intent without an authenticated site session', async () => {
    setGithubEnv();
    mocks.loadSiteSession.mockResolvedValueOnce({
      ok: true,
      authenticated: false,
    });
    const req = createRequest({
      query: {
        intent: 'link',
        returnTo: '/settings',
      },
      headers: {
        cookie: '',
      },
    });
    const res = createResponseRecorder();

    await githubOAuthStartHandler(req, res);

    const location = new URL(res.headers.Location);
    expect(location.pathname).toBe('/settings');
    expect(location.searchParams.get('oauth_status')).toBe('error');
    expect(location.searchParams.get('oauth_code')).toBe('site_session_required');
    expect(mocks.persistOAuthTransaction).not.toHaveBeenCalled();
  });

  it('links the provider identity to the current site session instead of signing in', async () => {
    setGithubEnv();
    mocks.linkOAuthIdentityToSiteSession.mockResolvedValue({
      ok: true,
      identity: {
        id: 'identity-1',
        provider: 'github',
        source: 'site_session',
      },
    });

    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (String(url).includes('/login/oauth/access_token')) {
        expect(String(options.body)).toContain('code_verifier=test-pkce-code-verifier');
        return new Response(JSON.stringify({ access_token: 'provider-access-token', token_type: 'Bearer' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).endsWith('/user')) {
        return new Response(JSON.stringify({
          id: 12345,
          login: 'github-user',
          name: 'GitHub User',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const state = createOAuthState({
      provider: 'github',
      returnTo: '/settings',
      intent: 'link',
    }, {
      secret: 'test-oauth-state-secret',
    });
    mockLinkTransaction(state);
    const req = createRequest({
      query: {
        code: 'auth-code',
        state,
      },
      headers: {
        cookie: `__Host-eg_session=session-token; ${createTransactionCookie(state)}`,
      },
    });
    const res = createResponseRecorder();

    await githubOAuthCallbackHandler(req, res);

    expect(mocks.linkOAuthIdentityToSiteSession).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      profile: expect.objectContaining({
        provider: 'github',
        username: 'github-user',
      }),
      subjectHash: expect.any(String),
      profileHash: expect.any(String),
      req,
      secret: 'test-oauth-state-secret',
    }));
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.Location);
    expect(location.pathname).toBe('/settings');
    expect(location.searchParams.get('oauth_status')).toBe('linked');
    expect(location.searchParams.get('oauth_code')).toBe('oauth_identity_linked');
    expect(String(res.headers['Set-Cookie'] || '')).not.toContain('ef_oauth_pending=');
  });

  it('consumes but rejects link callbacks from a different site session', async () => {
    setGithubEnv();
    const state = createOAuthState({
      provider: 'github',
      returnTo: '/settings',
      intent: 'link',
    }, {
      secret: 'test-oauth-state-secret',
    });
    mockLinkTransaction(state);
    mocks.loadSiteSession.mockResolvedValueOnce({
      ok: true,
      authenticated: true,
      session: { id: 'session-2' },
      user: { id: 'user-1' },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req = createRequest({
      query: {
        code: 'auth-code',
        state,
      },
      headers: {
        cookie: `__Host-eg_session=other-session-token; ${createTransactionCookie(state)}`,
      },
    });
    const res = createResponseRecorder();

    await githubOAuthCallbackHandler(req, res);

    const location = new URL(res.headers.Location);
    expect(location.pathname).toBe('/settings');
    expect(location.searchParams.get('oauth_status')).toBe('error');
    expect(location.searchParams.get('oauth_code')).toBe('oauth_link_session_mismatch');
    expect(mocks.consumeOAuthTransaction).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.linkOAuthIdentityToSiteSession).not.toHaveBeenCalled();
  });

  it('rejects link callbacks when the initiating user changed', async () => {
    setGithubEnv();
    const state = createOAuthState({
      provider: 'github',
      returnTo: '/settings',
      intent: 'link',
    }, {
      secret: 'test-oauth-state-secret',
    });
    mockLinkTransaction(state);
    mocks.loadSiteSession.mockResolvedValueOnce({
      ok: true,
      authenticated: true,
      session: { id: 'session-1' },
      user: { id: 'user-2' },
    });
    const req = createRequest({
      query: {
        code: 'auth-code',
        state,
      },
      headers: {
        cookie: `__Host-eg_session=session-token; ${createTransactionCookie(state)}`,
      },
    });
    const res = createResponseRecorder();

    await githubOAuthCallbackHandler(req, res);

    const location = new URL(res.headers.Location);
    expect(location.searchParams.get('oauth_code')).toBe('oauth_link_session_mismatch');
    expect(mocks.linkOAuthIdentityToSiteSession).not.toHaveBeenCalled();
  });
});
