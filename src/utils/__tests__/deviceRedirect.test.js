import { describe, expect, it } from 'vitest';

import {
  getDeviceRedirectTarget,
  shouldBypassDeviceRedirect,
} from '../deviceRedirect.js';

describe('deviceRedirect', () => {
  it('preserves email verification state when redirecting to mobile settings', () => {
    expect(getDeviceRedirectTarget('/settings', true, {
      search: '?email_verification=success&source=mail',
      hash: '#account',
    })).toBe('/m/settings?email_verification=success&source=mail#account');
  });

  it('preserves query and hash values without prefixes', () => {
    expect(getDeviceRedirectTarget('/m/settings', false, {
      search: 'email_verification=failed&reason=token_expired',
      hash: 'account',
    })).toBe('/settings?email_verification=failed&reason=token_expired#account');
  });

  it('does not redirect independent auth and status pages', () => {
    expect(shouldBypassDeviceRedirect('/auth/callback')).toBe(true);
    expect(shouldBypassDeviceRedirect('/status')).toBe(true);
    expect(getDeviceRedirectTarget('/auth/callback', true, {
      search: '?next=%2Fsettings',
    })).toBeNull();
  });

  it('returns null when the current path already matches the device', () => {
    expect(getDeviceRedirectTarget('/m/settings', true, {
      search: '?email_verification=success',
    })).toBeNull();
  });
});
