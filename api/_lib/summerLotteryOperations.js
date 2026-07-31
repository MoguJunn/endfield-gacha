import { createHash } from 'node:crypto';
import { QUICKNET_CHAIN_INFO, verifyQuicknetBeacon } from './drandVerification.js';

const DEFAULT_CAMPAIGN_ID = 'community-lottery';
const DRAND_RELAY = 'https://drand.cloudflare.com';
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/u;
const STRONG_SEED_MIN_LENGTH = 43;

function operationError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeCampaignId(value) {
  const normalized = String(
    value || process.env.LOTTERY_CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID,
  ).trim();
  if (!CAMPAIGN_ID_PATTERN.test(normalized)) throw operationError('invalid_campaign_id');
  return normalized;
}

function getCampaignPhase(campaign) {
  if (!campaign) return 'unavailable';
  if (campaign.status === 'cancelled') return 'cancelled';
  if (campaign.drawn_at || campaign.status === 'drawn') return 'drawn';
  const now = Date.now();
  if (now < new Date(campaign.starts_at).getTime()) return 'scheduled';
  if (!campaign.seed_commitment) return 'preparing';
  if (now < new Date(campaign.closes_at).getTime()) return 'open';
  if (now < new Date(campaign.draws_at).getTime()) return 'waiting_draw';
  return 'ready_to_draw';
}

export function getSummerLotterySeed(env = process.env) {
  const seed = String(env.LOTTERY_DRAW_SEED || '').trim().slice(0, 8192);
  if (seed.length < STRONG_SEED_MIN_LENGTH || seed.includes('replace-')) {
    throw operationError('lottery_draw_seed_not_configured');
  }
  return seed;
}

export async function loadSummerLotteryOperationStatus(adminClient, campaignId) {
  const normalizedCampaignId = normalizeCampaignId(campaignId);
  const { data, error } = await adminClient
    .from('summer_lottery_campaigns')
    .select([
      'id',
      'status',
      'starts_at',
      'closes_at',
      'draws_at',
      'drawn_at',
      'seed_commitment',
      'public_randomness_chain',
      'public_randomness_round',
      'candidate_manifest_hash',
    ].join(','))
    .eq('id', normalizedCampaignId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw operationError('campaign_not_found');
  return {
    campaignId: data.id,
    phase: getCampaignPhase(data),
    startsAt: data.starts_at,
    closesAt: data.closes_at,
    drawsAt: data.draws_at,
    drawnAt: data.drawn_at,
    seedCommitment: data.seed_commitment,
    publicRandomnessChain: data.public_randomness_chain,
    publicRandomnessRound: data.public_randomness_round,
    candidateManifestHash: data.candidate_manifest_hash,
  };
}

export async function fetchVerifiedSummerLotteryBeacon(adminClient, campaignId) {
  const normalizedCampaignId = normalizeCampaignId(campaignId);
  const { data: campaign, error } = await adminClient
    .from('summer_lottery_campaigns')
    .select('public_randomness_chain,public_randomness_round')
    .eq('id', normalizedCampaignId)
    .maybeSingle();
  if (error) throw error;
  const chainHash = String(campaign?.public_randomness_chain || '').trim().toLowerCase();
  const round = Number(campaign?.public_randomness_round);
  if (
    chainHash !== QUICKNET_CHAIN_INFO.hash
    || !Number.isSafeInteger(round)
    || round <= 0
  ) throw operationError('public_randomness_config_invalid');

  let response;
  try {
    response = await fetch(`${DRAND_RELAY}/${chainHash}/public/${round}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw operationError('public_randomness_unavailable');
  }
  const beacon = await response.json().catch(() => null);
  const randomness = String(beacon?.randomness || '').trim().toLowerCase();
  const signature = String(beacon?.signature || '').trim().toLowerCase();
  const valid = response.ok && await verifyQuicknetBeacon({
    chainHash,
    round: beacon?.round,
    randomness,
    signature,
  });
  if (!valid || Number(beacon?.round) !== round) {
    throw operationError('public_randomness_invalid');
  }
  return { round, randomness, signature };
}

export async function prepareSummerLotteryAsOperator(adminClient, {
  actorUserId,
  campaignId,
  seed = getSummerLotterySeed(),
}) {
  const normalizedCampaignId = normalizeCampaignId(campaignId);
  const seedCommitment = createHash('sha256').update(seed, 'utf8').digest('hex');
  const { data, error } = await adminClient.rpc('prepare_summer_lottery_as_operator', {
    p_campaign_id: normalizedCampaignId,
    p_seed_commitment: seedCommitment,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
  return data;
}

export async function drawSummerLotteryAsOperator(adminClient, {
  actorUserId,
  campaignId,
  seed = getSummerLotterySeed(),
}) {
  const normalizedCampaignId = normalizeCampaignId(campaignId);
  const beacon = await fetchVerifiedSummerLotteryBeacon(adminClient, normalizedCampaignId);
  const { data, error } = await adminClient.rpc('draw_summer_lottery_as_operator', {
    p_campaign_id: normalizedCampaignId,
    p_seed: seed,
    p_beacon_round: beacon.round,
    p_beacon_randomness: beacon.randomness,
    p_beacon_signature: beacon.signature,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
  return data;
}
