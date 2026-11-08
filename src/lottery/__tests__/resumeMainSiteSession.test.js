import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeMainSiteSession } from '../resumeMainSiteSession.js';

describe('automatic lottery main-session continuation', () => {
  const replace = vi.fn();
  beforeEach(() => {
    replace.mockReset();
    const original = window;
    vi.stubGlobal('window', new Proxy(original, {
      get(target, key) { return key === 'location' ? { replace } : Reflect.get(target, key); },
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('deduplicates existing main-session checks and continues without navigating to the homepage', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, authenticated: true, data: { user: { id: 'user-1' } } }) });
    vi.stubGlobal('fetch', fetch);
    await Promise.all([resumeMainSiteSession(), resumeMainSiteSession()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/api/auth/sso/start');
  });

  it.each([
    { success: true, authenticated: false },
    { success: true, authenticated: true, data: {} },
    { success: false, authenticated: true, data: { user: { id: 'user-1' } } },
  ])('does not start a redirect for an unauthenticated or incomplete response: %j', async session => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => session }));
    expect(await resumeMainSiteSession()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not redirect or loop during a session-service outage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await resumeMainSiteSession()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
