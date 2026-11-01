import { useEffect } from 'react';
import { supabase } from '../../supabaseClient.js';
import { useAuthStore } from '../../stores/index.js';
import { getValidatedSupabaseSession } from '../../services/authFetchService.js';
import { getCurrentSiteSession } from '../../services/siteSessionService.js';
import { subscribeAuthSessionSync } from '../../services/authSessionEvents.js';
import { isContributorDemoModeEnabled } from '../../dev/contributorDemoMode.js';
import appLogger from '../../utils/appLogger.js';

const RECHECK_INTERVAL_MS = 60_000;
const FOCUS_THROTTLE_MS = 15_000;

export function useSessionRecovery({
  applyAuthenticatedSession,
  applySiteSession,
  applySignedOut,
  siteSessionUserRef,
}) {
  useEffect(() => {
    if (!supabase || isContributorDemoModeEnabled()) return undefined;

    const isMountedRef = { current: true };
    let generation = 0;
    let pending = false;
    let lastCheckAt = 0;
    const unsubscribeStore = useAuthStore.subscribe((state, previous) => {
      if (state.user !== previous.user) generation += 1;
    });

    const recheck = async (source, force = false) => {
      if (pending || (!force && Date.now() - lastCheckAt < FOCUS_THROTTLE_MS)) return;
      pending = true;
      lastCheckAt = Date.now();
      const requestGeneration = generation;
      const isCurrent = () => isMountedRef.current && requestGeneration === generation;
      try {
        const siteSession = await getCurrentSiteSession({ syncSupabase: false, useCache: false });
        if (!isCurrent()) return;
        if (siteSession?.authenticated && siteSession.user) {
          siteSessionUserRef.current = siteSession.user;
          await applySiteSession(siteSession, { source, isMountedRef });
          return;
        }

        const nativeSession = await getValidatedSupabaseSession();
        if (!isCurrent()) return;
        siteSessionUserRef.current = null;
        if (nativeSession?.user) {
          await applyAuthenticatedSession(nativeSession.user, {
            event: 'TOKEN_REFRESHED', source, isMountedRef,
          });
        } else {
          applySignedOut({ source, event: 'SIGNED_OUT' });
        }
      } catch {
        appLogger.warn('[useSessionRecovery] 暂时无法验证登录状态，保留当前状态');
      } finally {
        pending = false;
      }
    };

    const onFocus = () => {
      if (document.visibilityState === 'visible') void recheck('window_focus');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void recheck('page_visible');
    };
    const unsubscribeSync = subscribeAuthSessionSync((event) => {
      if (event?.detail?.alreadyApplied !== true) void recheck('auth_session_sync', true);
    });
    const interval = window.setInterval(() => {
      // Signed-out visitors have no active session to revoke. Focus and the
      // cross-tab auth event still recover a newly created session immediately.
      if (document.visibilityState === 'visible'
        && useAuthStore.getState().user) {
        void recheck('session_interval');
      }
    }, RECHECK_INTERVAL_MS);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      isMountedRef.current = false;
      unsubscribeStore();
      unsubscribeSync();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [applyAuthenticatedSession, applySiteSession, applySignedOut, siteSessionUserRef]);
}
