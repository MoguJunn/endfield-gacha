import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountEmailActionError,
  confirmOAuthEmailArtifactMerge,
  isUserEmailVerified,
  prepareOAuthEmailArtifactMerge,
  requestCurrentEmailVerification,
  requestEmailChange,
  verifyCurrentEmailCode,
  verifyOAuthEmailArtifactMerge,
} from '../accountEmailService.js';
import { getSupabaseAccessToken } from '../authFetchService.js';
import { fetchJsonWithTimeout } from '../supabaseRequest.js';
import {
  clearSiteSessionCache,
  getCurrentSiteSession,
} from '../siteSessionService.js';

vi.mock('../authFetchService.js', () => ({
  getSupabaseAccessToken: vi.fn(),
}));

vi.mock('../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

vi.mock('../siteSessionService.js', () => ({
  clearSiteSessionCache: vi.fn(),
  getCurrentSiteSession: vi.fn(),
}));

describe('accountEmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAccessToken.mockResolvedValue(null);
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      user: { id: 'user-1', email: 'legacy@example.com' },
    });
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        success: true,
        sent: {
          code: true,
        },
      },
    });
  });

  it('requests current email verification with same-origin cookies when no native token is available', async () => {
    await expect(requestCurrentEmailVerification({ locale: 'zh-CN' })).resolves.toMatchObject({
      success: true,
    });

    expect(getSupabaseAccessToken).toHaveBeenCalledWith({
      syncSiteSession: false,
      useSiteSessionCache: true,
      allowSiteSessionToken: false,
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-email-action', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'resend_verification',
        locale: 'zh-CN',
      }),
    }, expect.objectContaining({
      label: 'account-email-action:resend-verification',
    }));
  });

  it('adds Authorization only when a native Supabase token is available', async () => {
    getSupabaseAccessToken.mockResolvedValue('native-token');

    await requestEmailChange({
      newEmail: 'new@example.com',
      currentPassword: 'current-password',
      locale: 'zh-CN',
    });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-email-action', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer native-token',
      },
      body: JSON.stringify({
        action: 'change_email',
        newEmail: 'new@example.com',
        currentPassword: 'current-password',
        locale: 'zh-CN',
      }),
    }, expect.objectContaining({
      label: 'account-email-action:change-email',
    }));
  });

  it('verifies current email code through the same-origin endpoint', async () => {
    await verifyCurrentEmailCode({ code: ' 12-34-56 ' });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-email-verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: '123456',
      }),
    }, expect.objectContaining({
      label: 'account-email-verify:code',
    }));
  });

  it('surfaces email action errors with retry metadata', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: false, status: 429 },
      data: {
        success: false,
        error: '发送太频繁',
        code: 'rate_limited',
        retry_after: 60,
        partial: true,
        sent: {
          code: false,
        },
      },
    });

    await expect(requestCurrentEmailVerification()).rejects.toMatchObject({
      name: 'AccountEmailActionError',
      message: '发送太频繁',
      code: 'rate_limited',
      status: 429,
      retryAfter: 60,
      partial: true,
      sent: {
        code: false,
      },
    });
  });

  it('prepares and verifies the explicit OAuth email artifact repair', async () => {
    await prepareOAuthEmailArtifactMerge({
      email: 'legacy@example.com',
      locale: 'zh-CN',
    });
    expect(fetchJsonWithTimeout).toHaveBeenLastCalledWith('/api/account-email-action', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'prepare_oauth_email_merge',
        newEmail: 'legacy@example.com',
        locale: 'zh-CN',
      }),
    }, expect.objectContaining({
      label: 'account-email-action:prepare-oauth-email-merge',
    }));

    await verifyOAuthEmailArtifactMerge({
      intentId: 'intent-1',
      code: '12-34-56',
    });
    expect(fetchJsonWithTimeout).toHaveBeenLastCalledWith('/api/account-email-merge', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify',
        intentId: 'intent-1',
        code: '123456',
      }),
    }, expect.objectContaining({
      label: 'account-email-merge:verify',
    }));
  });

  it('confirms repair and reloads the fresh site session', async () => {
    const result = await confirmOAuthEmailArtifactMerge({ intentId: 'intent-1' });

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/account-email-merge', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'confirm',
        intentId: 'intent-1',
        confirmation: 'merge',
      }),
    }, expect.objectContaining({
      label: 'account-email-merge:confirm',
    }));
    expect(clearSiteSessionCache).toHaveBeenCalledTimes(1);
    expect(getCurrentSiteSession).toHaveBeenCalledWith({
      syncSupabase: true,
      useCache: false,
    });
    expect(result.session).toMatchObject({
      authenticated: true,
      user: { id: 'user-1' },
    });
  });

  it('treats forced verification as not verified regardless of user metadata', () => {
    expect(isUserEmailVerified({
      email_confirmed_at: '2026-06-01T00:00:00.000Z',
    }, {
      emailVerificationRequired: true,
    })).toBe(false);
  });

  it('accepts a completed app-level email verification for OAuth site sessions', () => {
    expect(isUserEmailVerified({
      email: 'site-user@example.com',
      email_confirmed_at: null,
      user_metadata: {
        email_verified: false,
      },
    }, {
      emailVerificationRequired: false,
      emailVerificationVerifiedAt: '2026-07-24T01:02:03.000Z',
    })).toBe(true);
  });

  it('detects verified email from Supabase user fields and identity data', () => {
    expect(isUserEmailVerified({
      confirmed_at: '2026-06-01T00:00:00.000Z',
    })).toBe(true);

    expect(isUserEmailVerified({
      identities: [
        {
          identity_data: {
            email_verified: true,
          },
        },
      ],
    })).toBe(true);

    expect(AccountEmailActionError).toBeTypeOf('function');
  });
});
