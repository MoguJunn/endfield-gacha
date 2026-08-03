// @vitest-environment node

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildOAuthIdentityHashCandidates,
  getLegacyOAuthIdentityHashSecret,
  getOAuthIdentityHashKeyring,
  hashLegacyOAuthIdentitySubject,
  hashOAuthIdentitySubject,
} from '../_lib/identityHash.js';

describe('OAuth identity hash keyring', () => {
  it('fails closed when the dedicated current key is missing', () => {
    expect(getOAuthIdentityHashKeyring({})).toMatchObject({
      ok: false,
      code: 'oauth_identity_hash_key_missing',
    });
  });

  it('does not use the short-lived OAuth state key as an identity fallback', () => {
    expect(getOAuthIdentityHashKeyring({
      OAUTH_STATE_SECRET: 'state-secret-that-is-long-enough-for-signing',
    })).toMatchObject({
      ok: false,
      code: 'oauth_identity_hash_key_missing',
    });
  });

  it('builds current and previous hashes with explicit versions', () => {
    const result = buildOAuthIdentityHashCandidates('github', 'provider-user-1', {
      AUTH_IDENTITY_HASH_KEY_CURRENT: 'current-identity-key-12345678901234567890',
      AUTH_IDENTITY_HASH_KEY_CURRENT_VERSION: 'v3',
      AUTH_IDENTITY_HASH_KEY_PREVIOUS: 'previous-identity-key-123456789012345678',
      AUTH_IDENTITY_HASH_KEY_PREVIOUS_VERSION: 'v2',
    });

    expect(result).toMatchObject({
      ok: true,
      current: {
        version: 'v3',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      previous: {
        version: 'v2',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(result.current.hash).not.toBe(result.previous.hash);
  });

  it('also builds the exact legacy state-secret hash for account migration', () => {
    const stateSecret = 'legacy-state-secret-12345678901234567890';
    const result = buildOAuthIdentityHashCandidates('github', 'provider-user-1', {
      AUTH_IDENTITY_HASH_KEY_CURRENT: 'current-identity-key-12345678901234567890',
      AUTH_IDENTITY_HASH_KEY_CURRENT_VERSION: 'v2',
      OAUTH_STATE_SECRET: stateSecret,
    });

    expect(result).toMatchObject({
      ok: true,
      legacy: {
        version: 'legacy_state_v1',
        hash: createHmac('sha256', stateSecret)
          .update('github:provider-user-1', 'utf8')
          .digest('hex'),
      },
    });
    expect(result.legacy.hash).toBe(
      hashLegacyOAuthIdentitySubject('github', 'provider-user-1', stateSecret)
    );
  });

  it('replays the complete historical state-secret fallback order, including short keys', () => {
    const fallbackCases = [
      ['OAUTH_STATE_SECRET', 'short-state-key'],
      ['AUTH_SECURITY_HASH_SECRET', 'historical-auth-security-key'],
      ['MAIL_ABUSE_HASH_SECRET', 'historical-mail-key'],
      ['SUPABASE_JWT_SECRET', 'historical-jwt-key'],
    ];

    fallbackCases.forEach(([key, secret]) => {
      const env = {
        AUTH_IDENTITY_HASH_KEY_CURRENT: 'current-identity-key-12345678901234567890',
        [key]: secret,
      };
      const result = buildOAuthIdentityHashCandidates('github', 'provider-user-1', env);
      expect(getLegacyOAuthIdentityHashSecret(env)).toBe(secret);
      expect(result.legacy).toEqual({
        version: 'legacy_state_v1',
        hash: createHmac('sha256', secret)
          .update('github:provider-user-1', 'utf8')
          .digest('hex'),
      });
    });
  });

  it('uses the pinned historical identity secret after the OAuth state secret rotates', () => {
    const result = buildOAuthIdentityHashCandidates('github', 'provider-user-1', {
      AUTH_IDENTITY_HASH_KEY_CURRENT: 'current-identity-key-12345678901234567890',
      AUTH_IDENTITY_HASH_KEY_LEGACY_STATE: 'pinned-original-state-key',
      OAUTH_STATE_SECRET: 'rotated-state-key',
    });

    expect(result.legacy.hash).toBe(
      hashLegacyOAuthIdentitySubject('github', 'provider-user-1', 'pinned-original-state-key')
    );
  });

  it('domain-separates providers using the same subject', () => {
    const key = 'identity-key-domain-separation-1234567890';
    expect(hashOAuthIdentitySubject('github', '42', key))
      .not.toBe(hashOAuthIdentitySubject('linuxdo', '42', key));
  });

  it('rejects current and previous keys that claim the same version', () => {
    expect(getOAuthIdentityHashKeyring({
      AUTH_IDENTITY_HASH_KEY_CURRENT: 'current-identity-key-12345678901234567890',
      AUTH_IDENTITY_HASH_KEY_CURRENT_VERSION: 'v2',
      AUTH_IDENTITY_HASH_KEY_PREVIOUS: 'previous-identity-key-123456789012345678',
      AUTH_IDENTITY_HASH_KEY_PREVIOUS_VERSION: 'v2',
    })).toMatchObject({
      ok: false,
      code: 'oauth_identity_hash_key_versions_conflict',
    });
  });
});
