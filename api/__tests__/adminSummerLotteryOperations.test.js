// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumeLotteryRateLimit: vi.fn(),
  drawSummerLotteryAsOperator: vi.fn(),
  getSummerLotterySeed: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
  loadSummerLotteryOperationStatus: vi.fn(),
  prepareSummerLotteryAsOperator: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  requireSuperAdminUser: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));
vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));
vi.mock('../_lib/lotteryRateLimit.js', () => ({
  consumeLotteryRateLimit: mocks.consumeLotteryRateLimit,
}));
vi.mock('../_lib/siteAuth.js', () => ({
  requireSuperAdminUser: mocks.requireSuperAdminUser,
}));
vi.mock('../_lib/summerLotteryOperations.js', () => ({
  drawSummerLotteryAsOperator: mocks.drawSummerLotteryAsOperator,
  getSummerLotterySeed: mocks.getSummerLotterySeed,
  loadSummerLotteryOperationStatus: mocks.loadSummerLotteryOperationStatus,
  prepareSummerLotteryAsOperator: mocks.prepareSummerLotteryAsOperator,
}));

import handler from '../_routes/root/admin-summer-lottery-operations.js';

const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
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
    url: '/api/admin-summer-lottery-operations',
    body,
    headers: {
      cookie: '__Host-eg_session=redacted',
      ...(origin ? { origin } : {}),
    },
  };
}

describe('admin summer lottery operations API', () => {
  const adminClient = { rpc: vi.fn(), from: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LOTTERY_BACKEND_SECRET = 's'.repeat(43);
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.requireSuperAdminUser.mockResolvedValue({
      ok: true,
      source: 'site_session',
      user: { id: ACTOR_ID },
    });
    mocks.consumeLotteryRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      retryAfter: 0,
    });
    mocks.getSummerLotterySeed.mockReturnValue('configured-redacted-seed');
    mocks.loadSummerLotteryOperationStatus.mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      phase: 'preparing',
      seedCommitment: null,
    });
    mocks.prepareSummerLotteryAsOperator.mockResolvedValue({ campaignId: CAMPAIGN_ID });
    mocks.drawSummerLotteryAsOperator.mockResolvedValue({ campaignId: CAMPAIGN_ID });
  });

  afterEach(() => {
    delete process.env.LOTTERY_BACKEND_SECRET;
  });

  it('rejects callers without a short-lived super-admin identity', async () => {
    mocks.requireSuperAdminUser.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Super admin role required',
      code: 'super_admin_required',
    });
    const res = createResponse();
    await handler(createRequest(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('super_admin_required');
    expect(mocks.loadSummerLotteryOperationStatus).not.toHaveBeenCalled();
  });

  it('returns operation status without exposing the private seed', async () => {
    const res = createResponse();
    await handler(createRequest(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status.seedConfigured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('configured-redacted-seed');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('requires Origin and an exact campaign-scoped confirmation', async () => {
    const noOrigin = createResponse();
    await handler(createRequest('POST', {
      action: 'prepare',
      confirmation: `PREPARE ${CAMPAIGN_ID}`,
    }), noOrigin);
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.body.code).toBe('origin_required');

    mocks.requireSuperAdminUser.mockResolvedValue({
      ok: true,
      source: 'supabase_access_token',
      user: { id: ACTOR_ID },
    });
    const bearerWithoutOrigin = createResponse();
    await handler(createRequest('POST', {
      action: 'prepare',
      confirmation: `PREPARE ${CAMPAIGN_ID}`,
    }), bearerWithoutOrigin);
    expect(bearerWithoutOrigin.statusCode).toBe(403);
    expect(bearerWithoutOrigin.body.code).toBe('origin_required');

    const badConfirmation = createResponse();
    await handler(createRequest('POST', {
      action: 'prepare',
      confirmation: 'PREPARE',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), badConfirmation);
    expect(badConfirmation.statusCode).toBe(400);
    expect(badConfirmation.body.code).toBe('lottery_operation_confirmation_required');
    expect(mocks.prepareSummerLotteryAsOperator).not.toHaveBeenCalled();
  });

  it('prepares with the authenticated actor and an atomic audit wrapper', async () => {
    const res = createResponse();
    await handler(createRequest('POST', {
      action: 'prepare',
      confirmation: `PREPARE ${CAMPAIGN_ID}`,
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(mocks.consumeLotteryRateLimit).toHaveBeenCalledWith(adminClient, {
      action: 'admin_prepare',
      identifiers: [ACTOR_ID],
      secret: 's'.repeat(43),
    });
    expect(mocks.prepareSummerLotteryAsOperator).toHaveBeenCalledWith(adminClient, {
      actorUserId: ACTOR_ID,
      campaignId: CAMPAIGN_ID,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.operation).toBe('prepare');
  });

  it('draws only through the authenticated operator path', async () => {
    mocks.loadSummerLotteryOperationStatus.mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      phase: 'drawn',
    });
    const res = createResponse();
    await handler(createRequest('POST', {
      action: 'draw',
      confirmation: `DRAW ${CAMPAIGN_ID}`,
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(mocks.drawSummerLotteryAsOperator).toHaveBeenCalledWith(adminClient, {
      actorUserId: ACTOR_ID,
      campaignId: CAMPAIGN_ID,
    });
    expect(mocks.prepareSummerLotteryAsOperator).not.toHaveBeenCalled();
    expect(res.body.status.phase).toBe('drawn');
  });

  it('reports a concurrent operator demotion as an authorization failure', async () => {
    mocks.prepareSummerLotteryAsOperator.mockRejectedValue(
      new Error('lottery_operator_role_required'),
    );
    const res = createResponse();
    await handler(createRequest('POST', {
      action: 'prepare',
      confirmation: `PREPARE ${CAMPAIGN_ID}`,
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('super_admin_required');
  });

  it('does not misreport a committed operation when status refresh fails', async () => {
    mocks.loadSummerLotteryOperationStatus.mockRejectedValue(
      new Error('temporary_status_failure'),
    );
    const res = createResponse();
    await handler(createRequest('POST', {
      action: 'prepare',
      confirmation: `PREPARE ${CAMPAIGN_ID}`,
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(mocks.prepareSummerLotteryAsOperator).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      operation: 'prepare',
      status: null,
      statusRefreshRequired: true,
    });
  });

  it('returns database Retry-After without executing an operation', async () => {
    mocks.consumeLotteryRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfter: 45,
    });
    const res = createResponse();
    await handler(createRequest('POST', {
      action: 'draw',
      confirmation: `DRAW ${CAMPAIGN_ID}`,
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('45');
    expect(mocks.drawSummerLotteryAsOperator).not.toHaveBeenCalled();
  });
});
