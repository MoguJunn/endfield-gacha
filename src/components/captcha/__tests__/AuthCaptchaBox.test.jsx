import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthCaptchaBox from '../AuthCaptchaBox.jsx';
import {
  ensureAuthCaptchaProviderScriptLoaded,
  getAuthCaptchaClientConfig,
} from '../../../services/authCaptchaClient.js';
import { createAuthPowChallenge } from '../../../services/powChallengeService.js';

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({ isEnglish: false }),
}));

vi.mock('../../../services/authCaptchaClient.js', () => ({
  ensureAuthCaptchaProviderScriptLoaded: vi.fn(),
  getAuthCaptchaClientConfig: vi.fn(),
}));

vi.mock('../../../services/powChallengeService.js', () => ({
  createAuthPowChallenge: vi.fn(),
}));

const CHALLENGE = {
  action: 'register',
  algorithm: 'sha256-chain-v1',
  challengeId: 'challenge-1',
  difficulty: 1,
  expiresAt: Date.now() + 60_000,
  issuedAt: Date.now(),
  seed: 'seed',
  signature: 'signature',
  totalSteps: 10,
};

function renderCaptcha(onStateChange = vi.fn()) {
  return {
    onStateChange,
    ...render(<AuthCaptchaBox action="register" onStateChange={onStateChange} />),
  };
}

describe('AuthCaptchaBox verification presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthCaptchaClientConfig.mockReturnValue({
      action: 'register',
      configured: true,
      enabled: true,
      provider: 'turnstile',
      required: true,
      siteKey: 'site-key',
    });
    ensureAuthCaptchaProviderScriptLoaded.mockResolvedValue(true);
    createAuthPowChallenge.mockResolvedValue(CHALLENGE);
    window.turnstile = {
      remove: vi.fn(),
      render: vi.fn(() => 'widget-1'),
    };
  });

  it('shows clear provider choices and uses a flexible web widget', async () => {
    renderCaptcha();

    const webButton = screen.getByRole('button', { name: /网页验证/ });
    const localButton = screen.getByRole('button', { name: /本地校验/ });

    expect(webButton).toHaveAttribute('aria-pressed', 'true');
    expect(localButton).toHaveAttribute('aria-pressed', 'false');

    await waitFor(() => expect(window.turnstile.render).toHaveBeenCalled());
    expect(window.turnstile.render.mock.calls[0][1]).toMatchObject({
      action: 'register',
      size: 'flexible',
    });
  });

  it('switches to the compact local check without hiding its action', async () => {
    const { onStateChange } = renderCaptcha();

    fireEvent.click(screen.getByRole('button', { name: /本地校验/ }));

    expect(await screen.findByText('本地校验终端')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始校验' })).toBeVisible();
    expect(screen.getByRole('button', { name: /本地校验/ })).toHaveAttribute('aria-pressed', 'true');
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'register',
      provider: 'pow',
      ready: false,
      status: 'ready',
    }));
  });
});
