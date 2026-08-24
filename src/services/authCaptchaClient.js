const DEFAULT_AUTH_CAPTCHA_ACTIONS = new Set([
  'register',
  'password_reset',
  'account_recovery',
]);

const PROVIDER_RESPONSE_SELECTORS = {
  turnstile: [
    '[name="cf-turnstile-response"]',
    '[data-auth-captcha-token]',
    '[name="captchaToken"]',
    '[name="captcha_token"]',
  ],
  hcaptcha: [
    '[name="h-captcha-response"]',
    '[data-auth-captcha-token]',
    '[name="captchaToken"]',
    '[name="captcha_token"]',
  ],
};

const PROVIDER_SCRIPT_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
};

function normalizeAction(action) {
  return String(action || '').trim().toLowerCase();
}

function splitList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeMode(rawMode, rawEnabled) {
  const enabled = String(rawEnabled || '').trim().toLowerCase();
  const fallbackMode = ['1', 'true', 'yes', 'on'].includes(enabled) ? 'enforce' : 'off';
  const mode = String(rawMode || fallbackMode).trim().toLowerCase();
  return ['off', 'monitor', 'enforce'].includes(mode) ? mode : 'off';
}

function normalizeProvider(rawProvider) {
  const provider = String(rawProvider || 'turnstile').trim().toLowerCase();
  return provider === 'hcaptcha' ? 'hcaptcha' : 'turnstile';
}

function resolveSiteKey(env, provider) {
  const genericSiteKey = String(env?.VITE_AUTH_CAPTCHA_SITE_KEY || '').trim();
  if (genericSiteKey) {
    return genericSiteKey;
  }

  if (provider === 'hcaptcha') {
    return String(env?.VITE_HCAPTCHA_SITE_KEY || env?.VITE_H_CAPTCHA_SITE_KEY || '').trim();
  }

  return String(env?.VITE_TURNSTILE_SITE_KEY || '').trim();
}

function isPlaceholderSiteKey(siteKey) {
  const normalized = String(siteKey || '').trim().toUpperCase();
  return (
    !normalized ||
    normalized.includes('PASTE_') ||
    normalized.includes('_HERE') ||
    normalized.includes('YOUR_') ||
    normalized === 'SITE_KEY'
  );
}

export function getAuthCaptchaClientConfig({
  action,
  env = import.meta.env,
} = {}) {
  const normalizedAction = normalizeAction(action);
  const mode = normalizeMode(env?.VITE_AUTH_CAPTCHA_MODE, env?.VITE_AUTH_CAPTCHA_ENABLED);
  const provider = normalizeProvider(env?.VITE_AUTH_CAPTCHA_PROVIDER);
  const configuredActions = splitList(env?.VITE_AUTH_CAPTCHA_REQUIRED_ACTIONS);
  const requiredActions = configuredActions.length > 0
    ? new Set(configuredActions)
    : DEFAULT_AUTH_CAPTCHA_ACTIONS;
  const actionCovered = requiredActions.has(normalizedAction);
  const siteKey = resolveSiteKey(env, provider);

  return {
    action: normalizedAction,
    mode,
    provider,
    siteKey,
    actionCovered,
    enabled: mode !== 'off' && actionCovered,
    required: mode === 'enforce' && actionCovered,
    monitoring: mode === 'monitor' && actionCovered,
    configured: !isPlaceholderSiteKey(siteKey),
  };
}

function normalizeTokenResult(result) {
  if (!result) return '';
  if (typeof result === 'string') return result.trim();
  if (typeof result !== 'object') return '';

  return String(
    result.captchaToken ||
    result.captcha_token ||
    result.turnstileToken ||
    result.hcaptchaToken ||
    result.response ||
    result.token ||
    ''
  ).trim();
}

async function readTokenFromProviderHook(config, win) {
  const candidates = [
    win?.__endfieldAuthCaptcha,
    win?.endfieldAuthCaptcha,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const getToken = candidate?.getToken || candidate?.execute;
    if (typeof getToken !== 'function') {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- hooks are checked in deterministic precedence order.
    const result = await getToken.call(candidate, config.action, {
      provider: config.provider,
      mode: config.mode,
      siteKey: config.siteKey,
      required: config.required,
      monitoring: config.monitoring,
    });
    const token = normalizeTokenResult(result);
    if (token) {
      return token;
    }
  }

  return '';
}

function readTokenFromDom(config, doc) {
  if (!doc || typeof doc.querySelector !== 'function') {
    return '';
  }

  const selectors = PROVIDER_RESPONSE_SELECTORS[config.provider] || PROVIDER_RESPONSE_SELECTORS.turnstile;
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    const token = String(
      element?.value ||
      element?.getAttribute?.('data-auth-captcha-token') ||
      element?.textContent ||
      ''
    ).trim();
    if (token) {
      return token;
    }
  }

  return '';
}

function createProviderContainer(config, doc) {
  if (!doc?.body || typeof doc.createElement !== 'function') {
    return null;
  }

  const container = doc.createElement('div');
  container.setAttribute('data-auth-captcha-container', config.provider);
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.width = '1px';
  container.style.height = '1px';
  container.style.overflow = 'hidden';
  doc.body.appendChild(container);
  return container;
}

function removeProviderContainer(container) {
  try {
    container?.remove?.();
  } catch {
    // Best-effort cleanup only.
  }
}

function getProviderGlobal(config, win) {
  if (config.provider === 'hcaptcha') {
    return win?.hcaptcha;
  }

  return win?.turnstile;
}

export function ensureAuthCaptchaProviderScriptLoaded(config, win, doc, timeoutMs = 8000) {
  if (getProviderGlobal(config, win)?.render) {
    return Promise.resolve(true);
  }

  const scriptUrl = PROVIDER_SCRIPT_URLS[config.provider];
  if (!scriptUrl || !doc || typeof doc.querySelector !== 'function' || typeof doc.createElement !== 'function') {
    return Promise.resolve(false);
  }

  const existingScript = doc.querySelector(`script[data-auth-captcha-script="${config.provider}"]`);
  if (existingScript) {
    return new Promise((resolve) => {
      if (getProviderGlobal(config, win)?.render) {
        resolve(true);
        return;
      }

      const timer = window.setTimeout(() => resolve(Boolean(getProviderGlobal(config, win)?.render)), timeoutMs);
      existingScript.addEventListener?.('load', () => {
        window.clearTimeout(timer);
        resolve(Boolean(getProviderGlobal(config, win)?.render));
      }, { once: true });
      existingScript.addEventListener?.('error', () => {
        window.clearTimeout(timer);
        resolve(false);
      }, { once: true });
    });
  }

  const mountPoint = doc.head || doc.body || doc.documentElement;
  if (!mountPoint) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const script = doc.createElement('script');
    const timer = window.setTimeout(() => {
      resolve(Boolean(getProviderGlobal(config, win)?.render));
    }, timeoutMs);

    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-auth-captcha-script', config.provider);
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(Boolean(getProviderGlobal(config, win)?.render));
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    mountPoint.appendChild(script);
  });
}

function createProviderTokenPromise({
  config,
  doc,
  render,
  execute,
  reset,
  renderOptions,
  executeOptions,
  timeoutMs,
}) {
  const container = createProviderContainer(config, doc);
  if (!container) {
    return Promise.resolve('');
  }

  return new Promise((resolve) => {
    let settled = false;
    let widgetId = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (widgetId !== null && typeof reset === 'function') {
        try {
          reset(widgetId);
        } catch {
          // Provider reset is optional.
        }
      }
      removeProviderContainer(container);
      resolve(normalizeTokenResult(value));
    };
    const timer = window.setTimeout(() => finish(''), timeoutMs);
    const finishWithTimer = (value) => {
      window.clearTimeout(timer);
      finish(value);
    };

    try {
      widgetId = render(container, {
        ...renderOptions,
        callback: (token) => finishWithTimer(token),
        'error-callback': () => finishWithTimer(''),
        'timeout-callback': () => finishWithTimer(''),
        'expired-callback': () => finishWithTimer(''),
      });

      window.setTimeout(() => {
        if (settled || typeof execute !== 'function') {
          return;
        }

        try {
          const executeResult = execute(widgetId ?? container, executeOptions);
          if (executeResult && typeof executeResult.then === 'function') {
            executeResult.then(finishWithTimer).catch(() => finishWithTimer(''));
          } else {
            const token = normalizeTokenResult(executeResult);
            if (token) {
              finishWithTimer(token);
            }
          }
        } catch {
          finishWithTimer('');
        }
      }, 250);
    } catch {
      finishWithTimer('');
    }
  });
}

async function readTokenFromTurnstile(config, win, doc, timeoutMs) {
  const turnstile = win?.turnstile;
  if (!config.siteKey || typeof turnstile?.render !== 'function') {
    return '';
  }

  return createProviderTokenPromise({
    config,
    doc,
    render: turnstile.render.bind(turnstile),
    execute: typeof turnstile.execute === 'function' ? turnstile.execute.bind(turnstile) : null,
    reset: typeof turnstile.reset === 'function' ? turnstile.reset.bind(turnstile) : null,
    renderOptions: {
      sitekey: config.siteKey,
      action: config.action,
      size: 'normal',
      appearance: 'interaction-only',
      execution: 'execute',
    },
    executeOptions: undefined,
    timeoutMs,
  });
}

async function readTokenFromHCaptcha(config, win, doc, timeoutMs) {
  const hcaptcha = win?.hcaptcha;
  if (!config.siteKey || typeof hcaptcha?.render !== 'function') {
    return '';
  }

  return createProviderTokenPromise({
    config,
    doc,
    render: hcaptcha.render.bind(hcaptcha),
    execute: typeof hcaptcha.execute === 'function' ? hcaptcha.execute.bind(hcaptcha) : null,
    reset: typeof hcaptcha.reset === 'function' ? hcaptcha.reset.bind(hcaptcha) : null,
    renderOptions: {
      sitekey: config.siteKey,
      size: 'invisible',
    },
    executeOptions: {
      async: true,
    },
    timeoutMs,
  });
}

export async function getAuthCaptchaToken(action, {
  env = import.meta.env,
  win = typeof window === 'undefined' ? null : window,
  doc = typeof document === 'undefined' ? null : document,
  timeoutMs = 8000,
} = {}) {
  const config = getAuthCaptchaClientConfig({ action, env });
  if (!config.enabled) {
    return {
      config,
      token: '',
      source: 'disabled',
    };
  }

  try {
    if (!config.configured) {
      return {
        config,
        token: '',
        source: 'not-configured',
      };
    }

    const hookToken = await readTokenFromProviderHook(config, win);
    if (hookToken) {
      return {
        config,
        token: hookToken,
        source: 'provider-hook',
      };
    }

    const domToken = readTokenFromDom(config, doc);
    if (domToken) {
      return {
        config,
        token: domToken,
        source: 'dom',
      };
    }

    await ensureAuthCaptchaProviderScriptLoaded(config, win, doc, timeoutMs);

    const providerToken = config.provider === 'hcaptcha'
      ? await readTokenFromHCaptcha(config, win, doc, timeoutMs)
      : await readTokenFromTurnstile(config, win, doc, timeoutMs);
    if (providerToken) {
      return {
        config,
        token: providerToken,
        source: config.provider,
      };
    }
  } catch {
    return {
      config,
      token: '',
      source: 'unavailable',
    };
  }

  return {
    config,
    token: '',
    source: config.configured ? 'unavailable' : 'not-configured',
  };
}

export async function buildAuthCaptchaPayload(action, options = {}) {
  const { config, token } = await getAuthCaptchaToken(action, options);
  if (!token) {
    return {};
  }

  return {
    captchaToken: token,
    captchaProvider: config.provider,
    captchaAction: config.action,
  };
}

export function buildCompletedAuthCaptchaPayload(action, captchaState) {
  const normalizedAction = normalizeAction(action);
  if (!normalizedAction || normalizeAction(captchaState?.action) !== normalizedAction) {
    return {};
  }

  if (captchaState?.provider === 'pow' && captchaState?.powPayload) {
    return {
      captchaProvider: 'pow',
      captchaAction: normalizedAction,
      powPayload: captchaState.powPayload,
    };
  }

  const token = normalizeTokenResult(captchaState?.token);
  if (!token) {
    return {};
  }

  return {
    captchaToken: token,
    captchaProvider: normalizeProvider(captchaState?.provider),
    captchaAction: normalizedAction,
  };
}
