// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  isLotteryOperatorCapability: vi.fn((value) => (
    value === 'contact_read' || value === 'contact_purge'
  )),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  requireSuperAdminUser: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));
vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));
vi.mock('../_lib/lotteryOperatorAuth.js', () => ({
  isLotteryOperatorCapability: mocks.isLotteryOperatorCapability,
}));
vi.mock('../_lib/siteAuth.js', () => ({
  requireSuperAdminUser: mocks.requireSuperAdminUser,
}));

import handler from '../_routes/root/admin-summer-lottery-permissions.js';

const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN_ID = 'community-lottery';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function createRequest(method = 'GET', body, { origin } = {}) {
  return {
    method,
    url: '/api/admin-summer-lottery-permissions',
    body,
    headers: {
      cookie: '__Host-eg_session=redacted',
      ...(origin ? { origin } : {}),
    },
  };
}

describe('admin summer lottery permissions API', () => {
  let adminClient;

  beforeEach(() => {
    vi.clearAllMocks();
    adminClient = { rpc: vi.fn() };
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.requireSuperAdminUser.mockResolvedValue({
      ok: true,
      source: 'site_session',
      user: { id: ACTOR_ID },
    });
  });

  it('allows only a current super-admin to manage operator grants', async () => {
    mocks.requireSuperAdminUser.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'super_admin_required',
      error: 'Super admin role required',
    });
    const res = createResponse();
    await handler(createRequest(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('super_admin_required');
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('lists only safe active grant metadata through the audited wrapper', async () => {
    adminClient.rpc.mockResolvedValue({
      data: {
        campaignId: CAMPAIGN_ID,
        grants: [{
          userId: TARGET_ID,
          username: '兑奖专员',
          capability: 'contact_read',
          grantedAt: '2026-07-26T00:00:00.000Z',
        }],
      },
      error: null,
    });
    const res = createResponse();
    await handler(createRequest(), res);

    expect(adminClient.rpc).toHaveBeenCalledWith(
      'list_summer_lottery_operator_grants',
      {
        p_campaign_id: CAMPAIGN_ID,
        p_actor_user_id: ACTOR_ID,
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.grants[0]).toMatchObject({
      userId: TARGET_ID,
      capability: 'contact_read',
    });
    expect(JSON.stringify(res.body)).not.toContain('contactValue');
  });

  it('requires Origin before changing a grant', async () => {
    const res = createResponse();
    await handler(createRequest('POST', {
      campaignId: CAMPAIGN_ID,
      targetUserId: TARGET_ID,
      capability: 'contact_read',
    }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('origin_required');
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('rejects capabilities outside the contact allowlist', async () => {
    const res = createResponse();
    await handler(createRequest('POST', {
      campaignId: CAMPAIGN_ID,
      targetUserId: TARGET_ID,
      capability: 'draw',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('invalid_lottery_operator_grant_request');
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('grants one campaign-scoped contact capability with the authenticated actor', async () => {
    adminClient.rpc
      .mockResolvedValueOnce({
        data: {
          campaignId: CAMPAIGN_ID,
          targetUserId: TARGET_ID,
          capability: 'contact_read',
          enabled: true,
          changed: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { grants: [] }, error: null });
    const res = createResponse();
    await handler(createRequest('POST', {
      campaignId: CAMPAIGN_ID,
      targetUserId: TARGET_ID,
      capability: 'contact_read',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(adminClient.rpc).toHaveBeenNthCalledWith(
      1,
      'set_summer_lottery_operator_capability',
      {
        p_campaign_id: CAMPAIGN_ID,
        p_target_user_id: TARGET_ID,
        p_capability: 'contact_read',
        p_enabled: true,
        p_actor_user_id: ACTOR_ID,
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toMatchObject({ enabled: true, changed: true });
  });

  it('revokes a capability without granting unrelated access', async () => {
    adminClient.rpc
      .mockResolvedValueOnce({
        data: {
          campaignId: CAMPAIGN_ID,
          targetUserId: TARGET_ID,
          capability: 'contact_purge',
          enabled: false,
          changed: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { grants: [] }, error: null });
    const res = createResponse();
    await handler(createRequest('DELETE', {
      campaignId: CAMPAIGN_ID,
      targetUserId: TARGET_ID,
      capability: 'contact_purge',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(adminClient.rpc).toHaveBeenNthCalledWith(
      1,
      'set_summer_lottery_operator_capability',
      expect.objectContaining({
        p_capability: 'contact_purge',
        p_enabled: false,
      }),
    );
    expect(res.body.result.enabled).toBe(false);
  });

  it('does not misreport a committed grant when the list refresh fails', async () => {
    adminClient.rpc
      .mockResolvedValueOnce({
        data: {
          campaignId: CAMPAIGN_ID,
          targetUserId: TARGET_ID,
          capability: 'contact_read',
          enabled: true,
          changed: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: 'refresh unavailable' } });
    const res = createResponse();
    await handler(createRequest('POST', {
      campaignId: CAMPAIGN_ID,
      targetUserId: TARGET_ID,
      capability: 'contact_read',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      grants: null,
      grantsRefreshRequired: true,
    });
  });
});
