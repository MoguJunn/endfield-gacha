import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../supabaseClient.js';

import {
  isOAuthAccountCompletionRequired,
  isOAuthEmailSetupRequired,
  isOAuthPasswordSetupRequired,
  loadAccountSecurityState,
  setupPasswordForOAuthAccount,
  updatePasswordWithCurrentPassword,
} from '../accountSecurityService.js';
import { getSupabaseAccessToken } from '../authFetchService.js';
import { fetchJsonWithTimeout } from '../supabaseRequest.js';
import {
  bootstrapSiteSessionFromSupabaseToken,
} from '../siteSessionService.js';

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
      getSession: vi.fn(),
    },
  },
}));

vi.mock('../authFetchService.js', () => ({
  getSupabaseAccessToken: vi.fn(),
}));

vi.mock('../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

vi.mock('../siteSessionService.js', () => ({
  bootstrapSiteSessionFromSupabaseToken: vi.fn(),
}));

describe('accountSecurityService OAuth setup guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAccessToken.mockResolvedValue(null);
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        state: {
          passwordChangeRequired: true,
          reason: 'oauth_password_setup_required:github',
        },
      },
    });
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'fresh-native-token' } },
      error: null,
    });
    supabase.auth.updateUser.mockResolvedValue({ error: null });
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-native-token' } },
    });
    bootstrapSiteSessionFromSupabaseToken.mockResolvedValue({
      bootstrapped: true,
      authenticated: true,
    });
  });

  it('detects third-party email setup requirements', () => {
    expect(isOAuthEmailSetupRequired({
      emailVerificationRequired: true,
      emailVerificationReason: 'oauth_email_setup_required:github',
    })).toBe(true);
  });

  it('detects third-party password setup requirements', () => {
    expect(isOAuthPasswordSetupRequired({
      passwordChangeRequired: true,
      reason: 'oauth_password_setup_required:github',
    })).toBe(true);
  });

  it('does not treat ordinary unverified email as third-party account completion', () => {
    expect(isOAuthAccountCompletionRequired({
      emailVerificationRequired: true,
      emailVerificationReason: 'signup_email_verification_required',
      passwordChangeRequired: false,
      reason: null,
    })).toBe(false);
  });

  it('requires completion when either third-party email or password setup is pending', () => {
    expect(isOAuthAccountCompletionRequired({
      emailVerificationRequired: false,
      emailVerificationReason: null,
      passwordChangeRequired: true,
      reason: 'oauth_password_setup_required:github',
    })).toBe(true);

    expect(isOAuthAccountCompletionRequired({
      emailVerificationRequired: true,
      emailVerificationReason: 'oauth_email_setup_required:github',
      passwordChangeRequired: false,
      reason: null,
    })).toBe(true);
  });

  it('loads account security state with same-origin cookies when no native token is available', async () => {
    await expect(loadAccountSecurityState()).resolves.toEqual({
      passwordChangeRequired: true,
      reason: 'oauth_password_setup_required:github',
    });

    expect(getSupabaseAccessToken).toHaveBeenCalledWith({
      syncSiteSession: false,
      useSiteSessionCache: true,
      allowSiteSessionToken: false,
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-security-state', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {},
    }, expect.objectContaining({
      label: 'account-security-state',
    }));
  });

  it('adds Authorization only when a native Supabase token is available', async () => {
    getSupabaseAccessToken.mockResolvedValue('native-token');

    await loadAccountSecurityState();

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-security-state', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Authorization: 'Bearer native-token',
      },
    }, expect.any(Object));
  });

  it('returns an empty security state when optional auth is missing', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {
        success: false,
        error: 'Missing access token',
      },
    });

    await expect(loadAccountSecurityState()).resolves.toMatchObject({
      passwordChangeRequired: false,
      emailVerificationRequired: false,
    });
  });

  it('sets OAuth account password through the same-origin endpoint', async () => {
    fetchJsonWithTimeout
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: {
          allowed: true,
        },
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: {
          success: true,
          state: {
            passwordChangeRequired: false,
            reason: null,
          },
        },
      });

    await expect(setupPasswordForOAuthAccount({
      newPassword: 'new-password',
    })).resolves.toEqual({
      securityStateUpdated: true,
      state: {
        passwordChangeRequired: false,
        reason: null,
      },
      securityStateError: null,
    });

    expect(fetchJsonWithTimeout).toHaveBeenNthCalledWith(1, '/api/auth-rate-limit', expect.objectContaining({
      method: 'POST',
    }), expect.objectContaining({
      label: 'auth-rate-limit:change_password',
    }));
    expect(fetchJsonWithTimeout).toHaveBeenNthCalledWith(2, '/api/account-password-setup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        newPassword: 'new-password',
      }),
    }, expect.objectContaining({
      label: 'account-password-setup',
    }));
  });

  it('revokes old site sessions and creates a fresh current session after password change', async () => {
    const result = await updatePasswordWithCurrentPassword({
      email: 'user@example.com',
      currentPassword: 'OldPassword123',
      newPassword: 'NewPassword456',
    });

    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      password: 'NewPassword456',
    });
    expect(supabase.auth.signInWithPassword).toHaveBeenNthCalledWith(2, {
      email: 'user@example.com',
      password: 'NewPassword456',
    });
    expect(bootstrapSiteSessionFromSupabaseToken).toHaveBeenCalledWith('fresh-native-token');
    expect(result).toMatchObject({
      securityStateUpdated: true,
      sessionsRevoked: true,
      revokedSessionCount: null,
      currentSessionRecreated: true,
    });
  });
});
