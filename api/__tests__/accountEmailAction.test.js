// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  checkMemoryRateLimit: vi.fn(() => ({ allowed: true, retryAfter: 0 })),
  getRequesterKey: vi.fn(() => 'test-requester'),
  createSupabaseAccessTokenClient: vi.fn(),
  getBearerToken: vi.fn(() => 'access-token'),
  getSupabaseAdminClient: vi.fn(),
  getSupabaseAnonServerClient: vi.fn(),
  findAuthUserByEmail: vi.fn(),
  createMailProviderAdapter: vi.fn(),
  resolveAuthenticatedRequestUser: vi.fn(),
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
  checkMemoryRateLimit: mocks.checkMemoryRateLimit,
  getRequesterKey: mocks.getRequesterKey,
}));

vi.mock('../_lib/authAdmin.js', () => ({
  createSupabaseAccessTokenClient: mocks.createSupabaseAccessTokenClient,
  getBearerToken: mocks.getBearerToken,
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
  getSupabaseAnonServerClient: mocks.getSupabaseAnonServerClient,
  findAuthUserByEmail: mocks.findAuthUserByEmail,
}));

vi.mock('../_lib/mailProviderAdapter.js', () => ({
  createMailProviderAdapter: mocks.createMailProviderAdapter,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
}));

import accountEmailActionHandler from '../_routes/root/account-email-action.js';

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
  body,
  headers = {
    authorization: 'Bearer access-token',
    origin: 'https://ef-gacha.mogujun.icu',
    'user-agent': 'Vitest',
  },
} = {}) {
  return {
    method: 'POST',
    body,
    headers,
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
}

function createAdminClient({
  mailRuntimeConfig = null,
  generateLinkImpl = null,
  accountSecurityState = null,
} = {}) {
  const generateLink = vi.fn(async (payload) => {
    if (generateLinkImpl) {
      return generateLinkImpl(payload);
    }

    return {
      data: {
        properties: {
          action_link: `https://auth.example.test/${payload.type}`,
        },
        user: {
          id: 'user-1',
          email: payload.email,
        },
      },
      error: null,
    };
  });
  const deliveryInsert = vi.fn(async () => ({ error: null }));
  const securityUpsert = vi.fn(async () => ({ error: null }));
  const profileUpdate = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: null })),
  }));
  const challengeRpc = vi.fn(async () => ({
    data: {
      id: 'challenge-1',
      user_id: 'user-1',
      target_email: 'target@example.com',
    },
    error: null,
  }));
  const runtimeRow = mailRuntimeConfig
    ? {
      key: 'mail_runtime_config',
      value: JSON.stringify(mailRuntimeConfig),
      updated_at: '2026-06-12T00:00:00.000Z',
      updated_by: 'admin-user-id',
    }
    : null;

  return {
    rpc: challengeRpc,
    auth: {
      admin: {
        generateLink,
      },
    },
    from: vi.fn((table) => {
      if (table === 'site_config') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({
                data: runtimeRow ? [runtimeRow] : [],
                error: null,
              })),
            })),
          })),
        };
      }

      if (table === 'account_security_states') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: accountSecurityState,
                error: null,
              })),
            })),
          })),
          upsert: securityUpsert,
        };
      }

      if (table === 'profiles') {
        return {
          update: profileUpdate,
        };
      }

      if (table !== 'mail_delivery_events') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        insert: deliveryInsert,
      };
    }),
    __mocks: {
      deliveryInsert,
      generateLink,
      profileUpdate,
      challengeRpc,
      securityUpsert,
    },
  };
}

function createCallerClient({
  user = {
    id: 'user-1',
    email: 'current@example.com',
    email_confirmed_at: '2026-06-01T00:00:00.000Z',
  },
  getUserError = null,
  passwordError = null,
} = {}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
        error: getUserError,
      })),
      signInWithPassword: vi.fn(async () => ({
        data: passwordError ? null : { user },
        error: passwordError,
      })),
    },
  };
}

function createMailAdapter({
  ok = true,
  dryRun = false,
} = {}) {
  const sentMessages = [];
  return {
    sentMessages,
    config: {
      dryRun,
      provider: 'stalwart',
      providerKey: dryRun ? 'stalwart:dry-run' : 'stalwart',
      fromAddress: 'no-reply@leevident.com',
      fromName: 'Endfield Gacha',
    },
    send: vi.fn(async (message) => {
      sentMessages.push(message);
      return {
        ok,
        accepted: ok,
        dryRun,
        retryable: !ok,
        providerKey: dryRun ? 'stalwart:dry-run' : 'stalwart',
        providerMessageId: ok ? `provider-${sentMessages.length}` : '',
        code: ok ? 'stalwart_smtp_accepted' : 'stalwart_smtp_failed',
        reason: ok ? 'accepted' : 'failed',
      };
    }),
  };
}

function withAuthMailEnv(callback) {
  return async () => {
    const keys = [
      'APP_URL',
      'AUTH_MAIL_ACTIONS_ENABLED',
      'MAIL_OUTBOX_WORKER_ENABLED',
      'MAIL_OUTBOX_GLOBAL_KILL_SWITCH',
      'SUPABASE_URL',
      'VITE_SUPABASE_URL',
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

    process.env.APP_URL = 'https://ef-gacha.example';
    process.env.AUTH_MAIL_ACTIONS_ENABLED = 'true';
    process.env.MAIL_OUTBOX_WORKER_ENABLED = 'true';
    process.env.MAIL_OUTBOX_GLOBAL_KILL_SWITCH = 'false';

    try {
      await callback();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };
}

describe('api/account-email-action handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTH_MAIL_ACTIONS_ENABLED;
    delete process.env.MAIL_OUTBOX_WORKER_ENABLED;
    delete process.env.MAIL_OUTBOX_GLOBAL_KILL_SWITCH;

    mocks.getBearerToken.mockReturnValue('access-token');
    mocks.findAuthUserByEmail.mockResolvedValue(null);
    mocks.createMailProviderAdapter.mockReturnValue(createMailAdapter());
    mocks.createSupabaseAccessTokenClient.mockReturnValue(createCallerClient());
    mocks.getSupabaseAnonServerClient.mockReturnValue(createCallerClient());
    mocks.resolveAuthenticatedRequestUser.mockImplementation(async (req, { adminClient }) => {
      const token = mocks.getBearerToken(req);
      if (!token) {
        return { ok: false, status: 401, error: 'Missing access token' };
      }
      const callerClient = mocks.createSupabaseAccessTokenClient(token);
      const { data, error } = await callerClient.auth.getUser(token);
      if (error || !data?.user?.id) {
        return { ok: false, status: 401, error: error?.message || 'Invalid access token' };
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

  it('rejects unauthenticated account email actions', async () => {
    mocks.getBearerToken.mockReturnValue(null);
    mocks.getSupabaseAdminClient.mockReturnValue(createAdminClient());

    const req = createRequest({
      body: {
        action: 'change_email',
        newEmail: 'new@example.com',
        currentPassword: 'CurrentPass123',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'Missing access token',
    });
  });

  it('starts a secure email change by sending current and new mailbox confirmations', withAuthMailEnv(async () => {
    const adminClient = createAdminClient();
    const callerClient = createCallerClient();
    const adapter = createMailAdapter();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.getSupabaseAnonServerClient.mockReturnValue(callerClient);
    mocks.createMailProviderAdapter.mockReturnValue(adapter);

    const req = createRequest({
      body: {
        action: 'change_email',
        newEmail: 'New.User@Example.com',
        currentPassword: 'CurrentPass123',
        locale: 'zh-CN',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        status: 'sent',
        nextStep: 'confirm_current_and_new_email',
        sent: {
          current: true,
          new: true,
        },
      },
    });
    expect(callerClient.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'current@example.com',
      password: 'CurrentPass123',
    });
    expect(adminClient.__mocks.generateLink).toHaveBeenCalledWith({
      type: 'email_change_current',
      email: 'current@example.com',
      newEmail: 'new.user@example.com',
      options: {
        redirectTo: 'https://ef-gacha.example',
      },
    });
    expect(adminClient.__mocks.generateLink).toHaveBeenCalledWith({
      type: 'email_change_new',
      email: 'current@example.com',
      newEmail: 'new.user@example.com',
      options: {
        redirectTo: 'https://ef-gacha.example',
      },
    });
    expect(adapter.sentMessages).toHaveLength(2);
    expect(adapter.sentMessages.map((message) => message.templateKey)).toEqual([
      'auth.email-change-current',
      'auth.email-change-new',
    ]);
    expect(adapter.sentMessages[0].to).toBe('current@example.com');
    expect(adapter.sentMessages[1].to).toBe('new.user@example.com');
    expect(adminClient.__mocks.deliveryInsert).toHaveBeenCalledTimes(2);
  }));

  it('binds a site email for OAuth-only users without requiring current password', withAuthMailEnv(async () => {
    const adminClient = createAdminClient({
      accountSecurityState: {
        password_change_required: true,
        password_change_reason: 'oauth_password_setup_required',
        email_verification_required: true,
        email_verification_requested_at: '2026-06-12T00:00:00.000Z',
        email_verification_verified_at: null,
      },
    });
    const callerClient = createCallerClient({
      user: {
        id: 'user-1',
        email: 'github.abcdef1234567890abcdef1234567890@oauth.local.invalid',
        email_confirmed_at: '2026-06-01T00:00:00.000Z',
      },
    });
    const adapter = createMailAdapter();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(callerClient);
    mocks.createMailProviderAdapter.mockReturnValue(adapter);

    const req = createRequest({
      body: {
        action: 'change_email',
        newEmail: 'site-user@example.com',
        locale: 'zh-CN',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        status: 'sent',
        nextStep: 'enter_verification_code',
        sent: {
          current: false,
          new: true,
        },
      },
    });
    expect(callerClient.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
    expect(adminClient.__mocks.profileUpdate).not.toHaveBeenCalled();
    expect(adminClient.__mocks.challengeRpc).toHaveBeenCalledWith(
      'start_account_email_challenge',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_target_email: 'site-user@example.com',
        p_reason: 'oauth_email_setup_required',
      })
    );
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0]).toMatchObject({
      to: 'site-user@example.com',
      templateKey: 'auth.email-verification',
      eventType: 'email_verification',
    });
    expect(adapter.sentMessages[0].payload).toMatchObject({
      verificationMode: 'account_security_state',
      codeEntry: true,
    });
  }));

  it('rejects email change when the current password is wrong', withAuthMailEnv(async () => {
    const adminClient = createAdminClient();
    const callerClient = createCallerClient({
      passwordError: new Error('Invalid login credentials'),
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.getSupabaseAnonServerClient.mockReturnValue(callerClient);

    const req = createRequest({
      body: {
        action: 'change_email',
        newEmail: 'new@example.com',
        currentPassword: 'wrong',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      code: 'invalid_current_password',
    });
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.createMailProviderAdapter).not.toHaveBeenCalled();
  }));

  it('rejects email change when the target email already belongs to another user', withAuthMailEnv(async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.findAuthUserByEmail.mockResolvedValue({
      id: 'other-user',
      email: 'new@example.com',
    });

    const req = createRequest({
      body: {
        action: 'change_email',
        newEmail: 'new@example.com',
        currentPassword: 'CurrentPass123',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'email_already_registered',
    });
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
  }));

  it('does not send a verification email when the current email is already confirmed', withAuthMailEnv(async () => {
    const adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      body: {
        action: 'resend_verification',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        status: 'already_verified',
        sent: {
          current: false,
        },
      },
    });
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.createMailProviderAdapter).not.toHaveBeenCalled();
  }));

  it('recognizes a completed app-level verification for an OAuth site session', withAuthMailEnv(async () => {
    const adminClient = createAdminClient({
      accountSecurityState: {
        email_verification_required: false,
        email_verification_reason: 'oauth_email_setup_required',
        email_verification_requested_at: '2026-07-24T00:00:00.000Z',
        email_verification_verified_at: '2026-07-24T00:05:00.000Z',
        password_change_required: true,
        password_change_reason: 'oauth_password_setup_required',
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(createCallerClient({
      user: {
        id: 'user-1',
        email: 'site-user@example.com',
        email_confirmed_at: null,
        confirmed_at: null,
      },
    }));

    const req = createRequest({
      body: {
        action: 'resend_verification',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        status: 'already_verified',
        nextStep: 'none',
        sent: {
          current: false,
        },
      },
    });
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
    expect(adminClient.__mocks.securityUpsert).not.toHaveBeenCalled();
    expect(mocks.createMailProviderAdapter).not.toHaveBeenCalled();
  }));

  it('sends an app-level verification code when rollout verification is required', withAuthMailEnv(async () => {
    const adminClient = createAdminClient({
      accountSecurityState: {
        email_verification_required: true,
        email_verification_requested_at: '2026-06-12T00:00:00.000Z',
        email_verification_verified_at: null,
      },
    });
    const adapter = createMailAdapter();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.createMailProviderAdapter.mockReturnValue(adapter);

    const req = createRequest({
      body: {
        action: 'resend_verification',
        locale: 'zh-CN',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        status: 'sent',
        nextStep: 'enter_verification_code',
        sent: {
          current: true,
        },
      },
    });
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
    expect(adminClient.__mocks.challengeRpc).toHaveBeenCalledWith(
      'start_account_email_challenge',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_target_email: 'current@example.com',
        p_reason: 'user_requested',
        p_token_hash: expect.any(String),
        p_token_expires_at: expect.any(String),
        p_code_hash: expect.any(String),
        p_code_expires_at: expect.any(String),
      })
    );
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0]).toMatchObject({
      to: 'current@example.com',
      templateKey: 'auth.email-verification',
      eventType: 'email_verification',
    });
    expect(adapter.sentMessages[0].payload).toMatchObject({
      verificationMode: 'account_security_state',
      codeEntry: true,
    });
    expect(adapter.sentMessages[0].payload.tokenExpiresAt).toEqual(expect.any(String));
    expect(adapter.sentMessages[0].payload.codeExpiresAt).toEqual(expect.any(String));
    expect(adapter.sentMessages[0].html).toContain('验证码');
    expect(adapter.sentMessages[0].html).not.toContain('/api/account-email-verify?token=');
    expect(adapter.sentMessages[0].text).toContain('验证码: ');
    expect(adapter.sentMessages[0].text).not.toContain('/api/account-email-verify?token=');
  }));

  it('sends an app-level verification code for an unconfirmed current email', withAuthMailEnv(async () => {
    const adminClient = createAdminClient({
      accountSecurityState: {
        email_verification_required: false,
        email_verification_reason: 'oauth_email_setup_required',
        email_verification_requested_at: '2026-07-24T00:00:00.000Z',
        email_verification_verified_at: null,
        password_change_required: true,
        password_change_reason: 'oauth_password_setup_required',
      },
    });
    const adapter = createMailAdapter();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(createCallerClient({
      user: {
        id: 'user-1',
        email: 'current@example.com',
        email_confirmed_at: null,
        confirmed_at: null,
      },
    }));
    mocks.createMailProviderAdapter.mockReturnValue(adapter);

    const req = createRequest({
      body: {
        action: 'resend_verification',
        locale: 'zh-CN',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
    expect(adminClient.__mocks.challengeRpc).toHaveBeenCalledWith(
      'start_account_email_challenge',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_target_email: 'current@example.com',
        p_token_hash: expect.any(String),
        p_code_hash: expect.any(String),
      })
    );
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0]).toMatchObject({
      to: 'current@example.com',
      templateKey: 'auth.email-verification',
      eventType: 'email_verification',
    });
    expect(adapter.sentMessages[0].payload).toMatchObject({
      verificationMode: 'account_security_state',
      codeEntry: true,
    });
    expect(adapter.sentMessages[0].text).toContain('验证码: ');
    expect(adapter.sentMessages[0].text).not.toContain('/api/account-email-verify?token=');
  }));

  it('keeps app-level verification code independent from malformed auth links', withAuthMailEnv(async () => {
    process.env.SUPABASE_URL = 'https://db.example.test';
    const adminClient = createAdminClient({
      generateLinkImpl: async () => ({
        data: {
          properties: {
            action_link: 'http://localhost:8000,https:/auth/v1/verify?token=current-token&type=magiclink&redirect_to=https%3A%2F%2Fef-gacha.example',
          },
        },
        error: null,
      }),
    });
    const adapter = createMailAdapter();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.createSupabaseAccessTokenClient.mockReturnValue(createCallerClient({
      user: {
        id: 'user-1',
        email: 'current@example.com',
        email_confirmed_at: null,
        confirmed_at: null,
      },
    }));
    mocks.createMailProviderAdapter.mockReturnValue(adapter);

    const req = createRequest({
      body: {
        action: 'resend_verification',
        locale: 'zh-CN',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toContain('验证码: ');
    expect(adapter.sentMessages[0].text).not.toContain('localhost:8000');
  }));

  it('respects runtime disabled mail events for account email actions', withAuthMailEnv(async () => {
    const adminClient = createAdminClient({
      mailRuntimeConfig: {
        version: 1,
        events: {
          authMailActions: true,
        },
        controls: {
          killSwitch: null,
          disabledEvents: ['email_change'],
          pausedDomains: [],
        },
      },
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);

    const req = createRequest({
      body: {
        action: 'change_email',
        newEmail: 'new@example.com',
        currentPassword: 'CurrentPass123',
      },
    });
    const res = createJsonResponseRecorder();

    await accountEmailActionHandler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'mail_event_disabled',
    });
    expect(adminClient.__mocks.generateLink).not.toHaveBeenCalled();
  }));
});
