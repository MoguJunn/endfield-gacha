import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../supabaseClient.js';
import {
  getAuthFetchHeaders,
  getCurrentAuthenticatedUser,
  getSameOriginAuthHeaders,
  getSupabaseAccessToken,
  withAuthenticatedSupabaseRequest,
} from '../authFetchService.js';
import {
  getCurrentSiteSession,
  getKnownSiteSessionUserId,
  hasKnownAuthenticatedSiteSession,
} from '../siteSessionService.js';

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('../siteSessionService.js', () => ({
  getCurrentSiteSession: vi.fn(),
  getKnownSiteSessionUserId: vi.fn(),
  hasKnownAuthenticatedSiteSession: vi.fn(),
}));

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createSiteSessionCompatToken() {
  return [
    toBase64UrlJson({ alg: 'HS256', typ: 'JWT' }),
    toBase64UrlJson({
      sub: 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {
        provider: 'site_session',
      },
      user_metadata: {
        site_session: true,
      },
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'signature',
  ].join('.');
}

describe('authFetchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasKnownAuthenticatedSiteSession.mockReturnValue(false);
    getKnownSiteSessionUserId.mockReturnValue('');
    getCurrentSiteSession.mockResolvedValue({
      authenticated: false,
      supabase: null,
    });
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: null,
      },
    });
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: null,
      },
    });
    supabase.auth.signOut.mockResolvedValue({ error: null });
  });

  it('uses the known same-origin site session without revalidating a native token', async () => {
    hasKnownAuthenticatedSiteSession.mockReturnValue(true);
    getKnownSiteSessionUserId.mockReturnValue('site-user-id');

    await expect(getSameOriginAuthHeaders({ Accept: 'application/json' })).resolves.toEqual({
      headers: { Accept: 'application/json' },
      accessToken: null,
      credentialSource: 'site_session',
      credentialOwnerId: 'site-user-id',
    });

    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it('prefers a verified native Supabase token over a site-session compatible token', async () => {
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      user: {
        id: 'user-1',
      },
      supabase: {
        accessToken: 'site-session-token',
      },
    });
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'native-token',
          user: {
            id: 'user-1',
          },
        },
      },
    });
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
    });

    await expect(getSupabaseAccessToken()).resolves.toBe('native-token');
    expect(getCurrentSiteSession).not.toHaveBeenCalled();
  });

  it('refreshes a Supabase-cached site-session token through the site session endpoint', async () => {
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      supabase: {
        accessToken: 'fresh-site-session-token',
      },
    });
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: createSiteSessionCompatToken(),
          user: {
            id: 'user-1',
          },
        },
      },
    });
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
    });

    await expect(getSupabaseAccessToken()).resolves.toBe('fresh-site-session-token');
    expect(getCurrentSiteSession).toHaveBeenCalledWith({
      syncSupabase: false,
      useCache: true,
    });
  });

  it('can explicitly prefer a fresh site-session token over a native Supabase token', async () => {
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      supabase: {
        accessToken: 'fresh-site-session-token',
      },
    });
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'native-token',
          user: {
            id: 'user-1',
          },
        },
      },
    });

    await expect(getSupabaseAccessToken({ preferSiteSessionToken: true })).resolves.toBe('fresh-site-session-token');
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it('uses a verified Supabase client token when no site session is needed', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'supabase-token',
          user: {
            id: 'user-1',
          },
        },
      },
    });
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
    });

    await expect(getSupabaseAccessToken()).resolves.toBe('supabase-token');
  });

  it('falls back to the site-session token when native Supabase state is missing', async () => {
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      supabase: {
        accessToken: 'site-session-token',
      },
    });
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: null,
      },
    });

    await expect(getSupabaseAccessToken()).resolves.toBe('site-session-token');
    expect(getCurrentSiteSession).toHaveBeenCalledWith({
      syncSupabase: false,
      useCache: true,
    });
  });

  it('can require a native Supabase token and skip site-session token fallback', async () => {
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      supabase: {
        accessToken: 'site-session-token',
      },
    });
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: null,
      },
    });

    await expect(getSupabaseAccessToken({ allowSiteSessionToken: false })).resolves.toBeNull();
  });

  it('does not return a Supabase-cached site-session token when site-session tokens are disallowed', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: createSiteSessionCompatToken(),
          user: {
            id: 'user-1',
          },
        },
      },
    });
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
    });

    await expect(getSupabaseAccessToken({ allowSiteSessionToken: false })).resolves.toBeNull();
    expect(getCurrentSiteSession).not.toHaveBeenCalled();
  });

  it('clears invalid native Supabase state before falling back to the site session', async () => {
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      supabase: {
        accessToken: 'site-session-token',
      },
    });
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'stale-native-token',
          user: {
            id: 'user-1',
          },
        },
      },
    });
    supabase.auth.getUser.mockResolvedValue({
      error: {
        message: 'invalid JWT',
      },
      data: null,
    });

    await expect(getSupabaseAccessToken()).resolves.toBe('site-session-token');
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('throws the shared expired-session error when a required token is missing', async () => {
    await expect(getAuthFetchHeaders({}, { requireToken: true })).rejects.toThrow('当前登录已失效，请重新登录后重试');
  });

  it('injects the site-session token into Supabase query builders', async () => {
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      supabase: {
        accessToken: 'site-session-token',
      },
    });
    const requestWithHeader = { applied: true };
    const request = {
      setHeader: vi.fn(() => requestWithHeader),
    };

    const result = await withAuthenticatedSupabaseRequest(
      () => request,
      { requireToken: true }
    );

    expect(request.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer site-session-token');
    expect(result).toBe(requestWithHeader);
  });

  it('uses the site-session user as the unified current user', async () => {
    getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      user: {
        id: 'site-user-id',
        email: 'site@example.com',
      },
    });
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'supabase-user-id',
        },
      },
    });

    await expect(getCurrentAuthenticatedUser({ requireUser: true })).resolves.toEqual({
      id: 'site-user-id',
      email: 'site@example.com',
    });
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it('falls back to a verified native user when no site session is active', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'native-token',
          user: {
            id: 'native-user-id',
          },
        },
      },
    });
    supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'native-user-id',
          email: 'native@example.com',
        },
      },
    });

    await expect(getCurrentAuthenticatedUser({ requireUser: true })).resolves.toEqual({
      id: 'native-user-id',
      email: 'native@example.com',
    });
  });
});
