import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuthCaptchaPayload,
  buildCompletedAuthCaptchaPayload,
  getAuthCaptchaClientConfig,
  getAuthCaptchaToken,
} from '../authCaptchaClient.js';

function createEnv(overrides = {}) {
  return {
    VITE_AUTH_CAPTCHA_MODE: 'enforce',
    VITE_AUTH_CAPTCHA_PROVIDER: 'turnstile',
    VITE_AUTH_CAPTCHA_SITE_KEY: 'site-key',
    ...overrides,
  };
}

describe('authCaptchaClient', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete window.__endfieldAuthCaptcha;
    delete window.endfieldAuthCaptcha;
    delete window.turnstile;
    delete window.hcaptcha;
    vi.restoreAllMocks();
  });

  it('keeps CAPTCHA disabled by default when frontend mode is off', async () => {
    const config = getAuthCaptchaClientConfig({
      action: 'register',
      env: {
        VITE_AUTH_CAPTCHA_MODE: 'off',
        VITE_AUTH_CAPTCHA_PROVIDER: 'turnstile',
        VITE_TURNSTILE_SITE_KEY: 'site-key',
      },
    });
    const payload = await buildAuthCaptchaPayload('register', {
      env: {
        VITE_AUTH_CAPTCHA_MODE: 'off',
        VITE_AUTH_CAPTCHA_PROVIDER: 'turnstile',
        VITE_TURNSTILE_SITE_KEY: 'site-key',
      },
    });

    expect(config).toMatchObject({
      mode: 'off',
      provider: 'turnstile',
      enabled: false,
      required: false,
      configured: true,
    });
    expect(payload).toEqual({});
  });

  it('only covers default auth risk actions unless configured otherwise', async () => {
    const loginPayload = await buildAuthCaptchaPayload('login', {
      env: createEnv(),
      win: {
        __endfieldAuthCaptcha: {
          getToken: vi.fn(async () => 'login-token'),
        },
      },
      doc: document,
    });
    const registerPayload = await buildAuthCaptchaPayload('register', {
      env: createEnv(),
      win: {
        __endfieldAuthCaptcha: {
          getToken: vi.fn(async () => 'register-token'),
        },
      },
      doc: document,
    });

    expect(loginPayload).toEqual({});
    expect(registerPayload).toEqual({
      captchaToken: 'register-token',
      captchaProvider: 'turnstile',
      captchaAction: 'register',
    });
  });

  it('uses an injected provider hook without exposing the token in metadata', async () => {
    const getToken = vi.fn(async (action, options) => ({
      token: `${action}-provider-token`,
      debug: {
        ignored: true,
      },
      options,
    }));

    const result = await getAuthCaptchaToken('password_reset', {
      env: createEnv({
        VITE_AUTH_CAPTCHA_PROVIDER: 'hcaptcha',
        VITE_AUTH_CAPTCHA_SITE_KEY: '',
        VITE_HCAPTCHA_SITE_KEY: 'hcaptcha-site-key',
      }),
      win: {
        endfieldAuthCaptcha: {
          getToken,
        },
      },
      doc: document,
    });
    const payload = await buildAuthCaptchaPayload('password_reset', {
      env: createEnv({
        VITE_AUTH_CAPTCHA_PROVIDER: 'hcaptcha',
        VITE_AUTH_CAPTCHA_SITE_KEY: '',
        VITE_HCAPTCHA_SITE_KEY: 'hcaptcha-site-key',
      }),
      win: {
        endfieldAuthCaptcha: {
          getToken,
        },
      },
      doc: document,
    });

    expect(getToken).toHaveBeenCalledWith('password_reset', expect.objectContaining({
      provider: 'hcaptcha',
      siteKey: 'hcaptcha-site-key',
      required: true,
    }));
    expect(result).toMatchObject({
      source: 'provider-hook',
      token: 'password_reset-provider-token',
      config: {
        provider: 'hcaptcha',
        siteKey: 'hcaptcha-site-key',
      },
    });
    expect(JSON.stringify(result.config)).not.toContain('provider-token');
    expect(payload).toEqual({
      captchaToken: 'password_reset-provider-token',
      captchaProvider: 'hcaptcha',
      captchaAction: 'password_reset',
    });
  });

  it('falls back to existing hidden provider response fields', async () => {
    const input = document.createElement('input');
    input.name = 'cf-turnstile-response';
    input.value = 'dom-turnstile-token';
    document.body.appendChild(input);

    const result = await getAuthCaptchaToken('account_recovery', {
      env: createEnv(),
      win: {},
      doc: document,
    });

    expect(result).toMatchObject({
      source: 'dom',
      token: 'dom-turnstile-token',
      config: {
        action: 'account_recovery',
      },
    });
  });

  it('can execute a loaded Turnstile widget with supported deferred options', async () => {
    vi.useFakeTimers();
    try {
      let completeChallenge;
      const render = vi.fn((_container, options) => {
        completeChallenge = options.callback;
        return 'widget-id';
      });
      const execute = vi.fn(() => {
        window.setTimeout(() => completeChallenge('turnstile-executed-token'), 0);
      });
      const reset = vi.fn();

      const payloadPromise = buildAuthCaptchaPayload('register', {
        env: createEnv({
          VITE_AUTH_CAPTCHA_SITE_KEY: '',
          VITE_TURNSTILE_SITE_KEY: 'turnstile-site-key',
        }),
        win: {
          turnstile: {
            render,
            execute,
            reset,
          },
        },
        doc: document,
      });
      await vi.runAllTimersAsync();
      const payload = await payloadPromise;

      expect(render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
        sitekey: 'turnstile-site-key',
        action: 'register',
        size: 'normal',
        appearance: 'interaction-only',
        execution: 'execute',
      }));
      expect(execute).toHaveBeenCalledWith('widget-id', undefined);
      expect(reset).toHaveBeenCalledWith('widget-id');
      expect(document.querySelector('[data-auth-captcha-container]')).toBeNull();
      expect(payload).toEqual({
        captchaToken: 'turnstile-executed-token',
        captchaProvider: 'turnstile',
        captchaAction: 'register',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads the Turnstile script on demand before executing a deferred widget', async () => {
    const appendChild = vi.spyOn(document.head, 'appendChild');
    const tokenPromise = getAuthCaptchaToken('register', {
      env: createEnv({
        VITE_AUTH_CAPTCHA_SITE_KEY: '',
        VITE_TURNSTILE_SITE_KEY: 'turnstile-site-key',
      }),
      win: window,
      doc: document,
      timeoutMs: 1000,
    });

    await Promise.resolve();

    const script = document.querySelector('script[data-auth-captcha-script="turnstile"]');
    expect(script?.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    expect(appendChild).toHaveBeenCalledWith(script);

    window.turnstile = {
      render: vi.fn((_container, options) => {
        window.setTimeout(() => options.callback('lazy-turnstile-token'), 0);
        return 'lazy-widget-id';
      }),
      execute: vi.fn(),
      reset: vi.fn(),
    };
    script.onload();

    await expect(tokenPromise).resolves.toMatchObject({
      source: 'turnstile',
      token: 'lazy-turnstile-token',
    });
  });

  it('treats placeholder site keys as not configured', async () => {
    const result = await getAuthCaptchaToken('register', {
      env: createEnv({
        VITE_AUTH_CAPTCHA_SITE_KEY: '',
        VITE_TURNSTILE_SITE_KEY: 'PASTE_TURNSTILE_SITE_KEY_HERE',
      }),
      win: window,
      doc: document,
    });

    expect(result).toMatchObject({
      source: 'not-configured',
      token: '',
      config: {
        configured: false,
      },
    });
    expect(document.querySelector('script[data-auth-captcha-script="turnstile"]')).toBeNull();
  });

  it('reuses a completed visible Turnstile token for the matching action', () => {
    expect(buildCompletedAuthCaptchaPayload('register', {
      action: 'register',
      provider: 'turnstile',
      token: 'visible-turnstile-token',
    })).toEqual({
      captchaToken: 'visible-turnstile-token',
      captchaProvider: 'turnstile',
      captchaAction: 'register',
    });
  });

  it('does not reuse a completed token for a different action', () => {
    expect(buildCompletedAuthCaptchaPayload('password_reset', {
      action: 'register',
      provider: 'turnstile',
      token: 'stale-register-token',
    })).toEqual({});
  });

  it('reuses a completed local verification payload', () => {
    const powPayload = { challengeId: 'challenge-id', nonce: 42 };

    expect(buildCompletedAuthCaptchaPayload('register', {
      action: 'register',
      provider: 'pow',
      powPayload,
    })).toEqual({
      captchaProvider: 'pow',
      captchaAction: 'register',
      powPayload,
    });
  });

  it('respects custom action coverage for login preflight', async () => {
    const payload = await buildAuthCaptchaPayload('login', {
      env: createEnv({
        VITE_AUTH_CAPTCHA_REQUIRED_ACTIONS: 'login,register',
      }),
      win: {
        __endfieldAuthCaptcha: {
          getToken: vi.fn(async () => 'login-token'),
        },
      },
      doc: document,
    });

    expect(payload).toEqual({
      captchaToken: 'login-token',
      captchaProvider: 'turnstile',
      captchaAction: 'login',
    });
  });
});
