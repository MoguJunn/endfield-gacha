import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';

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

function getUrl(req) {
  return new URL(req.url || '/api/history-anomalies', 'http://localhost');
}

async function loadOwnAnomalies(adminClient, userId, req) {
  const url = getUrl(req);
  let query = adminClient
    .from('history_anomalies')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('detected_at', { ascending: false })
    .limit(500);

  const gameUid = normalizeText(url.searchParams.get('gameUid'), 160);
  const serverScope = normalizeText(url.searchParams.get('serverScope'), 160);
  const poolId = normalizeText(url.searchParams.get('poolId'), 160);
  if (gameUid) query = query.eq('game_uid', gameUid);
  if (serverScope) query = query.eq('server_scope', serverScope);
  if (poolId) query = query.eq('pool_id', poolId);

  const { data, error } = await query;
  if (error) throw error;
  const now = Date.now();
  return (Array.isArray(data) ? data : []).filter((item) => {
    const postponedUntil = Date.parse(item?.postponed_until || '');
    return !Number.isFinite(postponedUntil) || postponedUntil <= now;
  });
}

async function updateOwnAnomaly(adminClient, userId, req, res) {
  const body = parseBody(req);
  const anomalyId = normalizeText(body.anomalyId || body.id, 160);
  const action = normalizeText(body.action, 40);
  const note = normalizeText(body.note, 500);
  if (!anomalyId || !['confirm', 'postpone'].includes(action)) {
    return sendError(res, 400, '异常记录操作无效', 'invalid_anomaly_action');
  }

  const { data: anomaly, error: loadError } = await adminClient
    .from('history_anomalies')
    .select('*')
    .eq('id', anomalyId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();
  if (loadError) throw loadError;
  if (!anomaly) {
    return sendError(res, 404, '没有找到待核对记录，或它不属于当前用户', 'history_anomaly_not_found');
  }

  const now = new Date();
  const payload = action === 'confirm'
    ? {
        status: 'confirmed',
        postponed_until: null,
        resolved_at: now.toISOString(),
        resolved_by: userId,
        resolution_note: note || '用户确认记录无误',
      }
    : {
        postponed_until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        resolution_note: note || '用户选择稍后核对',
      };

  const { data: updated, error: updateError } = await adminClient
    .from('history_anomalies')
    .update(payload)
    .eq('id', anomalyId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    return sendError(res, 409, '该异常记录的状态已变化，请刷新后重试', 'history_anomaly_conflict');
  }

  if (action === 'confirm') {
    const { error: auditError } = await adminClient.from('history_change_log').insert({
      user_id: userId,
      record_id: String(anomaly.record_id),
      actor_user_id: userId,
      operation: 'confirm_anomaly',
      changed_fields: ['anomaly_status'],
      old_values: { anomaly_status: anomaly.status },
      new_values: { anomaly_status: 'confirmed' },
      reason: payload.resolution_note,
      source: 'user_anomaly_review',
    });
    if (auditError) throw auditError;
  }

  return res.status(200).json({ success: true, anomaly: updated });
}

export default async function historyAnomaliesHandler(req, res) {
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
  if (!adminClient) {
    return sendError(res, 503, 'Supabase admin client is not configured', 'supabase_admin_not_configured');
  }
  const auth = await resolveAuthenticatedRequestUser(req, { adminClient, touch: true });
  if (!auth.ok) {
    return sendError(res, auth.status || 401, auth.error || 'Authentication required', auth.code || 'authentication_required');
  }

  try {
    if (req.method === 'PATCH') {
      return await updateOwnAnomaly(adminClient, auth.user.id, req, res);
    }
    const anomalies = await loadOwnAnomalies(adminClient, auth.user.id, req);
    return res.status(200).json({ success: true, anomalies });
  } catch (error) {
    return sendError(res, 500, error.message || '异常记录读取失败', 'history_anomaly_request_failed');
  }
}
