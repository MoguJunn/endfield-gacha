import { supabase } from '../supabaseClient.js';
import {
  createContributorDemoReadonlyError,
  isContributorDemoModeEnabled,
} from '../dev/contributorDemoMode.js';

const OAUTH_PROVIDER_META = Object.freeze({
  github: {
    key: 'github',
    label: 'GitHub',
    enabledEnv: 'VITE_AUTH_OAUTH_GITHUB_ENABLED',
    strategy: 'bridge',
  },
  linuxdo: {
    key: 'linuxdo',
    label: 'Linux.do',
    enabledEnv: 'VITE_AUTH_OAUTH_LINUXDO_ENABLED',
    strategy: 'bridge',
  },
  qq: {
    key: 'qq',
    label: 'QQ',
    enabledEnv: 'VITE_AUTH_OAUTH_QQ_ENABLED',
    strategy: 'bridge',
  },
});

function isEnvEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isProviderReady(provider, env) {
  if (!provider?.readyEnv) {
    return true;
  }
  return isEnvEnabled(env?.[provider.readyEnv]);
}

export function getEnabledOAuthProviders(env = import.meta.env) {
  if (isContributorDemoModeEnabled()) return [];
  return Object.values(OAUTH_PROVIDER_META)
    .filter((provider) => isEnvEnabled(env?.[provider.enabledEnv]) && isProviderReady(provider, env))
    .map(({ key, label, strategy }) => ({ key, label, strategy }));
}

export function normalizeOAuthReturnTo(returnTo = '', origin = window.location.origin) {
  const fallback = '/';
  const rawValue = String(returnTo || '').trim();
  if (!rawValue) {
    return fallback;
  }

  try {
    const targetUrl = new URL(rawValue, origin);
    if (targetUrl.origin !== origin) {
      return fallback;
    }

    const pathname = targetUrl.pathname || fallback;
    if (!pathname.startsWith('/') || pathname.startsWith('//')) {
      return fallback;
    }

    if (pathname === '/auth/callback') {
      return fallback;
    }

    return `${pathname}${targetUrl.search}${targetUrl.hash}` || fallback;
  } catch {
    return fallback;
  }
}

export function buildOAuthCallbackUrl({
  returnTo = '',
  origin = window.location.origin,
} = {}) {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('next', normalizeOAuthReturnTo(returnTo, origin));
  return url.toString();
}

export function getOAuthProviderStrategy(provider, env = import.meta.env) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const meta = OAUTH_PROVIDER_META[normalizedProvider];
  if (!meta) {
    throw new Error('unsupported_oauth_provider');
  }

  if (!isProviderReady(meta, env)) {
    throw new Error('oauth_provider_not_ready');
  }

  return meta;
}

export function buildOAuthStartUrl(provider, {
  returnTo = '',
  intent = 'login',
  origin = window.location.origin,
} = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError('oauth-start-url');
  }
  const { key } = getOAuthProviderStrategy(provider);

  const url = new URL(`/api/auth/oauth/${key}/start`, origin);
  const normalizedReturnTo = normalizeOAuthReturnTo(
    returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`,
    origin
  );
  url.searchParams.set('returnTo', normalizedReturnTo || '/');
  url.searchParams.set('intent', intent || 'login');
  return url.toString();
}

export async function startOAuthLogin(provider, options = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError('oauth-login');
  }
  const meta = getOAuthProviderStrategy(provider, options.env || import.meta.env);
  const returnTo = options.returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const origin = options.origin || window.location.origin;

  if (meta.strategy === 'bridge') {
    const assign = typeof options.assign === 'function'
      ? options.assign
      : window.location.assign.bind(window.location);
    assign(buildOAuthStartUrl(provider, options));
    return { strategy: 'bridge' };
  }

  if (!supabase) {
    throw new Error('supabase_not_configured');
  }

  const signInOptions = {
    redirectTo: buildOAuthCallbackUrl({ returnTo, origin }),
  };

  if (meta.scopes) {
    signInOptions.scopes = meta.scopes;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: meta.supabaseProvider,
    options: signInOptions,
  });

  if (error) {
    throw error;
  }

  return { strategy: 'supabase', data };
}

export function consumeOAuthResultParams(search = window.location.search) {
  const params = new URLSearchParams(search);
  const status = params.get('oauth_status') || '';
  const provider = params.get('oauth_provider') || '';
  const code = params.get('oauth_code') || '';
  if (!status && !provider && !code) {
    return null;
  }

  params.delete('oauth_status');
  params.delete('oauth_provider');
  params.delete('oauth_code');
  return {
    status,
    provider,
    code,
    nextSearch: params.toString(),
  };
}
