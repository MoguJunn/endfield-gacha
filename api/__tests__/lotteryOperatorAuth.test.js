// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  resolveAuthenticatedRequestUser: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));
vi.mock('../_lib/siteAuth.js', () => ({
  resolveAuthenticatedRequestUser: mocks.resolveAuthenticatedRequestUser,
}));

import {
  LOTTERY_CONTACT_READ_CAPABILITY,
  requireLotteryOperatorCapability,
} from '../_lib/lotteryOperatorAuth.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN_ID = 'community-lottery';

describe('lottery operator capability authorization', () => {
  let adminClient;

  beforeEach(() => {
    vi.clearAllMocks();
    adminClient = { rpc: vi.fn() };
    mocks.getSupabaseAdminClient.mockReturnValue(adminClient);
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      source: 'site_session',
      user: { id: USER_ID },
      adminClient,
    });
  });

  it('passes through authentication failures without querying capabilities', async () => {
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: false,
      status: 401,
      code: 'missing_access_token',
    });

    const result = await requireLotteryOperatorCapability({}, {
      adminClient,
      campaignId: CAMPAIGN_ID,
      capability: LOTTERY_CONTACT_READ_CAPABILITY,
    });

    expect(result).toMatchObject({ ok: false, status: 401, code: 'missing_access_token' });
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it('accepts an explicitly granted campaign-scoped capability', async () => {
    adminClient.rpc.mockResolvedValue({ data: true, error: null });

    const result = await requireLotteryOperatorCapability({}, {
      adminClient,
      campaignId: CAMPAIGN_ID,
      capability: LOTTERY_CONTACT_READ_CAPABILITY,
    });

    expect(adminClient.rpc).toHaveBeenCalledWith(
      'has_summer_lottery_operator_capability',
      {
        p_campaign_id: CAMPAIGN_ID,
        p_user_id: USER_ID,
        p_capability: LOTTERY_CONTACT_READ_CAPABILITY,
      },
    );
    expect(result).toMatchObject({
      ok: true,
      campaignId: CAMPAIGN_ID,
      capability: LOTTERY_CONTACT_READ_CAPABILITY,
    });
  });

  it('does not let the global profile role imply a lottery capability', async () => {
    mocks.resolveAuthenticatedRequestUser.mockResolvedValue({
      ok: true,
      source: 'site_session',
      user: { id: USER_ID },
      profile: { role: 'super_admin' },
      adminClient,
    });
    adminClient.rpc.mockResolvedValue({ data: false, error: null });

    const result = await requireLotteryOperatorCapability({}, {
      adminClient,
      campaignId: CAMPAIGN_ID,
      capability: LOTTERY_CONTACT_READ_CAPABILITY,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: 'lottery_operator_capability_required',
    });
  });

  it('fails closed when the database capability check is unavailable', async () => {
    adminClient.rpc.mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    });

    const result = await requireLotteryOperatorCapability({}, {
      adminClient,
      campaignId: CAMPAIGN_ID,
      capability: LOTTERY_CONTACT_READ_CAPABILITY,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      code: 'lottery_operator_capability_check_failed',
    });
  });

  it('rejects capabilities outside the contact allowlist before database access', async () => {
    const result = await requireLotteryOperatorCapability({}, {
      adminClient,
      campaignId: CAMPAIGN_ID,
      capability: 'draw',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: 'invalid_lottery_operator_capability_request',
    });
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });
});
