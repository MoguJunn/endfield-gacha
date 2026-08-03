import { createHash } from 'node:crypto';
import {
  getSupabaseAdminClient,
} from '../../_lib/authAdmin.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';
import {
  checkMemoryRateLimit,
  getRequesterKey,
  rejectDisallowedBrowserOrigin,
} from '../../_lib/http.js';

const CODE_VERIFY_LIMIT = Object.freeze({
  windowMs: 10 * 60 * 1000,
  max: 8,
});

function readEnvironment() {
  return globalThis.process?.env || {};
}

function getAppUrl(env = readEnvironment(), req = null) {
  const configured = String(env.APP_URL || env.VITE_APP_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    return configured;
  }

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`.replace(/\/$/, '');
  }

  return 'https://ef-gacha.mogujun.icu';
}

function buildRedirectUrl(req, params = {}) {
  const url = new URL('/settings', `${getAppUrl(readEnvironment(), req)}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function redirect(res, location) {
  if (typeof res.redirect === 'function') {
    return res.redirect(303, location);
  }

  res.statusCode = 303;
  res.setHeader('Location', location);
  return res.end();
}

function hashEmailVerificationToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function getQueryToken(req) {
  const token = req.query?.token;
  if (Array.isArray(token)) {
    return String(token[0] || '').trim();
  }
  return String(token || '').trim();
}

function getBodyCode(req) {
  if (!req.body) return '';
  const body = typeof req.body === 'string'
    ? (() => {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    })()
    : req.body;
  return String(body?.code || body?.verificationCode || '').replace(/\D/g, '').slice(0, 12);
}

function hashEmailVerificationCode(code, userId = '') {
  return createHash('sha256')
    .update(`${String(userId || '').trim()}:${String(code || '').trim()}`, 'utf8')
    .digest('hex');
}

async function resolveCurrentUser(req, adminClient) {
  const authResult = await resolveAuthenticatedRequestUser(req, { adminClient });
  if (!authResult.ok) {
    return {
      ok: false,
      status: authResult.status || 401,
      error: authResult.error || 'Authentication required',
      code: authResult.code || 'session_invalid',
    };
  }

  return {
    ok: true,
    currentUser: authResult.user,
  };
}

async function consumeEmailChallenge(adminClient, {
  kind,
  hash,
  userId = null,
}) {
  if (typeof adminClient?.rpc !== 'function') {
    const error = new Error('Email challenge service unavailable');
    error.code = 'email_challenge_unavailable';
    throw error;
  }
  const query = adminClient.rpc('consume_account_email_challenge', {
    p_kind: kind,
    p_hash: hash,
    p_user_id: userId,
  });
  const { data, error } = typeof query?.maybeSingle === 'function'
    ? await query.maybeSingle()
    : await query;
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data[0] || null : data || null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, Authorization' })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (req.method === 'POST') {
    const code = getBodyCode(req);
    if (code.length !== 6) {
      return res.status(400).json({ success: false, error: 'Invalid verification code', code: 'invalid_code' });
    }

    const adminClient = getSupabaseAdminClient();
    if (!adminClient?.from) {
      return res.status(503).json({ success: false, error: 'Email verification service unavailable', code: 'service_unavailable' });
    }

    try {
      const userResult = await resolveCurrentUser(req, adminClient);
      if (!userResult.ok) {
        return res.status(userResult.status || 401).json({
          success: false,
          error: userResult.error || 'Authentication required',
          code: userResult.code || 'session_invalid',
        });
      }
      const currentUser = userResult.currentUser;

      const rateLimitResult = checkMemoryRateLimit(
        `account-email-verify:${currentUser.id}:${getRequesterKey(req)}`,
        CODE_VERIFY_LIMIT
      );
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          error: 'Too many verification attempts',
          code: 'rate_limited',
          retry_after: rateLimitResult.retryAfter,
        });
      }

      const codeHash = hashEmailVerificationCode(code, currentUser.id);
      const consumed = await consumeEmailChallenge(adminClient, {
        kind: 'code',
        hash: codeHash,
        userId: currentUser.id,
      });
      if (!consumed?.user_id) {
        return res.status(400).json({ success: false, error: 'Verification code not found', code: 'code_not_found' });
      }

      return res.status(200).json({
        success: true,
        data: {
          status: 'verified',
          email: consumed.target_email || null,
        },
      });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to verify email code', code: 'server_error' });
    }
  }

  const token = getQueryToken(req);
  if (token.length < 32 || token.length > 160) {
    return redirect(res, buildRedirectUrl(req, {
      email_verification: 'failed',
      reason: 'invalid_token',
    }));
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient?.from) {
    return redirect(res, buildRedirectUrl(req, {
      email_verification: 'failed',
      reason: 'service_unavailable',
    }));
  }

  try {
    const tokenHash = hashEmailVerificationToken(token);
    const consumed = await consumeEmailChallenge(adminClient, {
      kind: 'token',
      hash: tokenHash,
    });
    if (!consumed?.user_id) {
      return redirect(res, buildRedirectUrl(req, {
        email_verification: 'failed',
        reason: 'token_not_found',
      }));
    }

    return redirect(res, buildRedirectUrl(req, {
      email_verification: 'success',
    }));
  } catch {
    return redirect(res, buildRedirectUrl(req, {
      email_verification: 'failed',
      reason: 'server_error',
    }));
  }
}

export const __internal = {
  buildRedirectUrl,
  consumeEmailChallenge,
  hashEmailVerificationCode,
  hashEmailVerificationToken,
};
