import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { isLotteryOperatorCapability } from '../../_lib/lotteryOperatorAuth.js';
import { requireSuperAdminUser } from '../../_lib/siteAuth.js';

const DEFAULT_CAMPAIGN_ID = 'community-lottery';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/u;

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

function normalizeUserId(value) {
  const normalized = String(value || '').trim();
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function mapRpcError(error) {
  const message = String(error?.message || error?.code || '');
  const mappings = {
    campaign_not_found: [404, 'lottery_campaign_not_found'],
    lottery_operator_target_not_found: [404, 'lottery_operator_target_not_found'],
    lottery_operator_grant_admin_required: [403, 'super_admin_required'],
    invalid_lottery_operator_grant_request: [400, 'invalid_lottery_operator_grant_request'],
  };
  for (const [needle, [status, code]] of Object.entries(mappings)) {
    if (message.includes(needle)) return { status, code };
  }
  return { status: 500, code: 'lottery_operator_grant_failed' };
}

async function loadGrants(adminClient, campaignId, actorUserId) {
  const { data, error } = await adminClient.rpc('list_summer_lottery_operator_grants', {
    p_campaign_id: campaignId,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
  return Array.isArray(data?.grants) ? data.grants : [];
}

export default async function adminSummerLotteryPermissionsHandler(req, res) {
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

  const body = req.method === 'GET' ? {} : parseBody(req);
  const requestUrl = new URL(
    req.url || '/api/admin-summer-lottery-permissions',
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
        campaignId,
        grants: await loadGrants(adminClient, campaignId, auth.user.id),
      });
    } catch (error) {
      const mapped = mapRpcError(error);
      return sendError(res, mapped.status, '无法读取兑奖授权', mapped.code);
    }
  }

  if (!req.headers?.origin) {
    return sendError(res, 403, 'Origin required for sensitive operations', 'origin_required');
  }
  const targetUserId = normalizeUserId(body.targetUserId);
  const capability = String(body.capability || '').trim();
  if (!targetUserId || !isLotteryOperatorCapability(capability)) {
    return sendError(
      res,
      400,
      '兑奖授权参数无效',
      'invalid_lottery_operator_grant_request',
    );
  }

  const enabled = req.method === 'POST';
  try {
    const { data, error } = await adminClient.rpc(
      'set_summer_lottery_operator_capability',
      {
        p_campaign_id: campaignId,
        p_target_user_id: targetUserId,
        p_capability: capability,
        p_enabled: enabled,
        p_actor_user_id: auth.user.id,
      },
    );
    if (error) throw error;
    const result = {
      campaignId: data?.campaignId || campaignId,
      targetUserId: data?.targetUserId || targetUserId,
      capability: data?.capability || capability,
      enabled: data?.enabled === true,
      changed: data?.changed === true,
    };
    let grants;
    try {
      grants = await loadGrants(adminClient, campaignId, auth.user.id);
    } catch {
      return res.status(200).json({
        success: true,
        result,
        grants: null,
        grantsRefreshRequired: true,
      });
    }
    return res.status(200).json({
      success: true,
      result,
      grants,
    });
  } catch (error) {
    const mapped = mapRpcError(error);
    return sendError(res, mapped.status, '兑奖授权未修改', mapped.code);
  }
}
