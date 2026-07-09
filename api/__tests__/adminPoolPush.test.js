// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  requireSuperAdminUser: vi.fn(),
}));
const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: fsMocks.readFileSync,
  },
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));

vi.mock('../_lib/siteAuth.js', () => ({
  requireSuperAdminUser: mocks.requireSuperAdminUser,
}));

import adminPoolPushHandler from '../_routes/root/admin-pool-push.js';

const ENV_KEYS = [
  'QQBOT_POOL_PUSH_ENABLED',
  'QQBOT_POOL_PUSH_WEBHOOK_URL',
  'QQBOT_POOL_PUSH_WEBHOOK_SECRET',
  'QQBOT_POOL_PUSH_TIMEOUT_MS',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

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

function createRequest({ method = 'POST', headers = { authorization: 'Bearer test-token' }, body } = {}) {
  return {
    method,
    url: '/api/admin-pool-push',
    headers,
    body,
  };
}

function configureEnabledPoolPush() {
  process.env.QQBOT_POOL_PUSH_ENABLED = 'true';
  process.env.QQBOT_POOL_PUSH_WEBHOOK_URL = 'http://127.0.0.1:8787';
  process.env.QQBOT_POOL_PUSH_WEBHOOK_SECRET = 'bot-admin-secret';
  process.env.QQBOT_POOL_PUSH_TIMEOUT_MS = '5000';
}

async function callHandler(body) {
  const req = createRequest({ body });
  const res = createJsonResponseRecorder();
  await adminPoolPushHandler(req, res);
  return res;
}

describe('adminPoolPushHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV_KEYS.forEach((key) => {
      delete process.env[key];
    });
    fsMocks.readFileSync.mockReturnValue('QQBOT_POOL_PUSH_WEBHOOK_SECRET=local-file-secret\n');
    mocks.getSupabaseAdminClient.mockReturnValue({ from: vi.fn() });
    mocks.requireSuperAdminUser.mockResolvedValue({ ok: true, user: { id: 'admin-1' } });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (ORIGINAL_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = ORIGINAL_ENV[key];
      }
    });
    vi.unstubAllGlobals();
  });

  it('requires the feature flag before proxying to the QQ Bot', async () => {
    const res = await callHandler({ action: 'previewPoolPush' });

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: 'pool_push_disabled' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('requires a super admin user', async () => {
    configureEnabledPoolPush();
    mocks.requireSuperAdminUser.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'super_admin_required',
      error: 'Super admin role required',
    });

    const res = await callHandler({ action: 'previewPoolPush' });

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'super_admin_required' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('proxies pool push previews to the QQ Bot preview endpoint', async () => {
    configureEnabledPoolPush();
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({
        title: '预览',
        dedupeKey: 'pool-update:test',
        confirmationToken: 'signed-preview-token',
      }), { status: 200 })
    );

    const res = await callHandler({
      action: 'previewPoolPush',
      pool: {
        pool_id: 'pool-limited-1',
        name: '逐罪者',
        type: 'limited_character',
        upItems: ['卡缪'],
        start_time: '2026-06-26T12:00:00+08:00',
        end_time: '2026-07-16T06:00:00+08:00',
      },
      selectedTargets: [
        { platform: 'qq', adapter: 'napcat-personal-demo', scene: 'group', targetHash: 'group-hash' },
        { platform: 'qq', adapter: 'napcat-personal-demo', scene: 'group', targetHash: '' },
      ],
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { dedupeKey: 'pool-update:test', confirmationToken: 'signed-preview-token' },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/v1/admin/pool-updates/preview',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-qqbot-admin-secret': 'bot-admin-secret',
        }),
      })
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      targetPolicy: 'admin_selected_groups',
      pool: {
        id: 'pool-limited-1',
        name: '逐罪者',
        type: 'limited',
        upItems: ['卡缪'],
        startsAt: '2026-06-26T12:00:00+08:00',
        endsAt: '2026-07-16T06:00:00+08:00',
      },
      selectedTargets: [{ platform: 'qq', adapter: 'napcat-personal-demo', scene: 'group', targetHash: 'group-hash' }],
    });
  });

  it('falls back to .env.local when the inherited pool push secret is not header-safe', async () => {
    configureEnabledPoolPush();
    process.env.QQBOT_POOL_PUSH_WEBHOOK_SECRET = '中文密钥';
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ title: '预览', dedupeKey: 'pool-update:test' }), { status: 200 })
    );

    const res = await callHandler({ action: 'previewPoolPush' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { dedupeKey: 'pool-update:test' } });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/v1/admin/pool-updates/preview',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-qqbot-admin-secret': 'local-file-secret',
        }),
      })
    );
  });

  it('proxies confirmed sends to the QQ Bot confirm endpoint', async () => {
    configureEnabledPoolPush();
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ sentCount: 1, skippedCount: 0, failedCount: 0 }), { status: 200 })
    );

    const res = await callHandler({
      action: 'sendPoolPush',
      confirmationToken: 'signed-preview-token',
      dedupeKey: 'pool-update:must-not-be-forwarded',
      pool: { id: 'pool-must-not-be-forwarded', name: '不应转发' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { sentCount: 1 } });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/v1/admin/pool-updates/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-qqbot-admin-secret': 'bot-admin-secret',
        }),
      })
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      confirmationToken: 'signed-preview-token',
    });
  });

  it('rejects confirmed sends without a preview confirmation token', async () => {
    configureEnabledPoolPush();

    const res = await callHandler({ action: 'sendPoolPush', dedupeKey: 'pool-update:test' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'confirmation_token_required' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves confirmation token errors returned by the QQ Bot', async () => {
    configureEnabledPoolPush();
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: 'expired_confirmation_token' }), { status: 400 })
    );

    const res = await callHandler({ action: 'sendPoolPush', confirmationToken: 'expired-token' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'expired_confirmation_token',
      code: 'expired_confirmation_token',
    });
  });
});
