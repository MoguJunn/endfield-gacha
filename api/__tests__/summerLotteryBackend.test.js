// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptLotteryContact, isLotteryContactEnvelope } from '../_lib/lotteryContactCrypto.js';

const mocks = vi.hoisted(() => ({
  consumeLotteryRateLimit: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: mocks.getSupabaseAdminClient }));
vi.mock('../_lib/lotteryRateLimit.js', () => ({
  consumeLotteryRateLimit: mocks.consumeLotteryRateLimit,
}));

import summerLotteryBackendHandler from '../_routes/root/summer-lottery-backend.js';

const SECRET = 'backend-secret-which-is-at-least-forty-three-characters-long';
const ADMIN_SECRET = 'admin-backend-secret-which-is-at-least-forty-three-characters';
const HASH = 'a'.repeat(64);
const CONTACT_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64url');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function request(action, payload = {}, token = SECRET) {
  return {
    method: 'POST',
    body: { version: 1, action, payload },
    headers: {
      authorization: `Bearer ${token}`,
      'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

describe('summer lottery private backend gateway', () => {
  beforeEach(() => {
    process.env.LOTTERY_BACKEND_SECRET = SECRET;
    process.env.LOTTERY_ADMIN_BACKEND_SECRET = ADMIN_SECRET;
    process.env.LOTTERY_CONTACT_ENCRYPTION_ACTIVE_KEY_ID = 'test-current';
    process.env.LOTTERY_CONTACT_ENCRYPTION_KEYS_JSON = JSON.stringify({ 'test-current': CONTACT_KEY });
    process.env.AUTH_CAPTCHA_MODE = 'off';
    mocks.consumeLotteryRateLimit.mockReset();
    mocks.consumeLotteryRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfter: 0,
    });
    mocks.getSupabaseAdminClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LOTTERY_BACKEND_SECRET;
    delete process.env.LOTTERY_ADMIN_BACKEND_SECRET;
    delete process.env.LOTTERY_CONTACT_ENCRYPTION_ACTIVE_KEY_ID;
    delete process.env.LOTTERY_CONTACT_ENCRYPTION_KEYS_JSON;
    delete process.env.AUTH_CAPTCHA_MODE;
    delete process.env.AUTH_CAPTCHA_REQUIRED_ACTIONS;
    delete process.env.AUTH_CAPTCHA_SECRET_KEY;
  });

  it('rejects requests without the dedicated gateway secret', async () => {
    const response = responseRecorder();
    await summerLotteryBackendHandler(request('health', {}, 'wrong'), response);
    expect(response.statusCode).toBe(401);
    expect(response.body.error.code).toBe('lottery_backend_unauthorized');
    expect(mocks.getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('rejects unsupported contract versions and user secrets on admin actions', async () => {
    const versionResponse = responseRecorder();
    const versionRequest = request('health');
    versionRequest.body.version = 2;
    await summerLotteryBackendHandler(versionRequest, versionResponse);
    expect(versionResponse.statusCode).toBe(400);
    expect(versionResponse.body.error.code).toBe('gateway_contract_version_unsupported');

    const adminResponse = responseRecorder();
    await summerLotteryBackendHandler(request('draw', { seed: 'private-seed' }, SECRET), adminResponse);
    expect(adminResponse.statusCode).toBe(401);
    expect(mocks.getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('blocks over-budget requests using the shared database limiter', async () => {
    mocks.consumeLotteryRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 37,
    });
    const rpc = vi.fn();
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    const response = responseRecorder();

    await summerLotteryBackendHandler(request('health'), response);

    expect(mocks.consumeLotteryRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'gateway_health' }),
    );
    expect(response.statusCode).toBe(429);
    expect(response.headers['Retry-After']).toBe('37');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('only forwards hashed SSO material to the atomic exchange RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { userId: 'user-1', lotterySessionId: 'lottery-session-1' },
      error: null,
    });
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    const response = responseRecorder();

    await summerLotteryBackendHandler(request('exchange', {
      ticketHash: HASH,
      stateHash: HASH,
      audience: 'open-lottery',
      sessionTokenHash: HASH,
      csrfTokenHash: HASH,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requesterIp: '203.0.113.40',
    }), response);

    expect(response.statusCode).toBe(200);
    expect(mocks.consumeLotteryRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'gateway_exchange',
        identifiers: ['203.0.113.40'],
      }),
    );
    expect(rpc).toHaveBeenCalledWith('exchange_summer_lottery_sso_ticket', expect.objectContaining({
      p_ticket_hash: HASH,
      p_state_hash: HASH,
      p_session_token_hash: HASH,
      p_csrf_token_hash: HASH,
    }));
  });

  it('maps controlled PostgreSQL exception messages to stable business errors', async () => {
    mocks.getSupabaseAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '55000', message: 'campaign_not_open' } }),
    });
    const response = responseRecorder();

    await summerLotteryBackendHandler(request('enter', {
      sessionTokenHash: HASH,
      csrfTokenHash: HASH,
      contactQq: '123456789',
      groupJoined: true,
    }), response);

    expect(response.statusCode).toBe(409);
    expect(response.body.error.code).toBe('campaign_not_open');
  });

  it('blocks entry when the required robot verification is missing', async () => {
    process.env.AUTH_CAPTCHA_MODE = 'enforce';
    process.env.AUTH_CAPTCHA_REQUIRED_ACTIONS = 'lottery_enter';
    process.env.AUTH_CAPTCHA_SECRET_KEY = 'turnstile-test-secret';
    const rpc = vi.fn();
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    const response = responseRecorder();

    await summerLotteryBackendHandler(request('enter', {
      sessionTokenHash: HASH,
      csrfTokenHash: HASH,
      contactQq: '123456789',
      groupJoined: true,
    }), response);

    expect(response.statusCode).toBe(403);
    expect(response.body.error.code).toBe('captcha_required');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('encrypts generic private contact details before the entry RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null });
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    const response = responseRecorder();

    await summerLotteryBackendHandler(request('enter', {
      sessionTokenHash: HASH,
      csrfTokenHash: HASH,
      contactType: 'qq',
      contactValue: '123456789',
      notificationConfirmed: true,
      requesterIp: '203.0.113.41',
    }), response);

    expect(response.statusCode).toBe(200);
    expect(mocks.consumeLotteryRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'gateway_enter',
        identifiers: [HASH],
      }),
    );
    const rpcPayload = rpc.mock.calls[0][1];
    expect(rpc).toHaveBeenCalledWith('enter_summer_lottery', expect.objectContaining({
      p_contact_type: 'qq',
      p_notification_confirmed: true,
    }));
    expect(isLotteryContactEnvelope(rpcPayload.p_contact_value)).toBe(true);
    expect(rpcPayload.p_contact_value).not.toContain('123456789');
    expect(decryptLotteryContact(rpcPayload.p_contact_value, {
      campaignId: 'community-lottery',
      contactType: 'qq',
    })).toBe('123456789');
  });

  it('fails closed before the entry RPC when contact encryption is not configured', async () => {
    delete process.env.LOTTERY_CONTACT_ENCRYPTION_ACTIVE_KEY_ID;
    delete process.env.LOTTERY_CONTACT_ENCRYPTION_KEYS_JSON;
    const rpc = vi.fn();
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    const response = responseRecorder();

    await summerLotteryBackendHandler(request('enter', {
      sessionTokenHash: HASH,
      csrfTokenHash: HASH,
      contactType: 'email',
      contactValue: 'winner@example.test',
      notificationConfirmed: true,
    }), response);

    expect(response.statusCode).toBe(503);
    expect(response.body.error.code).toBe('lottery_contact_encryption_not_configured');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fetches only the precommitted drand round and verifies it before drawing', async () => {
    const chain = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
    const randomness = 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd';
    const signature = 'b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ round: 1000, randomness, signature }),
    }));
    const rpc = vi.fn().mockResolvedValue({ data: { campaignId: 'community-lottery' }, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { public_randomness_chain: chain, public_randomness_round: 1000 },
      error: null,
    });
    mocks.getSupabaseAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      rpc,
    });
    const response = responseRecorder();

    await summerLotteryBackendHandler(request('draw', { seed: 'private-seed' }, ADMIN_SECRET), response);

    expect(fetch).toHaveBeenCalledWith(
      `https://drand.cloudflare.com/${chain}/public/1000`,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(rpc).toHaveBeenCalledWith('draw_summer_lottery', expect.objectContaining({
      p_seed: 'private-seed',
      p_beacon_round: 1000,
      p_beacon_randomness: randomness,
      p_beacon_signature: signature,
    }));
    expect(response.statusCode).toBe(200);
  });

  it('rejects a forged drand signature before the draw RPC', async () => {
    const chain = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        round: 1000,
        randomness: 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
        signature: 'a44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39',
      }),
    }));
    const rpc = vi.fn();
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { public_randomness_chain: chain, public_randomness_round: 1000 },
      error: null,
    });
    mocks.getSupabaseAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      rpc,
    });
    const response = responseRecorder();

    await summerLotteryBackendHandler(request('draw', { seed: 'private-seed' }, ADMIN_SECRET), response);

    expect(response.statusCode).toBe(409);
    expect(response.body.error.code).toBe('public_randomness_invalid');
    expect(rpc).not.toHaveBeenCalled();
  });
});
