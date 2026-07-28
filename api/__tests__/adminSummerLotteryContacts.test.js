// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decryptLotteryContact: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  requireLotteryOperatorCapability: vi.fn(),
}));

vi.mock('../_lib/lotteryContactCrypto.js', () => ({
  decryptLotteryContact: mocks.decryptLotteryContact,
}));
vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));
vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));
vi.mock('../_lib/lotteryOperatorAuth.js', () => ({
  LOTTERY_CONTACT_PURGE_CAPABILITY: 'contact_purge',
  LOTTERY_CONTACT_READ_CAPABILITY: 'contact_read',
  requireLotteryOperatorCapability: mocks.requireLotteryOperatorCapability,
}));

import handler from '../_routes/root/admin-summer-lottery-contacts.js';

const ENTRY_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

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

function createRequest(method = 'GET', body, {
  url = '/api/admin-summer-lottery-contacts',
  origin,
} = {}) {
  return {
    method,
    url,
    body,
    headers: {
      cookie: '__Host-eg_session=redacted',
      ...(origin ? { origin } : {}),
    },
  };
}

function createAdminClient() {
  return { rpc: vi.fn() };
}

describe('admin summer lottery contacts API', () => {
  let adminClient;

  beforeEach(() => {
    vi.clearAllMocks();
    adminClient = createAdminClient();
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.requireLotteryOperatorCapability.mockResolvedValue({
      ok: true,
      source: 'site_session',
      user: { id: ACTOR_ID },
    });
    mocks.decryptLotteryContact.mockReturnValue('winner@example.test');
  });

  it('rejects callers without the campaign-scoped contact capability', async () => {
    mocks.requireLotteryOperatorCapability.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Lottery operator capability required',
      code: 'lottery_operator_capability_required',
    });
    const res = createResponse();
    await handler(createRequest(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('lottery_operator_capability_required');
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('lists winner metadata without returning a contact value', async () => {
    adminClient.rpc
      .mockResolvedValueOnce({
        data: {
          campaignId: 'community-lottery',
          contactRetentionUntil: '2026-09-24T12:00:00.000Z',
          contactsClearedAt: null,
          targets: [{ entryId: ENTRY_ID, contactType: 'email', contactAvailable: true }],
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const res = createResponse();
    await handler(createRequest('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.targets).toEqual([
      { entryId: ENTRY_ID, contactType: 'email', contactAvailable: true },
    ]);
    expect(res.body.permissions).toEqual({ canRead: true, canPurge: true });
    expect(JSON.stringify(res.body)).not.toContain('winner@example.test');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
    expect(mocks.requireLotteryOperatorCapability).toHaveBeenCalledWith(
      expect.anything(),
      {
        adminClient,
        campaignId: 'community-lottery',
        capability: 'contact_read',
      },
    );
    expect(adminClient.rpc).toHaveBeenCalledWith('list_summer_lottery_contact_targets', {
      p_campaign_id: 'community-lottery',
      p_actor_user_id: ACTOR_ID,
    });
  });

  it('audits through the RPC and returns only the decrypted single contact', async () => {
    adminClient.rpc.mockResolvedValue({
      data: {
        entryId: ENTRY_ID,
        campaignId: 'community-lottery',
        contactType: 'email',
        contactValue: 'olc1.current.encrypted.value.tag',
        claimStatus: 'pending',
        contactRetentionUntil: '2026-09-24T12:00:00.000Z',
      },
      error: null,
    });
    const res = createResponse();
    await handler(createRequest('POST', {
      entryId: ENTRY_ID,
      reason: 'winner_notification',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);

    expect(adminClient.rpc).toHaveBeenCalledWith('read_summer_lottery_contact', {
      p_entry_id: ENTRY_ID,
      p_actor_user_id: ACTOR_ID,
      p_reason: 'winner_notification',
    });
    expect(mocks.decryptLotteryContact).toHaveBeenCalledWith(
      'olc1.current.encrypted.value.tag',
      { campaignId: 'community-lottery', contactType: 'email' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.contact.contactValue).toBe('winner@example.test');
    expect(JSON.stringify(res.body)).not.toContain('olc1.current');
  });

  it('does not accept free-form audit reasons that may contain personal data', async () => {
    const res = createResponse();
    await handler(createRequest('POST', {
      entryId: ENTRY_ID,
      reason: 'send email to winner@example.test',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('invalid_lottery_contact_request');
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('requires an Origin for cookie-authenticated sensitive operations', async () => {
    const res = createResponse();
    await handler(createRequest('POST', {
      entryId: ENTRY_ID,
      reason: 'winner_notification',
    }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('origin_required');
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('fails closed without exposing the encrypted envelope when decryption fails', async () => {
    adminClient.rpc.mockResolvedValue({
      data: {
        entryId: ENTRY_ID,
        campaignId: 'community-lottery',
        contactType: 'email',
        contactValue: 'olc1.retired.encrypted.value.tag',
      },
      error: null,
    });
    const decryptError = new Error('retired key');
    decryptError.code = 'lottery_contact_encryption_key_unavailable';
    mocks.decryptLotteryContact.mockImplementation(() => { throw decryptError; });
    const res = createResponse();
    await handler(createRequest('POST', {
      entryId: ENTRY_ID,
      reason: 'claim_follow_up',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('lottery_contact_encryption_key_unavailable');
    expect(JSON.stringify(res.body)).not.toContain('olc1.retired');
  });

  it('purges only one selected contact for a fixed privacy reason', async () => {
    adminClient.rpc.mockResolvedValue({
      data: { entryId: ENTRY_ID, campaignId: 'community-lottery', cleared: true },
      error: null,
    });
    const res = createResponse();
    await handler(createRequest('DELETE', {
      entryId: ENTRY_ID,
      reason: 'manual_privacy_request',
    }, { origin: 'https://ef-gacha.mogujun.icu' }), res);
    expect(adminClient.rpc).toHaveBeenCalledWith('purge_summer_lottery_contact', {
      p_entry_id: ENTRY_ID,
      p_actor_user_id: ACTOR_ID,
      p_reason: 'manual_privacy_request',
    });
    expect(res.body.result).toEqual({
      entryId: ENTRY_ID,
      campaignId: 'community-lottery',
      cleared: true,
    });
    expect(mocks.requireLotteryOperatorCapability).toHaveBeenCalledWith(
      expect.anything(),
      {
        adminClient,
        campaignId: 'community-lottery',
        capability: 'contact_purge',
      },
    );
  });

  it('rejects disallowed methods before contacting the database', async () => {
    const res = createResponse();
    await handler(createRequest('PATCH'), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, POST, DELETE');
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });
});
