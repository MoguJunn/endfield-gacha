import { supabase } from '../supabaseClient.js';
import { buildOAuthCallbackUrl, buildOAuthStartUrl } from './authOAuthService.js';
import { getCurrentSiteSession } from './siteSessionService.js';
import {
  createContributorDemoReadonlyError,
  isContributorDemoModeEnabled,
} from '../dev/contributorDemoMode.js';

export const LOGIN_IDENTITY_PROVIDERS = Object.freeze({
  email: {
    key: 'email',
    label: 'Email',
    canLink: false,
    canUnlink: false,
  },
  github: {
    key: 'github',
    label: 'GitHub',
    canLink: true,
    canUnlink: true,
    bridgeProvider: 'github',
    readyEnv: 'VITE_AUTH_OAUTH_GITHUB_ENABLED',
  },
  linuxdo: {
    key: 'linuxdo',
    label: 'Linux.do',
    canLink: true,
    canUnlink: true,
    bridgeProvider: 'linuxdo',
    readyEnv: 'VITE_AUTH_OAUTH_LINUXDO_ENABLED',
  },
  qq: {
    key: 'qq',
    label: 'QQ',
    canLink: false,
    canUnlink: false,
    planned: true,
  },
});

function normalizeProviderValue(value) {
  return String(value || '').trim().toLowerCase();
}

function isEnvEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isBridgeManagedProvider(providerKey) {
  const meta = LOGIN_IDENTITY_PROVIDERS[providerKey];
  return Boolean(meta?.bridgeProvider);
}

function isSiteSessionIdentity(identity) {
  return identity?.source === 'site_session' || identity?.identity_data?.site_session === true;
}

export function isLoginIdentityProviderAvailable(providerKey, env = import.meta.env) {
  const meta = LOGIN_IDENTITY_PROVIDERS[providerKey];
  if (!meta) {
    return false;
  }
  if (!meta.readyEnv) {
    return true;
  }
  return isEnvEnabled(env?.[meta.readyEnv]);
}

export function normalizeAuthIdentityProvider(identity) {
  const rawProvider = normalizeProviderValue(identity?.provider || identity?.provider_id);
  const issuer = normalizeProviderValue(identity?.identity_data?.iss || identity?.identity_data?.issuer);

  if (rawProvider === 'github') {
    return 'github';
  }

  if (rawProvider === 'email') {
    return 'email';
  }

  if (
    rawProvider === 'custom:linuxdo'
    || rawProvider === 'linuxdo'
    || rawProvider === 'custom'
    || issuer.includes('connect.linux.do')
  ) {
    return 'linuxdo';
  }

  if (rawProvider === 'qq') {
    return 'qq';
  }

  return rawProvider || 'unknown';
}

export function getIdentityDisplayValue(identity) {
  const data = identity?.identity_data || {};
  return (
    data.preferred_username
    || data.user_name
    || data.username
    || data.name
    || data.full_name
    || data.email
    || identity?.email
    || identity?.id
    || ''
  );
}

export function groupAuthIdentities(identities = []) {
  const grouped = new Map();
  for (const identity of Array.isArray(identities) ? identities : []) {
    const providerKey = normalizeAuthIdentityProvider(identity);
    if (!grouped.has(providerKey)) {
      grouped.set(providerKey, []);
    }
    grouped.get(providerKey).push(identity);
  }
  return grouped;
}

export async function loadAuthIdentities() {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError('auth-identities-load');
  }
  const supabaseIdentities = [];
  const siteIdentities = [];
  let supabaseError = null;

  if (supabase) {
    try {
      const { data, error } = await supabase.auth.getUserIdentities();
      if (error) {
        throw error;
      }
      supabaseIdentities.push(...(Array.isArray(data?.identities) ? data.identities : []));
    } catch (error) {
      supabaseError = error;
    }
  }

  try {
    const siteSession = await getCurrentSiteSession({ syncSupabase: false });
    if (siteSession?.authenticated && Array.isArray(siteSession.identities)) {
      siteIdentities.push(...siteSession.identities);
    }
  } catch {
    // The settings panel can still show Supabase identities when the site
    // session endpoint is unavailable.
  }

  const identities = [
    ...siteIdentities,
    ...supabaseIdentities.filter((identity) => {
      const providerKey = normalizeAuthIdentityProvider(identity);
      return !isBridgeManagedProvider(providerKey);
    }),
  ];

  if (identities.length === 0 && supabaseError) {
    throw supabaseError;
  }

  const seen = new Set();
  return identities.filter((identity) => {
    const key = [
      normalizeAuthIdentityProvider(identity),
      identity?.source || 'supabase',
      identity?.id || identity?.identity_id || getIdentityDisplayValue(identity),
    ].join(':');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function linkLoginIdentity(providerKey, {
  returnTo = '/settings',
  env = import.meta.env,
  origin = window.location.origin,
  assign = window.location.assign.bind(window.location),
} = {}) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError('auth-identity-link');
  }
  const meta = LOGIN_IDENTITY_PROVIDERS[providerKey];
  if (!meta?.canLink) {
    throw new Error('unsupported_identity_provider');
  }

  if (!isLoginIdentityProviderAvailable(providerKey, env)) {
    throw new Error('identity_provider_not_ready');
  }

  if (meta.bridgeProvider) {
    const targetUrl = buildOAuthStartUrl(meta.bridgeProvider, {
      returnTo,
      intent: 'link',
      origin,
    });
    assign(targetUrl);
    return { strategy: 'bridge', url: targetUrl };
  }

  if (!supabase) {
    throw new Error('supabase_not_configured');
  }

  if (!meta.supabaseProvider) {
    throw new Error('unsupported_identity_provider');
  }

  const options = {
    redirectTo: buildOAuthCallbackUrl({ returnTo }),
  };
  if (meta.scopes) {
    options.scopes = meta.scopes;
  }

  const { data, error } = await supabase.auth.linkIdentity({
    provider: meta.supabaseProvider,
    options,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function unlinkLoginIdentity(identity) {
  if (isContributorDemoModeEnabled()) {
    throw createContributorDemoReadonlyError('auth-identity-unlink');
  }
  const providerKey = normalizeAuthIdentityProvider(identity);
  if (isSiteSessionIdentity(identity) || isBridgeManagedProvider(providerKey)) {
    const response = await fetch('/api/auth/identities/unlink', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identityId: identity.id,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.code || payload?.error || 'oauth_identity_unlink_failed');
      error.code = payload?.code || payload?.error || 'oauth_identity_unlink_failed';
      throw error;
    }
    return payload?.data || payload;
  }

  if (!supabase) {
    throw new Error('supabase_not_configured');
  }

  const { data, error } = await supabase.auth.unlinkIdentity(identity);
  if (error) {
    throw error;
  }

  return data;
}
