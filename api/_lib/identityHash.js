import { createHmac } from 'node:crypto';
import { normalizeOAuthProvider } from './oauthProviders.js';

const MIN_IDENTITY_KEY_LENGTH = 32;
const DEFAULT_CURRENT_VERSION = 'v2';
const LEGACY_STATE_VERSION = 'legacy_state_v1';

function normalizeSecret(value) {
  return String(value || '').trim();
}

function normalizeVersion(value, fallback = '') {
  return String(value || fallback).trim().toLowerCase().slice(0, 40);
}

export function hashOAuthIdentitySubject(provider, subject, key) {
  const normalizedProvider = normalizeOAuthProvider(provider);
  const normalizedSubject = String(subject || '').trim();
  const normalizedKey = normalizeSecret(key);
  if (!normalizedProvider || !normalizedSubject || normalizedKey.length < MIN_IDENTITY_KEY_LENGTH) {
    throw new Error('oauth_identity_hash_input_invalid');
  }

  return createHmac('sha256', normalizedKey)
    .update(`endfield-gacha:oauth-identity:v1:${normalizedProvider}:${normalizedSubject}`, 'utf8')
    .digest('hex');
}

export function hashLegacyOAuthIdentitySubject(provider, subject, stateSecret) {
  const normalizedProvider = normalizeOAuthProvider(provider);
  const normalizedSubject = String(subject || '').trim();
  const normalizedSecret = normalizeSecret(stateSecret);
  if (!normalizedProvider || !normalizedSubject || !normalizedSecret) {
    throw new Error('oauth_legacy_identity_hash_input_invalid');
  }

  return createHmac('sha256', normalizedSecret)
    .update(`${normalizedProvider}:${normalizedSubject}`, 'utf8')
    .digest('hex');
}

export function getLegacyOAuthIdentityHashSecret(env = globalThis.process?.env || {}) {
  return normalizeSecret(
    env.AUTH_IDENTITY_HASH_KEY_LEGACY_STATE
    || env.OAUTH_STATE_SECRET
    || env.AUTH_SECURITY_HASH_SECRET
    || env.MAIL_ABUSE_HASH_SECRET
    || env.SUPABASE_JWT_SECRET
    || ''
  );
}

export function getOAuthIdentityHashKeyring(env = globalThis.process?.env || {}) {
  const currentKey = normalizeSecret(env.AUTH_IDENTITY_HASH_KEY_CURRENT);
  const currentVersion = normalizeVersion(
    env.AUTH_IDENTITY_HASH_KEY_CURRENT_VERSION,
    DEFAULT_CURRENT_VERSION
  );
  if (currentKey.length < MIN_IDENTITY_KEY_LENGTH || !currentVersion) {
    return {
      ok: false,
      code: 'oauth_identity_hash_key_missing',
      current: null,
      previous: null,
    };
  }

  const previousKey = normalizeSecret(env.AUTH_IDENTITY_HASH_KEY_PREVIOUS);
  const previousVersion = normalizeVersion(env.AUTH_IDENTITY_HASH_KEY_PREVIOUS_VERSION);
  if ((previousKey && previousKey.length < MIN_IDENTITY_KEY_LENGTH) || (previousKey && !previousVersion)) {
    return {
      ok: false,
      code: 'oauth_identity_previous_hash_key_invalid',
      current: null,
      previous: null,
    };
  }
  if (previousKey && previousVersion === currentVersion) {
    return {
      ok: false,
      code: 'oauth_identity_hash_key_versions_conflict',
      current: null,
      previous: null,
    };
  }

  return {
    ok: true,
    current: {
      key: currentKey,
      version: currentVersion,
    },
    previous: previousKey ? {
      key: previousKey,
      version: previousVersion,
    } : null,
  };
}

export function buildOAuthIdentityHashCandidates(provider, subject, env = globalThis.process?.env || {}) {
  const keyring = getOAuthIdentityHashKeyring(env);
  if (!keyring.ok) {
    return keyring;
  }

  const current = {
    version: keyring.current.version,
    hash: hashOAuthIdentitySubject(provider, subject, keyring.current.key),
  };
  const previous = keyring.previous ? {
    version: keyring.previous.version,
    hash: hashOAuthIdentitySubject(provider, subject, keyring.previous.key),
  } : null;
  const legacyStateSecret = getLegacyOAuthIdentityHashSecret(env);
  const legacy = legacyStateSecret ? {
    version: LEGACY_STATE_VERSION,
    hash: hashLegacyOAuthIdentitySubject(provider, subject, legacyStateSecret),
  } : null;
  const distinctLegacy = legacy
    && legacy.hash !== current.hash
    && legacy.hash !== previous?.hash
    ? legacy
    : null;

  return {
    ok: true,
    current,
    previous: previous?.hash === current.hash ? null : previous,
    legacy: distinctLegacy,
  };
}

export default {
  buildOAuthIdentityHashCandidates,
  getLegacyOAuthIdentityHashSecret,
  getOAuthIdentityHashKeyring,
  hashLegacyOAuthIdentitySubject,
  hashOAuthIdentitySubject,
};
