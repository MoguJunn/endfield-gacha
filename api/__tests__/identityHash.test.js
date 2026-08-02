// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildOAuthIdentityHashCandidates,
  getOAuthIdentityHashKeyring,
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
