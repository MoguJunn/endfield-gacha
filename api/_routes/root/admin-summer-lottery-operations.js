import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { consumeLotteryRateLimit } from '../../_lib/lotteryRateLimit.js';
import { requireSuperAdminUser } from '../../_lib/siteAuth.js';
import {
  drawSummerLotteryAsOperator,
  getSummerLotterySeed,
  loadSummerLotteryOperationStatus,
  prepareSummerLotteryAsOperator,
} from '../../_lib/summerLotteryOperations.js';

const DEFAULT_CAMPAIGN_ID = 'community-lottery';
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/u;
const ALLOWED_ACTIONS = new Set(['prepare', 'draw']);

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
  const normalized = String(
    value || process.env.LOTTERY_CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID,
  ).trim();
  return CAMPAIGN_ID_PATTERN.test(normalized) ? normalized : '';
}

function hasRequiredBrowserOrigin(req) {
  return Boolean(req.headers?.origin);
}

function expectedConfirmation(action, campaignId) {
  return `${action.toUpperCase()} ${campaignId}`;
}

function mapOperationError(error) {
  const message = String(error?.message || error?.code || '');
  const mappings = {
    campaign_not_found: [404, 'lottery_campaign_not_found'],
    campaign_already_has_entries: [409, 'campaign_already_has_entries'],
    seed_commitment_already_fixed: [409, 'seed_commitment_already_fixed'],
    campaign_already_drawn: [409, 'campaign_already_drawn'],
    draw_not_open: [409, 'draw_not_open'],
    campaign_has_no_entries: [409, 'campaign_has_no_entries'],
    seed_commitment_mismatch: [409, 'seed_commitment_mismatch'],
    public_randomness_unavailable: [503, 'public_randomness_unavailable'],
    public_randomness_invalid: [409, 'public_randomness_invalid'],
    public_randomness_config_invalid: [409, 'public_randomness_config_invalid'],
    lottery_draw_seed_not_configured: [503, 'lottery_draw_seed_not_configured'],
    lottery_rate_limit_not_configured: [503, 'lottery_rate_limit_not_configured'],
    lottery_rate_limit_unavailable: [503, 'lottery_rate_limit_unavailable'],
    lottery_operator_actor_required: [403, 'super_admin_required'],
    lottery_operator_role_required: [403, 'super_admin_required'],
  };
  for (const [needle, [status, code]] of Object.entries(mappings)) {
    if (message.includes(needle)) return { status, code };
  }
  return { status: 500, code: 'admin_lottery_operation_failed' };
}

async function loadStatus(adminClient, campaignId) {
  const status = await loadSummerLotteryOperationStatus(adminClient, campaignId);
  let seedConfigured = true;
  try {
    getSummerLotterySeed();
  } catch {
    seedConfigured = false;
  }
  return { ...status, seedConfigured };
}

export default async function adminSummerLotteryOperationsHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, POST, OPTIONS',
    headers: 'Content-Type, Authorization',
  })) return;
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return sendError(res, 405, 'Method not allowed', 'method_not_allowed');
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return sendError(
      res,
      503,
      'Supabase admin client is not configured',
      'supabase_admin_not_configured',
    );
  }
  const auth = await requireSuperAdminUser(req, { adminClient });
  if (!auth.ok) {
    return sendError(
      res,
      auth.status || 403,
      auth.error || 'Super admin role required',
      auth.code || 'super_admin_required',
    );
  }

  const body = req.method === 'POST' ? parseBody(req) : {};
  const requestUrl = new URL(
    req.url || '/api/admin-summer-lottery-operations',
    'http://localhost',
  );
  const campaignId = normalizeCampaignId(
    body.campaignId || requestUrl.searchParams.get('campaignId'),
  );
  if (!campaignId) return sendError(res, 400, '活动 ID 无效', 'invalid_campaign_id');

  if (req.method === 'GET') {
    try {
      return res.status(200).json({
        success: true,
        status: await loadStatus(adminClient, campaignId),
      });
    } catch (error) {
      const mapped = mapOperationError(error);
      return sendError(res, mapped.status, '无法读取抽奖操作状态', mapped.code);
    }
  }

  if (!hasRequiredBrowserOrigin(req)) {
    return sendError(
      res,
      403,
      'Origin required for sensitive operations',
      'origin_required',
    );
  }
  const action = String(body.action || '').trim().toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    return sendError(res, 400, '抽奖操作无效', 'invalid_lottery_operation');
  }
  if (String(body.confirmation || '').trim() !== expectedConfirmation(action, campaignId)) {
    return sendError(res, 400, '确认词不匹配', 'lottery_operation_confirmation_required');
  }

  try {
    const rateLimit = await consumeLotteryRateLimit(adminClient, {
      action: `admin_${action}`,
      identifiers: [auth.user.id],
      secret: process.env.LOTTERY_BACKEND_SECRET,
    });
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      return sendError(res, 429, '操作过于频繁，请稍后重试', 'rate_limited');
    }

    const operation = action === 'prepare'
      ? prepareSummerLotteryAsOperator
      : drawSummerLotteryAsOperator;
    await operation(adminClient, {
      actorUserId: auth.user.id,
      campaignId,
    });
    let status;
    try {
      status = await loadStatus(adminClient, campaignId);
    } catch {
      return res.status(200).json({
        success: true,
        operation: action,
        status: null,
        statusRefreshRequired: true,
      });
    }
    return res.status(200).json({
      success: true,
      operation: action,
      status,
    });
  } catch (error) {
    const mapped = mapOperationError(error);
    return sendError(res, mapped.status, '抽奖操作未执行', mapped.code);
  }
}
