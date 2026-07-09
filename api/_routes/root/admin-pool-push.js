import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import { requireSuperAdminUser } from '../../_lib/siteAuth.js';

const DEFAULT_TIMEOUT_MS = 10000;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOCAL_ENV_PATH = path.join(PROJECT_ROOT, '.env.local');

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function sendError(res, status, error, code = error) {
  return res.status(status).json({
    success: false,
    error,
    code,
  });
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBoolean(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isHttpHeaderSafeSecret(value) {
  return /^[\x21-\x7E]+$/.test(value);
}

function parseEnvFileText(text) {
  const env = {};
  for (let line of String(text || '').split('\n')) {
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index);
    let value = line.slice(index + 1).trim();
    const first = value.charCodeAt(0);
    const last = value.charCodeAt(value.length - 1);
    if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function readLocalEnvFile() {
  try {
    return parseEnvFileText(fs.readFileSync(LOCAL_ENV_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function resolvePoolPushSecret(value) {
  const current = normalizeText(value);
  if (current && isHttpHeaderSafeSecret(current)) {
    return current;
  }

  const localSecret = normalizeText(readLocalEnvFile().QQBOT_POOL_PUSH_WEBHOOK_SECRET);
  return localSecret || current;
}

function getConfig() {
  return {
    enabled: parseBoolean(process.env.QQBOT_POOL_PUSH_ENABLED),
    baseUrl: normalizeText(process.env.QQBOT_POOL_PUSH_WEBHOOK_URL),
    secret: resolvePoolPushSecret(process.env.QQBOT_POOL_PUSH_WEBHOOK_SECRET),
    timeoutMs: Number.parseInt(process.env.QQBOT_POOL_PUSH_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS,
  };
}

function buildBotEndpoint(baseUrl, action) {
  const path = action === 'sendPoolPush' ? '/v1/admin/pool-updates/confirm' : '/v1/admin/pool-updates/preview';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ''), normalizedBase).toString();
}

function pickSelectedTargets(value) {
  if (!Array.isArray(value)) return undefined;
  const targets = value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      targetHash: normalizeText(item.targetHash),
      platform: normalizeText(item.platform),
      adapter: normalizeText(item.adapter),
      scene: normalizeText(item.scene),
    }))
    .filter((item) => item.targetHash && item.platform && item.adapter && item.scene);
  return targets.length > 0 ? targets : undefined;
}

function normalizePoolType(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'limited_character' || normalized === 'limited') return 'limited';
  if (normalized === 'limited_weapon' || normalized === 'weapon') return 'weapon';
  if (normalized === 'extra') return 'extra';
  if (normalized === 'beginner' || normalized === 'newbie') return 'newbie';
  if (normalized === 'standard') return 'standard';
  return 'unknown';
}

function pickStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)));
}

function pickPoolSummary(value) {
  if (!value || typeof value !== 'object') return undefined;
  const pool = value;
  const id = normalizeText(pool.id || pool.pool_id || pool.poolId);
  const name = normalizeText(pool.name || pool.name_en || pool.displayName);
  if (!id || !name) return undefined;

  const summary = {
    id,
    name,
    type: normalizePoolType(pool.type || pool.poolType),
    upItems: pickStringArray(pool.upItems || pool.up_items || pool.featuredItems),
  };
  const startsAt = normalizeText(pool.startsAt || pool.start_time || pool.startTime);
  if (startsAt) summary.startsAt = startsAt;
  const endsAt = normalizeText(pool.endsAt || pool.end_time || pool.endTime);
  if (endsAt) summary.endsAt = endsAt;
  const note = normalizeText(pool.note || pool.description);
  if (note) summary.note = note;
  return summary;
}

function buildBotPayload(body, action) {
  if (action === 'sendPoolPush') {
    const confirmationToken = normalizeText(body.confirmationToken);
    return confirmationToken ? { confirmationToken } : {};
  }

  const payload = {};
  const dedupeKey = normalizeText(body.dedupeKey);
  if (dedupeKey) payload.dedupeKey = dedupeKey;
  const selectedTargets = pickSelectedTargets(body.selectedTargets);
  if (selectedTargets) {
    payload.targetPolicy = 'admin_selected_groups';
    payload.selectedTargets = selectedTargets;
  }
  const pool = pickPoolSummary(body.pool);
  if (pool) {
    payload.pool = pool;
  }
  return payload;
}

async function callBotPoolPush(config, action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(buildBotEndpoint(config.baseUrl, action), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-qqbot-admin-secret': config.secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.error || `Bot pool push request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.code = data?.error || 'pool_push_request_failed';
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Bot pool push request timed out after ${config.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function adminPoolPushHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (
    rejectDisallowedBrowserOrigin(req, res, {
      methods: 'POST, OPTIONS',
      headers: 'Content-Type, Authorization',
    })
  ) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return sendError(res, 405, 'Method not allowed', 'method_not_allowed');
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return sendError(res, 503, 'Supabase admin client is not configured', 'supabase_admin_not_configured');
  }

  const auth = await requireSuperAdminUser(req, { adminClient });
  if (!auth.ok) {
    return sendError(
      res,
      auth.status || 403,
      auth.error || 'Super admin role required',
      auth.code || 'super_admin_required'
    );
  }

  const config = getConfig();
  if (!config.enabled) {
    return sendError(res, 503, '卡池推送功能尚未开启', 'pool_push_disabled');
  }
  if (!config.baseUrl || !config.secret) {
    return sendError(res, 503, '卡池推送服务配置不完整', 'pool_push_not_configured');
  }
  if (!isHttpHeaderSafeSecret(config.secret)) {
    return sendError(res, 503, '卡池推送服务密钥只能使用英文、数字或常见半角符号', 'pool_push_secret_invalid');
  }

  const body = parseRequestBody(req);
  const action = normalizeText(body.action);
  if (action !== 'previewPoolPush' && action !== 'sendPoolPush') {
    return sendError(res, 400, 'Invalid pool push action', 'invalid_action');
  }

  const botPayload = buildBotPayload(body, action);
  if (action === 'sendPoolPush' && !botPayload.confirmationToken) {
    return sendError(res, 400, '缺少卡池推送确认凭证，请重新生成预览', 'confirmation_token_required');
  }

  try {
    const data = await callBotPoolPush(config, action, botPayload);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(
      res,
      error.status || 502,
      error.message || '卡池推送服务请求失败',
      error.code || 'pool_push_request_failed'
    );
  }
}
