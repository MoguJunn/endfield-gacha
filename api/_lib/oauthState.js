import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

const DEFAULT_APP_URL = 'https://ef-gacha.mogujun.icu';
const STATE_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
const OAUTH_TRANSACTION_TABLE = 'app_oauth_transactions';
const OAUTH_TRANSACTION_COOKIE_PREFIX = 'eg_oauth_tx_';
const OAUTH_INTENTS = new Set(['login', 'link']);

function readEnvironment() {
  return globalThis.process?.env || {};
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function hmacSha256(value, secret) {
  return createHmac('sha256', secret).update(String(value || ''), 'utf8').digest('base64url');
}

function sha256Base64Url(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getOAuthStateSecret(env = readEnvironment()) {
  return String(
    env.OAUTH_STATE_SECRET
    || env.AUTH_SECURITY_HASH_SECRET
    || env.MAIL_ABUSE_HASH_SECRET
    || env.SUPABASE_JWT_SECRET
    || ''
  ).trim();
}

export function getAppUrl(env = readEnvironment(), req = null) {
  const configured = String(env.APP_URL || env.VITE_APP_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    return configured;
  }

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (host) {
    return `${forwardedProto || 'https'}://${host}`.replace(/\/$/, '');
  }

  return DEFAULT_APP_URL;
}

export function normalizeOAuthReturnTo(value, env = readEnvironment(), req = null) {
  const appUrl = getAppUrl(env, req);
  const raw = String(value || '').trim();
  if (!raw) {
    return '/';
  }

  try {
    if (raw.startsWith('/') && !raw.startsWith('//')) {
      const url = new URL(raw, `${appUrl}/`);
      if (url.pathname.startsWith('/api/')) {
        return '/';
      }
      return `${url.pathname}${url.search}${url.hash}` || '/';
    }

    const parsed = new URL(raw);
    const appOrigin = new URL(appUrl).origin;
    if (parsed.origin !== appOrigin || parsed.pathname.startsWith('/api/')) {
      return '/';
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return '/';
  }
}

export function appendOAuthResultParams(returnTo, params = {}, env = readEnvironment(), req = null) {
  const appUrl = getAppUrl(env, req);
  const url = new URL(normalizeOAuthReturnTo(returnTo, env, req), `${appUrl}/`);
  Object.entries(params).forEach(([key, value]) => {
    const normalizedValue = String(value || '').trim();
    if (normalizedValue) {
      url.searchParams.set(key, normalizedValue.slice(0, 120));
    }
  });
  return url.toString();
}

export function normalizeOAuthIntent(value, fallback = 'login') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return OAUTH_INTENTS.has(normalized) ? normalized : '';
}

export function createOAuthTransactionMaterial({
  secret,
} = {}) {
  if (!secret) {
    throw new Error('oauth_state_secret_missing');
  }

  const transactionId = randomUUID();
  const browserBindingToken = randomBytes(32).toString('base64url');
  const pkceCodeVerifier = randomBytes(48).toString('base64url');
  return {
    transactionId,
    browserBindingToken,
    browserBindingHash: hashOAuthBrowserBinding(browserBindingToken, { secret }),
    pkceCodeVerifier,
    pkceCodeChallenge: sha256Base64Url(pkceCodeVerifier),
  };
}

export function hashOAuthBrowserBinding(value, {
  env = readEnvironment(),
  secret = getOAuthStateSecret(env),
} = {}) {
  if (!secret) {
    throw new Error('oauth_state_secret_missing');
  }
  const token = String(value || '').trim();
  if (!token) {
    return '';
  }
  return hmacSha256(`oauth-browser:${token}`, secret);
}

export function getOAuthTransactionCookieName(transactionId, {
  secure = true,
} = {}) {
  const safeId = String(transactionId || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (!safeId) {
    return '';
  }
  return `${secure ? '__Host-' : ''}${OAUTH_TRANSACTION_COOKIE_PREFIX}${safeId}`;
}

export function readOAuthTransactionCookie(req, transactionId, {
  secure = true,
} = {}) {
  const cookieName = getOAuthTransactionCookieName(transactionId, { secure });
  if (!cookieName) {
    return '';
  }

  const rawHeader = String(req?.headers?.cookie || '');
  for (const part of rawHeader.split(';')) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0 || trimmed.slice(0, separatorIndex).trim() !== cookieName) {
      continue;
    }
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return '';
}

export function serializeOAuthTransactionCookie(transactionId, value, {
  secure = true,
  maxAgeSeconds = Math.ceil(STATE_TTL_MS / 1000),
} = {}) {
  const cookieName = getOAuthTransactionCookieName(transactionId, { secure });
  if (!cookieName) {
    throw new Error('oauth_transaction_id_invalid');
  }

  const parts = [
    `${cookieName}=${encodeURIComponent(value || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export async function persistOAuthTransaction(adminClient, {
  transactionId,
  provider,
  intent,
  returnTo,
  browserBindingHash,
  pkceCodeVerifier,
  startedSessionId = null,
  startedUserId = null,
  now = Date.now(),
  ttlMs = STATE_TTL_MS,
} = {}) {
  if (!adminClient?.from) {
    return { ok: false, code: 'oauth_session_unavailable' };
  }

  const normalizedIntent = normalizeOAuthIntent(intent);
  if (!normalizedIntent) {
    return { ok: false, code: 'oauth_intent_invalid' };
  }

  const row = {
    id: String(transactionId || '').trim(),
    provider: String(provider || '').trim().toLowerCase(),
    intent: normalizedIntent,
    return_to: String(returnTo || '/'),
    browser_binding_hash: String(browserBindingHash || '').trim(),
    pkce_code_verifier: String(pkceCodeVerifier || '').trim(),
    started_session_id: startedSessionId || null,
    started_user_id: startedUserId || null,
    created_at: new Date(Number(now)).toISOString(),
    expires_at: new Date(Number(now) + Number(ttlMs)).toISOString(),
  };

  if (
    !row.id
    || !row.provider
    || !row.browser_binding_hash
    || !row.pkce_code_verifier
    || (normalizedIntent === 'link' && (!row.started_session_id || !row.started_user_id))
  ) {
    return { ok: false, code: 'oauth_transaction_invalid' };
  }

  const { error: cleanupError } = await adminClient
    .from(OAUTH_TRANSACTION_TABLE)
    .delete()
    .lte('expires_at', row.created_at);
  if (cleanupError) {
    return {
      ok: false,
      code: cleanupError.code || 'oauth_transaction_cleanup_failed',
      reason: cleanupError.message,
    };
  }

  const { data, error } = await adminClient
    .from(OAUTH_TRANSACTION_TABLE)
    .insert(row)
    .select('*')
    .single();

  if (error) {
    return {
      ok: false,
      code: error.code || 'oauth_transaction_create_failed',
      reason: error.message,
    };
  }

  return { ok: true, transaction: data || row };
}

export async function consumeOAuthTransaction(adminClient, {
  transactionId,
  provider,
  browserBindingHash,
  now = Date.now(),
} = {}) {
  if (!adminClient?.from) {
    return { ok: false, code: 'oauth_session_unavailable' };
  }
  if (!transactionId || !provider || !browserBindingHash) {
    return { ok: false, code: 'oauth_transaction_invalid' };
  }

  const consumedAt = new Date(Number(now)).toISOString();
  const query = adminClient
    .from(OAUTH_TRANSACTION_TABLE)
    .delete()
    .eq('id', String(transactionId))
    .eq('provider', String(provider).trim().toLowerCase())
    .eq('browser_binding_hash', String(browserBindingHash))
    .gt('expires_at', consumedAt)
    .select('*');
  const { data, error } = typeof query.maybeSingle === 'function'
    ? await query.maybeSingle()
    : await query.single();

  if (error) {
    return {
      ok: false,
      code: error.code || 'oauth_transaction_consume_failed',
      reason: error.message,
    };
  }
  if (!data?.id) {
    return { ok: false, code: 'oauth_transaction_invalid_or_consumed' };
  }

  return { ok: true, transaction: data };
}

export function createOAuthState({
  provider,
  returnTo = '/',
  intent = 'login',
  transactionId = randomUUID(),
  now = Date.now(),
  ttlMs = STATE_TTL_MS,
} = {}, {
  env = readEnvironment(),
  req = null,
  secret = getOAuthStateSecret(env),
} = {}) {
  if (!secret) {
    throw new Error('oauth_state_secret_missing');
  }

  const payload = {
    provider: String(provider || '').trim().toLowerCase(),
    intent: String(intent || 'login').trim().toLowerCase(),
    returnTo: normalizeOAuthReturnTo(returnTo, env, req),
    transactionId: String(transactionId || '').trim(),
    nonce: randomBytes(16).toString('base64url'),
    createdAt: Number(now),
    expiresAt: Number(now) + ttlMs,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = hmacSha256(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyOAuthState(state, {
  expectedProvider = '',
  env = readEnvironment(),
  secret = getOAuthStateSecret(env),
  now = Date.now(),
} = {}) {
  if (!secret) {
    return { ok: false, code: 'oauth_state_secret_missing' };
  }

  const [encodedPayload, signature, extra] = String(state || '').split('.');
  if (!encodedPayload || !signature || extra) {
    return { ok: false, code: 'oauth_state_malformed' };
  }

  const expectedSignature = hmacSha256(encodedPayload, secret);
  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, code: 'oauth_state_invalid_signature' };
  }

  let payload = null;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload));
  } catch {
    return { ok: false, code: 'oauth_state_invalid_payload' };
  }

  if (expectedProvider && payload?.provider !== expectedProvider) {
    return { ok: false, code: 'oauth_state_provider_mismatch' };
  }

  if (!payload?.transactionId) {
    return { ok: false, code: 'oauth_state_transaction_missing' };
  }

  if (!Number.isFinite(Number(payload?.expiresAt)) || Number(payload.expiresAt) <= Number(now)) {
    return { ok: false, code: 'oauth_state_expired' };
  }

  return {
    ok: true,
    payload: {
      ...payload,
      returnTo: normalizeOAuthReturnTo(payload.returnTo, env),
    },
  };
}

export function createSignedOAuthCookie(payload, {
  env = readEnvironment(),
  secret = getOAuthStateSecret(env),
  now = Date.now(),
  ttlMs = PENDING_TTL_MS,
} = {}) {
  if (!secret) {
    throw new Error('oauth_state_secret_missing');
  }

  const safePayload = {
    provider: String(payload?.provider || '').trim().toLowerCase(),
    displayName: String(payload?.displayName || '').trim().slice(0, 80),
    avatarUrl: String(payload?.avatarUrl || '').trim().slice(0, 500),
    subjectHash: String(payload?.subjectHash || '').trim(),
    profileHash: String(payload?.profileHash || '').trim(),
    createdAt: Number(now),
    expiresAt: Number(now) + ttlMs,
  };
  const encodedPayload = toBase64Url(JSON.stringify(safePayload));
  return `${encodedPayload}.${hmacSha256(encodedPayload, secret)}`;
}

export function serializeOAuthPendingCookie(value, {
  secure = true,
  maxAgeSeconds = Math.ceil(PENDING_TTL_MS / 1000),
} = {}) {
  const parts = [
    `ef_oauth_pending=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
