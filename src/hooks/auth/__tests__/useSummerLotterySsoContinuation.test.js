import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapSiteSessionFromSupabaseToken,
  getCurrentSiteSession,
} from '../../../services/siteSessionService.js';
import { useSummerLotterySsoContinuation } from '../useSummerLotterySsoContinuation.js';

vi.mock('../../../services/siteSessionService.js', () => ({
  bootstrapSiteSessionFromSupabaseToken: vi.fn(),
  getCurrentSiteSession: vi.fn(),
}));

describe('useSummerLotterySsoContinuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/?summer_lottery_login=1');
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('opens login from the controlled query even when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const openAuthModal = vi.fn();

    renderHook(() => useSummerLotterySsoContinuation({
      user: null,
      authResolved: true,
      openAuthModal,
    }));

    expect(openAuthModal).toHaveBeenCalledTimes(1);
  });

  it('does not redirect-loop when only a Supabase user exists and site-session bootstrap fails', async () => {
    getCurrentSiteSession.mockResolvedValue({ authenticated: false, session: null });
    bootstrapSiteSessionFromSupabaseToken.mockResolvedValue({ authenticated: false, bootstrapped: false });
    const openAuthModal = vi.fn();

    renderHook(() => useSummerLotterySsoContinuation({
      user: { id: 'user-1' },
      authResolved: true,
      openAuthModal,
    }));

    await waitFor(() => {
      expect(getCurrentSiteSession).toHaveBeenCalledWith({ syncSupabase: false });
      expect(bootstrapSiteSessionFromSupabaseToken).toHaveBeenCalled();
      expect(openAuthModal).toHaveBeenCalledTimes(1);
    });
  });
});
