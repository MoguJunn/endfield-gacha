import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { requireSuperAdminUser } from '../../_lib/siteAuth.js';

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

function normalizeText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

async function loadAdminAnomalies(adminClient, req) {
  const url = new URL(req.url || '/api/admin-history-anomalies', 'http://localhost');
  const status = normalizeText(url.searchParams.get('status'), 40) || 'pending';
  const allowedStatuses = new Set(['pending', 'confirmed', 'resolved', 'deleted', 'dismissed', 'all']);
  if (!allowedStatuses.has(status)) {
    const error = new Error('异常记录状态筛选无效');
    error.statusCode = 400;
    error.code = 'invalid_anomaly_status';
    throw error;
  }

  let query = adminClient
    .from('history_anomalies')
    .select('*')
    .order('detected_at', { ascending: false })
    .limit(500);
  if (status !== 'all') query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  const anomalies = Array.isArray(data) ? data : [];
  const userIds = [...new Set(anomalies.map((item) => item.user_id).filter(Boolean))];
  let profiles = [];
  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } = await adminClient
      .from('profiles')
      .select('id, username, email')
      .in('id', userIds);
    if (profileError) throw profileError;
    profiles = Array.isArray(profileRows) ? profileRows : [];
  }
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return anomalies.map((anomaly) => ({
    ...anomaly,
    user: profileById.get(anomaly.user_id) || null,
  }));
}

async function updateAdminAnomaly(adminClient, adminUserId, req, res) {
  const body = parseBody(req);
  const anomalyId = normalizeText(body.anomalyId || body.id, 160);
  const action = normalizeText(body.action, 40);
  const note = normalizeText(body.note, 500);
  const statusByAction = {
    resolve: 'resolved',
    dismiss: 'dismissed',
    reopen: 'pending',
  };
  const nextStatus = statusByAction[action];
  if (!anomalyId || !nextStatus) {
    return sendError(res, 400, '管理员审阅操作无效', 'invalid_admin_anomaly_action');
  }

  const now = new Date().toISOString();
  const payload = nextStatus === 'pending'
    ? {
        status: 'pending',
        postponed_until: null,
        resolved_at: null,
        resolved_by: null,
        resolution_note: note || '管理员重新打开核对',
      }
    : {
        status: nextStatus,
        postponed_until: null,
        resolved_at: now,
        resolved_by: adminUserId,
        resolution_note: note || (nextStatus === 'resolved' ? '管理员已处理' : '管理员判断无需继续处理'),
      };

  const { data, error } = await adminClient
    .from('history_anomalies')
    .update(payload)
    .eq('id', anomalyId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return sendError(res, 404, '没有找到该异常记录', 'history_anomaly_not_found');
  return res.status(200).json({ success: true, anomaly: data });
}

export default async function adminHistoryAnomaliesHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, PATCH, OPTIONS',
    headers: 'Content-Type, Authorization',
  })) return;
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return sendError(res, 405, 'Method not allowed', 'method_not_allowed');
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) return sendError(res, 503, 'Supabase admin client is not configured', 'supabase_admin_not_configured');
  const auth = await requireSuperAdminUser(req, { adminClient });
  if (!auth.ok) {
    return sendError(res, auth.status || 403, auth.error || 'Super admin role required', auth.code || 'super_admin_required');
  }

  try {
    if (req.method === 'PATCH') {
      return await updateAdminAnomaly(adminClient, auth.user.id, req, res);
    }
    const anomalies = await loadAdminAnomalies(adminClient, req);
    return res.status(200).json({ success: true, anomalies, count: anomalies.length });
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 500,
      error.message || '管理员异常审阅请求失败',
      error.code || 'admin_history_anomaly_request_failed'
    );
  }
}
