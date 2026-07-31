// @vitest-environment node

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drawSummerLotteryAsOperator,
  getSummerLotterySeed,
  loadSummerLotteryOperationStatus,
  prepareSummerLotteryAsOperator,
} from '../_lib/summerLotteryOperations.js';

const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const CAMPAIGN_ID = 'community-lottery';
const DRAW_SEED = 'main-site-private-draw-seed-with-at-least-43-characters';
const QUICKNET_CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const QUICKNET_RANDOMNESS = 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd';
const QUICKNET_SIGNATURE = 'b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39';

function createCampaignClient(campaign, rpc = vi.fn()) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: campaign, error: null });
  return {
    client: {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      rpc,
    },
    maybeSingle,
  };
}

describe('summer lottery short-session operations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires a strong main-site-only draw seed', () => {
    expect(() => getSummerLotterySeed({ LOTTERY_DRAW_SEED: 'weak' }))
      .toThrow('lottery_draw_seed_not_configured');
    expect(getSummerLotterySeed({ LOTTERY_DRAW_SEED: DRAW_SEED })).toBe(DRAW_SEED);
  });

  it('prepares through the audited operator wrapper without sending the seed', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { campaignId: CAMPAIGN_ID, status: 'open' },
      error: null,
    });
    const result = await prepareSummerLotteryAsOperator({ rpc }, {
      actorUserId: ACTOR_ID,
      campaignId: CAMPAIGN_ID,
      seed: DRAW_SEED,
    });

    expect(result.status).toBe('open');
    expect(rpc).toHaveBeenCalledWith('prepare_summer_lottery_as_operator', {
      p_campaign_id: CAMPAIGN_ID,
      p_seed_commitment: createHash('sha256').update(DRAW_SEED).digest('hex'),
      p_actor_user_id: ACTOR_ID,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(DRAW_SEED);
  });

  it('verifies the fixed Quicknet BLS beacon before the audited draw wrapper', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        round: 1000,
        randomness: QUICKNET_RANDOMNESS,
        signature: QUICKNET_SIGNATURE,
      }),
    }));
    const rpc = vi.fn().mockResolvedValue({
      data: { campaignId: CAMPAIGN_ID, drawnAt: '2026-07-27T00:00:00.000Z' },
      error: null,
    });
    const { client } = createCampaignClient({
      public_randomness_chain: QUICKNET_CHAIN,
      public_randomness_round: 1000,
    }, rpc);

    await drawSummerLotteryAsOperator(client, {
      actorUserId: ACTOR_ID,
      campaignId: CAMPAIGN_ID,
      seed: DRAW_SEED,
    });

    expect(rpc).toHaveBeenCalledWith('draw_summer_lottery_as_operator', {
      p_campaign_id: CAMPAIGN_ID,
      p_seed: DRAW_SEED,
      p_beacon_round: 1000,
      p_beacon_randomness: QUICKNET_RANDOMNESS,
      p_beacon_signature: QUICKNET_SIGNATURE,
      p_actor_user_id: ACTOR_ID,
    });
  });

  it('rejects a forged beacon before any draw RPC', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        round: 1000,
        randomness: QUICKNET_RANDOMNESS,
        signature: `a${QUICKNET_SIGNATURE.slice(1)}`,
      }),
    }));
    const rpc = vi.fn();
    const { client } = createCampaignClient({
      public_randomness_chain: QUICKNET_CHAIN,
      public_randomness_round: 1000,
    }, rpc);

    await expect(drawSummerLotteryAsOperator(client, {
      actorUserId: ACTOR_ID,
      campaignId: CAMPAIGN_ID,
      seed: DRAW_SEED,
    })).rejects.toThrow('public_randomness_invalid');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns only public-safe operation status fields', async () => {
    const { client } = createCampaignClient({
      id: CAMPAIGN_ID,
      status: 'drawn',
      starts_at: '2026-07-01T00:00:00.000Z',
      closes_at: '2026-07-20T00:00:00.000Z',
      draws_at: '2026-07-21T00:00:00.000Z',
      drawn_at: '2026-07-21T00:00:01.000Z',
      seed_commitment: 'a'.repeat(64),
      public_randomness_chain: QUICKNET_CHAIN,
      public_randomness_round: 1000,
      candidate_manifest_hash: 'b'.repeat(64),
    });

    const status = await loadSummerLotteryOperationStatus(client, CAMPAIGN_ID);
    expect(status.phase).toBe('drawn');
    expect(JSON.stringify(status)).not.toContain(DRAW_SEED);
    expect(status).not.toHaveProperty('seedReveal');
  });
});
