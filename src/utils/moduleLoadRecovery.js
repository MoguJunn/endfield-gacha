const RECOVERY_KEY = 'endfield-module-load-recovery';
const RECOVERY_PARAM = '__module_recover';
const RETRY_WINDOW_MS = 5 * 60 * 1000;

// Match load failures, not arbitrary exceptions thrown while evaluating a module.
export function isModuleLoadError(error) {
  return error?.name === 'ChunkLoadError'
    || /^(?:Importing a module script failed\.?|Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk \S+ failed\.?)(?:$|[\s:])/i.test(error?.message || '');
}

export function reloadModulePage(browser = window, now = Date.now()) {
  const url = new URL(browser.location.href);
  url.searchParams.set(RECOVERY_PARAM, String(now));
  browser.history.replaceState(browser.history.state, '', url.toString());
  browser.location.reload();
}

export function recoverModuleLoad(error, browser = window, now = Date.now()) {
  if (!isModuleLoadError(error) || browser.navigator.onLine === false) return false;
  try {
    const url = new URL(browser.location.href);
    const previous = Number(browser.sessionStorage.getItem(RECOVERY_KEY));
    // The URL also guards browsers that lose session storage on navigation.
    if (url.searchParams.has(RECOVERY_PARAM)
      || (previous > 0 && now - previous < RETRY_WINDOW_MS)) return false;
    browser.sessionStorage.setItem(RECOVERY_KEY, String(now));
    if (browser.sessionStorage.getItem(RECOVERY_KEY) !== String(now)) return false;
    // The fresh document uses its recovery import map to bypass failed module
    // responses, with the URL guard already in place. Keep all user data.
    reloadModulePage(browser, now);
    return true;
  } catch {
    // If the one-shot guard cannot persist, leave the explicit reload action.
    return false;
  }
}
