// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppStartupGate from '../AppStartupGate.jsx';
import { STORAGE_KEYS, writeNumberStorageValue } from '../../../utils/storageUtils.js';
import { CAPTCHA_VALIDITY_DURATION_MS } from '../../../utils/startupGateSession.js';

vi.mock('../../captcha/SiteGateCaptcha.jsx', () => ({
  default: ({ onVerified }) => (
    <button type="button" onClick={onVerified}>verify gate</button>
  ),
}));

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    t: (_key, _params, fallback) => fallback,
  }),
}));

describe('AppStartupGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('does not mount the application before first-time verification', () => {
    render(
      <AppStartupGate>
        <div>application shell</div>
      </AppStartupGate>
    );

    expect(screen.queryByText('application shell')).toBeNull();
    expect(screen.queryByText('完成验证后即可进入；已验证设备不会等待额外加载动画。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'verify gate' }));
    expect(screen.getByText('application shell')).toBeTruthy();
  });

  it('mounts the application immediately for a trusted gate session', () => {
    writeNumberStorageValue(
      STORAGE_KEYS.CAPTCHA_LAST_VERIFIED,
      Date.now() - Math.floor(CAPTCHA_VALIDITY_DURATION_MS / 2),
      { raw: true }
    );

    render(
      <AppStartupGate>
        <div>trusted application shell</div>
      </AppStartupGate>
    );

    expect(screen.getByText('trusted application shell')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'verify gate' })).toBeNull();
  });
});
