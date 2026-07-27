// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumeLotteryRateLimit: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
  loadSiteSession: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/lotteryRateLimit.js', () => ({
  consumeLotteryRateLimit: mocks.consumeLotteryRateLimit,
}));

vi.mock('../_lib/siteSession.js', async () => {
  const actual = await vi.importActual('../_lib/siteSession.js');
  return { ...actual, loadSiteSession: mocks.loadSiteSession };
});

import summerLotterySsoStartHandler from '../_routes/root/summer-lottery-sso.js';

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

function createRequest({ state = '', cookie = '' } = {}) {
  return {
    method: 'GET',
    query: state ? { state } : {},
    headers: {
      host: 'main.example.com',
      'x-forwarded-proto': 'https',
      cookie,
    },
  };
}

describe('summer lottery SSO start', () => {
  beforeEach(() => {
    process.env.VITE_APP_URL = 'https://main.example.com';
    process.env.LOTTERY_SITE_URL = 'https://lottery.example.com';
    process.env.LOTTERY_SSO_AUDIENCE = 'summer-lottery-2026';
    process.env.LOTTERY_BACKEND_SECRET = 's'.repeat(43);
    mocks.consumeLotteryRateLimit.mockReset();
    mocks.consumeLotteryRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfter: 0,
    });
    mocks.getSupabaseAdminClient.mockReset();
    mocks.loadSiteSession.mockReset();
  });

  afterEach(() => {
    delete process.env.VITE_APP_URL;
    delete process.env.LOTTERY_SITE_URL;
    delete process.env.LOTTERY_SSO_AUDIENCE;
    delete process.env.LOTTERY_BACKEND_SECRET;
  });

  it('returns malformed state to the activity page without reading a main-site session', async () => {
    const response = createResponse();
    await summerLotterySsoStartHandler(createRequest({ state: 'too-short' }), response);
    expect(response.statusCode).toBe(303);
    expect(response.headers.Location).toBe('https://lottery.example.com/?auth=state_error');
    expect(mocks.loadSiteSession).not.toHaveBeenCalled();
  });

  it('stores pending state in a host-only cookie before opening login', async () => {
    const state = 'A'.repeat(43);
    mocks.getSupabaseAdminClient.mockReturnValue({ from: vi.fn() });
    mocks.loadSiteSession.mockResolvedValue({ ok: true, authenticated: false });
    const response = createResponse();

    await summerLotterySsoStartHandler(createRequest({ state }), response);

    expect(response.statusCode).toBe(303);
    expect(response.headers.Location).toBe('https://main.example.com/?summer_lottery_login=1');
    expect(response.headers['Set-Cookie']).toContain(`__Host-eg_summer_lottery_sso=${state}`);
    expect(response.headers['Set-Cookie']).toContain('HttpOnly');
    expect(response.headers['Set-Cookie']).toContain('Secure');
  });

  it('shares SSO rate-limit state across server instances', async () => {
    const state = 'R'.repeat(43);
    mocks.getSupabaseAdminClient.mockReturnValue({ from: vi.fn() });
    mocks.consumeLotteryRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 41,
    });
    const response = createResponse();

    await summerLotterySsoStartHandler(createRequest({ state }), response);

    expect(response.statusCode).toBe(303);
    expect(response.headers.Location).toBe('https://lottery.example.com/?auth=rate_error');
    expect(response.headers['Retry-After']).toBe('41');
    expect(mocks.loadSiteSession).not.toHaveBeenCalled();
  });

  it('issues only hashed ticket data and redirects with a non-request fragment', async () => {
    const state = 'B'.repeat(43);
    const insert = vi.fn().mockResolvedValue({ error: null });
    const adminClient = {
      from: vi.fn((table) => ({
        insert,
        delete: vi.fn(() => ({
          lt: vi.fn().mockResolvedValue({ error: null }),
          eq: vi.fn(() => ({ is: vi.fn().mockResolvedValue({ error: null }) })),
        })),
        table,
      })),
    };
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.loadSiteSession.mockResolvedValue({
      ok: true,
      authenticated: true,
      user: { id: '11111111-1111-4111-8111-111111111111' },
      session: { id: '22222222-2222-4222-8222-222222222222' },
    });
    const response = createResponse();

    await summerLotterySsoStartHandler(createRequest({ state }), response);

    expect(adminClient.from).toHaveBeenCalledWith('summer_lottery_sso_tickets');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      state_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      ticket_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      audience: 'summer-lottery-2026',
      user_id: '11111111-1111-4111-8111-111111111111',
      main_session_id: '22222222-2222-4222-8222-222222222222',
    }));
    expect(insert.mock.calls[0][0]).not.toHaveProperty('ticket');
    expect(response.statusCode).toBe(303);
    const target = new URL(response.headers.Location);
    expect(target.origin).toBe('https://lottery.example.com');
    expect(target.search).toBe('');
    const fragment = new URLSearchParams(target.hash.slice(1));
    expect(fragment.get('state')).toBe(state);
    expect(fragment.get('sso_ticket')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });
});
