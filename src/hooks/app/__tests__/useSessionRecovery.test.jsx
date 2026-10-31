// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionRecovery } from '../useSessionRecovery.js';
import { useAuthenticatedSessionSync } from '../useAuthenticatedSessionSync.js';
import { useAuthStore, usePersonalDataStore } from '../../../stores/index.js';
import { createPersonalDataInitialState } from '../../../stores/usePersonalDataStore.js';
import { getCurrentSiteSession } from '../../../services/siteSessionService.js';
import { getValidatedSupabaseSession } from '../../../services/authFetchService.js';
import { emitAuthSessionSync } from '../../../services/authSessionEvents.js';

vi.mock('../../../supabaseClient.js', () => ({ supabase: { auth: {} } }));
vi.mock('../../../services/siteSessionService.js', () => ({ getCurrentSiteSession: vi.fn() }));
vi.mock('../../../services/authFetchService.js', () => ({ getValidatedSupabaseSession: vi.fn() }));

describe('session recovery', () => {
  let refreshPersonalData;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
    usePersonalDataStore.setState({
      ...createPersonalDataInitialState(), ownerId: 'user-1', hasSnapshot: true, phase: 'ready',
    });
    getCurrentSiteSession.mockResolvedValue({ authenticated: true, user: { id: 'user-1' } });
    getValidatedSupabaseSession.mockResolvedValue(null);
    refreshPersonalData = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mountRecovery() {
    return renderHook(() => {
      const sync = useAuthenticatedSessionSync({ refreshPersonalData });
      useSessionRecovery({ ...sync, siteSessionUserRef: useRef(null) });
    });
  }

  async function focus() {
    await act(async () => { window.dispatchEvent(new Event('focus')); });
  }

  it('resolves a recently signed-in user on focus without refreshing the page', async () => {
    useAuthStore.setState({ user: null });
    usePersonalDataStore.setState(createPersonalDataInitialState());
    mountRecovery();
    await focus();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(usePersonalDataStore.getState().ownerId).toBe('user-1');
    expect(refreshPersonalData).toHaveBeenCalledOnce();
    expect(getCurrentSiteSession).toHaveBeenCalledWith({ syncSupabase: false, useCache: false });
  });

  it('preserves the existing snapshot when refreshing the same owner', async () => {
    mountRecovery();
    await focus();
    expect(usePersonalDataStore.getState().hasSnapshot).toBe(true);
    expect(refreshPersonalData).not.toHaveBeenCalled();
  });

  it('corrects stale logged-in state when neither credential can recover', async () => {
    getCurrentSiteSession.mockResolvedValue({ authenticated: false });
    mountRecovery();
    await focus();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().authResolved).toBe(true);
    expect(usePersonalDataStore.getState().ownerId).toBeNull();
  });

  it('uses a verified native session when the site session is absent', async () => {
    getCurrentSiteSession.mockResolvedValue({ authenticated: false });
    getValidatedSupabaseSession.mockResolvedValue({ user: { id: 'user-1' } });
    mountRecovery();
    await focus();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(refreshPersonalData).not.toHaveBeenCalled();
  });

  it.each(['site', 'native'])('keeps the owner on transient %s authentication failures', async (source) => {
    if (source === 'site') getCurrentSiteSession.mockRejectedValue(new Error('503'));
    else {
      getCurrentSiteSession.mockResolvedValue({ authenticated: false });
      getValidatedSupabaseSession.mockRejectedValue(new TypeError('Failed to fetch'));
    }
    mountRecovery();
    await focus();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(usePersonalDataStore.getState().hasSnapshot).toBe(true);
  });

  it('checks on return and every visible minute, throttling overlapping focus events', async () => {
    mountRecovery();
    await focus();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(getCurrentSiteSession).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getCurrentSiteSession).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getCurrentSiteSession).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(getCurrentSiteSession).toHaveBeenCalledTimes(3);
  });

  it('handles import authentication errors immediately even inside the focus throttle', async () => {
    mountRecovery();
    await focus();
    getCurrentSiteSession.mockResolvedValue({ authenticated: false });
    await act(async () => { emitAuthSessionSync({ source: 'import_token_missing' }); });
    expect(getCurrentSiteSession).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it.each(['logout', 'switch', 'unmount'])('discards a late response after %s', async (change) => {
    let resolveSession;
    getCurrentSiteSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
    const view = mountRecovery();
    await focus();
    await focus();
    expect(getCurrentSiteSession).toHaveBeenCalledTimes(1);
    if (change === 'unmount') view.unmount();
    else act(() => { useAuthStore.setState({ user: change === 'logout' ? null : { id: 'user-2' } }); });
    await act(async () => { resolveSession({ authenticated: true, user: { id: 'user-1' } }); });
    expect(useAuthStore.getState().user?.id ?? null).toBe(change === 'logout' ? null : change === 'switch' ? 'user-2' : 'user-1');
    expect(refreshPersonalData).not.toHaveBeenCalled();
  });
});
