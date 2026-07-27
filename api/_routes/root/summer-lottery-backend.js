import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { verifyAuthCaptcha } from '../../_lib/authSecurityGuards.js';
import { getRequesterKey } from '../../_lib/http.js';
import { encryptLotteryContact } from '../../_lib/lotteryContactCrypto.js';
import { QUICKNET_CHAIN_INFO, verifyQuicknetBeacon } from '../../_lib/drandVerification.js';
import { consumeLotteryRateLimit } from '../../_lib/lotteryRateLimit.js';

const CAMPAIGN_ID = normalizeString(process.env.LOTTERY_CAMPAIGN_ID || 'community-lottery', 100);
const LOTTERY_CAPTCHA_ACTION = 'lottery_enter';
const LOTTERY_GATEWAY_CONTRACT_VERSION = 1;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const ALLOWED_ACTIONS = new Set(['snapshot', 'exchange', 'enter', 'logout', 'prepare', 'draw', 'health']);
const DRAND_RELAY = 'https://drand.cloudflare.com';

function normalizeString(value, maxLength = 8192) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getBearerToken(req) {
  const authorization = normalizeString(req.headers?.authorization, 9000);
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
}

function sendJson(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(payload);
}

function sendError(res, status, code, message) {
  return sendJson(res, status, { success: false, error: { code, message } });
}

function requireHash(value, field) {
  const normalized = normalizeString(value, 64);
  if (!HASH_PATTERN.test(normalized)) {
    const error = new Error(`${field}_invalid`);
    error.code = `${field}_invalid`;
    throw error;
  }
  return normalized;
}

function requireContact(value, type) {
  const normalizedType = normalizeString(type || 'text', 32).toLowerCase();
  const normalizedValue = normalizeString(value, 254);
  const validType = /^[a-z][a-z0-9_-]{1,31}$/u.test(normalizedType);
  const validValue = normalizedType === 'qq'
    ? /^[1-9][0-9]{4,11}$/u.test(normalizedValue)
    : normalizedType === 'email'
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedValue)
      : normalizedValue.length >= 2;
  if (!validType || !validValue) {
    throw Object.assign(new Error('invalid_contact_value'), { code: 'invalid_contact_value' });
  }
  return { type: normalizedType, value: normalizedValue };
}

function getLotteryCaptchaEnvironment() {
  const configuredActions = String(process.env.AUTH_CAPTCHA_REQUIRED_ACTIONS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!configuredActions.includes(LOTTERY_CAPTCHA_ACTION)) {
    configuredActions.push(LOTTERY_CAPTCHA_ACTION);
  }
  return {
    ...process.env,
    AUTH_CAPTCHA_REQUIRED_ACTIONS: configuredActions.join(','),
  };
}

async function requireEntryCaptcha(payload) {
  const result = await verifyAuthCaptcha({
    action: LOTTERY_CAPTCHA_ACTION,
    token: payload.captchaToken,
    provider: payload.captchaProvider,
    powPayload: payload.powPayload,
    requesterIp: normalizeString(payload.requesterIp, 128),
    env: getLotteryCaptchaEnvironment(),
  });
  if (!result.ok) {
    const code = normalizeString(result.code, 80) || 'captcha_required';
    throw Object.assign(new Error(code), { code });
  }
}

function getCampaignPhase(campaign) {
  if (!campaign) return 'unavailable';
  if (campaign.status === 'cancelled') return 'cancelled';
  if (campaign.status === 'closed') return 'closed';
  if (campaign.drawn_at || campaign.status === 'drawn') return 'drawn';
  const now = Date.now();
  if (now < new Date(campaign.starts_at).getTime()) return 'scheduled';
  if (!campaign.seed_commitment) return 'preparing';
  if (now < new Date(campaign.closes_at).getTime()) return 'open';
  if (now < new Date(campaign.draws_at).getTime()) return 'waiting_draw';
  return 'ready_to_draw';
}

function maskDisplayName(value) {
  const characters = Array.from(normalizeString(value, 120));
  if (!characters.length) return '匿名参与者';
  if (characters.length <= 2) return `${characters[0]}*`;
  return `${characters[0]}${'*'.repeat(Math.min(4, characters.length - 2))}${characters.at(-1)}`;
}

async function loadSession(adminClient, sessionTokenHash, { touch = true } = {}) {
  if (!HASH_PATTERN.test(sessionTokenHash || '')) return null;
  const nowIso = new Date().toISOString();
  const { data: session, error } = await adminClient
    .from('summer_lottery_sessions')
    .select('id,user_id,source_main_session_id,csrf_token_hash,expires_at,last_seen_at')
    .eq('session_token_hash', sessionTokenHash)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle();
  if (error) throw error;
  if (!session?.user_id) return null;

  const { data: sourceSession, error: sourceError } = await adminClient
    .from('app_sessions')
    .select('id,user_id,expires_at,absolute_expires_at')
    .eq('id', session.source_main_session_id)
    .eq('user_id', session.user_id)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .gt('absolute_expires_at', nowIso)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!sourceSession?.id) {
    const { error: revokeError } = await adminClient
      .from('summer_lottery_sessions')
      .update({ revoked_at: nowIso, revoke_reason: 'source_main_session_invalid' })
      .eq('id', session.id);
    if (revokeError) throw revokeError;
    return null;
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id,username,role')
    .eq('id', session.user_id)
    .maybeSingle();
  if (profileError) throw profileError;

  if (touch) {
    const { error: touchError } = await adminClient
      .from('summer_lottery_sessions')
      .update({ last_seen_at: nowIso })
      .eq('id', session.id);
    if (touchError) throw touchError;
  }

  return {
    session,
    user: {
      id: session.user_id,
      username: profile?.username || `游客_${session.user_id.replaceAll('-', '').slice(0, 6)}`,
      role: profile?.role || 'user',
    },
  };
}

async function loadSnapshot(adminClient, sessionTokenHash = '') {
  const [{ data: campaign, error: campaignError }, { count, error: countError }] = await Promise.all([
    adminClient.from('summer_lottery_campaigns').select('*').eq('id', CAMPAIGN_ID).maybeSingle(),
    adminClient.from('summer_lottery_entries').select('id', { count: 'exact', head: true }).eq('campaign_id', CAMPAIGN_ID).eq('eligible', true),
  ]);
  if (campaignError) throw campaignError;
  if (countError) throw countError;
  if (!campaign) {
    const error = new Error('campaign_not_found');
    error.code = 'campaign_not_found';
    throw error;
  }

  const loadedSession = await loadSession(adminClient, sessionTokenHash);
  let entry = null;
  let ownWinner = null;
  if (loadedSession?.user?.id) {
    const { data: entryRow, error: entryError } = await adminClient
      .from('summer_lottery_entries')
      .select('id,public_id,entry_number,eligible,created_at')
      .eq('campaign_id', CAMPAIGN_ID)
      .eq('user_id', loadedSession.user.id)
      .maybeSingle();
    if (entryError) throw entryError;
    entry = entryRow ? {
      id: entryRow.id,
      publicId: entryRow.public_id,
      entryNumber: entryRow.entry_number,
      eligible: entryRow.eligible,
      createdAt: entryRow.created_at,
    } : null;

    if (campaign.drawn_at && entryRow) {
      if (!entryRow.eligible) {
        ownWinner = { prizeTier: 'ineligible', winnerOrder: null, claimStatus: 'ineligible' };
      } else {
        const { data: winner, error: winnerError } = await adminClient
          .from('summer_lottery_winners')
          .select('prize_tier,winner_order,claim_status')
          .eq('campaign_id', CAMPAIGN_ID)
          .eq('user_id', loadedSession.user.id)
          .maybeSingle();
        if (winnerError) throw winnerError;
        ownWinner = winner ? {
          prizeTier: winner.prize_tier,
          winnerOrder: winner.winner_order,
          claimStatus: winner.claim_status,
        } : { prizeTier: 'participation', winnerOrder: null, claimStatus: 'granted' };
      }
    }
  }

  let publicWinners = [];
  if (campaign.drawn_at) {
    const { data: winners, error: winnersError } = await adminClient
      .from('summer_lottery_winners')
      .select('entry_id,user_id,prize_tier,winner_order')
      .eq('campaign_id', CAMPAIGN_ID)
      .order('prize_tier')
      .order('winner_order');
    if (winnersError) throw winnersError;
    const userIds = (winners || []).map((item) => item.user_id);
    const entryIds = (winners || []).map((item) => item.entry_id);
    const [profileResult, entryResult] = await Promise.all([
      userIds.length
        ? adminClient.from('profiles').select('id,username').in('id', userIds)
        : Promise.resolve({ data: [], error: null }),
      entryIds.length
        ? adminClient.from('summer_lottery_entries').select('id,public_id,entry_number').in('id', entryIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (entryResult.error) throw entryResult.error;
    const profiles = new Map((profileResult.data || []).map((item) => [item.id, item]));
    const entries = new Map((entryResult.data || []).map((item) => [item.id, item]));
    publicWinners = (winners || []).map((winner) => ({
      prizeTier: winner.prize_tier,
      winnerOrder: winner.winner_order,
      entryNumber: entries.get(winner.entry_id)?.entry_number || null,
      publicId: entries.get(winner.entry_id)?.public_id || null,
      displayName: maskDisplayName(profiles.get(winner.user_id)?.username),
    }));
  }

  let publicCandidateIds = [];
  if (campaign.drawn_at) {
    const { data: candidates, error: candidatesError } = await adminClient
      .from('summer_lottery_entries')
      .select('public_id')
      .eq('campaign_id', CAMPAIGN_ID)
      .eq('eligible', true)
      .order('public_id');
    if (candidatesError) throw candidatesError;
    publicCandidateIds = (candidates || []).map((candidate) => candidate.public_id);
  }

  return {
    campaign: {
      id: campaign.id,
      title: campaign.title,
      startsAt: campaign.starts_at,
      closesAt: campaign.closes_at,
      drawsAt: campaign.draws_at,
      drawnAt: campaign.drawn_at,
      phase: getCampaignPhase(campaign),
      prizePlan: campaign.prize_plan || { first: 2, second: 2 },
      seedCommitment: campaign.seed_commitment,
      seedReveal: campaign.drawn_at ? campaign.seed_reveal : null,
      publicRandomnessChain: campaign.public_randomness_chain,
      publicRandomnessRound: campaign.public_randomness_round,
      publicRandomness: campaign.drawn_at ? campaign.public_randomness : null,
      publicRandomnessSignature: campaign.drawn_at ? campaign.public_randomness_signature : null,
      candidateManifestHash: campaign.drawn_at ? campaign.candidate_manifest_hash : null,
    },
    entryCount: count || 0,
    user: loadedSession?.user || null,
    entry,
    ownWinner,
    publicWinners,
    publicCandidateIds,
  };
}

async function fetchPublicRandomness(adminClient) {
  const { data: campaign, error } = await adminClient
    .from('summer_lottery_campaigns')
    .select('public_randomness_chain,public_randomness_round')
    .eq('id', CAMPAIGN_ID)
    .maybeSingle();
  if (error) throw error;
  const chain = normalizeString(campaign?.public_randomness_chain, 64);
  const round = Number(campaign?.public_randomness_round);
  if (chain !== QUICKNET_CHAIN_INFO.hash || !Number.isSafeInteger(round) || round <= 0) {
    throw Object.assign(new Error('public_randomness_config_invalid'), { code: 'public_randomness_config_invalid' });
  }
  let response;
  try {
    response = await fetch(`${DRAND_RELAY}/${chain}/public/${round}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw Object.assign(new Error('public_randomness_unavailable'), { code: 'public_randomness_unavailable' });
  }
  const beacon = await response.json().catch(() => null);
  const randomness = normalizeString(beacon?.randomness, 64).toLowerCase();
  const signature = normalizeString(beacon?.signature, 512).toLowerCase();
  const signatureValid = response.ok && await verifyQuicknetBeacon({
    chainHash: chain,
    round: beacon?.round,
    randomness,
    signature,
  });
  if (!signatureValid || Number(beacon?.round) !== round) {
    throw Object.assign(new Error('public_randomness_invalid'), { code: 'public_randomness_invalid' });
  }
  return { round, randomness, signature };
}

function normalizeRpcError(error) {
  const message = normalizeString(error?.message, 120);
  const businessCodes = new Set([
    'campaign_not_found', 'campaign_not_open', 'campaign_already_has_entries',
    'seed_commitment_already_fixed', 'campaign_already_drawn', 'draw_not_open',
    'campaign_has_no_entries', 'seed_commitment_mismatch', 'lottery_session_invalid',
    'source_main_session_invalid', 'invalid_lottery_session_material',
    'public_randomness_unavailable', 'public_randomness_invalid', 'public_randomness_config_invalid',
    'lottery_rate_limit_not_configured', 'lottery_rate_limit_unavailable',
    'invalid_contact_value', 'notification_confirmation_required',
    'lottery_contact_encryption_not_configured', 'lottery_contact_encryption_context_invalid',
    'captcha_required', 'captcha_failed', 'captcha_not_configured', 'captcha_verify_error',
    'pow_missing', 'pow_invalid_payload', 'pow_action_mismatch', 'pow_expired',
    'pow_bad_signature', 'pow_invalid_steps', 'pow_failed',
  ]);
  return {
    code: businessCodes.has(message) ? message : normalizeString(error?.code, 60) || 'lottery_backend_failed',
    message: businessCodes.has(message) ? message : 'lottery_backend_failed',
  };
}

async function runAction(adminClient, action, payload) {
  if (action === 'snapshot') {
    return loadSnapshot(adminClient, normalizeString(payload.sessionTokenHash, 64));
  }
  if (action === 'exchange') {
    const { data, error } = await adminClient.rpc('exchange_summer_lottery_sso_ticket', {
      p_ticket_hash: requireHash(payload.ticketHash, 'ticket_hash'),
      p_state_hash: requireHash(payload.stateHash, 'state_hash'),
      p_audience: normalizeString(payload.audience, 100),
      p_session_token_hash: requireHash(payload.sessionTokenHash, 'session_token_hash'),
      p_csrf_token_hash: requireHash(payload.csrfTokenHash, 'csrf_token_hash'),
      p_expires_at: normalizeString(payload.expiresAt, 80),
    });
    if (error) throw error;
    if (!data?.userId) {
      const ticketError = new Error('sso_ticket_invalid');
      ticketError.code = 'sso_ticket_invalid';
      throw ticketError;
    }
    return data;
  }
  if (action === 'enter') {
    const contact = requireContact(payload.contactValue || payload.contactQq, payload.contactType || 'qq');
    const notificationConfirmed = payload.notificationConfirmed === true || payload.groupJoined === true;
    if (String(process.env.LOTTERY_NOTIFICATION_REQUIRED || '').toLowerCase() === 'true' && !notificationConfirmed) {
      throw Object.assign(new Error('notification_confirmation_required'), { code: 'notification_confirmation_required' });
    }
    await requireEntryCaptcha(payload);
    const encryptedContactValue = encryptLotteryContact(contact.value, {
      campaignId: CAMPAIGN_ID,
      contactType: contact.type,
    });
    const { data, error } = await adminClient.rpc('enter_summer_lottery', {
      p_campaign_id: CAMPAIGN_ID,
      p_session_token_hash: requireHash(payload.sessionTokenHash, 'session_token_hash'),
      p_csrf_token_hash: requireHash(payload.csrfTokenHash, 'csrf_token_hash'),
      p_contact_type: contact.type,
      p_contact_value: encryptedContactValue,
      p_notification_confirmed: notificationConfirmed,
    });
    if (error) throw error;
    return data;
  }
  if (action === 'logout') {
    const nowIso = new Date().toISOString();
    const { data, error } = await adminClient
      .from('summer_lottery_sessions')
      .update({ revoked_at: nowIso, revoke_reason: 'user_logout' })
      .eq('session_token_hash', requireHash(payload.sessionTokenHash, 'session_token_hash'))
      .eq('csrf_token_hash', requireHash(payload.csrfTokenHash, 'csrf_token_hash'))
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) {
      const sessionError = new Error('lottery_session_invalid');
      sessionError.code = 'lottery_session_invalid';
      throw sessionError;
    }
    return { revoked: true };
  }
  if (action === 'prepare') {
    const { data, error } = await adminClient.rpc('prepare_summer_lottery', {
      p_campaign_id: CAMPAIGN_ID,
      p_seed_commitment: requireHash(payload.seedCommitment, 'seed_commitment'),
    });
    if (error) throw error;
    return data;
  }
  if (action === 'draw') {
    const seed = normalizeString(payload.seed, 8192);
    if (!seed) throw Object.assign(new Error('draw_seed_invalid'), { code: 'draw_seed_invalid' });
    const beacon = await fetchPublicRandomness(adminClient);
    const { data, error } = await adminClient.rpc('draw_summer_lottery', {
      p_campaign_id: CAMPAIGN_ID,
      p_seed: seed,
      p_beacon_round: beacon.round,
      p_beacon_randomness: beacon.randomness,
      p_beacon_signature: beacon.signature,
    });
    if (error) throw error;
    return data;
  }
  if (action === 'health') {
    const { data, error } = await adminClient
      .from('summer_lottery_campaigns')
      .select('id,seed_commitment')
      .eq('id', CAMPAIGN_ID)
      .maybeSingle();
    if (error) throw error;
    return { schemaReady: Boolean(data?.id), campaignPrepared: HASH_PATTERN.test(data?.seed_commitment || '') };
  }
  throw Object.assign(new Error('action_not_allowed'), { code: 'action_not_allowed' });
}

export default async function summerLotteryBackendHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
  }
  if (Number(req.body?.version) !== LOTTERY_GATEWAY_CONTRACT_VERSION) {
    return sendError(res, 400, 'gateway_contract_version_unsupported', 'Unsupported gateway contract version.');
  }
  const action = normalizeString(req.body?.action, 40);
  if (!ALLOWED_ACTIONS.has(action)) {
    return sendError(res, 400, 'action_not_allowed', 'Action not allowed.');
  }
  const adminAction = action === 'prepare' || action === 'draw';
  const expectedSecret = normalizeString(
    adminAction ? process.env.LOTTERY_ADMIN_BACKEND_SECRET : process.env.LOTTERY_BACKEND_SECRET,
    8192,
  );
  if (expectedSecret.length < 43 || expectedSecret.includes('replace-')) {
    return sendError(res, 503, 'lottery_backend_not_configured', 'Lottery backend is not configured.');
  }
  if (!safeEqual(getBearerToken(req), expectedSecret)) {
    return sendError(res, 401, 'lottery_backend_unauthorized', 'Unauthorized.');
  }
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return sendError(res, 503, 'supabase_admin_not_configured', 'Supabase admin client is not configured.');
  }
  try {
    const payload = req.body?.payload || {};
    const suppliedSubject = normalizeString(
      payload.sessionTokenHash || payload.ticketHash,
      64,
    );
    const requesterIdentifier = normalizeString(payload.requesterIp, 128)
      || getRequesterKey(req);
    const sessionScopedAction = action === 'enter' || action === 'logout';
    const rateLimitIdentifiers = sessionScopedAction && HASH_PATTERN.test(suppliedSubject)
      ? [suppliedSubject]
      : [requesterIdentifier];
    const rateLimit = await consumeLotteryRateLimit(adminClient, {
      action: `gateway_${action}`,
      identifiers: rateLimitIdentifiers,
      secret: expectedSecret,
    });
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      return sendError(res, 429, 'rate_limited', 'Too many requests.');
    }
    const data = await runAction(adminClient, action, payload);
    return sendJson(res, 200, { success: true, data });
  } catch (error) {
    const normalized = normalizeRpcError(error);
    const status = [
      'lottery_contact_encryption_not_configured',
      'lottery_rate_limit_not_configured',
      'lottery_rate_limit_unavailable',
    ].includes(normalized.code)
      ? 503
      : ['lottery_session_invalid', 'sso_ticket_invalid', 'source_main_session_invalid'].includes(normalized.code)
      ? 401
      : normalized.code.startsWith('captcha_') || normalized.code.startsWith('pow_')
        ? 403
        : ['invalid_contact_value', 'notification_confirmation_required'].includes(normalized.code)
          ? 400
          : 409;
    return sendError(res, status, normalized.code, normalized.message);
  }
}
