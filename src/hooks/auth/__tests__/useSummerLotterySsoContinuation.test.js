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
    vi.unstubAllGlobals();
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

  it('resumes a valid public session without an internal session ID or login modal', async () => {
    const originalWindow = window;
    const assign = vi.fn();
    vi.stubGlobal('window', new Proxy(originalWindow, {
      get(target, key) { return key === 'location' ? { search: '?summer_lottery_login=1', assign } : Reflect.get(target, key); },
    }));
    getCurrentSiteSession.mockResolvedValue({ authenticated: true, user: { id: 'user-1' }, session: { expiresAt: '2099-01-01' } });
    const openAuthModal = vi.fn();
    renderHook(() => useSummerLotterySsoContinuation({ user: { id: 'user-1' }, authResolved: true, openAuthModal }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/summer-lottery-sso/start'));
    expect(openAuthModal).not.toHaveBeenCalled();
    expect(bootstrapSiteSessionFromSupabaseToken).not.toHaveBeenCalled();
    expect(originalWindow.sessionStorage.getItem('eg_summer_lottery_sso_pending_at')).toBeNull();
  });

  it('bootstraps a native login and accepts the resulting public session response', async () => {
    const originalWindow = window;
    const assign = vi.fn();
    vi.stubGlobal('window', new Proxy(originalWindow, {
      get(target, key) { return key === 'location' ? { search: '?summer_lottery_login=1', assign } : Reflect.get(target, key); },
    }));
    getCurrentSiteSession.mockResolvedValueOnce({ authenticated: false })
      .mockResolvedValueOnce({ authenticated: true, user: { id: 'user-1' }, session: { expiresAt: '2099-01-01' } });
    bootstrapSiteSessionFromSupabaseToken.mockResolvedValue({ authenticated: true });
    const openAuthModal = vi.fn();
    renderHook(() => useSummerLotterySsoContinuation({ user: { id: 'user-1' }, authResolved: true, openAuthModal }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(openAuthModal).not.toHaveBeenCalled();
    expect(bootstrapSiteSessionFromSupabaseToken).toHaveBeenCalledTimes(1);
  });
});
