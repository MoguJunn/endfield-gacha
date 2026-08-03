import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import {
  checkMemoryRateLimit,
  getRequesterKey,
  rejectDisallowedBrowserOrigin,
} from '../../_lib/http.js';
import {
  completeOAuthEmailArtifactMerge,
  maskAccountMergeEmail,
  verifyOAuthEmailArtifactMerge,
} from '../../_lib/oauthEmailArtifactMerge.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function sendError(res, status, code, message, details = {}) {
  return res.status(status).json({
    success: false,
    error: message,
    code,
    details,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'POST, OPTIONS',
    headers: 'Content-Type, Authorization',
  })) {
    return;
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return sendError(res, 503, 'oauth_email_merge_unavailable', 'Account merge service is not configured');
  }

  try {
    const authResult = await resolveAuthenticatedRequestUser(req, { adminClient });
    if (!authResult.ok || !authResult.user?.id) {
      return sendError(
        res,
        authResult.status || 401,
        authResult.code || 'auth_required',
        authResult.error || 'Authentication required'
      );
    }

    const body = parseRequestBody(req);
    const action = String(body.action || '').trim().toLowerCase();
    const intentId = String(body.intentId || body.intent_id || '').trim();
    if (!intentId) {
      return sendError(res, 400, 'oauth_email_merge_intent_required', 'Merge intent is required');
    }
    const rateLimit = checkMemoryRateLimit(
      `account-email-merge:${action}:${authResult.user.id}:${intentId}:${getRequesterKey(req)}`,
      { windowMs: 10 * 60 * 1000, max: action === 'verify' ? 8 : 4 }
    );
    if (!rateLimit.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Too many account merge attempts',
        code: 'oauth_email_merge_rate_limited',
        retry_after: rateLimit.retryAfter,
      });
    }

    if (action === 'verify') {
      const code = String(body.code || '').replace(/\D/g, '').slice(0, 6);
      if (code.length !== 6) {
        return sendError(res, 400, 'oauth_email_merge_code_invalid', 'Verification code is invalid');
      }
      const intent = await verifyOAuthEmailArtifactMerge(adminClient, {
        intentId,
        sourceUserId: authResult.user.id,
        verificationCode: code,
      });
      if (!intent?.id) {
        return sendError(
          res,
          400,
          'oauth_email_merge_code_invalid',
          'Verification code is invalid or expired'
        );
      }
      return res.status(200).json({
        success: true,
        data: {
          status: 'verified',
          intentId: intent.id,
          maskedEmail: maskAccountMergeEmail(intent.target_email),
          preview: {
            retainedAccount: 'current_oauth_account',
            conflictingAccount: 'verified_empty_auth_artifact',
            businessDataMoved: false,
            loginIdentityPreserved: true,
          },
        },
      });
    }

    if (action === 'confirm') {
      if (String(body.confirmation || '').trim().toLowerCase() !== 'merge') {
        return sendError(
          res,
          400,
          'oauth_email_merge_confirmation_required',
          'Explicit merge confirmation is required'
        );
      }
      const startedSessionId = authResult.session?.id || null;
      if (!startedSessionId) {
        return sendError(
          res,
          400,
          'oauth_email_merge_site_session_required',
          'A valid site session is required to complete the repair'
        );
      }
      const result = await completeOAuthEmailArtifactMerge(adminClient, {
        intentId,
        sourceUserId: authResult.user.id,
        startedSessionId,
        req,
        res,
      });
      if (!result.ok) {
        const status = result.code === 'oauth_email_merge_coordination_required' ? 500 : 409;
        return sendError(
          res,
          status,
          result.code || 'oauth_email_merge_failed',
          result.code === 'oauth_email_merge_coordination_required'
            ? 'Account state requires support coordination'
            : 'Account merge could not be completed',
          {
            mergeCompleted: Boolean(result.mergeCompleted),
            compensated: Boolean(result.compensated),
          }
        );
      }
      return res.status(200).json({
        success: true,
        data: result,
      });
    }

    return sendError(res, 400, 'oauth_email_merge_action_invalid', 'Invalid account merge action');
  } catch (error) {
    return sendError(
      res,
      500,
      error?.code || 'oauth_email_merge_failed',
      'Account merge operation failed'
    );
  }
}
