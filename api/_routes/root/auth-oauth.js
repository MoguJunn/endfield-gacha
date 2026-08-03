import {
  appendOAuthResultParams,
  consumeOAuthTransaction,
  createOAuthState,
  createOAuthTransactionMaterial,
  getOAuthStateSecret,
  hashOAuthBrowserBinding,
  normalizeOAuthIntent,
  normalizeOAuthReturnTo,
  persistOAuthTransaction,
  readOAuthTransactionCookie,
  serializeOAuthTransactionCookie,
  verifyOAuthState,
} from '../../_lib/oauthState.js';
import {
  OAUTH_PROVIDERS,
  buildOAuthAuthorizationUrl,
  exchangeOAuthCode,
  fetchOAuthProfile,
  getOAuthProviderConfig,
  hashOAuthProfile,
  isSupportedOAuthProvider,
  normalizeOAuthProvider,
  sanitizeOAuthProfile,
} from '../../_lib/oauthProviders.js';
import { buildOAuthIdentityHashCandidates } from '../../_lib/identityHash.js';
import {
  applyCors,
  checkMemoryRateLimit,
  getRequesterKey,
} from '../../_lib/http.js';
import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import {
  appendSetCookieHeader,
  createOrLinkOAuthUserAndSession,
  isSecureRequest,
  linkOAuthIdentityToSiteSession,
  loadSiteSession,
} from '../../_lib/siteSession.js';

function readEnvironment() {
  return globalThis.process?.env || {};
}

function getProviderFromRequest(req, fallbackProvider = '') {
  const queryProvider = req?.query?.provider;
  return normalizeOAuthProvider(queryProvider || fallbackProvider);
}

function sendJsonError(res, status, code, message, details = {}) {
  return res.status(status).json({
    success: false,
    error: code,
    code,
    message,
    details,
    meta: {
      cache: 'no-store',
      generatedAt: new Date().toISOString(),
    },
  });
}

function redirect(res, location, status = 302) {
  res.status(status);
  res.setHeader('Location', location);
  return res.end();
}

function redirectWithOAuthResult(res, req, {
  returnTo = '/',
  provider,
  status,
  code = '',
  env = readEnvironment(),
}) {
  const location = appendOAuthResultParams(returnTo, {
    oauth_status: status,
    oauth_provider: provider,
    oauth_code: code,
  }, env, req);
  return redirect(res, location);
}

function readQueryParam(query, key) {
  const value = query?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function clearOAuthTransactionCookie(res, transactionId, secure) {
  appendSetCookieHeader(res, serializeOAuthTransactionCookie(transactionId, '', {
    secure,
    maxAgeSeconds: 0,
  }));
}

async function loadOAuthLinkSession(adminClient, req, env) {
  return loadSiteSession(adminClient, {
    req,
    env,
    touch: false,
  }).catch((error) => ({
    ok: false,
    authenticated: false,
    code: error?.code || 'site_session_lookup_failed',
  }));
}

function guardCommon(req, res, {
  methods = ['GET'],
} = {}) {
  res.setHeader('Cache-Control', 'no-store');
  const { allowed, origin } = applyCors(req, res, {
    methods: `${methods.join(', ')}, OPTIONS`,
    headers: 'Content-Type, Authorization',
  });

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }

  if (origin && !allowed) {
    sendJsonError(res, 403, 'origin_not_allowed', 'Origin not allowed.');
    return false;
  }

  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    sendJsonError(res, 405, 'method_not_allowed', `Method ${req.method || 'UNKNOWN'} not allowed.`);
    return false;
  }

  return true;
}

export function createOAuthAuthorizeProxyHandler(fallbackProvider) {
  return async function oauthAuthorizeProxyHandler(req, res) {
    if (!guardCommon(req, res, { methods: ['GET'] })) {
      return;
    }

    const provider = getProviderFromRequest(req, fallbackProvider);
    const providerMeta = OAUTH_PROVIDERS[provider];
    if (!providerMeta?.authorizeUrl) {
      return sendJsonError(res, 404, 'oauth_provider_unsupported', 'OAuth provider is not supported.');
    }

    const query = req?.query || {};
    const targetUrl = new URL(providerMeta.authorizeUrl);
    [
      'response_type',
      'client_id',
      'redirect_uri',
      'scope',
      'state',
    ].forEach((key) => {
      const value = readQueryParam(query, key);
      if (value) {
        targetUrl.searchParams.set(key, String(value));
      }
    });

    return redirect(res, targetUrl.toString());
  };
}

function enforceStartRateLimit(req, res, provider) {
  const key = `${getRequesterKey(req)}:oauth:${provider}:start`;
  const result = checkMemoryRateLimit(key, {
    windowMs: 10 * 60 * 1000,
    max: 12,
  });
  if (result.allowed) {
    return true;
  }

  res.setHeader('Retry-After', String(result.retryAfter || 60));
  sendJsonError(res, 429, 'oauth_rate_limited', 'Too many OAuth start attempts.', {
    retryAfter: result.retryAfter || 60,
  });
  return false;
}

export function createOAuthStartHandler(fallbackProvider) {
  return async function oauthStartHandler(req, res) {
    if (!guardCommon(req, res, { methods: ['GET'] })) {
      return;
    }

    const env = readEnvironment();
    const provider = getProviderFromRequest(req, fallbackProvider);
    const rawReturnTo = req?.query?.returnTo || req?.query?.return_to || req?.headers?.referer || '/';
    const returnTo = normalizeOAuthReturnTo(rawReturnTo, env, req);

    if (!isSupportedOAuthProvider(provider)) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: 'error',
        code: 'oauth_provider_unsupported',
        env,
      });
    }

    if (!enforceStartRateLimit(req, res, provider)) {
      return;
    }

    const config = getOAuthProviderConfig(provider, { env, req });
    if (!config.ok) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: 'disabled',
        code: config.code,
        env,
      });
    }

    const intent = normalizeOAuthIntent(readQueryParam(req?.query, 'intent'));
    if (!intent) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: 'error',
        code: 'oauth_intent_invalid',
        env,
      });
    }

    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: 'error',
        code: 'oauth_session_unavailable',
        env,
      });
    }

    let startedSessionId = null;
    let startedUserId = null;
    if (intent === 'link') {
      const sessionResult = await loadOAuthLinkSession(adminClient, req, env);
      if (!sessionResult?.authenticated || !sessionResult.session?.id || !sessionResult.user?.id) {
        return redirectWithOAuthResult(res, req, {
          returnTo,
          provider,
          status: 'error',
          code: 'site_session_required',
          env,
        });
      }
      startedSessionId = sessionResult.session.id;
      startedUserId = sessionResult.user.id;
    }

    let state = '';
    try {
      const secret = getOAuthStateSecret(env);
      const transactionMaterial = createOAuthTransactionMaterial({ secret });
      const persisted = await persistOAuthTransaction(adminClient, {
        transactionId: transactionMaterial.transactionId,
        provider,
        intent,
        returnTo,
        browserBindingHash: transactionMaterial.browserBindingHash,
        pkceCodeVerifier: transactionMaterial.pkceCodeVerifier,
        startedSessionId,
        startedUserId,
      });
      if (!persisted.ok) {
        throw Object.assign(new Error(persisted.code || 'oauth_transaction_create_failed'), {
          code: persisted.code,
        });
      }

      state = createOAuthState({
        provider,
        returnTo,
        intent,
        transactionId: transactionMaterial.transactionId,
      }, { env, req, secret });

      const secure = isSecureRequest(req, env);
      appendSetCookieHeader(res, serializeOAuthTransactionCookie(
        transactionMaterial.transactionId,
        transactionMaterial.browserBindingToken,
        { secure }
      ));

      return redirect(res, buildOAuthAuthorizationUrl(config, state, {
        codeChallenge: transactionMaterial.pkceCodeChallenge,
      }));
    } catch (error) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: 'error',
        code: error?.code || error?.message || 'oauth_state_create_failed',
        env,
      });
    }
  };
}

export function createOAuthCallbackHandler(fallbackProvider) {
  return async function oauthCallbackHandler(req, res) {
    if (!guardCommon(req, res, { methods: ['GET'] })) {
      return;
    }

    const env = readEnvironment();
    const provider = getProviderFromRequest(req, fallbackProvider);
    const code = String(req?.query?.code || '').trim();
    const state = String(req?.query?.state || '').trim();
    const providerError = String(req?.query?.error || '').trim();
    const secret = getOAuthStateSecret(env);

    if (!isSupportedOAuthProvider(provider)) {
      return redirect(res, appendOAuthResultParams('/', {
        oauth_status: 'error',
        oauth_provider: provider,
        oauth_code: 'oauth_provider_unsupported',
      }, env, req));
    }

    const stateResult = verifyOAuthState(state, {
      expectedProvider: provider,
      env,
      secret,
    });
    if (!stateResult.ok) {
      return redirect(res, appendOAuthResultParams('/', {
        oauth_status: 'error',
        oauth_provider: provider,
        oauth_code: stateResult.code,
      }, env, req));
    }

    const fallbackReturnTo = normalizeOAuthReturnTo(stateResult.payload.returnTo || '/', env, req);
    const transactionId = String(stateResult.payload.transactionId || '').trim();
    const secure = isSecureRequest(req, env);
    const browserBindingToken = readOAuthTransactionCookie(req, transactionId, { secure });
    if (!browserBindingToken) {
      return redirectWithOAuthResult(res, req, {
        returnTo: fallbackReturnTo,
        provider,
        status: 'error',
        code: 'oauth_transaction_browser_mismatch',
        env,
      });
    }

    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return redirectWithOAuthResult(res, req, {
        returnTo: fallbackReturnTo,
        provider,
        status: 'error',
        code: 'oauth_session_unavailable',
        env,
      });
    }

    let transactionResult = null;
    try {
      transactionResult = await consumeOAuthTransaction(adminClient, {
        transactionId,
        provider,
        browserBindingHash: hashOAuthBrowserBinding(browserBindingToken, { secret }),
      });
    } catch (error) {
      transactionResult = {
        ok: false,
        code: error?.code || 'oauth_transaction_consume_failed',
      };
    }
    if (!transactionResult.ok) {
      return redirectWithOAuthResult(res, req, {
        returnTo: fallbackReturnTo,
        provider,
        status: 'error',
        code: transactionResult.code || 'oauth_transaction_consume_failed',
        env,
      });
    }

    clearOAuthTransactionCookie(res, transactionId, secure);
    const transaction = transactionResult.transaction;
    const returnTo = normalizeOAuthReturnTo(transaction.return_to || fallbackReturnTo, env, req);
    const intent = normalizeOAuthIntent(transaction.intent);
    if (!intent) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: 'error',
        code: 'oauth_intent_invalid',
        env,
      });
    }

    if (providerError) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: providerError === 'access_denied' ? 'cancelled' : 'error',
        code: providerError,
        env,
      });
    }

    if (!code) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: 'error',
        code: 'oauth_code_missing',
        env,
      });
    }

    if (intent === 'link') {
      const sessionResult = await loadOAuthLinkSession(adminClient, req, env);
      if (
        !sessionResult?.authenticated
        || sessionResult.session?.id !== transaction.started_session_id
        || sessionResult.user?.id !== transaction.started_user_id
      ) {
        return redirectWithOAuthResult(res, req, {
          returnTo,
          provider,
          status: 'error',
          code: 'oauth_link_session_mismatch',
          env,
        });
      }
    }

    const config = getOAuthProviderConfig(provider, { env, req });
    if (!config.ok) {
      return redirectWithOAuthResult(res, req, {
        returnTo,
        provider,
        status: 'disabled',
        code: config.code,
        env,
      });
    }

    try {
      const tokenResult = await exchangeOAuthCode(config, code, {
        codeVerifier: transaction.pkce_code_verifier,
      });
      if (!tokenResult.ok) {
        return redirectWithOAuthResult(res, req, {
          returnTo,
          provider,
          status: 'error',
          code: tokenResult.code,
          env,
        });
      }

      const profileResult = await fetchOAuthProfile(config, tokenResult);
      if (!profileResult.ok) {
        return redirectWithOAuthResult(res, req, {
          returnTo,
          provider,
          status: 'error',
          code: profileResult.code,
          env,
        });
      }

      const profile = sanitizeOAuthProfile(profileResult.profile);
      if (!profile.subject) {
        return redirectWithOAuthResult(res, req, {
          returnTo,
          provider,
          status: 'error',
          code: 'oauth_profile_subject_missing',
          env,
        });
      }

      const identityHashes = buildOAuthIdentityHashCandidates(provider, profile.subject, env);
      if (!identityHashes.ok) {
        return redirectWithOAuthResult(res, req, {
          returnTo,
          provider,
          status: 'error',
          code: identityHashes.code || 'oauth_identity_hash_key_missing',
          env,
        });
      }
      const subjectHash = identityHashes.current.hash;
      const profileHash = hashOAuthProfile(profile);

      try {
        if (intent === 'link') {
          const linkResult = await linkOAuthIdentityToSiteSession(adminClient, {
            profile,
            subjectHash,
            subjectHashVersion: identityHashes.current.version,
            previousSubjectHash: identityHashes.previous?.hash || '',
            previousSubjectHashVersion: identityHashes.previous?.version || '',
            legacySubjectHash: identityHashes.legacy?.hash || '',
            legacySubjectHashVersion: identityHashes.legacy?.version || '',
            profileHash,
            req,
            env,
            secret,
          });

          return redirectWithOAuthResult(res, req, {
            returnTo,
            provider,
            status: linkResult.ok ? 'linked' : 'error',
            code: linkResult.ok ? 'oauth_identity_linked' : (linkResult.code || 'oauth_identity_link_failed'),
            env,
          });
        }

        const signInResult = await createOrLinkOAuthUserAndSession(adminClient, {
          profile,
          subjectHash,
          subjectHashVersion: identityHashes.current.version,
          previousSubjectHash: identityHashes.previous?.hash || '',
          previousSubjectHashVersion: identityHashes.previous?.version || '',
          legacySubjectHash: identityHashes.legacy?.hash || '',
          legacySubjectHashVersion: identityHashes.legacy?.version || '',
          profileHash,
          req,
          res,
          env,
          secret,
        });

        return redirectWithOAuthResult(res, req, {
          returnTo,
          provider,
          status: signInResult.ok ? 'signed_in' : 'error',
          code: signInResult.ok
            ? (signInResult.created ? 'oauth_account_created' : 'oauth_signed_in')
            : (signInResult.code || 'oauth_session_create_failed'),
          env,
        });
      } catch {
        return redirectWithOAuthResult(res, req, {
          returnTo,
          provider,
          status: 'error',
          code: intent === 'link' ? 'oauth_identity_link_failed' : 'oauth_session_create_failed',
          env,
        });
      }
    } catch {
      return redirect(res, appendOAuthResultParams(returnTo || '/', {
        oauth_status: 'error',
        oauth_provider: provider,
        oauth_code: 'oauth_callback_failed',
      }, env, req));
    }
  };
}

export const linuxdoOAuthStartHandler = createOAuthStartHandler('linuxdo');
export const linuxdoOAuthCallbackHandler = createOAuthCallbackHandler('linuxdo');
export const linuxdoSupabaseAuthorizeHandler = createOAuthAuthorizeProxyHandler('linuxdo');
export const qqOAuthStartHandler = createOAuthStartHandler('qq');
export const qqOAuthCallbackHandler = createOAuthCallbackHandler('qq');
export const githubOAuthStartHandler = createOAuthStartHandler('github');
export const githubOAuthCallbackHandler = createOAuthCallbackHandler('github');
