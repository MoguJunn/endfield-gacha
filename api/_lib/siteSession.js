import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { findAuthUserByEmail, loadAuthUserById } from './authAdmin.js';
import { resolveSupabaseUrl } from './supabaseEnv.js';

const DEFAULT_SESSION_COOKIE = '__Host-eg_session';
const DEFAULT_REFRESH_COOKIE = '__Secure-eg_refresh';
const LOCAL_SESSION_COOKIE = 'eg_session';
const LOCAL_REFRESH_COOKIE = 'eg_refresh';
const DEFAULT_SESSION_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_COMPAT_JWT_TTL_SECONDS = 60 * 60;
const SYNTHETIC_EMAIL_DOMAIN = 'oauth.local.invalid';
const PROFILE_FIELDS = 'id, username, email, role, created_at, updated_at, last_seen_at';

function readEnvironment() {
  return globalThis.process?.env || {};
}

function normalizeString(value, maxLength = 512) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, defaultValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function hmacHex(value, secret) {
  return createHmac('sha256', secret).update(String(value || ''), 'utf8').digest('hex');
}

function hmacBase64Url(value, secret) {
  return createHmac('sha256', secret).update(String(value || ''), 'utf8').digest('base64url');
}

export function getSiteSessionSecret(env = readEnvironment()) {
  return normalizeString(
    env.APP_SESSION_SECRET
    || env.OAUTH_STATE_SECRET
    || env.AUTH_SECURITY_HASH_SECRET
    || env.SUPABASE_JWT_SECRET
    || '',
    4096
  );
}

export function getSiteSessionConfig(env = readEnvironment(), {
  secure = true,
} = {}) {
  const defaultSessionCookie = secure ? DEFAULT_SESSION_COOKIE : LOCAL_SESSION_COOKIE;
  const defaultRefreshCookie = secure ? DEFAULT_REFRESH_COOKIE : LOCAL_REFRESH_COOKIE;
  const configuredRefreshCookie = normalizeString(
    env.APP_REFRESH_COOKIE_NAME || defaultRefreshCookie,
    80
  );
  const refreshCookieName = secure && configuredRefreshCookie.startsWith('__Host-')
    ? `__Secure-${configuredRefreshCookie.slice('__Host-'.length)}`
    : configuredRefreshCookie;
  return {
    secret: getSiteSessionSecret(env),
    sessionCookieName: normalizeString(env.APP_SESSION_COOKIE_NAME || defaultSessionCookie, 80),
    refreshCookieName,
    sessionTtlSeconds: parseInteger(env.APP_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS),
    idleTtlSeconds: parseInteger(env.APP_SESSION_IDLE_TTL_SECONDS, DEFAULT_IDLE_TTL_SECONDS),
    absoluteTtlSeconds: parseInteger(env.APP_SESSION_ABSOLUTE_TTL_SECONDS, DEFAULT_ABSOLUTE_TTL_SECONDS),
    compatJwtTtlSeconds: parseInteger(env.APP_SESSION_COMPAT_JWT_TTL_SECONDS, DEFAULT_COMPAT_JWT_TTL_SECONDS),
  };
}

export function isSecureRequest(req, env = readEnvironment()) {
  const appUrl = normalizeString(env.APP_URL || env.VITE_APP_URL || '');
  if (appUrl.startsWith('https://')) {
    return true;
  }
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

export function parseCookieHeader(headerValue) {
  const cookies = {};
  String(headerValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex <= 0) {
        return;
      }
      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    });
  return cookies;
}

export function serializeCookie(name, value, {
  maxAgeSeconds,
  path = '/',
  httpOnly = true,
  secure = true,
  sameSite = 'Lax',
} = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value || '')}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];
  if (Number.isFinite(Number(maxAgeSeconds))) {
    parts.push(`Max-Age=${Math.max(0, Number(maxAgeSeconds))}`);
  }
  if (httpOnly) {
    parts.push('HttpOnly');
  }
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function appendSetCookieHeader(res, cookieValue) {
  const current = res.getHeader?.('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  const next = Array.isArray(current) ? [...current, cookieValue] : [String(current), cookieValue];
  res.setHeader('Set-Cookie', next);
}

export function clearSiteSessionCookies(res, req, env = readEnvironment()) {
  const secure = isSecureRequest(req, env);
  const config = getSiteSessionConfig(env, { secure });
  appendSetCookieHeader(res, serializeCookie(config.sessionCookieName, '', {
    maxAgeSeconds: 0,
    secure,
  }));
  appendSetCookieHeader(res, serializeCookie(config.refreshCookieName, '', {
    maxAgeSeconds: 0,
    secure,
    path: '/api/auth/session',
  }));
}

function createRandomToken() {
  return randomBytes(32).toString('base64url');
}

function hashToken(token, secret, purpose = 'session') {
  return hmacHex(`${purpose}:${token}`, secret);
}

function getRequesterIp(req) {
  const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || String(req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress || '').trim();
}

function getIpPrefix(ip) {
  const normalized = normalizeString(ip, 128);
  if (!normalized) {
    return '';
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
    return normalized.split('.').slice(0, 3).join('.');
  }
  if (normalized.includes(':')) {
    return normalized.split(':').slice(0, 4).join(':');
  }
  return normalized.slice(0, 32);
}

function buildRequesterHash(req, secret) {
  const parts = [
    getIpPrefix(getRequesterIp(req)),
    normalizeString(req?.headers?.origin || '', 200),
  ].join('|');
  return hmacHex(`requester:${parts}`, secret);
}

function buildUserAgentHash(req, secret) {
  const userAgent = normalizeString(req?.headers?.['user-agent'] || '', 500);
  return userAgent ? hmacHex(`ua:${userAgent}`, secret) : null;
}

function buildIpPrefixHash(req, secret) {
  const prefix = getIpPrefix(getRequesterIp(req));
  return prefix ? hmacHex(`ip:${prefix}`, secret) : null;
}

function normalizeUsername(value, fallback) {
  const candidate = normalizeString(value || fallback || '', 80)
    .replace(/[^\dA-Za-z_\-+.\u3040-\u30ff\u3400-\u9fff]/g, '')
    .trim();
  if (candidate.length >= 2) {
    return candidate.slice(0, 50);
  }
  return normalizeString(fallback || 'oauth_user', 50) || 'oauth_user';
}

export function buildSyntheticOAuthEmail(provider, subjectHash) {
  const providerPart = normalizeString(provider, 20).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'oauth';
  const subjectPart = normalizeString(subjectHash, 64).replace(/[^a-f0-9]/gi, '').slice(0, 32) || randomBytes(8).toString('hex');
  return `${providerPart}.${subjectPart}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

function isSyntheticEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}

function hasUsableEmail(profile = null, authUser = null) {
  const email = normalizeString(profile?.email || authUser?.email || '', 320).toLowerCase();
  return Boolean(email && !isSyntheticEmail(email));
}

function hasSitePassword(authUser = null) {
  const encryptedPassword = normalizeString(authUser?.encrypted_password, 200);
  const metadata = authUser?.user_metadata || authUser?.raw_user_meta_data || {};
  return Boolean(
    encryptedPassword
    || metadata?.synthetic_oauth_email === false
    || metadata?.email_bound_from_profile === true
    || metadata?.site_password_set === true
  );
}

function hasVerifiedPasswordLoginFromAuthPayload(profile = null, authUser = null) {
  const profileEmail = normalizeString(profile?.email, 320).toLowerCase();
  const authEmail = normalizeString(authUser?.email, 320).toLowerCase();
  return Boolean(
    profileEmail
    && authEmail
    && profileEmail === authEmail
    && !isSyntheticEmail(authEmail)
    && (authUser?.email_confirmed_at || authUser?.confirmed_at)
    && hasSitePassword(authUser)
  );
}

async function hasVerifiedPasswordLogin(adminClient, {
  userId,
  profile = null,
  authUser = null,
} = {}) {
  if (typeof adminClient?.rpc === 'function' && userId) {
    const { data, error } = await adminClient.rpc('has_verified_password_login', {
      p_user_id: userId,
    });
    if (error) {
      throw Object.assign(new Error(error.message || 'password_login_state_lookup_failed'), {
        code: error.code || 'password_login_state_lookup_failed',
      });
    }
    return data === true;
  }

  return hasVerifiedPasswordLoginFromAuthPayload(profile, authUser);
}

export async function checkAccountCredentialAllowed(adminClient, userId) {
  if (!userId) {
    return { ok: false, allowed: false, code: 'credential_user_missing' };
  }
  if (typeof adminClient?.rpc !== 'function') {
    return { ok: true, allowed: true, legacy: true };
  }
  const { data, error } = await adminClient.rpc('is_account_credential_allowed', {
    p_user_id: userId,
  });
  if (error) {
    return {
      ok: false,
      allowed: false,
      code: error.code || 'credential_state_lookup_failed',
      reason: error.message,
    };
  }
  return {
    ok: true,
    allowed: data === true,
    code: data === true ? null : 'temporary_password_expired',
  };
}

function buildPublicUser({
  userId,
  profile = null,
  authUser = null,
  provider = '',
  emailVerified = false,
}) {
  const rawEmail = profile?.email || authUser?.email || '';
  const email = isSyntheticEmail(rawEmail) ? null : (rawEmail || null);
  const normalizedEmail = normalizeString(email, 320).toLowerCase();
  const normalizedAuthEmail = isSyntheticEmail(authUser?.email)
    ? ''
    : normalizeString(authUser?.email, 320).toLowerCase();
  const authEmailVerified = Boolean(
    normalizedEmail
    && normalizedAuthEmail
    && normalizedEmail === normalizedAuthEmail
    && (authUser?.email_confirmed_at || authUser?.confirmed_at)
  );
  const effectiveEmailVerified = Boolean(email && (emailVerified || authEmailVerified));
  const username = profile?.username || authUser?.user_metadata?.username || authUser?.raw_user_meta_data?.username || 'oauth_user';
  const verifiedAt = effectiveEmailVerified
    ? authUser?.email_confirmed_at || authUser?.confirmed_at || profile?.updated_at || profile?.created_at || null
    : null;
  return {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: verifiedAt,
    confirmed_at: verifiedAt,
    app_metadata: {
      provider: provider || 'site_session',
      providers: [provider || 'site_session'],
    },
    user_metadata: {
      username,
      display_name: username,
      site_session: true,
      email_verified: effectiveEmailVerified,
    },
    created_at: profile?.created_at || authUser?.created_at || null,
    updated_at: profile?.updated_at || authUser?.updated_at || null,
    site_session: true,
    profile_role: profile?.role || 'user',
  };
}

async function loadProfile(adminClient, userId) {
  const { data, error } = await adminClient
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data || null;
}

async function loadSessionByTokenHash(adminClient, tokenHash) {
  if (!tokenHash) {
    return null;
  }

  const now = new Date();
  const { data: sessionRow, error } = await adminClient
    .from('app_sessions')
    .select('*')
    .eq('session_token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', now.toISOString())
    .gt('absolute_expires_at', now.toISOString())
    .maybeSingle();

  if (error) {
    throw error;
  }

  return sessionRow || null;
}

async function loadSessionByRefreshTokenHash(adminClient, refreshTokenHash, config) {
  if (!refreshTokenHash) {
    return null;
  }

  const now = new Date();
  const idleCutoff = new Date(now.getTime() - config.idleTtlSeconds * 1000);
  const { data: sessionRow, error } = await adminClient
    .from('app_sessions')
    .select('*')
    .eq('refresh_token_hash', refreshTokenHash)
    .is('revoked_at', null)
    .gt('last_seen_at', idleCutoff.toISOString())
    .gt('absolute_expires_at', now.toISOString())
    .maybeSingle();

  if (error) {
    throw error;
  }

  return sessionRow || null;
}

async function rotateSessionTokens(adminClient, {
  sessionRow,
  expectedRefreshTokenHash,
  req,
  res,
  env,
  config,
  reason = 'session_refresh',
}) {
  const now = new Date();
  const secure = isSecureRequest(req, env);
  const expiresAtMs = now.getTime() + config.sessionTtlSeconds * 1000;
  const absoluteExpiresAtMs = new Date(sessionRow.absolute_expires_at).getTime();
  const expiresAt = new Date(Math.min(expiresAtMs, absoluteExpiresAtMs));

  const sessionToken = createRandomToken();
  const refreshToken = createRandomToken();
  if (typeof adminClient?.rpc !== 'function') {
    throw Object.assign(new Error('Atomic session rotation RPC is unavailable'), {
      code: 'site_session_rotation_unavailable',
    });
  }
  const rotateQuery = adminClient.rpc('rotate_app_session_tokens', {
    p_session_id: sessionRow.id,
    p_expected_refresh_token_hash: expectedRefreshTokenHash,
    p_new_session_token_hash: hashToken(sessionToken, config.secret, 'session'),
    p_new_refresh_token_hash: hashToken(refreshToken, config.secret, 'refresh'),
    p_expires_at: expiresAt.toISOString(),
    p_idle_cutoff: new Date(now.getTime() - config.idleTtlSeconds * 1000).toISOString(),
  });
  const { data, error } = typeof rotateQuery?.maybeSingle === 'function'
    ? await rotateQuery.maybeSingle()
    : await rotateQuery;
  const rotatedSession = Array.isArray(data) ? data[0] || null : data || null;

  if (error) {
    throw error;
  }
  if (!rotatedSession?.id) {
    return null;
  }

  appendSetCookieHeader(res, serializeCookie(config.sessionCookieName, sessionToken, {
    maxAgeSeconds: config.sessionTtlSeconds,
    secure,
  }));
  appendSetCookieHeader(res, serializeCookie(config.refreshCookieName, refreshToken, {
    maxAgeSeconds: config.absoluteTtlSeconds,
    secure,
    path: '/api/auth/session',
  }));

  await persistAuthAudit(adminClient, {
    userId: sessionRow.user_id,
    provider: 'site_session',
    eventType: 'site_session_refreshed',
    outcome: 'success',
    req,
    secret: config.secret,
    metadata: {
      reason,
    },
  });

  return {
    ...rotatedSession,
    expires_at: expiresAt.toISOString(),
    last_seen_at: now.toISOString(),
  };
}

async function upsertOAuthProfile(adminClient, {
  userId,
  profile,
}) {
  const username = normalizeUsername(
    profile?.displayName || profile?.username,
    `${profile?.provider || 'oauth'}_${String(userId || '').replace(/-/g, '').slice(0, 8)}`
  );
  const email = profile?.provider !== 'github' && profile?.emailVerified === true
    ? normalizeString(profile?.email, 320).toLowerCase() || null
    : null;
  const { data, error } = await adminClient
    .from('profiles')
    .upsert({
      id: userId,
      username,
      email,
      role: 'user',
    }, {
      onConflict: 'id',
    })
    .select(PROFILE_FIELDS)
    .single();

  if (error) {
    throw error;
  }
  return data || null;
}

async function upsertOAuthSecurityState(adminClient, {
  userId,
  profile,
  authUser,
  created = false,
}) {
  if (!adminClient?.from || !userId) {
    return null;
  }

  const requiresEmail = !hasUsableEmail(profile, authUser);
  if (typeof adminClient?.rpc === 'function') {
    const refreshQuery = adminClient.rpc('refresh_oauth_account_security_state', {
      p_user_id: userId,
      p_requires_email: requiresEmail,
      p_created: created,
      p_capability_id: created ? randomUUID() : null,
    });
    const { data, error } = typeof refreshQuery?.maybeSingle === 'function'
      ? await refreshQuery.maybeSingle()
      : await refreshQuery;
    if (error) {
      throw Object.assign(new Error(error.message || 'oauth_security_state_refresh_failed'), {
        code: error.code || 'oauth_security_state_refresh_failed',
      });
    }
    return Array.isArray(data) ? data[0] || null : data || null;
  }

  const requiresPassword = created
    ? !hasSitePassword(authUser)
    : !await hasVerifiedPasswordLogin(adminClient, {
      userId,
      profile,
      authUser,
    });
  if (!requiresEmail && !requiresPassword) {
    return null;
  }

  const now = new Date().toISOString();
  const patch = {
    user_id: userId,
    updated_at: now,
  };
  if (requiresEmail) {
    patch.email_verification_required = true;
    patch.email_verification_reason = created
      ? 'oauth_email_setup_required'
      : 'oauth_email_setup_required_existing';
    patch.email_verification_requested_at = now;
    patch.email_verification_token_hash = null;
    patch.email_verification_token_expires_at = null;
    patch.email_verification_code_hash = null;
    patch.email_verification_code_expires_at = null;
  }
  if (requiresPassword) {
    patch.password_change_required = true;
    patch.password_change_reason = created
      ? 'oauth_password_setup_required'
      : 'oauth_password_setup_required_existing';
    patch.password_change_source = 'oauth';
    patch.password_change_requested_at = now;
    patch.password_change_expires_at = null;
    patch.password_change_recovery_request_id = null;
    patch.password_change_set_by = null;
    if (created) {
      patch.password_setup_capability_id = randomUUID();
      patch.password_setup_capability_status = 'available';
      patch.password_setup_claimed_at = null;
      patch.password_setup_completed_at = null;
      patch.password_setup_attempt_count = 0;
      patch.password_setup_last_error_code = null;
    }
  }

  const { data, error } = await adminClient
    .from('account_security_states')
    .upsert(patch, {
      onConflict: 'user_id',
    })
    .select('*')
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data || null;
}

function toClientSiteIdentity(row) {
  if (!row?.provider) {
    return null;
  }
  const displayName = normalizeString(row.display_name, 120);
  return {
    id: row.id,
    provider: row.provider,
    source: 'site_session',
    created_at: row.linked_at || null,
    updated_at: row.last_used_at || row.linked_at || null,
    last_sign_in_at: row.last_used_at || null,
    disabled_at: row.disabled_at || null,
    identity_data: {
      provider: row.provider,
      name: displayName,
      username: displayName,
      full_name: displayName,
      avatar_url: normalizeString(row.avatar_url, 500),
      email_verified: row.email_verified === true,
      site_session: true,
    },
  };
}

export async function loadSiteAuthIdentities(adminClient, {
  userId,
  includeDisabled = false,
} = {}) {
  if (!adminClient?.from || !userId) {
    return [];
  }

  let query = adminClient
    .from('app_auth_identities')
    .select('id, provider, display_name, avatar_url, email_verified, linked_at, last_used_at, disabled_at')
    .eq('user_id', userId);

  if (!includeDisabled) {
    query = query.is('disabled_at', null);
  }

  const { data, error } = await query.order('linked_at', { ascending: true });
  if (error) {
    throw error;
  }

  return (Array.isArray(data) ? data : [])
    .map(toClientSiteIdentity)
    .filter(Boolean);
}

async function persistAuthAudit(adminClient, {
  userId = null,
  provider = '',
  eventType = 'site_auth',
  outcome = 'unknown',
  req = null,
  metadata = {},
  secret,
}) {
  try {
    await adminClient
      .from('app_auth_audit_events')
      .insert({
        user_id: userId,
        event_type: eventType,
        provider: provider || null,
        outcome,
        requester_hash: secret && req ? buildRequesterHash(req, secret) : null,
        metadata,
      });
  } catch {
    // Audit failure must not block sign-in.
  }
}

async function createOAuthAuthUser(adminClient, {
  profile,
  subjectHash,
  subjectHashVersion = 'legacy_state_v1',
}) {
  const provider = normalizeString(profile?.provider, 40) || 'oauth';
  const username = normalizeUsername(profile?.displayName || profile?.username, `${provider}_${subjectHash.slice(0, 8)}`);
  const syntheticEmail = buildSyntheticOAuthEmail(provider, subjectHash);
  const createUser = adminClient?.auth?.admin?.createUser;
  if (typeof createUser !== 'function') {
    throw new Error('auth_create_user_unavailable');
  }

  const { data, error } = await createUser.call(adminClient.auth.admin, {
    email: syntheticEmail,
    email_confirm: true,
    user_metadata: {
      username,
      display_name: profile?.displayName || username,
      avatar_url: profile?.avatarUrl || '',
      auth_provider: provider,
      synthetic_oauth_email: true,
      oauth_identity_hash: subjectHash,
      oauth_identity_hash_key_version: subjectHashVersion,
    },
  });

  if (error) {
    error.code = error.code || 'auth_create_user_failed';
    throw error;
  }

  const user = data?.user || data || null;
  if (!user?.id) {
    throw new Error('auth_create_user_empty');
  }
  return user;
}

async function recoverOAuthAuthUser(adminClient, {
  profile,
  subjectHash,
  subjectHashVersion,
  previousSubjectHash = '',
  previousSubjectHashVersion = '',
  legacySubjectHash = '',
  legacySubjectHashVersion = '',
}) {
  if (typeof adminClient?.auth?.admin?.listUsers !== 'function') {
    return null;
  }

  const candidates = [
    { hash: subjectHash, version: subjectHashVersion },
    { hash: previousSubjectHash, version: previousSubjectHashVersion },
    { hash: legacySubjectHash, version: legacySubjectHashVersion },
  ].filter((candidate) => candidate.hash && candidate.version);

  for (const candidate of candidates) {
    const syntheticEmail = buildSyntheticOAuthEmail(profile.provider, candidate.hash);
    const authUser = await findAuthUserByEmail(adminClient, syntheticEmail);
    if (!authUser?.id) {
      continue;
    }
    const metadata = authUser.user_metadata || authUser.raw_user_meta_data || {};
    const authEmail = normalizeString(authUser.email, 320).toLowerCase();
    const matchesVersionedMetadata = metadata.oauth_identity_hash === candidate.hash
      && metadata.oauth_identity_hash_key_version === candidate.version;
    const matchesUnversionedLegacyMetadata = candidate.version === 'legacy_state_v1'
      && !metadata.oauth_identity_hash
      && !metadata.oauth_identity_hash_key_version;
    if (
      authEmail === syntheticEmail
      && metadata.auth_provider === profile.provider
      && metadata.synthetic_oauth_email === true
      && (matchesVersionedMetadata || matchesUnversionedLegacyMetadata)
    ) {
      return authUser;
    }
  }

  return null;
}

function sanitizeIdentityMetadata(profile) {
  const metadata = profile?.metadata && typeof profile.metadata === 'object' ? profile.metadata : {};
  const ignoresProviderEmail = profile?.provider === 'github';
  return {
    usernamePresent: Boolean(profile?.username),
    emailPresent: ignoresProviderEmail ? false : Boolean(profile?.email),
    avatarPresent: Boolean(profile?.avatarUrl),
    active: metadata.active === true ? true : metadata.active === false ? false : null,
    trustLevel: Number.isFinite(Number(metadata.trustLevel)) ? Number(metadata.trustLevel) : null,
    profileUrlPresent: Boolean(metadata.profileUrl),
    providerEmailIgnoredForSiteAuth: ignoresProviderEmail || metadata.emailIgnored === true,
  };
}

async function upsertOAuthIdentity(adminClient, {
  userId,
  profile,
  subjectHash,
  subjectHashVersion = '',
  previousSubjectHash = '',
  legacySubjectHash = '',
  profileHash,
  secret,
}) {
  const email = profile?.provider === 'github'
    ? ''
    : normalizeString(profile?.email, 320).toLowerCase();
  const identityPayload = {
    user_id: userId,
    provider: profile.provider,
    provider_subject_hash: subjectHash,
    ...(subjectHashVersion ? {
      provider_subject_hash_key_version: subjectHashVersion,
    } : {}),
    display_name: normalizeString(profile.displayName || profile.username, 120) || null,
    avatar_url: normalizeString(profile.avatarUrl, 500) || null,
    email_hash: email ? hmacHex(`email:${email}`, secret) : null,
    email_verified: profile?.provider === 'github' ? false : profile.emailVerified === true,
    raw_profile_hash: profileHash || null,
    last_used_at: new Date().toISOString(),
    disabled_at: null,
    metadata_redacted_json: sanitizeIdentityMetadata(profile),
  };
  let claimedIdentity = null;
  if (subjectHashVersion) {
    if (typeof adminClient?.rpc !== 'function') {
      const unavailableError = new Error('OAuth identity claim RPC is unavailable');
      unavailableError.code = 'oauth_identity_claim_unavailable';
      throw unavailableError;
    }
    const claimQuery = adminClient.rpc('claim_oauth_identity_v2', {
      p_user_id: userId,
      p_provider: profile.provider,
      p_current_hash: subjectHash,
      p_current_version: subjectHashVersion,
      p_candidate_hashes: [previousSubjectHash, legacySubjectHash].filter(Boolean),
    });
    const { data: claimData, error: claimError } = typeof claimQuery?.maybeSingle === 'function'
      ? await claimQuery.maybeSingle()
      : await claimQuery;
    if (claimError) {
      const error = new Error(claimError.message || 'OAuth identity claim failed');
      error.code = String(claimError.message || '').includes('oauth_identity_already_linked')
        ? 'oauth_identity_already_linked'
        : (claimError.code || 'oauth_identity_claim_failed');
      throw error;
    }
    claimedIdentity = Array.isArray(claimData) ? claimData[0] || null : claimData || null;
    if (!claimedIdentity?.id) {
      const emptyError = new Error('OAuth identity claim returned no identity');
      emptyError.code = 'oauth_identity_claim_empty';
      throw emptyError;
    }
  }

  const { data, error } = claimedIdentity
    ? await adminClient
      .from('app_auth_identities')
      .update({
        display_name: identityPayload.display_name,
        avatar_url: identityPayload.avatar_url,
        email_hash: identityPayload.email_hash,
        email_verified: identityPayload.email_verified,
        raw_profile_hash: identityPayload.raw_profile_hash,
        last_used_at: identityPayload.last_used_at,
        disabled_at: null,
        metadata_redacted_json: identityPayload.metadata_redacted_json,
      })
      .eq('id', claimedIdentity.id)
      .eq('user_id', userId)
      .select('*')
      .single()
    : await adminClient
      .from('app_auth_identities')
      .insert(identityPayload)
      .select('*')
      .single();

  if (!error) {
    return data || null;
  }
  if (error.code !== '23505') {
    throw error;
  }

  const existingIdentity = await resolveOAuthIdentity(adminClient, {
    provider: profile.provider,
    subjectHash,
  });
  if (!existingIdentity?.id || existingIdentity.user_id !== userId) {
    const conflictError = new Error('OAuth identity already belongs to another user');
    conflictError.code = 'oauth_identity_already_linked';
    throw conflictError;
  }

  const { data: updatedIdentity, error: updateError } = await adminClient
    .from('app_auth_identities')
    .update({
      display_name: identityPayload.display_name,
      avatar_url: identityPayload.avatar_url,
      email_hash: identityPayload.email_hash,
      email_verified: identityPayload.email_verified,
      raw_profile_hash: identityPayload.raw_profile_hash,
      last_used_at: identityPayload.last_used_at,
      disabled_at: null,
      metadata_redacted_json: identityPayload.metadata_redacted_json,
    })
    .eq('id', existingIdentity.id)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (updateError) {
    throw updateError;
  }
  return updatedIdentity || null;
}

async function resolveOAuthIdentity(adminClient, {
  provider,
  subjectHash,
  previousSubjectHash = '',
  legacySubjectHash = '',
}) {
  const candidates = [subjectHash, previousSubjectHash, legacySubjectHash]
    .filter((hash, index, hashes) => hash && hashes.indexOf(hash) === index);
  for (const candidateHash of candidates) {
    const { data, error } = await adminClient
      .from('app_auth_identities')
      .select('*')
      .eq('provider', provider)
      .eq('provider_subject_hash', candidateHash)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (data) {
      return data;
    }
  }
  return null;
}

async function loadSiteIdentityById(adminClient, identityId) {
  const normalizedId = normalizeString(identityId, 80);
  if (!normalizedId) {
    return null;
  }
  const { data, error } = await adminClient
    .from('app_auth_identities')
    .select('*')
    .eq('id', normalizedId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data || null;
}

async function countActiveOAuthIdentities(adminClient, userId, {
  excludeIdentityId = '',
} = {}) {
  const identities = await loadSiteAuthIdentities(adminClient, {
    userId,
  });
  const excludedId = normalizeString(excludeIdentityId, 80);
  return identities.filter((identity) => identity.id !== excludedId).length;
}

export async function createSiteSession(adminClient, {
  userId,
  req,
  res,
  env = readEnvironment(),
  provider = 'site_session',
} = {}) {
  const secure = isSecureRequest(req, env);
  const config = getSiteSessionConfig(env, { secure });
  if (!config.secret) {
    return { ok: false, code: 'site_session_secret_missing' };
  }
  if (!adminClient?.from || !userId) {
    return { ok: false, code: 'site_session_admin_unavailable' };
  }

  const now = new Date();
  const sessionToken = createRandomToken();
  const refreshToken = createRandomToken();
  const expiresAtMs = now.getTime() + config.sessionTtlSeconds * 1000;
  const absoluteExpiresAtMs = now.getTime() + config.absoluteTtlSeconds * 1000;
  const expiresAt = new Date(Math.min(expiresAtMs, absoluteExpiresAtMs));
  const absoluteExpiresAt = new Date(absoluteExpiresAtMs);
  const { data, error } = await adminClient
    .from('app_sessions')
    .insert({
      user_id: userId,
      session_token_hash: hashToken(sessionToken, config.secret, 'session'),
      refresh_token_hash: hashToken(refreshToken, config.secret, 'refresh'),
      user_agent_hash: buildUserAgentHash(req, config.secret),
      ip_prefix_hash: buildIpPrefixHash(req, config.secret),
      last_seen_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      absolute_expires_at: absoluteExpiresAt.toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    return { ok: false, code: error.code || 'site_session_insert_failed', reason: error.message };
  }

  appendSetCookieHeader(res, serializeCookie(config.sessionCookieName, sessionToken, {
    maxAgeSeconds: config.sessionTtlSeconds,
    secure,
  }));
  appendSetCookieHeader(res, serializeCookie(config.refreshCookieName, refreshToken, {
    maxAgeSeconds: config.absoluteTtlSeconds,
    secure,
    path: '/api/auth/session',
  }));

  await persistAuthAudit(adminClient, {
    userId,
    provider,
    eventType: 'site_session_created',
    outcome: 'success',
    req,
    secret: config.secret,
  });

  return {
    ok: true,
    session: data,
    expiresAt: expiresAt.toISOString(),
    absoluteExpiresAt: absoluteExpiresAt.toISOString(),
  };
}

export async function createSiteSessionFromBearer(adminClient, {
  userId,
  sourceAuthSessionId,
  bearerIssuedAt,
  bearerExpiresAt,
  req,
  res,
  env = readEnvironment(),
} = {}) {
  const secure = isSecureRequest(req, env);
  const config = getSiteSessionConfig(env, { secure });
  const issuedAtMs = Number(bearerIssuedAt) * 1000;
  const bearerExpiresAtMs = Number(bearerExpiresAt) * 1000;
  if (
    !config.secret
    || !adminClient?.rpc
    || !userId
    || !sourceAuthSessionId
    || !Number.isFinite(issuedAtMs)
    || issuedAtMs <= 0
    || !Number.isFinite(bearerExpiresAtMs)
    || bearerExpiresAtMs <= Date.now()
  ) {
    return { ok: false, code: 'bearer_session_binding_invalid' };
  }

  const now = new Date();
  const sessionToken = createRandomToken();
  const refreshToken = createRandomToken();
  const absoluteExpiresAtMs = now.getTime() + config.absoluteTtlSeconds * 1000;
  const expiresAtMs = now.getTime() + config.sessionTtlSeconds * 1000;
  const rpcQuery = adminClient.rpc('create_or_rotate_bearer_app_session', {
    p_user_id: userId,
    p_source_auth_session_id: sourceAuthSessionId,
    p_bearer_issued_at: new Date(issuedAtMs).toISOString(),
    p_session_token_hash: hashToken(sessionToken, config.secret, 'session'),
    p_refresh_token_hash: hashToken(refreshToken, config.secret, 'refresh'),
    p_user_agent_hash: buildUserAgentHash(req, config.secret),
    p_ip_prefix_hash: buildIpPrefixHash(req, config.secret),
    p_expires_at: new Date(expiresAtMs).toISOString(),
    p_absolute_expires_at: new Date(absoluteExpiresAtMs).toISOString(),
  });
  const { data, error } = typeof rpcQuery?.maybeSingle === 'function'
    ? await rpcQuery.maybeSingle()
    : await rpcQuery;
  const session = Array.isArray(data) ? data[0] || null : data || null;

  if (error) {
    return { ok: false, code: error.code || 'site_session_insert_failed', reason: error.message };
  }
  if (!session?.id) {
    return { ok: false, code: 'bearer_session_revoked' };
  }

  appendSetCookieHeader(res, serializeCookie(config.sessionCookieName, sessionToken, {
    maxAgeSeconds: Math.max(1, Math.floor((expiresAtMs - now.getTime()) / 1000)),
    secure,
  }));
  appendSetCookieHeader(res, serializeCookie(config.refreshCookieName, refreshToken, {
    maxAgeSeconds: Math.max(1, Math.floor((absoluteExpiresAtMs - now.getTime()) / 1000)),
    secure,
    path: '/api/auth/session',
  }));

  await persistAuthAudit(adminClient, {
    userId,
    provider: 'supabase',
    eventType: 'site_session_created',
    outcome: 'success',
    req,
    secret: config.secret,
    metadata: {
      source: 'native_bearer',
    },
  });

  return {
    ok: true,
    session,
    expiresAt: new Date(expiresAtMs).toISOString(),
    absoluteExpiresAt: new Date(absoluteExpiresAtMs).toISOString(),
  };
}

export async function loadSiteSession(adminClient, {
  req,
  res = null,
  env = readEnvironment(),
  touch = true,
} = {}) {
  const secure = isSecureRequest(req, env);
  const config = getSiteSessionConfig(env, { secure });
  if (!config.secret || !adminClient?.from) {
    return { ok: false, authenticated: false, code: 'site_session_unavailable' };
  }

  const cookies = parseCookieHeader(req?.headers?.cookie || '');
  const token = cookies[config.sessionCookieName];
  const refreshToken = cookies[config.refreshCookieName];

  let sessionRow = null;
  let lookupError = null;
  if (token) {
    try {
      sessionRow = await loadSessionByTokenHash(adminClient, hashToken(token, config.secret, 'session'));
    } catch (error) {
      lookupError = error;
    }
  }

  let refreshRejected = false;
  if (!sessionRow && refreshToken && res) {
    try {
      const refreshTokenHash = hashToken(refreshToken, config.secret, 'refresh');
      const refreshRow = await loadSessionByRefreshTokenHash(adminClient, refreshTokenHash, config);
      if (refreshRow?.id) {
        const rotatedSession = await rotateSessionTokens(adminClient, {
          sessionRow: refreshRow,
          expectedRefreshTokenHash: refreshTokenHash,
          req,
          res,
          env,
          config,
          reason: 'session_refresh',
        });
        if (rotatedSession?.id) {
          sessionRow = rotatedSession;
        } else {
          refreshRejected = true;
        }
      } else {
        refreshRejected = true;
      }
    } catch (error) {
      lookupError = lookupError || error;
    }
  }

  if (lookupError) {
    return { ok: false, authenticated: false, code: lookupError.code || 'site_session_lookup_failed', reason: lookupError.message };
  }
  if (refreshRejected) {
    return { ok: true, authenticated: false, code: 'site_session_refresh_replayed' };
  }
  if (!sessionRow?.user_id) {
    return { ok: true, authenticated: false, code: 'site_session_missing' };
  }

  const credentialGate = await checkAccountCredentialAllowed(adminClient, sessionRow.user_id);
  if (!credentialGate.ok) {
    return {
      ok: false,
      authenticated: false,
      code: credentialGate.code || 'credential_state_lookup_failed',
      reason: credentialGate.reason,
    };
  }
  if (!credentialGate.allowed) {
    await adminClient
      .from('app_sessions')
      .update({
        revoked_at: new Date().toISOString(),
        revoke_reason: 'temporary_password_expired',
      })
      .eq('id', sessionRow.id)
      .is('revoked_at', null);
    return { ok: true, authenticated: false, code: 'temporary_password_expired' };
  }

  const now = new Date();
  const profile = await loadProfile(adminClient, sessionRow.user_id);
  const authUser = await loadAuthUserById(adminClient, sessionRow.user_id).catch(() => null);
  const identities = await loadSiteAuthIdentities(adminClient, {
    userId: sessionRow.user_id,
  });
  const hasVerifiedProviderEmail = identities.some((identity) => (
    identity?.identity_data?.email_verified === true
  ));
  if (touch) {
    await adminClient
      .from('app_sessions')
      .update({
        last_seen_at: now.toISOString(),
      })
      .eq('id', sessionRow.id);

    await adminClient
      .from('profiles')
      .update({ last_seen_at: now.toISOString() })
      .eq('id', sessionRow.user_id);
  }

  return {
    ok: true,
    authenticated: true,
    session: {
      ...sessionRow,
    },
    profile,
    identities,
    user: buildPublicUser({
      userId: sessionRow.user_id,
      profile,
      authUser,
      provider: 'site_session',
      emailVerified: hasVerifiedProviderEmail,
    }),
    config,
  };
}

export async function revokeSiteSession(adminClient, {
  req,
  res,
  env = readEnvironment(),
  reason = 'user_logout',
} = {}) {
  const secure = isSecureRequest(req, env);
  const config = getSiteSessionConfig(env, { secure });
  const cookies = parseCookieHeader(req?.headers?.cookie || '');
  const sessionToken = cookies[config.sessionCookieName];
  const refreshToken = cookies[config.refreshCookieName];
  if (res) {
    clearSiteSessionCookies(res, req, env);
  }

  if (!sessionToken && !refreshToken) {
    return { ok: true, revokedCount: 0 };
  }
  if (!config.secret || typeof adminClient?.rpc !== 'function') {
    return { ok: false, code: 'site_session_revoke_unavailable' };
  }

  const { data, error } = await adminClient.rpc('revoke_app_session_by_token_hashes', {
    p_session_token_hash: sessionToken
      ? hashToken(sessionToken, config.secret, 'session')
      : null,
    p_refresh_token_hash: refreshToken
      ? hashToken(refreshToken, config.secret, 'refresh')
      : null,
    p_reason: normalizeString(reason, 120) || 'user_logout',
    p_revoked_at: new Date().toISOString(),
  });
  if (error) {
    return {
      ok: false,
      code: error.code || 'site_session_revoke_failed',
      reason: error.message,
    };
  }

  return { ok: true, revokedCount: Math.max(0, Number(data) || 0) };
}

export async function loadActiveSiteSessionById(adminClient, {
  sessionId,
  userId,
  now = Date.now(),
} = {}) {
  const normalizedSessionId = normalizeString(sessionId, 80);
  const normalizedUserId = normalizeString(userId, 80);
  if (!adminClient?.from || !normalizedSessionId || !normalizedUserId) {
    return { ok: false, active: false, code: 'site_session_lookup_invalid' };
  }

  const nowIso = new Date(Number(now)).toISOString();
  const { data, error } = await adminClient
    .from('app_sessions')
    .select('id, user_id, expires_at, absolute_expires_at')
    .eq('id', normalizedSessionId)
    .eq('user_id', normalizedUserId)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .gt('absolute_expires_at', nowIso)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      active: false,
      code: error.code || 'site_session_lookup_failed',
      reason: error.message,
    };
  }

  return {
    ok: true,
    active: Boolean(data?.id),
    session: data || null,
  };
}

export async function loadActiveSiteSessionByBinding(adminClient, {
  sessionBinding,
  userId,
  now = Date.now(),
} = {}) {
  const normalizedBinding = normalizeString(sessionBinding, 80);
  const normalizedUserId = normalizeString(userId, 80);
  if (!adminClient?.from || !normalizedBinding || !normalizedUserId) {
    return { ok: false, active: false, code: 'site_session_lookup_invalid' };
  }

  const nowIso = new Date(Number(now)).toISOString();
  const { data, error } = await adminClient
    .from('app_sessions')
    .select('id, user_id, expires_at, absolute_expires_at')
    .eq('compat_session_binding', normalizedBinding)
    .eq('user_id', normalizedUserId)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .gt('absolute_expires_at', nowIso)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      active: false,
      code: error.code || 'site_session_lookup_failed',
      reason: error.message,
    };
  }

  return {
    ok: true,
    active: Boolean(data?.id),
    session: data || null,
  };
}

export async function revokeAllSiteSessionsForUser(adminClient, {
  userId,
  reason = 'credential_changed',
  now = Date.now(),
} = {}) {
  const normalizedUserId = normalizeString(userId, 80);
  if (!adminClient?.rpc || !normalizedUserId) {
    return { ok: false, code: 'site_session_revoke_invalid' };
  }

  const { data, error } = await adminClient.rpc('revoke_all_app_sessions_for_user', {
    p_user_id: normalizedUserId,
    p_reason: normalizeString(reason, 120) || 'credential_changed',
    p_revoked_at: new Date(Number(now)).toISOString(),
  });

  if (error) {
    return {
      ok: false,
      code: error.code || 'site_session_revoke_failed',
      reason: error.message,
    };
  }

  return {
    ok: true,
    revokedCount: Math.max(0, Number(data) || 0),
  };
}

export function createSupabaseCompatAccessToken({
  user,
  profile = null,
  sessionBinding = '',
  env = readEnvironment(),
  ttlSeconds,
} = {}) {
  if (!parseBoolean(env.APP_SESSION_COMPAT_JWT_ENABLED, true)) {
    return null;
  }

  const jwtSecret = normalizeString(env.SUPABASE_JWT_SECRET || '', 4096);
  if (!jwtSecret || !user?.id) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresIn = parseInteger(ttlSeconds, getSiteSessionConfig(env).compatJwtTtlSeconds);
  const email = isSyntheticEmail(user.email) ? '' : normalizeString(user.email, 320).toLowerCase();
  const supabaseUrl = resolveSupabaseUrl(env).replace(/\/$/, '');
  const payload = {
    iss: `${supabaseUrl || 'https://ef-gacha.mogujun.icu'}/auth/v1`,
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    phone: '',
    app_metadata: {
      provider: 'site_session',
      providers: ['site_session'],
    },
    user_metadata: {
      username: profile?.username || user?.user_metadata?.username || '',
      site_session: true,
    },
    aal: 'aal1',
    session_binding: sessionBinding || '',
    iat: nowSeconds,
    exp: nowSeconds + expiresIn,
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const unsigned = `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}`;
  return {
    accessToken: `${unsigned}.${hmacBase64Url(unsigned, jwtSecret)}`,
    expiresIn,
    expiresAt: nowSeconds + expiresIn,
  };
}

export async function createOrLinkOAuthUserAndSession(adminClient, {
  profile,
  subjectHash,
  subjectHashVersion = '',
  previousSubjectHash = '',
  previousSubjectHashVersion = '',
  legacySubjectHash = '',
  legacySubjectHashVersion = '',
  profileHash,
  req,
  res,
  env = readEnvironment(),
  secret = getSiteSessionSecret(env),
} = {}) {
  if (!adminClient?.from) {
    return { ok: false, code: 'admin_client_unavailable' };
  }
  if (!secret) {
    return { ok: false, code: 'site_session_secret_missing' };
  }
  if (!profile?.provider || !subjectHash) {
    return { ok: false, code: 'oauth_identity_invalid' };
  }

  let identity = await resolveOAuthIdentity(adminClient, {
    provider: profile.provider,
    subjectHash,
    previousSubjectHash,
    legacySubjectHash,
  });
  let authUser = null;
  let created = false;

  if (identity?.disabled_at) {
    await persistAuthAudit(adminClient, {
      userId: identity.user_id,
      provider: profile.provider,
      eventType: 'oauth_callback',
      outcome: 'identity_unlinked',
      req,
      secret,
      metadata: {
        identityId: identity.id || null,
      },
    });
    return { ok: false, code: 'oauth_identity_unlinked' };
  }

  if (!identity?.user_id) {
    authUser = await recoverOAuthAuthUser(adminClient, {
      profile,
      subjectHash,
      subjectHashVersion,
      previousSubjectHash,
      previousSubjectHashVersion,
      legacySubjectHash,
      legacySubjectHashVersion,
    });
    if (!authUser) {
      authUser = await createOAuthAuthUser(adminClient, {
        profile,
        subjectHash,
        subjectHashVersion,
      });
      created = true;
    }
    try {
      identity = await upsertOAuthIdentity(adminClient, {
        userId: authUser.id,
        profile,
        subjectHash,
        subjectHashVersion,
        previousSubjectHash,
        legacySubjectHash,
        profileHash,
        secret,
      });
    } catch (error) {
      if (created) {
        const deleteUser = adminClient?.auth?.admin?.deleteUser;
        if (typeof deleteUser === 'function') {
          await deleteUser.call(adminClient.auth.admin, authUser.id).catch(() => null);
        }
      }
      throw error;
    }
  } else {
    identity = await upsertOAuthIdentity(adminClient, {
      userId: identity.user_id,
      profile,
      subjectHash,
      subjectHashVersion,
      previousSubjectHash,
      legacySubjectHash,
      profileHash,
      secret,
    });
  }

  const userId = identity?.user_id || authUser?.id;
  if (!authUser && userId) {
    authUser = await loadAuthUserById(adminClient, userId);
  }
  const existingProfile = await loadProfile(adminClient, userId);
  const profileRow = existingProfile
    || await upsertOAuthProfile(adminClient, { userId, profile });
  await upsertOAuthSecurityState(adminClient, {
    userId,
    profile: profileRow,
    authUser,
    created,
  });

  const sessionResult = await createSiteSession(adminClient, {
    userId,
    req,
    res,
    env,
    provider: profile.provider,
  });

  if (!sessionResult.ok) {
    await persistAuthAudit(adminClient, {
      userId,
      provider: profile.provider,
      eventType: 'oauth_callback',
      outcome: sessionResult.code || 'site_session_failed',
      req,
      secret,
    });
    return sessionResult;
  }

  await persistAuthAudit(adminClient, {
    userId,
    provider: profile.provider,
    eventType: 'oauth_callback',
    outcome: created ? 'created_and_signed_in' : 'signed_in',
    req,
    secret,
    metadata: {
      identityId: identity?.id || null,
      created,
    },
  });

  return {
    ok: true,
    user: buildPublicUser({
      userId,
      profile: profileRow,
      authUser,
      provider: profile.provider,
      emailVerified: identity?.email_verified === true,
    }),
    profile: profileRow,
    session: sessionResult.session,
    created,
  };
}

export async function linkOAuthIdentityToSiteSession(adminClient, {
  profile,
  subjectHash,
  subjectHashVersion = '',
  previousSubjectHash = '',
  legacySubjectHash = '',
  profileHash,
  req,
  env = readEnvironment(),
  secret = getSiteSessionSecret(env),
} = {}) {
  if (!adminClient?.from) {
    return { ok: false, code: 'admin_client_unavailable' };
  }
  if (!secret) {
    return { ok: false, code: 'site_session_secret_missing' };
  }
  if (!profile?.provider || !subjectHash) {
    return { ok: false, code: 'oauth_identity_invalid' };
  }

  const sessionResult = await loadSiteSession(adminClient, {
    req,
    env,
    touch: true,
  }).catch((error) => ({
    ok: false,
    authenticated: false,
    code: error?.code || 'site_session_lookup_failed',
    reason: error?.message,
  }));

  if (!sessionResult?.authenticated || !sessionResult.user?.id) {
    await persistAuthAudit(adminClient, {
      provider: profile.provider,
      eventType: 'oauth_identity_link',
      outcome: 'site_session_required',
      req,
      secret,
    });
    return { ok: false, code: 'site_session_required' };
  }

  const existingIdentity = await resolveOAuthIdentity(adminClient, {
    provider: profile.provider,
    subjectHash,
    previousSubjectHash,
    legacySubjectHash,
  });

  if (existingIdentity?.user_id && existingIdentity.user_id !== sessionResult.user.id) {
    await persistAuthAudit(adminClient, {
      userId: sessionResult.user.id,
      provider: profile.provider,
      eventType: 'oauth_identity_link',
      outcome: 'identity_already_linked',
      req,
      secret,
      metadata: {
        identityId: existingIdentity.id || null,
      },
    });
    return { ok: false, code: 'oauth_identity_already_linked' };
  }

  const identity = await upsertOAuthIdentity(adminClient, {
    userId: sessionResult.user.id,
    profile,
    subjectHash,
    subjectHashVersion,
    previousSubjectHash,
    legacySubjectHash,
    profileHash,
    secret,
  });

  await persistAuthAudit(adminClient, {
    userId: sessionResult.user.id,
    provider: profile.provider,
    eventType: 'oauth_identity_link',
    outcome: existingIdentity?.disabled_at ? 'relinked' : 'linked',
    req,
    secret,
    metadata: {
      identityId: identity?.id || null,
    },
  });

  return {
    ok: true,
    identity: toClientSiteIdentity(identity),
    user: sessionResult.user,
  };
}

export async function unlinkSiteAuthIdentity(adminClient, {
  identityId,
  req,
  env = readEnvironment(),
  secret = getSiteSessionSecret(env),
} = {}) {
  if (!adminClient?.from) {
    return { ok: false, code: 'admin_client_unavailable' };
  }
  if (!secret) {
    return { ok: false, code: 'site_session_secret_missing' };
  }

  const sessionResult = await loadSiteSession(adminClient, {
    req,
    env,
    touch: true,
  }).catch((error) => ({
    ok: false,
    authenticated: false,
    code: error?.code || 'site_session_lookup_failed',
    reason: error?.message,
  }));

  if (!sessionResult?.authenticated || !sessionResult.user?.id) {
    return { ok: false, code: 'site_session_required' };
  }

  const identity = await loadSiteIdentityById(adminClient, identityId);
  if (!identity?.id || identity.disabled_at) {
    return { ok: false, code: 'oauth_identity_not_found' };
  }
  if (identity.user_id !== sessionResult.user.id) {
    await persistAuthAudit(adminClient, {
      userId: sessionResult.user.id,
      provider: identity.provider || null,
      eventType: 'oauth_identity_unlink',
      outcome: 'identity_forbidden',
      req,
      secret,
      metadata: {
        identityId: identity.id,
      },
    });
    return { ok: false, code: 'oauth_identity_forbidden' };
  }

  let data = null;
  let error = null;
  if (typeof adminClient?.rpc === 'function') {
    const unlinkQuery = adminClient.rpc('unlink_oauth_identity_atomically', {
      p_user_id: sessionResult.user.id,
      p_identity_id: identity.id,
    });
    const rpcResult = typeof unlinkQuery?.maybeSingle === 'function'
      ? await unlinkQuery.maybeSingle()
      : await unlinkQuery;
    data = Array.isArray(rpcResult?.data) ? rpcResult.data[0] || null : rpcResult?.data || null;
    error = rpcResult?.error || null;
    if (error) {
      const message = String(error.message || '');
      const code = [
        'oauth_identity_not_found',
        'oauth_identity_forbidden',
        'oauth_last_login_method',
        'oauth_identity_unlink_failed',
      ].find((candidate) => message.includes(candidate));
      if (code === 'oauth_last_login_method') {
        await persistAuthAudit(adminClient, {
          userId: sessionResult.user.id,
          provider: identity.provider || null,
          eventType: 'oauth_identity_unlink',
          outcome: 'last_login_method_blocked',
          req,
          secret,
          metadata: { identityId: identity.id },
        });
      }
      return { ok: false, code: code || error.code || 'oauth_identity_unlink_failed', reason: error.message };
    }
  } else {
    const remainingOAuthCount = await countActiveOAuthIdentities(adminClient, sessionResult.user.id, {
      excludeIdentityId: identity.id,
    });
    const profile = sessionResult.profile || await loadProfile(adminClient, sessionResult.user.id);
    const authUser = remainingOAuthCount < 1
      ? await loadAuthUserById(adminClient, sessionResult.user.id)
      : null;
    if (remainingOAuthCount < 1 && !hasVerifiedPasswordLoginFromAuthPayload(profile, authUser)) {
      return { ok: false, code: 'oauth_last_login_method' };
    }

    const legacyResult = await adminClient
      .from('app_auth_identities')
      .update({
        disabled_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      })
      .eq('id', identity.id)
      .eq('user_id', sessionResult.user.id)
      .is('disabled_at', null)
      .select('*')
      .single();
    data = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) {
    return { ok: false, code: error.code || 'oauth_identity_unlink_failed', reason: error.message };
  }

  await persistAuthAudit(adminClient, {
    userId: sessionResult.user.id,
    provider: identity.provider || null,
    eventType: 'oauth_identity_unlink',
    outcome: 'success',
    req,
    secret,
    metadata: {
      identityId: identity.id,
    },
  });

  return {
    ok: true,
    identity: toClientSiteIdentity(data),
  };
}

export default {
  appendSetCookieHeader,
  buildSyntheticOAuthEmail,
  checkAccountCredentialAllowed,
  clearSiteSessionCookies,
  linkOAuthIdentityToSiteSession,
  createOrLinkOAuthUserAndSession,
  createSiteSession,
  createSiteSessionFromBearer,
  createSupabaseCompatAccessToken,
  getSiteSessionConfig,
  getSiteSessionSecret,
  isSecureRequest,
  loadSiteAuthIdentities,
  loadSiteSession,
  parseCookieHeader,
  revokeAllSiteSessionsForUser,
  revokeSiteSession,
  serializeCookie,
  unlinkSiteAuthIdentity,
};
