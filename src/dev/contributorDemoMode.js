export const CONTRIBUTOR_DEMO_SESSION_KEY = 'endfield_contributor_demo_session_v1';

export const CONTRIBUTOR_DEMO_CREDENTIALS = Object.freeze({
  email: 'demo-admin@local.invalid',
  password: 'frontend-demo',
});

export const CONTRIBUTOR_DEMO_USER = Object.freeze({
  id: 'demo:contributor-admin',
  email: CONTRIBUTOR_DEMO_CREDENTIALS.email,
  role: 'super_admin',
  user_metadata: Object.freeze({
    username: 'Frontend Demo Admin',
    contributor_demo: true,
  }),
  app_metadata: Object.freeze({
    provider: 'contributor_demo',
    providers: Object.freeze(['contributor_demo']),
  }),
});

function readDemoFlag() {
  return String(import.meta.env?.VITE_CONTRIBUTOR_DEMO_MODE || '')
    .trim()
    .toLowerCase();
}

export function isContributorDemoModeEnabled() {
  const testOverride = import.meta.env?.MODE === 'test'
    && globalThis.__CONTRIBUTOR_DEMO_TEST_MODE__ === true;
  return Boolean(
    import.meta.env?.DEV
    && (testOverride || ['1', 'true', 'yes', 'on'].includes(readDemoFlag()))
  );
}

export function isContributorDemoUser(user) {
  return Boolean(
    user?.id === CONTRIBUTOR_DEMO_USER.id
    && user?.user_metadata?.contributor_demo === true
    && user?.app_metadata?.provider === 'contributor_demo'
  );
}

export function isContributorDemoCredentials(email, password) {
  if (!isContributorDemoModeEnabled()) return false;
  return String(email || '').trim().toLowerCase() === CONTRIBUTOR_DEMO_CREDENTIALS.email
    && String(password || '') === CONTRIBUTOR_DEMO_CREDENTIALS.password;
}

export function isContributorDemoSessionActive() {
  if (!isContributorDemoModeEnabled() || typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(CONTRIBUTOR_DEMO_SESSION_KEY) === 'active';
  } catch {
    return false;
  }
}

export function markContributorDemoSessionActive(active) {
  if (typeof window === 'undefined') return false;
  try {
    if (active && isContributorDemoModeEnabled()) {
      window.sessionStorage.setItem(CONTRIBUTOR_DEMO_SESSION_KEY, 'active');
      return true;
    }
    window.sessionStorage.removeItem(CONTRIBUTOR_DEMO_SESSION_KEY);
    return false;
  } catch {
    return false;
  }
}

export function clearContributorDemoAndSupabaseBrowserState() {
  markContributorDemoSessionActive(false);
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (
        key
        && (
          /^sb-[A-Za-z0-9_-]+-auth-token$/u.test(key)
          || key === 'supabase.auth.token'
        )
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in privacy modes; the in-memory sandbox
    // identity is still torn down by the auth store.
  }
}

export function createContributorDemoReadonlyError(operation = 'write') {
  const error = new Error('贡献者内容沙盒不会向真实服务提交更改；请在本地管理页完成内容调试。');
  error.code = 'contributor_demo_readonly';
  error.operation = String(operation || 'write');
  return error;
}
