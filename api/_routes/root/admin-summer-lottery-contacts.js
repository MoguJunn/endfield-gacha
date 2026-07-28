import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { decryptLotteryContact } from '../../_lib/lotteryContactCrypto.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import {
  LOTTERY_CONTACT_PURGE_CAPABILITY,
  LOTTERY_CONTACT_READ_CAPABILITY,
  requireLotteryOperatorCapability,
} from '../../_lib/lotteryOperatorAuth.js';

const DEFAULT_CAMPAIGN_ID = 'community-lottery';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/u;
const READ_REASONS = new Set(['winner_notification', 'claim_follow_up']);
const DELETE_REASONS = new Set(['manual_privacy_request']);

const REASON_LABELS = {
  winner_notification: 'winner_notification',
  claim_follow_up: 'claim_follow_up',
  manual_privacy_request: 'manual_privacy_request',
};

function sendError(res, status, error, code = error) {
  return res.status(status).json({ success: false, error, code });
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return typeof req.body === 'object' ? req.body : {};
}

function normalizeCampaignId(value) {
  const normalized = String(value || process.env.LOTTERY_CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID).trim();
  return CAMPAIGN_ID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeEntryId(value) {
  const normalized = String(value || '').trim();
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeReason(value, allowedReasons) {
  const normalized = String(value || '').trim();
  return allowedReasons.has(normalized) ? REASON_LABELS[normalized] : '';
}

function hasRequiredBrowserOrigin(req) {
  return Boolean(req.headers?.origin);
}

function mapRpcError(error) {
  const message = String(error?.message || '');
  const mappings = {
    campaign_not_found: [404, 'lottery_campaign_not_found'],
    contact_entry_not_available: [404, 'lottery_contact_not_found'],
    contact_already_cleared: [409, 'lottery_contact_cleared'],
    contact_retention_expired: [410, 'lottery_contact_expired'],
    invalid_contact_access_request: [400, 'invalid_lottery_contact_request'],
    invalid_contact_purge_request: [400, 'invalid_lottery_contact_request'],
    lottery_operator_capability_required: [403, 'lottery_operator_capability_required'],
  };
  for (const [needle, [status, code]] of Object.entries(mappings)) {
    if (message.includes(needle)) return { status, code };
  }
  return { status: 500, code: 'admin_lottery_contact_request_failed' };
}

function mapDecryptError(error) {
  const code = String(error?.code || '');
  if (code === 'lottery_contact_encryption_not_configured'
      || code === 'lottery_contact_encryption_key_unavailable') {
    return { status: 503, code };
  }
  return { status: 422, code: 'lottery_contact_read_failed' };
}

async function listTargets(adminClient, campaignId, actorUserId, res) {
  const [{ data, error }, purgeCapability] = await Promise.all([
    adminClient.rpc('list_summer_lottery_contact_targets', {
      p_campaign_id: campaignId,
      p_actor_user_id: actorUserId,
    }),
    adminClient.rpc('has_summer_lottery_operator_capability', {
      p_campaign_id: campaignId,
      p_user_id: actorUserId,
      p_capability: LOTTERY_CONTACT_PURGE_CAPABILITY,
    }),
  ]);
  if (error) {
    const mapped = mapRpcError(error);
    return sendError(res, mapped.status, '无法读取中奖联系方式状态', mapped.code);
  }
  return res.status(200).json({
    success: true,
    campaign: {
      campaignId: data?.campaignId || campaignId,
      contactRetentionUntil: data?.contactRetentionUntil || null,
      contactsClearedAt: data?.contactsClearedAt || null,
    },
    permissions: {
      canRead: true,
      canPurge: !purgeCapability.error && purgeCapability.data === true,
    },
    targets: Array.isArray(data?.targets) ? data.targets : [],
  });
}

async function readContact(adminClient, actorUserId, body, res) {
  const entryId = normalizeEntryId(body.entryId);
  const reason = normalizeReason(body.reason, READ_REASONS);
  if (!entryId || !reason) {
    return sendError(res, 400, '读取目标或用途无效', 'invalid_lottery_contact_request');
  }

  const { data, error } = await adminClient.rpc('read_summer_lottery_contact', {
    p_entry_id: entryId,
    p_actor_user_id: actorUserId,
    p_reason: reason,
  });
  if (error) {
    const mapped = mapRpcError(error);
    return sendError(res, mapped.status, '无法读取中奖联系方式', mapped.code);
  }

  let contactValue;
  try {
    contactValue = decryptLotteryContact(data?.contactValue, {
      campaignId: data?.campaignId,
      contactType: data?.contactType,
    });
  } catch (decryptError) {
    const mapped = mapDecryptError(decryptError);
    return sendError(res, mapped.status, '联系方式解密失败', mapped.code);
  }

  return res.status(200).json({
    success: true,
    contact: {
      entryId: data.entryId,
      campaignId: data.campaignId,
      contactType: data.contactType,
      contactValue,
      claimStatus: data.claimStatus || 'pending',
      contactRetentionUntil: data.contactRetentionUntil || null,
    },
  });
}

async function purgeContact(adminClient, actorUserId, body, res) {
  const entryId = normalizeEntryId(body.entryId);
  const reason = normalizeReason(body.reason, DELETE_REASONS);
  if (!entryId || !reason) {
    return sendError(res, 400, '删除目标或用途无效', 'invalid_lottery_contact_request');
  }

  const { data, error } = await adminClient.rpc('purge_summer_lottery_contact', {
    p_entry_id: entryId,
    p_actor_user_id: actorUserId,
    p_reason: reason,
  });
  if (error) {
    const mapped = mapRpcError(error);
    return sendError(res, mapped.status, '无法删除中奖联系方式', mapped.code);
  }
  return res.status(200).json({
    success: true,
    result: {
      entryId: data?.entryId || entryId,
      campaignId: data?.campaignId || null,
      cleared: data?.cleared === true,
    },
  });
}

export default async function adminSummerLotteryContactsHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, POST, DELETE, OPTIONS',
    headers: 'Content-Type, Authorization',
  })) return;
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return sendError(res, 405, 'Method not allowed', 'method_not_allowed');
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return sendError(res, 503, 'Supabase admin client is not configured', 'supabase_admin_not_configured');
  }
  const body = req.method === 'GET' ? {} : parseBody(req);
  const requestUrl = new URL(
    req.url || '/api/admin-summer-lottery-contacts',
    'http://localhost',
  );
  const campaignId = normalizeCampaignId(
    body.campaignId || requestUrl.searchParams.get('campaignId'),
  );
  if (!campaignId) return sendError(res, 400, '活动 ID 无效', 'invalid_campaign_id');

  const capability = req.method === 'DELETE'
    ? LOTTERY_CONTACT_PURGE_CAPABILITY
    : LOTTERY_CONTACT_READ_CAPABILITY;
  const auth = await requireLotteryOperatorCapability(req, {
    adminClient,
    campaignId,
    capability,
  });
  if (!auth.ok) {
    return sendError(
      res,
      auth.status || 403,
      auth.error || 'Lottery operator capability required',
      auth.code || 'lottery_operator_capability_required',
    );
  }
  if (req.method !== 'GET' && !hasRequiredBrowserOrigin(req)) {
    return sendError(res, 403, 'Origin required for sensitive operations', 'origin_required');
  }

  if (req.method === 'GET') {
    return listTargets(adminClient, campaignId, auth.user.id, res);
  }

  if (req.method === 'POST') return readContact(adminClient, auth.user.id, body, res);
  return purgeContact(adminClient, auth.user.id, body, res);
}
