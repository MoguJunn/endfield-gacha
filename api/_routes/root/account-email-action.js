import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  checkMemoryRateLimit,
  getRequesterKey,
  rejectDisallowedBrowserOrigin,
} from '../../_lib/http.js';
import {
  findAuthUserByEmail,
  getSupabaseAdminClient,
  getSupabaseAnonServerClient,
} from '../../_lib/authAdmin.js';
import { resolveAuthenticatedRequestUser } from '../../_lib/siteAuth.js';
import { normalizeGeneratedAuthActionLink } from '../../_lib/authActionLinks.js';
import { createMailProviderAdapter } from '../../_lib/mailProviderAdapter.js';
import { renderMailTemplate } from '../../_lib/mailTemplateRenderer.js';
import {
  buildMailRuntimeControls,
  isRuntimeEventEnabled,
  loadMailRuntimeState,
} from '../../_lib/mailRuntimeConfig.js';
import {
  MAIL_EVENT_TYPES,
  buildRecipientFingerprint,
  hashMailIdentifier,
  normalizeMailRecipient,
  sanitizeMailPayload,
} from '../../_lib/mailAbuseGuards.js';

const ACTIONS = Object.freeze({
  RESEND_VERIFICATION: 'resend_verification',
  CHANGE_EMAIL: 'change_email',
});
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;

const ACTION_META = Object.freeze({
  [ACTIONS.RESEND_VERIFICATION]: {
    eventType: MAIL_EVENT_TYPES.EMAIL_VERIFICATION,
    templateKey: 'auth.email-verification',
    rateLimit: { windowMs: 10 * 60 * 1000, max: 3 },
  },
  [ACTIONS.CHANGE_EMAIL]: {
    eventType: MAIL_EVENT_TYPES.EMAIL_CHANGE,
    currentTemplateKey: 'auth.email-change-current',
    newTemplateKey: 'auth.email-change-new',
    rateLimit: { windowMs: 15 * 60 * 1000, max: 4 },
  },
});

function readEnvironment() {
  return globalThis.process?.env || {};
}

function parseBoolean(value, defaultValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

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

function resolveLocale(req, body) {
  const explicit = String(body.locale || body.lang || '').trim();
  if (explicit) {
    return explicit.slice(0, 16);
  }

  const acceptLanguage = String(req.headers?.['accept-language'] || '').trim();
  return acceptLanguage.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

function getAppUrl(env = readEnvironment(), req = null) {
  const configured = String(env.APP_URL || env.VITE_APP_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    return configured;
  }

  const origin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
  return origin || 'https://ef-gacha.mogujun.icu';
}

function isEmailConfirmed(user) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

function hashEmailVerificationToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function createEmailVerificationToken() {
  return randomBytes(32).toString('base64url');
}

function createEmailVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashEmailVerificationCode(code, userId = '') {
  return createHash('sha256')
    .update(`${String(userId || '').trim()}:${String(code || '').trim()}`, 'utf8')
    .digest('hex');
}

function buildAccountEmailVerificationUrl(env, req, token) {
  const url = new URL('/api/account-email-verify', `${getAppUrl(env, req)}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

function getNormalizedEmail(value) {
  const recipient = normalizeMailRecipient(value);
  return recipient.ok ? recipient.email : '';
}

function isAuthMailEnabled(env = readEnvironment(), runtimeState = null) {
  if (runtimeState) {
    return isRuntimeEventEnabled(runtimeState, 'authMailActions');
  }
  return parseBoolean(env.AUTH_MAIL_ACTIONS_ENABLED || env.AUTH_EMAIL_ACTIONS_ENABLED, false)
    && parseBoolean(env.MAIL_OUTBOX_WORKER_ENABLED || env.MAIL_WORKER_ENABLED, false);
}

function isAuthMailPaused(env = readEnvironment(), runtimeState = null) {
  if (runtimeState) {
    return Boolean(runtimeState.controls?.killSwitch);
  }
  return parseBoolean(env.MAIL_OUTBOX_GLOBAL_KILL_SWITCH, false);
}

async function safeLoadMailRuntimeState(adminClient, env) {
  try {
    return await loadMailRuntimeState(adminClient, env);
  } catch {
    return null;
  }
}

async function loadAccountSecurityState(adminClient, userId) {
  if (!adminClient?.from || !userId) {
    return null;
  }

  const { data, error } = await adminClient
    .from('account_security_states')
    .select('email_verification_required, email_verification_reason, email_verification_requested_at, email_verification_verified_at, email_verification_target_email, email_verification_version, password_change_required, password_change_reason')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function storeAccountEmailVerificationToken(adminClient, userId, {
  token,
  code,
  targetEmail,
  now,
  reason = 'user_requested',
}) {
  const tokenExpiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TOKEN_TTL_MS);
  const codeExpiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_CODE_TTL_MS);
  const tokenHash = hashEmailVerificationToken(token);
  const codeHash = hashEmailVerificationCode(code, userId);
  if (typeof adminClient?.rpc !== 'function') {
    const error = new Error('Email challenge service is unavailable');
    error.code = 'email_challenge_unavailable';
    throw error;
  }
  const challengeId = randomUUID();
  const challengeQuery = adminClient.rpc('start_account_email_challenge', {
    p_challenge_id: challengeId,
    p_user_id: userId,
    p_target_email: targetEmail,
    p_reason: reason,
    p_token_hash: tokenHash,
    p_token_expires_at: tokenExpiresAt.toISOString(),
    p_code_hash: codeHash,
    p_code_expires_at: codeExpiresAt.toISOString(),
  });
  const { error } = typeof challengeQuery?.maybeSingle === 'function'
    ? await challengeQuery.maybeSingle()
    : await challengeQuery;

  if (error) {
    throw error;
  }

  return {
    tokenHash,
    tokenExpiresAt,
    codeHash,
    codeExpiresAt,
    challengeId,
    targetEmail,
  };
}

function getRuntimeRecipientBlock(runtimeState, eventType, recipientEmail) {
  const controls = runtimeState?.controls || {};
  const disabledEvents = new Set(
    (controls.disabledEvents || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
  );
  if (disabledEvents.has(String(eventType || '').toLowerCase())) {
    return {
      blocked: true,
      code: 'mail_event_disabled',
      reason: 'This mail event type is disabled.',
    };
  }

  const recipient = normalizeMailRecipient(recipientEmail);
  const pausedDomains = new Set(
    (controls.pausedDomains || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
  );
  if (recipient.ok && pausedDomains.has(recipient.domain)) {
    return {
      blocked: true,
      code: 'mail_domain_paused',
      reason: 'Recipient domain is paused.',
    };
  }

  return { blocked: false };
}

function sendAccountEmailResponse(res, {
  status = 'sent',
  nextStep = 'check_email',
  dryRun = false,
  partial = false,
  sent = {},
  pendingEmail = null,
} = {}) {
  return res.status(200).json({
    success: true,
    partial,
    data: {
      status,
      nextStep,
      deliveryChannel: 'mail',
      dryRun,
      sent,
      pendingEmail,
    },
  });
}

async function generateAuthActionLink(adminClient, payload) {
  const generateLink = adminClient?.auth?.admin?.generateLink;
  if (typeof generateLink !== 'function') {
    return {
      ok: false,
      code: 'auth_generate_link_unavailable',
      reason: 'Auth admin generateLink is unavailable.',
    };
  }

  const { data, error } = await generateLink.call(adminClient.auth.admin, payload);
  if (error) {
    return {
      ok: false,
      code: 'auth_generate_link_failed',
      reason: error.message || 'Failed to generate auth action link.',
      status: error.status,
    };
  }

  const actionLink = normalizeGeneratedAuthActionLink(
    data?.properties?.action_link || data?.action_link || data?.actionLink || ''
  );
  if (!actionLink) {
    return {
      ok: false,
      code: 'auth_generate_link_empty',
      reason: 'Auth admin returned no action link.',
    };
  }

  return {
    ok: true,
    actionLink,
    user: data?.user || null,
  };
}

async function insertAccountMailDeliveryEvent(adminClient, {
  eventType,
  providerResult,
  recipient,
  now,
  payload = {},
}) {
  if (!adminClient?.from) {
    return { ok: false, error: 'admin_client_unavailable' };
  }

  const providerMessageIdHash = providerResult?.providerMessageId
    ? hashMailIdentifier(providerResult.providerMessageId, { prefix: 'provider_message_id' })
    : null;
  const { error } = await adminClient
    .from('mail_delivery_events')
    .insert({
      outbox_id: null,
      provider_key: providerResult?.providerKey || null,
      provider_message_id_hash: providerMessageIdHash,
      event_type: `${eventType}_${providerResult?.ok ? 'accepted' : 'failed'}`,
      event_payload_redacted_json: sanitizeMailPayload({
        eventType,
        code: providerResult?.code || 'account_email_mail_result',
        reason: providerResult?.reason || '',
        dryRun: Boolean(providerResult?.dryRun),
        retryable: providerResult?.retryable !== false,
        recipientDomain: recipient?.domain || '',
        recipientRedacted: recipient?.redacted || '',
        ...payload,
      }),
      created_at: now.toISOString(),
    });

  return error ? { ok: false, error: error.message || 'mail_delivery_event_insert_failed' } : { ok: true };
}

async function sendAccountMail({
  adminClient,
  eventType,
  templateKey,
  email,
  actionLink,
  verificationCode = '',
  locale,
  env,
  now,
  controls,
  relatedEntityId,
  payload = {},
}) {
  const adapter = createMailProviderAdapter({ env });
  const providerConfig = adapter.config || {};
  const rendered = renderMailTemplate({
    templateKey,
    locale,
    actionUrl: actionLink,
    verificationCode,
    generatedAt: now,
  });

  const providerResult = await adapter.send({
    from: {
      address: providerConfig.fromAddress,
      name: providerConfig.fromName,
    },
    to: email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateKey,
    locale,
    eventType,
    relatedEntityType: 'account_email',
    relatedEntityId,
    payload: {
      eventType,
      controls: sanitizeMailPayload(controls || {}),
      ...sanitizeMailPayload(payload),
    },
  });
  const recipient = buildRecipientFingerprint(email);
  const deliveryEvent = await insertAccountMailDeliveryEvent(adminClient, {
    eventType,
    providerResult,
    recipient,
    now,
    payload: {
      templateKey,
      relatedEntityId,
      ...payload,
    },
  });

  return {
    providerResult,
    deliveryEvent,
    recipient,
  };
}

async function verifyCurrentPassword(callerClient, email, password) {
  const { error } = await callerClient.auth.signInWithPassword({
    email,
    password,
  });
  return { ok: !error, error };
}

async function resolveCurrentUser(req, {
  adminClient,
} = {}) {
  const authResult = await resolveAuthenticatedRequestUser(req, { adminClient });
  if (!authResult.ok) {
    return {
      ok: false,
      status: authResult.status || 401,
      error: authResult.error || 'Authentication required',
    };
  }

  return {
    ok: true,
    currentUser: authResult.user,
    authSource: authResult.source,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (rejectDisallowedBrowserOrigin(req, res, { methods: 'POST, OPTIONS', headers: 'Content-Type, Authorization' })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = parseRequestBody(req);
  const action = String(body.action || '').trim().toLowerCase();
  const meta = ACTION_META[action];
  if (!meta) {
    return res.status(400).json({ success: false, error: 'Invalid account email action' });
  }

  const requesterKey = getRequesterKey(req);
  const rateLimitResult = checkMemoryRateLimit(`account-email:${action}:${requesterKey}`, meta.rateLimit);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      retry_after: rateLimitResult.retryAfter,
    });
  }

  const env = readEnvironment();
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return res.status(503).json({ success: false, error: 'Account email service not configured' });
  }

  try {
    const userResult = await resolveCurrentUser(req, {
      adminClient,
    });
    if (!userResult.ok) {
      return res.status(userResult.status || 401).json({
        success: false,
        error: userResult.error || 'Authentication required',
      });
    }
    const currentUser = userResult.currentUser;

    const runtimeState = await safeLoadMailRuntimeState(adminClient, env);
    if (!isAuthMailEnabled(env, runtimeState)) {
      return res.status(503).json({
        success: false,
        error: 'Auth mail actions are disabled',
        code: 'auth_mail_disabled',
      });
    }

    if (isAuthMailPaused(env, runtimeState)) {
      return res.status(503).json({
        success: false,
        error: 'Auth mail actions are paused',
        code: 'mail_kill_switch_enabled',
      });
    }

    const locale = resolveLocale(req, body);
    const redirectTo = getAppUrl(env, req);
    const now = new Date();
    const controls = buildMailRuntimeControls(runtimeState, 'authMailActions');
    const accountSecurityState = await loadAccountSecurityState(adminClient, currentUser.id);
    const isSuperAdmin = currentUser?.app_metadata?.role === 'super_admin'
      || currentUser?.profile_role === 'super_admin';
    const stateRequiresEmailVerification = Boolean(accountSecurityState?.email_verification_required);
    const stateEmailVerified = !stateRequiresEmailVerification
      && Boolean(accountSecurityState?.email_verification_verified_at);
    const emailVerified = !stateRequiresEmailVerification && Boolean(
      stateEmailVerified
      || isEmailConfirmed(currentUser)
      || (!accountSecurityState && isSuperAdmin)
    );
    const emailVerificationRequired = !emailVerified;
    const isOAuthEmailSetup = Boolean(
      (
        stateRequiresEmailVerification
        && String(accountSecurityState?.email_verification_reason || '').startsWith('oauth_email_setup_required')
      )
      || (
        accountSecurityState?.password_change_required
        && String(accountSecurityState?.password_change_reason || '').startsWith('oauth_password_setup_required')
      )
    );
    const currentEmail = getNormalizedEmail(currentUser.email);
    if (!currentEmail && (action !== ACTIONS.CHANGE_EMAIL || !isOAuthEmailSetup)) {
      return res.status(400).json({
        success: false,
        error: 'Current account does not have a valid email address',
        code: 'current_email_invalid',
      });
    }

    if (action === ACTIONS.RESEND_VERIFICATION) {
      if (!emailVerificationRequired) {
        return sendAccountEmailResponse(res, {
          status: 'already_verified',
          nextStep: 'none',
          sent: { current: false },
        });
      }

      const block = getRuntimeRecipientBlock(runtimeState, meta.eventType, currentEmail);
      if (block.blocked) {
        return res.status(503).json({
          success: false,
          error: block.reason,
          code: block.code,
        });
      }

      const token = createEmailVerificationToken();
      const verificationCode = createEmailVerificationCode();
      const storedToken = await storeAccountEmailVerificationToken(adminClient, currentUser.id, {
        token,
        code: verificationCode,
        targetEmail: currentEmail,
        now,
        reason: accountSecurityState?.email_verification_requested_at
          ? 'user_requested'
          : 'mail_verification_rollout_2026_05',
      });
      const actionLink = buildAccountEmailVerificationUrl(env, req, token);
      const tokenPayload = {
        verificationMode: 'account_security_state',
        tokenExpiresAt: storedToken.tokenExpiresAt.toISOString(),
        codeEntry: true,
        codeExpiresAt: storedToken.codeExpiresAt.toISOString(),
      };

      const mailResult = await sendAccountMail({
        adminClient,
        eventType: meta.eventType,
        templateKey: meta.templateKey,
        email: currentEmail,
        actionLink,
        verificationCode: tokenPayload.codeEntry ? verificationCode : '',
        locale,
        env,
        now,
        controls,
        relatedEntityId: ACTIONS.RESEND_VERIFICATION,
        payload: {
          action: ACTIONS.RESEND_VERIFICATION,
          ...tokenPayload,
        },
      });
      const providerResult = mailResult.providerResult || {};
      if (!providerResult.ok) {
        return res.status(502).json({
          success: false,
          error: 'Unable to send verification email',
          code: providerResult.code || 'mail_send_failed',
        });
      }

      return sendAccountEmailResponse(res, {
        status: providerResult.dryRun ? 'dry_run' : 'sent',
        nextStep: 'enter_verification_code',
        dryRun: Boolean(providerResult.dryRun),
        sent: { current: true },
      });
    }

    const nextEmail = getNormalizedEmail(body.newEmail || body.new_email);
    const currentPassword = String(body.currentPassword || body.current_password || '');
    if (!nextEmail) {
      return res.status(400).json({
        success: false,
        error: 'New email is invalid',
        code: 'new_email_invalid',
      });
    }

    if (nextEmail === currentEmail) {
      return res.status(400).json({
        success: false,
        error: 'New email must be different from the current email',
        code: 'email_unchanged',
      });
    }

    const existingUser = await findAuthUserByEmail(adminClient, nextEmail);
    if (existingUser?.id && existingUser.id !== currentUser.id) {
      return res.status(409).json({
        success: false,
        error: 'Email already registered',
        code: 'email_already_registered',
      });
    }

    if (isOAuthEmailSetup) {
      const nextBlock = getRuntimeRecipientBlock(runtimeState, MAIL_EVENT_TYPES.EMAIL_VERIFICATION, nextEmail);
      if (nextBlock.blocked) {
        return res.status(503).json({
          success: false,
          error: nextBlock.reason,
          code: nextBlock.code,
        });
      }

      const token = createEmailVerificationToken();
      const verificationCode = createEmailVerificationCode();
      const storedToken = await storeAccountEmailVerificationToken(adminClient, currentUser.id, {
        token,
        code: verificationCode,
        targetEmail: nextEmail,
        now,
        reason: 'oauth_email_setup_required',
      });

      const mailResult = await sendAccountMail({
        adminClient,
        eventType: MAIL_EVENT_TYPES.EMAIL_VERIFICATION,
        templateKey: 'auth.email-verification',
        email: nextEmail,
        actionLink: buildAccountEmailVerificationUrl(env, req, token),
        verificationCode,
        locale,
        env,
        now,
        controls,
        relatedEntityId: ACTIONS.RESEND_VERIFICATION,
        payload: {
          action: ACTIONS.RESEND_VERIFICATION,
          verificationMode: 'account_security_state',
          tokenExpiresAt: storedToken.tokenExpiresAt.toISOString(),
          codeEntry: true,
          codeExpiresAt: storedToken.codeExpiresAt.toISOString(),
        },
      });
      const providerResult = mailResult.providerResult || {};
      if (!providerResult.ok) {
        return res.status(502).json({
          success: false,
          error: 'Unable to send verification email',
          code: providerResult.code || 'mail_send_failed',
        });
      }

      return sendAccountEmailResponse(res, {
        status: providerResult.dryRun ? 'dry_run' : 'sent',
        nextStep: 'enter_verification_code',
        dryRun: Boolean(providerResult.dryRun),
        sent: {
          current: false,
          new: true,
        },
        pendingEmail: nextEmail,
      });
    }

    if (currentPassword.length < 1) {
      return res.status(400).json({
        success: false,
        error: 'Current password is required',
        code: 'current_password_required',
      });
    }

    const callerClient = getSupabaseAnonServerClient();
    if (!callerClient) {
      return res.status(503).json({
        success: false,
        error: 'Account email service not configured',
        code: 'auth_service_unavailable',
      });
    }

    const passwordResult = await verifyCurrentPassword(callerClient, currentEmail, currentPassword);
    if (!passwordResult.ok) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect',
        code: 'invalid_current_password',
      });
    }

    const currentBlock = getRuntimeRecipientBlock(runtimeState, meta.eventType, currentEmail);
    const nextBlock = getRuntimeRecipientBlock(runtimeState, meta.eventType, nextEmail);
    if (currentBlock.blocked || nextBlock.blocked) {
      const block = currentBlock.blocked ? currentBlock : nextBlock;
      return res.status(503).json({
        success: false,
        error: block.reason,
        code: block.code,
      });
    }

    const currentLinkResult = await generateAuthActionLink(adminClient, {
      type: 'email_change_current',
      email: currentEmail,
      newEmail: nextEmail,
      options: {
        redirectTo,
      },
    });

    if (!currentLinkResult.ok) {
      return res.status(500).json({
        success: false,
        error: 'Unable to create current-email confirmation link',
        code: currentLinkResult.code,
      });
    }

    const nextLinkResult = await generateAuthActionLink(adminClient, {
      type: 'email_change_new',
      email: currentEmail,
      newEmail: nextEmail,
      options: {
        redirectTo,
      },
    });

    if (!nextLinkResult.ok) {
      return res.status(500).json({
        success: false,
        error: 'Unable to create new-email confirmation link',
        code: nextLinkResult.code,
      });
    }

    const currentMailResult = await sendAccountMail({
      adminClient,
      eventType: meta.eventType,
      templateKey: meta.currentTemplateKey,
      email: currentEmail,
      actionLink: currentLinkResult.actionLink,
      locale,
      env,
      now,
      controls,
      relatedEntityId: 'email_change_current',
      payload: {
        action: ACTIONS.CHANGE_EMAIL,
        recipientRole: 'current',
      },
    });

    const nextMailResult = await sendAccountMail({
      adminClient,
      eventType: meta.eventType,
      templateKey: meta.newTemplateKey,
      email: nextEmail,
      actionLink: nextLinkResult.actionLink,
      locale,
      env,
      now,
      controls,
      relatedEntityId: 'email_change_new',
      payload: {
        action: ACTIONS.CHANGE_EMAIL,
        recipientRole: 'new',
      },
    });

    const currentProvider = currentMailResult.providerResult || {};
    const nextProvider = nextMailResult.providerResult || {};
    if (!currentProvider.ok || !nextProvider.ok) {
      return res.status(502).json({
        success: false,
        partial: currentProvider.ok !== nextProvider.ok,
        error: 'Unable to send all email change confirmation messages',
        code: (currentProvider.ok ? nextProvider.code : currentProvider.code) || 'mail_send_failed',
        sent: {
          current: Boolean(currentProvider.ok),
          new: Boolean(nextProvider.ok),
        },
      });
    }

    return sendAccountEmailResponse(res, {
      status: currentProvider.dryRun || nextProvider.dryRun ? 'dry_run' : 'sent',
      nextStep: 'confirm_current_and_new_email',
      dryRun: Boolean(currentProvider.dryRun || nextProvider.dryRun),
      sent: {
        current: true,
        new: true,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Account email action failed',
    });
  }
}

export const __internal = {
  ACTIONS,
  ACTION_META,
  generateAuthActionLink,
  getRuntimeRecipientBlock,
  isEmailConfirmed,
  isAuthMailEnabled,
  isAuthMailPaused,
  hashEmailVerificationToken,
};
