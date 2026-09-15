// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumeLotteryRateLimit: vi.fn(),
  decryptLotteryContact: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));
vi.mock('../_lib/lotteryContactCrypto.js', () => ({
  decryptLotteryContact: mocks.decryptLotteryContact,
}));
vi.mock('../_lib/lotteryRateLimit.js', () => ({
  consumeLotteryRateLimit: mocks.consumeLotteryRateLimit,
}));

import handler from '../_routes/root/admin-summer-lottery-contact-export.js';

const EXPORT_TOKEN = 'x'.repeat(43);
const CAMPAIGN_ID = 'arknights-p3r-collab-2026';

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

function createRequest(token = EXPORT_TOKEN) {
  return {
    method: 'POST',
    headers: token ? { 'x-lottery-export-token': token } : {},
    body: {
      campaignId: CAMPAIGN_ID,
      confirmation: `EXPORT ${CAMPAIGN_ID}`,
    },
  };
}

function createQuery(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    insert: vi.fn(() => Promise.resolve(result)),
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return query;
}

describe('one-time lottery contact export', () => {
  let queries;
  let adminClient;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LOTTERY_ONE_TIME_EXPORT_TOKEN = EXPORT_TOKEN;
    process.env.LOTTERY_BACKEND_SECRET = 'backend-secret-for-test-only-and-long-enough';
    queries = {
      summer_lottery_campaigns: createQuery({
        data: {
          id: CAMPAIGN_ID,
          contact_retention_until: '2099-10-16T04:00:03.000Z',
          contacts_cleared_at: null,
        },
        error: null,
      }),
      profiles: createQuery({ data: [{ id: 'actor-id' }], error: null }),
      summer_lottery_entries: createQuery({
        data: [{
          id: 'entry-id',
          entry_number: 89,
          contact_type: 'qq',
          contact_value: 'encrypted-contact',
          notification_confirmed_at: '2026-09-15T00:00:00.000Z',
          eligible: true,
          created_at: '2026-09-01T00:00:00.000Z',
        }],
        count: 1,
        error: null,
      }),
      summer_lottery_winners: createQuery({
        data: [{
          entry_id: 'entry-id',
          prize_tier: 'first',
          winner_order: 1,
          claim_status: 'pending',
        }],
        error: null,
      }),
      summer_lottery_operation_audit: createQuery({ data: null, error: null }),
    };
    adminClient = { from: vi.fn((table) => queries[table]) };
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.consumeLotteryRateLimit.mockResolvedValue({ allowed: true });
    mocks.decryptLotteryContact.mockReturnValue('123456789');
  });

  afterEach(() => {
    delete process.env.LOTTERY_ONE_TIME_EXPORT_TOKEN;
    delete process.env.LOTTERY_BACKEND_SECRET;
  });

  it('fails closed without the one-time token', async () => {
    const res = createResponse();
    await handler(createRequest(''), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('export_authorization_required');
    expect(mocks.getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it('exports only required fields and writes an immutable audit row', async () => {
    const res = createResponse();
    await handler(createRequest(), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body.contacts).toEqual([{
      lotteryNumber: 'P3R26-000089',
      entryNumber: 89,
      qq: '123456789',
      eligible: true,
      notificationConfirmedAt: '2026-09-15T00:00:00.000Z',
      prizeTier: 'first',
      winnerOrder: 1,
      claimStatus: 'pending',
      enteredAt: '2026-09-01T00:00:00.000Z',
    }]);
    expect(JSON.stringify(res.body)).not.toContain('encrypted-contact');
    expect(queries.summer_lottery_operation_audit.insert).toHaveBeenCalledWith({
      campaign_id: CAMPAIGN_ID,
      actor_user_id: 'actor-id',
      operation: 'contact_export',
    });
  });
});
