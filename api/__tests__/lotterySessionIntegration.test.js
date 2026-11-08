// @vitest-environment node
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { applyLotterySessionIntegration } from '../../scripts/lottery-session-integration.mjs';

vi.mock('open-lottery/api/_lib/provider.js', () => ({ callLotteryProvider: vi.fn(), createProviderPowChallenge: vi.fn() }));

let handler;
const primary = 'https://ef-gacha.mogujun.icu';
const backup = 'https://ef.nepst.cn';
const request = (origin, path, method = 'GET') => ({
  url: path, method, headers: { host: new URL(origin).host, 'x-forwarded-proto': 'https', ...(method === 'GET' ? {} : { origin }) }, body: {},
});
function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    getHeader(key) { return this.headers[key]; },
    status(status) { this.statusCode = status; return this; },
    json(body) { this.body = body; return this; },
    end() {},
  };
}

describe('integrated lottery session routes', () => {
  beforeAll(async () => {
    const root = resolve(import.meta.dirname, '../..');
    await applyLotterySessionIntegration(root, resolve(root, 'node_modules/open-lottery'));
    handler = (await import('open-lottery/api/router.js')).default;
  });
  beforeEach(() => {
    vi.stubEnv('MAIN_SITE_URL', primary);
    vi.stubEnv('LOTTERY_SITE_URL', `${primary}/lottery`);
    vi.stubEnv('LOTTERY_SESSION_SECRET', 's'.repeat(50));
    vi.stubEnv('LOTTERY_BACKEND_SECRET', 'b'.repeat(50));
    vi.stubEnv('LOTTERY_PROVIDER', 'main-site');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([primary, backup])('starts SSO on the current approved host %s', async origin => {
    const res = response();
    await handler(request(origin, '/api/auth/sso/start'), res);
    const target = new URL(res.headers.Location);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe('/api/summer-lottery-sso/start');
    expect(target.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(res.headers['Set-Cookie']).toBeDefined();
    expect(process.env.LOTTERY_SITE_URL).toBe(`${primary}/lottery`);
  });

  it.each([primary, backup])('accepts same-host POST validation but still requires login on %s', async origin => {
    const res = response();
    await handler(request(origin, '/api/lottery/enter', 'POST'), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('login_required');
  });

  it('rejects a cross-domain POST even when both hosts are valid site domains', async () => {
    const req = request(backup, '/api/lottery/enter', 'POST');
    req.headers.origin = primary;
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('origin_not_allowed');
  });

  it('does not accept an unapproved origin', async () => {
    const res = response();
    await handler(request('https://attacker.example', '/api/lottery/enter', 'POST'), res);
    expect(res.statusCode).toBe(403);
  });
});
