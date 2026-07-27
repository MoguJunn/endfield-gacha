// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

import handler, { __internal } from '../_routes/root/summer-lottery-contact-retention.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function createRequest(method = 'GET', token = '') {
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

function createAdminClient(campaigns = []) {
  class Query {
    select() { return this; }
    in() { return this; }
    lte() { return this; }
    is() { return this; }
    order() { return this; }
    limit() { return this; }
    then(resolve) { return Promise.resolve({ data: campaigns, error: null }).then(resolve); }
  }
  return {
    from: vi.fn(() => new Query()),
    rpc: vi.fn(),
  };
}

describe('summer lottery contact retention worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  it('fails closed when the worker secret is not configured', () => {
    expect(__internal.authorizeRetentionWorker(createRequest(), {})).toEqual({
      ok: false,
      status: 503,
      code: 'retention_worker_not_configured',
    });
  });

  it('uses a constant-time bearer comparison for the cron request', () => {
    expect(__internal.authorizeRetentionWorker(createRequest('GET', 'wrong'), {
      CRON_SECRET: 'test-cron-secret',
    }).ok).toBe(false);
    expect(__internal.authorizeRetentionWorker(createRequest('GET', 'test-cron-secret'), {
      CRON_SECRET: 'test-cron-secret',
    })).toEqual({ ok: true });
  });

  it('purges each due campaign without exposing contact data', async () => {
    const adminClient = createAdminClient();
    adminClient.rpc
      .mockResolvedValueOnce({
        data: {
          campaignId: 'campaign-a',
          clearedCount: 3,
          contactsClearedAt: '2026-07-27T00:00:00.000Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: new Error('database unavailable') });
    const results = await __internal.purgeDueCampaigns(adminClient, [
      { id: 'campaign-a' },
      { id: 'campaign-b' },
    ]);
    expect(results).toEqual([
      {
        campaignId: 'campaign-a',
        success: true,
        clearedCount: 3,
        contactsClearedAt: '2026-07-27T00:00:00.000Z',
      },
      { campaignId: 'campaign-b', success: false, code: 'retention_purge_failed' },
    ]);
    expect(JSON.stringify(results)).not.toContain('contactValue');
  });

  it('runs the daily cleanup and returns aggregate counts', async () => {
    const adminClient = createAdminClient([{ id: 'campaign-a' }]);
    adminClient.rpc.mockResolvedValue({
      data: { campaignId: 'campaign-a', clearedCount: 2, contactsClearedAt: 'now' },
      error: null,
    });
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    const res = createResponse();
    await handler(createRequest('GET', 'test-cron-secret'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      dueCount: 1,
      failedCount: 0,
      clearedCount: 2,
      results: [{
        campaignId: 'campaign-a',
        success: true,
        clearedCount: 2,
        contactsClearedAt: 'now',
      }],
    });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('rejects unauthorized requests before creating an admin client', async () => {
    const res = createResponse();
    await handler(createRequest('GET', 'wrong'), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('retention_worker_unauthorized');
    expect(mocks.getSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
