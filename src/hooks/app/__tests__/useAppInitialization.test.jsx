// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppInitialization } from '../useAppInitialization.js';
import { useAuthStore, usePersonalDataStore } from '../../../stores/index.js';
import { createPersonalDataInitialState } from '../../../stores/usePersonalDataStore.js';

const mocks = vi.hoisted(() => ({
  authCallback: null,
  applyAuthenticatedSession: vi.fn().mockResolvedValue({ ok: true }),
  applySiteSession: vi.fn().mockResolvedValue({ ok: true }),
  applySignedOut: vi.fn(),
  getValidatedSupabaseSession: vi.fn(),
  getCurrentSiteSession: vi.fn(),
  loadConfig: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../supabaseClient.js', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        mocks.authCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  },
}));

vi.mock('../../../stores/useSiteConfigStore.js', () => ({
  default: { getState: () => ({ loadConfig: mocks.loadConfig }) },
}));

vi.mock('../../../utils/characterUtils.js', () => ({
  characterCache: { load: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../../services/authFetchService.js', () => ({
  getValidatedSupabaseSession: mocks.getValidatedSupabaseSession,
}));

vi.mock('../../../services/siteSessionService.js', () => ({
  getCurrentSiteSession: mocks.getCurrentSiteSession,
}));

vi.mock('../../../services/accountLastSeenService.js', () => ({
  updateAccountLastSeen: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../services/authSessionEvents.js', () => ({
  subscribeAuthSessionSync: vi.fn(() => () => {}),
}));

vi.mock('../useAuthenticatedSessionSync.js', () => ({
  canUsePrivateCloudDataFromSiteSession: () => true,
  useAuthenticatedSessionSync: () => ({
    applyAuthenticatedSession: mocks.applyAuthenticatedSession,
    applySiteSession: mocks.applySiteSession,
    applySignedOut: mocks.applySignedOut,
  }),
}));

describe('useAppInitialization auth event coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authCallback = null;
    mocks.getValidatedSupabaseSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.getCurrentSiteSession.mockResolvedValue({
      authenticated: true,
      user: { id: 'user-1' },
    });
    useAuthStore.setState({ user: null, authResolved: false });
    usePersonalDataStore.setState(createPersonalDataInitialState());
  });

  it('does not turn an empty INITIAL_SESSION race into sign-out', async () => {
    const loadPublicPools = vi.fn().mockResolvedValue([]);
    renderHook(() => useAppInitialization({
      refreshPersonalData: vi.fn(),
      loadPublicPools,
    }));

    expect(typeof mocks.authCallback).toBe('function');
    await act(async () => {
      mocks.authCallback('INITIAL_SESSION', null);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.applyAuthenticatedSession).toHaveBeenCalledTimes(1);
    });
    expect(mocks.applySignedOut).not.toHaveBeenCalled();
  });

  it('discards a late anonymous initialization result after an owner is established', async () => {
    let resolveSupabase;
    let resolveSiteSession;
    mocks.getValidatedSupabaseSession.mockReturnValue(new Promise((resolve) => {
      resolveSupabase = resolve;
    }));
    mocks.getCurrentSiteSession.mockReturnValue(new Promise((resolve) => {
      resolveSiteSession = resolve;
    }));

    renderHook(() => useAppInitialization({
      refreshPersonalData: vi.fn(),
      loadPublicPools: vi.fn().mockResolvedValue([]),
    }));

    await act(async () => {
      useAuthStore.setState({ user: { id: 'user-1' }, authResolved: true });
      usePersonalDataStore.getState().switchOwner('user-1');
      resolveSupabase(null);
      resolveSiteSession({ authenticated: false, user: null });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.getCurrentSiteSession).toHaveBeenCalled();
    });
    expect(mocks.applySignedOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
  });
});
