import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';

// Real native Web Locks and the installed SDK; no production auth or cookies.
const bundle = await build({
  stdin: {
    contents: `
      import { createClient, navigatorLock, NavigatorLockAcquireTimeoutError } from '@supabase/supabase-js';
      import { browserAuthLock, getBrowserAuthLock } from './src/utils/supabaseAuthLock.js';
      window.authLockTest = { createClient, navigatorLock, NavigatorLockAcquireTimeoutError, browserAuthLock, getBrowserAuthLock };
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
});

for (const browserType of [chromium, firefox]) {
  const browser = await browserType.launch(
    browserType === chromium && process.platform === 'win32'
      ? { channel: 'msedge', headless: true } : { headless: true },
  );
  try {
    const context = await browser.newContext();
    await context.route('https://auth-lock.test/**', (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Auth lock regression</title>',
    }));
    const holder = await context.newPage();
    const clientPage = await context.newPage();
    const pageErrors = [];
    clientPage.on('pageerror', (error) => pageErrors.push(error.message));
    await Promise.all([holder.goto('https://auth-lock.test/'), clientPage.goto('https://auth-lock.test/')]);
    await clientPage.addScriptTag({ content: bundle.outputFiles[0].text });

    await clientPage.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);
      const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated' };
      const token = (expiresAt) => [
        btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
        btoa(JSON.stringify({ sub: user.id, exp: expiresAt })),
        'test-signature',
      ].join('.');
      window.testSession = {
        access_token: token(now + 3600), refresh_token: 'local-test-only',
        expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user,
      };
      localStorage.setItem('auth-lock-regression', JSON.stringify(window.testSession));
      window.refreshCalls = 0;
      window.authClient = window.authLockTest.createClient('https://local-supabase.test', 'local-test-key', {
        auth: {
          storageKey: 'auth-lock-regression', autoRefreshToken: false,
          detectSessionInUrl: false, lock: window.authLockTest.getBrowserAuthLock(),
        },
        global: { fetch: async (url) => {
          if (String(url).includes('/token')) {
            window.refreshCalls += 1;
            return new Response(JSON.stringify({ ...window.testSession }), {
              status: 200, headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify(user), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        } },
      });
      await window.authClient.auth.initialize();
      await window.authClient.auth.getSession();
      // Let initialization's queued INITIAL_SESSION subscribers release the
      // SDK's in-client lock before making the stored token nearly expire.
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.refreshCalls = 0;
      localStorage.setItem('auth-lock-regression', JSON.stringify({
        ...window.testSession, expires_at: now + 15,
      }));
    });

    await holder.evaluate(() => {
      window.lockHeld = false;
      window.holdPromise = navigator.locks.request('lock:auth-lock-regression', async () => {
        window.lockHeld = true;
        await new Promise((resolve) => { window.releaseLock = resolve; });
      });
    });
    await holder.waitForFunction(() => window.lockHeld);

    const legacy = await clientPage.evaluate(async () => {
      const { navigatorLock, NavigatorLockAcquireTimeoutError } = window.authLockTest;
      try {
        await navigatorLock('lock:auth-lock-regression', 0, async () => 'unexpected');
        return { unexpectedAcquisition: true };
      } catch (error) {
        return { message: error.message, typed: error instanceof NavigatorLockAcquireTimeoutError,
          timeoutMarker: error.isAcquireTimeout === true };
      }
    });
    assert.match(legacy.message, /immediately failed/);
    console.log(`${browserType.name()} legacy contention: ${JSON.stringify(legacy)}`);

    const busy = await clientPage.evaluate(async () => {
      let callbackCalls = 0;
      const result = await window.authLockTest.browserAuthLock('lock:auth-lock-regression', 0, async () => {
        callbackCalls += 1;
      });
      await window.authClient.auth._autoRefreshTokenTick();
      return { skipped: result === undefined, callbackCalls, refreshCalls: window.refreshCalls };
    });
    assert.deepEqual(busy, { skipped: true, callbackCalls: 0, refreshCalls: 0 });
    const originalTick = await clientPage.evaluate(async () => {
      const auth = window.authClient.auth;
      const fixedLock = auth.lock;
      try {
        auth.lock = window.authLockTest.navigatorLock;
        await auth._autoRefreshTokenTick();
        return { handled: true, refreshCalls: window.refreshCalls };
      } finally { auth.lock = fixedLock; }
    });
    assert.deepEqual(originalTick, { handled: true, refreshCalls: 0 });

    // Ordinary auth calls wait for the other tab; they must not be skipped.
    await clientPage.evaluate(() => {
      window.waitCallbackCalls = 0;
      window.waitResult = window.authLockTest.browserAuthLock('lock:auth-lock-regression', 5000, async () => {
        window.waitCallbackCalls += 1;
        return 'authenticated-operation';
      });
    });
    await clientPage.waitForFunction(async () => {
      const state = await navigator.locks.query();
      return state.pending.some((lock) => lock.name === 'lock:auth-lock-regression');
    });
    assert.equal(await clientPage.evaluate(() => window.waitCallbackCalls), 0);
    await holder.evaluate(async () => { window.releaseLock(); await window.holdPromise; });
    assert.equal(await clientPage.evaluate(() => window.waitResult), 'authenticated-operation');
    assert.equal(await clientPage.evaluate(() => window.waitCallbackCalls), 1);

    const refreshed = await clientPage.evaluate(async () => {
      await window.authClient.auth._autoRefreshTokenTick();
      const { data, error } = await window.authClient.auth.getSession();
      return { refreshCalls: window.refreshCalls, userId: data.session?.user?.id, error };
    });
    assert.equal(refreshed.refreshCalls, 1);
    assert.equal(refreshed.userId, '00000000-0000-4000-8000-000000000001');
    assert.equal(refreshed.error, null);

    // Both zero and negative timeouts still run protected operations when free.
    for (const timeout of [0, -1]) {
      assert.equal(await clientPage.evaluate((acquireTimeout) => (
        window.authLockTest.browserAuthLock('lock:auth-lock-regression', acquireTimeout, async () => 42)
      ), timeout), 42);
      const message = await clientPage.evaluate(async (acquireTimeout) => {
        try {
          await window.authLockTest.browserAuthLock('lock:auth-lock-regression', acquireTimeout, async () => {
            throw new Error('real operation failure');
          });
          return 'swallowed';
        } catch (error) { return error.message; }
      }, timeout);
      assert.equal(message, 'real operation failure');
    }

    const signedOut = await clientPage.evaluate(async () => {
      const { error } = await window.authClient.auth.signOut({ scope: 'local' });
      await window.authClient.auth._autoRefreshTokenTick();
      const { data } = await window.authClient.auth.getSession();
      return { error, session: data.session, refreshCalls: window.refreshCalls };
    });
    assert.deepEqual(signedOut, { error: null, session: null, refreshCalls: 1 });

    const fallback = await clientPage.evaluate(() => {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
      return window.authLockTest.getBrowserAuthLock() === undefined;
    });
    assert.equal(fallback, true);
    assert.deepEqual(pageErrors, []);
    console.log(`PASS ${browserType.name()}: cross-tab exclusion, busy tick skipped, next tick refreshes, auth waits, errors propagate, sign-out, fallback, no unhandled rejections`);
    await context.close();
  } finally {
    await browser.close();
  }
}
