import { fetchJsonWithTimeout } from './supabaseRequest.js';
import { getSupabaseAccessToken } from './authFetchService.js';

export class AccountEmailActionError extends Error {
  constructor(message, {
    code = '',
    status = 0,
    retryAfter = 0,
    partial = false,
    sent = null,
  } = {}) {
    super(message || 'Account email action failed');
    this.name = 'AccountEmailActionError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.partial = partial;
    this.sent = sent;
  }
}

async function postAccountEmailAction(body, {
  label = 'account-email-action',
  timeoutMs = 30000,
} = {}) {
  const accessToken = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  });
  const headers = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const { response, data: payload } = await fetchJsonWithTimeout('/api/account-email-action', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(body),
  }, {
    label,
    timeoutMs,
    retries: 0,
  });

  if (!response.ok || payload?.success !== true) {
    throw new AccountEmailActionError(payload?.error || '邮箱操作失败，请稍后重试', {
      code: payload?.code || '',
      status: response.status,
      retryAfter: payload?.retry_after || 0,
      partial: Boolean(payload?.partial),
      sent: payload?.sent || null,
    });
  }

  return payload;
}

export function isUserEmailVerified(user, {
  emailVerificationRequired = false,
  emailVerificationVerifiedAt = null,
} = {}) {
  if (emailVerificationRequired) {
    return false;
  }

  return Boolean(
    emailVerificationVerifiedAt
    || user?.email_confirmed_at
    || user?.confirmed_at
    || user?.user_metadata?.email_verified
    || user?.identities?.some?.((identity) => identity?.identity_data?.email_verified === true)
  );
}

export async function requestCurrentEmailVerification({ locale } = {}) {
  return postAccountEmailAction({
    action: 'resend_verification',
    locale,
  }, {
    label: 'account-email-action:resend-verification',
  });
}

export async function verifyCurrentEmailCode({ code } = {}) {
  const accessToken = await getSupabaseAccessToken({
    syncSiteSession: false,
    useSiteSessionCache: true,
    allowSiteSessionToken: false,
  });
  const headers = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const normalizedCode = String(code || '').replace(/\D/g, '').slice(0, 6);
  const { response, data: payload } = await fetchJsonWithTimeout('/api/account-email-verify', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ code: normalizedCode }),
  }, {
    label: 'account-email-verify:code',
    timeoutMs: 20000,
    retries: 0,
  });

  if (!response.ok || payload?.success !== true) {
    throw new AccountEmailActionError(payload?.error || '邮箱验证码验证失败，请稍后重试', {
      code: payload?.code || '',
      status: response.status,
    });
  }

  return payload;
}

export async function requestEmailChange({
  newEmail,
  currentPassword,
  locale,
} = {}) {
  return postAccountEmailAction({
    action: 'change_email',
    newEmail,
    currentPassword,
    locale,
  }, {
    label: 'account-email-action:change-email',
    timeoutMs: 45000,
  });
}

export default {
  AccountEmailActionError,
  isUserEmailVerified,
  requestCurrentEmailVerification,
  verifyCurrentEmailCode,
  requestEmailChange,
};
