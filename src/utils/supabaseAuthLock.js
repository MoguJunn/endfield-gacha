import { navigatorLock } from '@supabase/supabase-js';

// auth-js 2.106.2 only uses acquireTimeout=0 for its background refresh tick,
// whose result is ignored. Busy means skip this tick and retry next time.
// Avoid generating an exception for this expected contention, which debuggers
// can display as a misleading login error even when the SDK catches it.
export async function browserAuthLock(name, acquireTimeout, fn) {
  if (acquireTimeout !== 0) {
    return navigatorLock(name, acquireTimeout, fn);
  }

  return globalThis.navigator.locks.request(
    name,
    { mode: 'exclusive', ifAvailable: true },
    (lock) => (lock ? fn() : undefined),
  );
}

export function getBrowserAuthLock() {
  // Without Web Locks, retain the SDK's platform fallback.
  return typeof globalThis.navigator?.locks?.request === 'function'
    ? browserAuthLock
    : undefined;
}
