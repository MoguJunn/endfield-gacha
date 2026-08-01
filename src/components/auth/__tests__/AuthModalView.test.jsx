import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuthModalView from '../AuthModalView.jsx';

const originalScrollIntoView = Element.prototype.scrollIntoView;

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({ isEnglish: false }),
}));

vi.mock('../../captcha/AuthCaptchaBox.jsx', () => ({
  default: function MockAuthCaptchaBox() {
    return <div data-testid="auth-captcha-box">安全验证</div>;
  },
}));

function createProps(overrides = {}) {
  const noop = vi.fn();

  return {
    agreedToTerms: true,
    confirmPassword: 'Password123',
    email: 'user@example.com',
    emailCodeAction: '',
    emailCodeLoading: false,
    emailCodeValue: '',
    emailDomainError: '',
    emailLoginDisabled: false,
    emailLoginSendCount: 0,
    emailValid: true,
    error: '',
    forgotPasswordStatus: null,
    hasEmailError: false,
    captchaAction: 'register',
    captchaReady: false,
    loading: false,
    message: '',
    mode: 'register',
    oauthProviders: [],
    password: 'Password123',
    passwordResetSendCount: 0,
    recoveryRequestError: '',
    recoveryRequestForm: {
      requestType: '',
      claimedAccountCount: 1,
      verificationClaims: [{ gameUid: '', nickName: '' }],
      note: '',
    },
    recoveryRequestLoading: false,
    recoveryRequestSuccess: null,
    recoverySubmitDisabled: false,
    resendCooldown: 0,
    showDuplicateEmailPrompt: false,
    submitDisabled: true,
    username: '测试用户',
    onAddRecoveryClaim: noop,
    onAgreedToTermsChange: noop,
    onCaptchaStateChange: noop,
    onClose: noop,
    onCloseRecoveryRequest: noop,
    onConfirmPasswordChange: noop,
    onEmailChange: noop,
    onEmailCodeChange: noop,
    onEmailCodeSubmit: noop,
    onEmailLogin: noop,
    onOAuthLogin: noop,
    onOpenRecoveryRequest: noop,
    onPasswordChange: noop,
    onRecoveryClaimChange: noop,
    onRecoveryClaimedAccountCountChange: noop,
    onRecoveryNoteChange: noop,
    onRemoveRecoveryClaim: noop,
    onSkipEmailLoginCode: noop,
    onSkipPasswordResetEmail: noop,
    onSubmit: noop,
    onSubmitRecoveryRequest: noop,
    onSwitchMode: noop,
    onSwitchToForgotPassword: noop,
    onSwitchToLoginWithEmail: noop,
    onUsernameChange: noop,
    ...overrides,
  };
}

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.restoreAllMocks();
});

describe('AuthModalView responsive registration layout', () => {
  it('keeps the dialog inside the viewport with a dedicated scroll region', () => {
    render(<AuthModalView {...createProps()} />);

    const dialog = screen.getByRole('dialog', { name: 'REGISTER' });
    const scrollRegion = screen.getByTestId('auth-modal-scroll-region');

    expect(dialog).toHaveClass('max-h-[calc(100dvh-1rem)]', 'flex-col', 'overflow-hidden');
    expect(scrollRegion).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', 'p-4', 'sm:p-6');
    expect(screen.getByTestId('auth-captcha-box')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '等待验证' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '关闭账号窗口' })).toBeEnabled();
  });

  it('moves the completed registration action into view', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const props = createProps();
    const { rerender } = render(<AuthModalView {...props} />);
    rerender(<AuthModalView {...props} captchaReady submitDisabled={false} />);

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
    expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled();
  });
});
