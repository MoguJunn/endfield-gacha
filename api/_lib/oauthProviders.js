import { createHash, createHmac } from 'node:crypto';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getAppUrl } from './oauthState.js';

const DEFAULT_OAUTH_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_OAUTH_FETCH_ATTEMPTS = 2;
const DEFAULT_OAUTH_FETCH_RETRY_DELAY_MS = 150;
const MAX_OAUTH_RESPONSE_BYTES = 1024 * 1024;

export const OAUTH_PROVIDERS = Object.freeze({
  linuxdo: {
    key: 'linuxdo',
    label: 'Linux.do',
    authorizeUrl: 'https://connect.linux.do/oauth2/authorize',
    tokenUrl: 'https://connect.linux.do/oauth2/token',
    userUrl: 'https://connect.linux.do/api/user',
    defaultScope: 'openid profile email',
    tokenAuthMethod: 'basic',
    sendRedirectUri: false,
  },
  qq: {
    key: 'qq',
    label: 'QQ',
    authorizeUrl: 'https://graph.qq.com/oauth2.0/authorize',
    tokenUrl: 'https://graph.qq.com/oauth2.0/token',
    openIdUrl: 'https://graph.qq.com/oauth2.0/me',
    userUrl: 'https://graph.qq.com/user/get_user_info',
    defaultScope: 'get_user_info',
    tokenAuthMethod: 'query',
    sendRedirectUri: true,
  },
  github: {
    key: 'github',
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    emailUrl: 'https://api.github.com/user/emails',
    defaultScope: 'read:user user:email',
    tokenAuthMethod: 'body',
    sendRedirectUri: true,
  },
});

const PROVIDER_ALIASES = Object.freeze({
  linux: 'linuxdo',
  'linux.do': 'linuxdo',
});

function readEnvironment() {
  return globalThis.process?.env || {};
}

function parseBoolean(value, defaultValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeString(value, maxLength = 512) {
  return String(value || '').trim().slice(0, maxLength);
}

function envKey(provider, suffix) {
  return `AUTH_OAUTH_${String(provider || '').toUpperCase()}_${suffix}`;
}

export function normalizeOAuthProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] || normalized;
}

export function isSupportedOAuthProvider(value) {
  return Boolean(OAUTH_PROVIDERS[normalizeOAuthProvider(value)]);
}

function getProviderEnv(env, provider, suffix, fallback = '') {
  return normalizeString(env[envKey(provider, suffix)] || fallback);
}

function normalizeOAuthScope(provider, value) {
  const normalizedProvider = normalizeOAuthProvider(provider);
  const raw = normalizeString(value, 1024);
  if (normalizedProvider !== 'linuxdo') {
    return raw;
  }

  const normalizedScope = raw
    .split(/[,\s]+/u)
    .map((scope) => scope.trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (!normalizedScope || normalizedScope === 'read' || normalizedScope === 'read write') {
    return 'openid profile email';
  }

  return normalizedScope;
}

export function getOAuthRedirectUri(provider, env = readEnvironment(), req = null) {
  const normalizedProvider = normalizeOAuthProvider(provider);
  const configured = getProviderEnv(env, normalizedProvider, 'REDIRECT_URI');
  if (configured) {
    return configured;
  }
  return `${getAppUrl(env, req)}/api/auth/oauth/${normalizedProvider}/callback`;
}

export function getOAuthProviderConfig(provider, {
  env = readEnvironment(),
  req = null,
} = {}) {
  const normalizedProvider = normalizeOAuthProvider(provider);
  const base = OAUTH_PROVIDERS[normalizedProvider];
  if (!base) {
    return {
      ok: false,
      provider: normalizedProvider,
      code: 'oauth_provider_unsupported',
      reason: 'OAuth provider is not supported.',
    };
  }

  const clientId = getProviderEnv(env, normalizedProvider, 'CLIENT_ID');
  const clientSecret = getProviderEnv(env, normalizedProvider, 'CLIENT_SECRET');
  const enabledDefault = Boolean(clientId && (clientSecret || normalizedProvider === 'github'));
  const enabled = parseBoolean(env[envKey(normalizedProvider, 'ENABLED')], enabledDefault);
  const bridgeEnabled = normalizedProvider === 'github'
    ? parseBoolean(env.AUTH_OAUTH_GITHUB_BRIDGE_ENABLED, enabled)
    : enabled;

  if (!bridgeEnabled) {
    return {
      ok: false,
      provider: normalizedProvider,
      label: base.label,
      code: 'oauth_provider_disabled',
      reason: 'OAuth provider is disabled.',
    };
  }

  if (!clientId) {
    return {
      ok: false,
      provider: normalizedProvider,
      label: base.label,
      code: 'oauth_client_id_missing',
      reason: 'OAuth client id is missing.',
    };
  }

  if (!clientSecret) {
    return {
      ok: false,
      provider: normalizedProvider,
      label: base.label,
      code: 'oauth_client_secret_missing',
      reason: 'OAuth client secret is missing.',
    };
  }

  return {
    ok: true,
    provider: normalizedProvider,
    label: base.label,
    clientId,
    clientSecret,
    authorizeUrl: getProviderEnv(env, normalizedProvider, 'AUTHORIZE_URL', base.authorizeUrl),
    tokenUrl: getProviderEnv(env, normalizedProvider, 'TOKEN_URL', base.tokenUrl),
    openIdUrl: getProviderEnv(env, normalizedProvider, 'OPENID_URL', base.openIdUrl || ''),
    userUrl: getProviderEnv(env, normalizedProvider, 'USER_URL', base.userUrl),
    emailUrl: getProviderEnv(env, normalizedProvider, 'EMAIL_URL', base.emailUrl || ''),
    redirectUri: getOAuthRedirectUri(normalizedProvider, env, req),
    scope: normalizeOAuthScope(normalizedProvider, getProviderEnv(env, normalizedProvider, 'SCOPE', base.defaultScope)),
    tokenAuthMethod: getProviderEnv(env, normalizedProvider, 'TOKEN_AUTH_METHOD', base.tokenAuthMethod),
    sendRedirectUri: parseBoolean(
      env[envKey(normalizedProvider, 'SEND_REDIRECT_URI')],
      base.sendRedirectUri !== false
    ),
  };
}

export function buildOAuthAuthorizationUrl(config, state, {
  codeChallenge = '',
} = {}) {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  if (config.sendRedirectUri !== false) {
    url.searchParams.set('redirect_uri', config.redirectUri);
  }
  url.searchParams.set('state', state);
  if (config.scope) {
    url.searchParams.set('scope', config.scope);
  }
  if (codeChallenge) {
    url.searchParams.set('code_challenge', String(codeChallenge));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

async function parseOAuthResponse(response) {
  const text = await response.text();
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    const jsonpMatch = text.match(/^[^{]*(\{[\s\S]*\})[^}]*$/u);
    if (jsonpMatch) {
      try {
        return JSON.parse(jsonpMatch[1]);
      } catch {
        return {};
      }
    }
    return Object.fromEntries(new URLSearchParams(text));
  }
}

function normalizePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

function waitForRetry(delayMs) {
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function shouldBypassProxy(targetUrl, noProxyValue) {
  const hostname = String(targetUrl?.hostname || '').trim().toLowerCase();
  const port = String(targetUrl?.port || (targetUrl?.protocol === 'https:' ? '443' : '80'));
  if (!hostname) {
    return false;
  }

  return String(noProxyValue || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === '*') {
        return true;
      }

      let entryHost = entry;
      let entryPort = '';
      const portSeparator = entry.lastIndexOf(':');
      if (portSeparator > 0 && /^\d+$/u.test(entry.slice(portSeparator + 1))) {
        entryHost = entry.slice(0, portSeparator);
        entryPort = entry.slice(portSeparator + 1);
      }
      if (entryPort && entryPort !== port) {
        return false;
      }

      entryHost = entryHost.replace(/^\*\./u, '.');
      if (entryHost.startsWith('.')) {
        return hostname.endsWith(entryHost) || hostname === entryHost.slice(1);
      }
      return hostname === entryHost || hostname.endsWith(`.${entryHost}`);
    });
}

export function resolveOAuthProxyUrl(targetUrlValue, env = readEnvironment()) {
  if (!parseBoolean(env.AUTH_OAUTH_USE_ENV_PROXY, false)) {
    return '';
  }

  let targetUrl = null;
  try {
    targetUrl = new URL(targetUrlValue);
  } catch {
    return '';
  }

  const noProxy = env.NO_PROXY || env.no_proxy || '';
  if (shouldBypassProxy(targetUrl, noProxy)) {
    return '';
  }

  const rawProxy = targetUrl.protocol === 'https:'
    ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
    : env.HTTP_PROXY || env.http_proxy;
  if (!rawProxy) {
    return '';
  }

  try {
    const proxyUrl = new URL(rawProxy);
    return ['http:', 'https:'].includes(proxyUrl.protocol) ? proxyUrl.toString() : '';
  } catch {
    return '';
  }
}

function createBufferedResponse(response, body) {
  const status = Number(response?.statusCode || 0);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const value = response?.headers?.[String(name || '').toLowerCase()];
        if (Array.isArray(value)) {
          return value.join(', ');
        }
        return value == null ? null : String(value);
      },
    },
    async text() {
      return body.toString('utf8');
    },
  };
}

function fetchOAuthUrlViaProxy(urlValue, options, proxyUrl) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(urlValue);
    const signal = options?.signal;
    if (signal?.aborted) {
      reject(Object.assign(new Error('OAuth request aborted.'), { name: 'AbortError' }));
      return;
    }

    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      callback(value);
    };
    const request = https.request(targetUrl, {
      method: options?.method || 'GET',
      headers: options?.headers || {},
      agent: new HttpsProxyAgent(proxyUrl),
    }, (response) => {
      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_OAUTH_RESPONSE_BYTES) {
          response.destroy(new Error('OAuth provider response is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        finish(resolve, createBufferedResponse(response, Buffer.concat(chunks)));
      });
      response.on('error', (error) => finish(reject, error));
    });
    const onAbort = () => {
      request.destroy(Object.assign(new Error('OAuth request aborted.'), { name: 'AbortError' }));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    request.on('error', (error) => finish(reject, error));
    if (options?.body != null) {
      request.write(options.body);
    }
    request.end();
  });
}

function resolveOAuthFetchImpl(fetchImpl, env = readEnvironment()) {
  if (typeof fetchImpl === 'function') {
    return fetchImpl;
  }
  if (typeof globalThis.fetch !== 'function') {
    return null;
  }

  return (url, options) => {
    const proxyUrl = resolveOAuthProxyUrl(url, env);
    if (proxyUrl && String(url).startsWith('https://')) {
      return fetchOAuthUrlViaProxy(url, options, proxyUrl);
    }
    return globalThis.fetch(url, options);
  };
}

async function requestOAuthPayload(url, requestOptions, {
  fetchImpl,
  timeoutMs = DEFAULT_OAUTH_FETCH_TIMEOUT_MS,
  maxAttempts = DEFAULT_OAUTH_FETCH_ATTEMPTS,
  retryDelayMs = DEFAULT_OAUTH_FETCH_RETRY_DELAY_MS,
  networkErrorCode,
  timeoutErrorCode,
}) {
  const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs, DEFAULT_OAUTH_FETCH_TIMEOUT_MS, 30_000);
  const normalizedMaxAttempts = normalizePositiveInteger(maxAttempts, DEFAULT_OAUTH_FETCH_ATTEMPTS, 3);
  const normalizedRetryDelayMs = Math.max(0, Math.min(Number(retryDelayMs) || 0, 2_000));
  let lastCode = networkErrorCode;

  for (let attempt = 1; attempt <= normalizedMaxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalizedTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...requestOptions,
        signal: controller.signal,
      });
      const payload = await parseOAuthResponse(response);
      return { ok: true, response, payload };
    } catch (error) {
      lastCode = controller.signal.aborted
        || error?.name === 'AbortError'
        || error?.name === 'TimeoutError'
        ? timeoutErrorCode
        : networkErrorCode;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < normalizedMaxAttempts) {
      await waitForRetry(normalizedRetryDelayMs);
    }
  }

  return {
    ok: false,
    code: lastCode,
    reason: 'OAuth provider is temporarily unreachable.',
  };
}

function buildTokenHeaders(config) {
  const headers = {
    Accept: 'application/json',
  };

  if (config.tokenAuthMethod === 'basic') {
    const credential = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${credential}`;
  }

  return headers;
}

export async function exchangeOAuthCode(config, code, {
  fetchImpl = null,
  codeVerifier = '',
  timeoutMs = DEFAULT_OAUTH_FETCH_TIMEOUT_MS,
  maxAttempts = DEFAULT_OAUTH_FETCH_ATTEMPTS,
  retryDelayMs = DEFAULT_OAUTH_FETCH_RETRY_DELAY_MS,
  env = readEnvironment(),
} = {}) {
  const normalizedCode = normalizeString(code, 2048);
  if (!normalizedCode) {
    return { ok: false, code: 'oauth_code_missing', reason: 'OAuth authorization code is missing.' };
  }

  const resolvedFetchImpl = resolveOAuthFetchImpl(fetchImpl, env);
  if (typeof resolvedFetchImpl !== 'function') {
    return { ok: false, code: 'fetch_unavailable', reason: 'Server fetch is unavailable.' };
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: normalizedCode,
  });

  if (config.sendRedirectUri !== false) {
    params.set('redirect_uri', config.redirectUri);
  }

  if (codeVerifier) {
    params.set('code_verifier', normalizeString(codeVerifier, 256));
  }

  if (config.tokenAuthMethod !== 'basic') {
    params.set('client_id', config.clientId);
    params.set('client_secret', config.clientSecret);
  }

  const method = config.tokenAuthMethod === 'query' ? 'GET' : 'POST';
  const url = new URL(config.tokenUrl);
  let body = null;
  const headers = buildTokenHeaders(config);

  if (method === 'GET') {
    params.forEach((value, key) => url.searchParams.set(key, value));
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = params.toString();
  }

  const requestResult = await requestOAuthPayload(url.toString(), {
    method,
    headers,
    body,
  }, {
    fetchImpl: resolvedFetchImpl,
    timeoutMs,
    maxAttempts,
    retryDelayMs,
    networkErrorCode: 'oauth_token_network_error',
    timeoutErrorCode: 'oauth_token_timeout',
  });
  if (!requestResult.ok) {
    return requestResult;
  }

  const { response, payload } = requestResult;
  if (!response.ok || payload?.error) {
    return {
      ok: false,
      code: payload?.error || `oauth_token_http_${response.status}`,
      reason: payload?.error_description || payload?.message || 'OAuth token exchange failed.',
      status: response.status,
    };
  }

  const accessToken = normalizeString(payload.access_token || payload.accessToken, 4096);
  if (!accessToken) {
    return { ok: false, code: 'oauth_access_token_missing', reason: 'OAuth provider returned no access token.' };
  }

  return {
    ok: true,
    accessToken,
    tokenType: normalizeString(payload.token_type || payload.tokenType || 'Bearer', 32),
    scope: normalizeString(payload.scope || ''),
    expiresIn: Number.isFinite(Number(payload.expires_in)) ? Number(payload.expires_in) : null,
  };
}

async function fetchJson(url, {
  fetchImpl = null,
  headers = {},
  timeoutMs = DEFAULT_OAUTH_FETCH_TIMEOUT_MS,
  maxAttempts = DEFAULT_OAUTH_FETCH_ATTEMPTS,
  retryDelayMs = DEFAULT_OAUTH_FETCH_RETRY_DELAY_MS,
  env = readEnvironment(),
} = {}) {
  const resolvedFetchImpl = resolveOAuthFetchImpl(fetchImpl, env);
  if (typeof resolvedFetchImpl !== 'function') {
    return { ok: false, code: 'fetch_unavailable', reason: 'Server fetch is unavailable.' };
  }

  const requestResult = await requestOAuthPayload(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  }, {
    fetchImpl: resolvedFetchImpl,
    timeoutMs,
    maxAttempts,
    retryDelayMs,
    networkErrorCode: 'oauth_profile_network_error',
    timeoutErrorCode: 'oauth_profile_timeout',
  });
  if (!requestResult.ok) {
    return requestResult;
  }

  const { response, payload } = requestResult;
  if (!response.ok || payload?.error) {
    return {
      ok: false,
      code: payload?.error || `oauth_profile_http_${response.status}`,
      reason: payload?.error_description || payload?.message || 'OAuth profile request failed.',
      status: response.status,
    };
  }
  return { ok: true, payload };
}

function normalizeAvatarTemplate(value) {
  const raw = normalizeString(value, 500);
  if (!raw) return '';
  if (raw.includes('{size}')) {
    return raw.replace('{size}', '128');
  }
  return raw;
}

async function fetchQqProfile(config, tokenResult, options) {
  const openIdUrl = new URL(config.openIdUrl);
  openIdUrl.searchParams.set('access_token', tokenResult.accessToken);
  const openIdResult = await fetchJson(openIdUrl.toString(), options);
  if (!openIdResult.ok) {
    return openIdResult;
  }

  const openId = normalizeString(openIdResult.payload?.openid, 256);
  if (!openId) {
    return { ok: false, code: 'oauth_profile_subject_missing', reason: 'QQ returned no openid.' };
  }

  const userUrl = new URL(config.userUrl);
  userUrl.searchParams.set('access_token', tokenResult.accessToken);
  userUrl.searchParams.set('oauth_consumer_key', config.clientId);
  userUrl.searchParams.set('openid', openId);
  const profileResult = await fetchJson(userUrl.toString(), options);
  if (!profileResult.ok) {
    return profileResult;
  }

  return {
    ok: true,
    profile: {
      provider: 'qq',
      subject: openId,
      username: normalizeString(profileResult.payload?.nickname || ''),
      displayName: normalizeString(profileResult.payload?.nickname || ''),
      avatarUrl: normalizeString(profileResult.payload?.figureurl_qq_2 || profileResult.payload?.figureurl_qq_1 || profileResult.payload?.figureurl || ''),
      email: '',
      metadata: {
        gender: normalizeString(profileResult.payload?.gender || '', 32),
      },
    },
  };
}

async function fetchGithubProfile(config, tokenResult, options) {
  const profileResult = await fetchJson(config.userUrl, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      'User-Agent': 'endfield-gacha-oauth',
    },
  });
  if (!profileResult.ok) {
    return profileResult;
  }

  return {
    ok: true,
    profile: {
      provider: 'github',
      subject: normalizeString(profileResult.payload?.id, 128),
      username: normalizeString(profileResult.payload?.login || ''),
      displayName: normalizeString(profileResult.payload?.name || profileResult.payload?.login || ''),
      avatarUrl: normalizeString(profileResult.payload?.avatar_url || ''),
      email: '',
      emailVerified: false,
      metadata: {
        profileUrl: normalizeString(profileResult.payload?.html_url || '', 500),
        emailIgnored: Boolean(profileResult.payload?.email || config.emailUrl),
      },
    },
  };
}

async function fetchLinuxDoProfile(config, tokenResult, options) {
  const profileResult = await fetchJson(config.userUrl, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
    },
  });
  if (!profileResult.ok) {
    return profileResult;
  }

  const payload = profileResult.payload;
  return {
    ok: true,
    profile: {
      provider: 'linuxdo',
      subject: normalizeString(payload?.id, 128),
      username: normalizeString(payload?.username || payload?.login || ''),
      displayName: normalizeString(payload?.name || payload?.username || payload?.login || ''),
      avatarUrl: normalizeAvatarTemplate(payload?.avatar_template || payload?.avatar_url || ''),
      email: normalizeString(payload?.email || '', 320),
      metadata: {
        active: payload?.active === true,
        trustLevel: Number.isFinite(Number(payload?.trust_level)) ? Number(payload.trust_level) : null,
      },
    },
  };
}

export async function fetchOAuthProfile(config, tokenResult, options = {}) {
  if (config.provider === 'qq') {
    return fetchQqProfile(config, tokenResult, options);
  }
  if (config.provider === 'github') {
    return fetchGithubProfile(config, tokenResult, options);
  }
  return fetchLinuxDoProfile(config, tokenResult, options);
}

export function sanitizeOAuthProfile(profile) {
  return {
    provider: normalizeOAuthProvider(profile?.provider),
    subject: normalizeString(profile?.subject, 256),
    username: normalizeString(profile?.username, 80),
    displayName: normalizeString(profile?.displayName || profile?.username, 80),
    avatarUrl: normalizeString(profile?.avatarUrl, 500),
    email: normalizeString(profile?.email, 320),
    emailVerified: profile?.emailVerified === true,
    metadata: profile?.metadata && typeof profile.metadata === 'object'
      ? profile.metadata
      : {},
  };
}

export function hashOAuthSubject(provider, subject, secret) {
  return createHmac('sha256', String(secret || ''))
    .update(`${normalizeOAuthProvider(provider)}:${String(subject || '').trim()}`, 'utf8')
    .digest('hex');
}

export function hashOAuthProfile(profile) {
  return createHash('sha256')
    .update(JSON.stringify({
      provider: profile?.provider || '',
      username: profile?.username || '',
      displayName: profile?.displayName || '',
      avatarUrl: profile?.avatarUrl || '',
      emailPresent: Boolean(profile?.email),
    }), 'utf8')
    .digest('hex');
}
