let pendingContinuation = null;

export function resumeMainSiteSession() {
  if (pendingContinuation) return pendingContinuation;
  pendingContinuation = (async () => {
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return false;
      const session = await response.json();
      if (session?.success !== true || session.authenticated !== true || !session.data?.user?.id) return false;
      // The server exchanges the existing host-only main session for a separate
      // lottery session. No login token is copied into the page or URL.
      window.location.replace('/api/auth/sso/start');
      return true;
    } catch {
      return false;
    }
  })().finally(() => { pendingContinuation = null; });
  return pendingContinuation;
}
