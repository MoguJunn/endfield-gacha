import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../supabaseClient.js';
import { fetchJsonWithTimeout } from '../supabaseRequest.js';
import {
  bootstrapSiteSessionFromSupabaseToken,
  clearSiteSessionCache,
  getCurrentSiteSession,
  getKnownSiteSessionUserId,
  hasKnownAuthenticatedSiteSession,
  revokeAllSiteSessions,
} from '../siteSessionService.js';

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      setSession: vi.fn(),
    },
  },
}));

vi.mock('../supabaseRequest.js', () => ({
  fetchJsonWithTimeout: vi.fn(),
}));

describe('siteSessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSiteSessionCache();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.setSession.mockResolvedValue({ error: null });
  });

  it('bootstraps a site session from an explicit Supabase access token', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        data: {
          bootstrapped: true,
          source: 'supabase',
        },
      },
    });

    const result = await bootstrapSiteSessionFromSupabaseToken('access-token');

    expect(result).toEqual({
      bootstrapped: true,
      authenticated: true,
      source: 'supabase',
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer access-token',
      },
    }, expect.objectContaining({
      label: 'auth-session-bootstrap',
    }));
  });

  it('uses the current Supabase session token when no token is passed', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'current-access-token',
        },
      },
    });
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        data: {
          bootstrapped: true,
          source: 'supabase',
        },
      },
    });

    await bootstrapSiteSessionFromSupabaseToken();

    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer current-access-token',
      }),
    }), expect.any(Object));
  });

  it('revokes all site sessions with the current native bearer identity', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        data: {
          sessionsRevoked: true,
          revokedCount: 3,
        },
      },
    });

    await expect(revokeAllSiteSessions('native-token')).resolves.toEqual({
      sessionsRevoked: true,
      revokedCount: 3,
    });
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith('/api/auth/session/revoke-all', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer native-token',
      },
    }, expect.objectContaining({
      label: 'auth-session-revoke-all',
    }));
  });

  it('does not sync authenticated site sessions back to the Supabase client by default', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        authenticated: true,
        data: {
          authenticated: true,
          user: {
            id: '00000000-0000-4000-8000-000000000001',
          },
          profile: {
            username: 'site_user',
          },
          identities: [],
          session: {
            expiresAt: '2026-08-03T08:00:00.000Z',
          },
          supabase: {
            accessToken: 'compat-access-token',
            tokenType: 'bearer',
            expiresIn: 3600,
            expiresAt: 1800000000,
          },
        },
      },
    });

    const result = await getCurrentSiteSession();

    expect(result.authenticated).toBe(true);
    expect(result.supabaseSessionSynced).toBe(false);
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
    expect(fetchJsonWithTimeout).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/auth\/session\?_/), expect.objectContaining({
      cache: 'no-store',
      headers: expect.objectContaining({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      }),
    }), expect.objectContaining({
      label: 'auth-session',
    }));
    expect(hasKnownAuthenticatedSiteSession(new Date('2026-08-03T07:00:00.000Z').getTime())).toBe(true);
    expect(getKnownSiteSessionUserId(new Date('2026-08-03T07:00:00.000Z').getTime())).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('syncs authenticated site sessions back to the Supabase client only when explicitly requested', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        authenticated: true,
        data: {
          authenticated: true,
          user: {
            id: '00000000-0000-4000-8000-000000000001',
          },
          profile: {
            username: 'site_user',
          },
          identities: [],
          session: {
            expiresAt: '2026-08-03T08:00:00.000Z',
          },
          supabase: {
            accessToken: 'compat-access-token',
            tokenType: 'bearer',
            expiresIn: 3600,
            expiresAt: 1800000000,
          },
        },
      },
    });

    const result = await getCurrentSiteSession({ syncSupabase: true });

    expect(result.authenticated).toBe(true);
    expect(result.supabaseSessionSynced).toBe(true);
    expect(supabase.auth.setSession).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'compat-access-token',
      refresh_token: 'site_session_compat',
      user: expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
      }),
    }));
  });

  it('does not reuse an unsynced cached site session when Supabase sync is required', async () => {
    fetchJsonWithTimeout.mockResolvedValue({
      response: { ok: true },
      data: {
        success: true,
        authenticated: true,
        data: {
          authenticated: true,
          user: {
            id: '00000000-0000-4000-8000-000000000002',
          },
          profile: {
            username: 'site_user',
          },
          identities: [],
          session: {
            expiresAt: '2026-08-03T08:00:00.000Z',
          },
          supabase: {
            accessToken: 'compat-access-token',
            tokenType: 'bearer',
            expiresIn: 3600,
            expiresAt: 1800000000,
          },
        },
      },
    });

    const unsynced = await getCurrentSiteSession({ syncSupabase: false, useCache: true });
    const synced = await getCurrentSiteSession({ syncSupabase: true, useCache: true });

    expect(unsynced.supabaseSessionSynced).toBe(false);
    expect(synced.supabaseSessionSynced).toBe(true);
    expect(fetchJsonWithTimeout).toHaveBeenCalledTimes(2);
    expect(supabase.auth.setSession).toHaveBeenCalledTimes(1);
  });
});
