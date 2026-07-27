import { useEffect, useRef } from 'react';
import {
  bootstrapSiteSessionFromSupabaseToken,
  getCurrentSiteSession,
} from '../../services/siteSessionService.js';

const STORAGE_KEY = 'eg_summer_lottery_sso_pending_at';
const MAX_PENDING_AGE_MS = 10 * 60 * 1000;

function readPendingTimestamp() {
  try {
    return Number.parseInt(window.sessionStorage.getItem(STORAGE_KEY) || '', 10) || 0;
  } catch {
    return 0;
  }
}

function writePendingTimestamp(value) {
  try {
    if (value) window.sessionStorage.setItem(STORAGE_KEY, String(value));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in hardened browser modes.
  }
}

export function useSummerLotterySsoContinuation({ user, authResolved, openAuthModal }) {
  const runningRef = useRef(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hasQueryPendingLogin = query.get('summer_lottery_login') === '1';
    if (hasQueryPendingLogin) {
      writePendingTimestamp(Date.now());
    }

    const pendingAt = readPendingTimestamp();
    const hasFreshPendingLogin = hasQueryPendingLogin
      || (pendingAt > 0 && Date.now() - pendingAt <= MAX_PENDING_AGE_MS);
    if (!hasFreshPendingLogin) {
      writePendingTimestamp(0);
      return;
    }
    if (!authResolved) return;

    if (user?.id) {
      if (runningRef.current) return;
      runningRef.current = true;
      void (async () => {
        try {
          let siteSession = await getCurrentSiteSession({ syncSupabase: false });
          if (!siteSession?.authenticated || !siteSession?.session?.id) {
            const bootstrap = await bootstrapSiteSessionFromSupabaseToken();
            if (bootstrap?.authenticated) {
              siteSession = await getCurrentSiteSession({ syncSupabase: false });
            }
          }
          if (!siteSession?.authenticated || !siteSession?.session?.id) {
            openAuthModal();
            return;
          }
          writePendingTimestamp(0);
          window.location.assign('/api/summer-lottery-sso/start');
        } catch {
          openAuthModal();
        } finally {
          runningRef.current = false;
        }
      })();
      return;
    }

    openAuthModal();
  }, [authResolved, openAuthModal, user?.id]);
}
