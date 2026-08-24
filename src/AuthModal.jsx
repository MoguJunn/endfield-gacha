import React from 'react';
import { supabase } from './supabaseClient';
import {
  buildAuthCaptchaPayload,
  buildCompletedAuthCaptchaPayload,
} from './services/authCaptchaClient.js';
import { getEnabledOAuthProviders, startOAuthLogin } from './services/authOAuthService.js';
import { bootstrapSiteSessionFromSupabaseToken } from './services/siteSessionService.js';
import { fetchJsonWithTimeout } from './services/supabaseRequest.js';
import { getSimpleFriendlyError, isNetworkConnectivityError } from './utils/errorMessages';
import { validateAccountPassword } from './utils/authSecurity.js';
import { buildAccountRecoveryNotification } from './utils/notificationModel.js';
import { getUsernameValidationCode, normalizeUsername } from './utils/usernameValidation.js';
import AuthModalView from './components/auth/AuthModalView';
import { useAuthModalState } from './hooks/auth/useAuthModalState';
import { useI18n } from './i18n/index.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUTH_REQUEST_TIMEOUT_MS = import.meta.env?.DEV ? 30000 : 25000;

function createAuthRequestTimeoutError(timeoutMs) {
  const error = new Error(`Auth request timed out after ${timeoutMs}ms`);
  error.code = 'CLIENT_TIMEOUT';
  error.name = 'TimeoutError';
  return error;
}

async function withAuthRequestTimeout(request, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(createAuthRequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function createEmptyRecoveryForm(requestType = '') {
  return {
    requestType,
    claimedAccountCount: '1',
    verificationClaims: [{ gameUid: '', nickName: '' }],
    note: ''
  };
}

export default function AuthModal({ isOpen, onClose, onAuthSuccess, addDurableNotification }) {
  const { isEnglish, locale } = useI18n();
  const {
    agreedToTerms,
    confirmPassword,
    email,
    emailDomainError,
    emailValid,
    error,
    hasEmailError,
    loading,
    message,
    mode,
    password,
    resendCooldown,
    showDuplicateEmailPrompt,
    username,
    setAgreedToTerms,
    setConfirmPassword,
    setError,
    setLoading,
    setMessage,
    setPassword,
    setResendCooldown,
    setShowDuplicateEmailPrompt,
    setUsername,
    handleEmailChange,
    switchMode,
    switchToForgotPassword,
    switchToLoginWithEmail,
  } = useAuthModalState();
  const tt = React.useCallback((zh, en) => (isEnglish ? en : zh), [isEnglish]);
  const [forgotPasswordStatus, setForgotPasswordStatus] = React.useState(null);
  const [recoveryRequestForm, setRecoveryRequestForm] = React.useState(() => createEmptyRecoveryForm());
  const [recoveryRequestLoading, setRecoveryRequestLoading] = React.useState(false);
  const [recoveryRequestError, setRecoveryRequestError] = React.useState('');
  const [recoveryRequestSuccess, setRecoveryRequestSuccess] = React.useState(null);
  const [captchaState, setCaptchaState] = React.useState(null);
  const [captchaResetKey, setCaptchaResetKey] = React.useState(0);
  const [emailLoginCaptchaVisible, setEmailLoginCaptchaVisible] = React.useState(false);
  const [emailCodeState, setEmailCodeState] = React.useState({
    action: '',
    email: '',
    code: '',
    loading: false,
  });
  const [emailSendAttempts, setEmailSendAttempts] = React.useState({
    email_login: 0,
    password_reset: 0,
  });
  const oauthProviders = React.useMemo(() => getEnabledOAuthProviders(), []);
  const captchaAction = React.useMemo(() => {
    if (mode === 'login' && emailLoginCaptchaVisible) return 'password_reset';
    if (mode === 'register') return 'register';
    if (mode === 'forgotPassword' && forgotPasswordStatus === 'checked' && recoveryRequestForm.requestType) return 'account_recovery';
    if (mode === 'forgotPassword' && forgotPasswordStatus !== 'checked') return 'password_reset';
    return null;
  }, [emailLoginCaptchaVisible, forgotPasswordStatus, mode, recoveryRequestForm.requestType]);
  const captchaReady = !captchaAction || (
    captchaState?.action === captchaAction
    && (!captchaState.required || Boolean(captchaState.token || captchaState.powPayload))
  );
  const buildVisibleCaptchaPayload = React.useCallback(async (action) => {
    const completedPayload = buildCompletedAuthCaptchaPayload(action, captchaState);
    if (Object.keys(completedPayload).length > 0) {
      return completedPayload;
    }

    return buildAuthCaptchaPayload(action);
  }, [captchaState]);

  const bootstrapSiteSessionAfterAuth = React.useCallback(async (session) => {
    const accessToken = session?.access_token || session?.accessToken || '';
    if (!accessToken) {
      return;
    }

    await bootstrapSiteSessionFromSupabaseToken(accessToken).catch(() => null);
  }, []);

  const handleOAuthLogin = React.useCallback(async (provider) => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await startOAuthLogin(provider, {
        returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        intent: 'login',
      });
      setLoading(false);
    } catch {
      setError(tt('该第三方登录方式暂不可用。', 'This third-party sign-in provider is not available yet.'));
      setLoading(false);
    }
  }, [setError, setLoading, setMessage, tt]);

  const resetRecoveryRequestState = React.useCallback(() => {
    setRecoveryRequestForm(createEmptyRecoveryForm());
    setRecoveryRequestLoading(false);
    setRecoveryRequestError('');
    setRecoveryRequestSuccess(null);
  }, []);

  React.useEffect(() => {
    setCaptchaState(null);
  }, [captchaAction]);

  React.useEffect(() => {
    if (mode !== 'forgotPassword') {
      setForgotPasswordStatus(null);
      resetRecoveryRequestState();
    }
    if (mode !== 'login') {
      setEmailLoginCaptchaVisible(false);
    }
    setEmailCodeState({ action: '', email: '', code: '', loading: false });
  }, [mode, resetRecoveryRequestState]);

  const incrementEmailSendAttempt = React.useCallback((action) => {
    const normalizedAction = String(action || '').trim();
    if (!normalizedAction) {
      return;
    }

    setEmailSendAttempts((prev) => ({
      ...prev,
      [normalizedAction]: (prev[normalizedAction] || 0) + 1,
    }));
  }, []);

  const resetEmailSendAttempts = React.useCallback(() => {
    setEmailSendAttempts({
      email_login: 0,
      password_reset: 0,
    });
  }, []);

  const getLocalizedAuthError = React.useCallback((err) => {
    const rawMessage = String(err?.message || err || '').trim();
    const lowerMessage = rawMessage.toLowerCase();

    if (!rawMessage) {
      return tt('操作失败，请稍后重试', 'Request failed. Please try again later.');
    }

    if (lowerMessage.includes('invalid login credentials') || lowerMessage.includes('invalid_credentials')) {
      return tt('邮箱或密码错误，请检查后重试。', 'Incorrect email or password. Check your credentials and try again.');
    }

    if (lowerMessage.includes('email not confirmed')) {
      return tt('邮箱尚未验证，请先完成邮箱验证。', 'Your email is not confirmed yet. Finish email verification first.');
    }

    if (lowerMessage.includes('captcha verification required') || lowerMessage.includes('captcha_required')) {
      return tt('请先完成人机验证。', 'Complete the bot check first.');
    }

    if (lowerMessage.includes('auth mail actions are disabled') || lowerMessage.includes('auth_mail_disabled')) {
      return tt('当前环境未启用认证邮件，请稍后再试或联系管理员。', 'Auth email is not enabled in this environment. Try again later or contact an administrator.');
    }

    if (lowerMessage.includes('mail_kill_switch_enabled') || lowerMessage.includes('auth mail actions are paused')) {
      return tt('邮件发送当前已暂停，请稍后再试。', 'Mail sending is paused right now. Try again later.');
    }

    if (lowerMessage.includes('email_confirmation_pending')) {
      return tt(
        '该邮箱已有一封待处理的验证邮件。请检查收件箱和垃圾邮件夹；如果仍收不到，请稍后重试或联系管理员。',
        'This email already has a pending confirmation message. Check inbox and spam; if it still does not arrive, try again later or contact an administrator.'
      );
    }

    if (lowerMessage.includes('already registered') || lowerMessage.includes('user already exists')) {
      return tt('该邮箱已被注册。', 'This email is already registered.');
    }

    if (lowerMessage.includes('sending confirmation') || lowerMessage.includes('confirmation email')) {
      return tt('邮件服务暂时不可用，请稍后再试。', 'Email delivery is unavailable right now. Please try again later.');
    }

    if (lowerMessage.includes('unable to validate email')) {
      return tt('无法验证邮箱地址，请检查后重试。', 'Unable to validate this email address. Check it and try again.');
    }

    if (isNetworkConnectivityError(err)) {
      return tt(
        '无法连接认证服务，可能是当前网络或服务节点异常。请稍后重试；若多次失败，请切换网络或浏览器后再试。',
        'Unable to reach the auth service. The current network path or service endpoint may be unstable. Try again later, or switch networks or browsers and retry.'
      );
    }

    if (lowerMessage.includes('auth admin not configured')) {
      return tt(
        '当前环境未启用安全的账号恢复流程，请联系管理员协助处理。',
        'Secure account recovery is not enabled in this environment. Contact an administrator.'
      );
    }

    return isEnglish ? rawMessage : getSimpleFriendlyError(err);
  }, [isEnglish, tt]);

  const getLocalizedUsernameError = React.useCallback((validationCode) => {
    switch (validationCode) {
      case 'required':
        return tt('请输入用户名', 'Enter a username.');
      case 'too_short':
        return tt('用户名至少需要 2 个字符', 'Username must be at least 2 characters.');
      case 'too_long':
        return tt('用户名长度不能超过 50 个字符', 'Username must be 50 characters or fewer.');
      case 'invalid_characters':
        return tt(
          '用户名只能包含中文、字母、数字、日文等文字、数字，以及 . _ - +',
          'Username can only contain letters, numbers, Chinese/Japanese characters, and . _ - +.'
        );
      default:
        return tt('用户名格式不正确', 'Invalid username format.');
    }
  }, [tt]);

  const getLocalizedPasswordPolicyError = React.useCallback((validation) => {
    const errors = Array.isArray(validation?.errors) ? validation.errors : [];

    if (errors.includes('required')) {
      return tt('请输入密码', 'Enter a password.');
    }

    if (errors.includes('too_short')) {
      return tt('密码至少需要 8 位字符', 'Password must be at least 8 characters.');
    }

    if (errors.includes('too_long')) {
      return tt('密码长度不能超过 100 位字符', 'Password must be 100 characters or fewer.');
    }

    if (errors.includes('too_simple')) {
      return tt(
        '密码需要至少包含两类字符，例如字母和数字。',
        'Password must include at least two character groups, such as letters and numbers.'
      );
    }

    return tt('密码不符合安全要求', 'Password does not meet the security requirements.');
  }, [tt]);

  if (!isOpen) return null;

  const checkRateLimit = async (action, extraPayload = {}) => {
    try {
      const { response, data: payload } = await fetchJsonWithTimeout('/api/auth-rate-limit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action,
          ...extraPayload,
        })
      }, {
        label: 'auth-rate-limit',
        timeoutMs: 15000,
        retries: 1,
      });

      if (!response.ok) {
        if (payload?.allowed === false) {
          return payload;
        }

        if (import.meta.env.DEV) {
          return { allowed: true };
        }

        return { allowed: false, retry_after: 60 };
      }

      return payload || { allowed: true };
    } catch {
      if (import.meta.env.DEV) {
        return { allowed: true };
      }

      return { allowed: false, retry_after: 60 };
    }
  };

  const sendAuthEmailAction = async ({
    action,
    requestEmail = email,
    requestPassword,
    requestUsername,
    captchaPayload = {},
  }) => {
    const { response, data: payload } = await fetchJsonWithTimeout('/api/auth-email-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action,
        email: requestEmail,
        password: requestPassword,
        username: requestUsername,
        locale,
        ...captchaPayload,
      })
    }, {
      label: `auth-email-action:${action}`,
      timeoutMs: 30000,
      retries: 1,
    });

    if (!response.ok || payload?.success !== true) {
      if (response.status === 429 && payload?.retry_after) {
        throw new Error(tt(
          `查询过于频繁，请 ${Math.ceil(payload.retry_after / 60)} 分钟后再试`,
          `Too many checks. Try again in ${Math.ceil(payload.retry_after / 60)} minute(s).`
        ));
      }

      const error = new Error(payload?.error || tt('认证邮件请求失败，请稍后重试', 'Auth email request failed. Try again later.'));
      error.code = payload?.code || payload?.error || 'auth_email_action_failed';
      error.status = response.status;
      throw error;
    }

    return payload.data || {};
  };

  const createRecoveryRequest = async (payload) => {
    const { response, data: result } = await fetchJsonWithTimeout('/api/account-recovery-request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }, {
      label: 'account-recovery-request',
      timeoutMs: 25000,
      retries: 1,
    });

    if (!response.ok || result?.success !== true) {
      if (response.status === 409 || response.status === 404) {
        return { status: 'received' };
      }

      if (response.status === 429 && result?.retry_after) {
        throw new Error(tt(
          `提交过于频繁，请 ${Math.ceil(result.retry_after / 60)} 分钟后再试`,
          `Too many submissions. Try again in ${Math.ceil(result.retry_after / 60)} minute(s).`
        ));
      }

      throw new Error(result?.error || tt('提交账号恢复申请失败，请稍后重试', 'Failed to submit the recovery request. Try again later.'));
    }

    return result.data;
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const captchaPayload = await buildAuthCaptchaPayload('login');
      const rateLimitResult = await checkRateLimit('login', { email, ...captchaPayload });
      if (!rateLimitResult.allowed) {
        const retryAfter = rateLimitResult.retry_after ? Math.ceil(rateLimitResult.retry_after / 60) : 30;
        setError(tt(
          `登录尝试过于频繁，请 ${retryAfter} 分钟后再试`,
          `Too many sign-in attempts. Try again in ${retryAfter} minute(s).`
        ));
        setLoading(false);
        return;
      }

      const { data, error: authError } = await withAuthRequestTimeout(supabase.auth.signInWithPassword({
        email,
        password,
      }));

      if (authError) throw authError;

      await bootstrapSiteSessionAfterAuth(data?.session);
      onAuthSuccess(data.user);
      onClose();
    } catch (err) {
      setError(getLocalizedAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const signInAfterRegister = async () => {
    const { data, error: authError } = await withAuthRequestTimeout(supabase.auth.signInWithPassword({
      email,
      password,
    }));

    if (authError) {
      throw authError;
    }

    await bootstrapSiteSessionAfterAuth(data?.session);
    addDurableNotification?.({
      type: 'warning',
      category: 'account',
      priority: 'normal',
      title: tt('邮箱尚未验证', 'Email not verified'),
      message: tt(
        '账号已创建并登录。请稍后到设置页验证邮箱，否则密码找回、换邮箱和安全通知可能无法正常使用。',
        'Your account was created and signed in. Verify the email in Settings so password recovery, email changes, and security notices keep working.'
      ),
      dedupeKey: `email-verification:${email}`,
      actions: [
        { label: tt('打开设置', 'Open Settings'), href: '/settings', variant: 'primary' },
      ],
    });
    onAuthSuccess(data.user);
    onClose();
  };

  const handleForgotPassword = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    setForgotPasswordStatus(null);
    resetRecoveryRequestState();

    if (!EMAIL_REGEX.test(email)) {
      setError(tt('请输入有效的邮箱地址', 'Enter a valid email address.'));
      setLoading(false);
      return;
    }

    try {
      if (captchaAction === 'password_reset' && !captchaReady) {
        setError(tt('请先完成人机验证', 'Complete the bot check first.'));
        setLoading(false);
        return;
      }

      const captchaPayload = await buildVisibleCaptchaPayload('password_reset');
      const result = await sendAuthEmailAction({
        action: 'password_reset',
        captchaPayload,
      });
      incrementEmailSendAttempt('password_reset');
      setForgotPasswordStatus('checked');
      setResendCooldown(60);
      setEmailCodeState({
        action: 'password_reset',
        email,
        code: '',
        loading: false,
      });
      if (['mail_unavailable', 'mail_paused', 'mail_failed_or_unavailable'].includes(result?.status)) {
        setMessage(tt(
          '自助重置邮件暂不可用。你可以稍后重试；如果多次收不到邮件，请提交人工恢复申请。',
          'Self-service reset mail is unavailable right now. Try again later; if mail still does not arrive, submit a manual recovery request.'
        ));
      } else {
        setMessage(tt(
          '如果该邮箱存在可恢复账号，密码重置邮件已发送。请检查收件箱和垃圾邮件夹。',
          'If this email matches a recoverable account, a password reset email has been sent. Check your inbox and spam folder.'
        ));
      }
    } catch (err) {
      setError(getLocalizedAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (!EMAIL_REGEX.test(email)) {
      setError(tt('请输入有效的邮箱地址', 'Enter a valid email address.'));
      setLoading(false);
      return;
    }

    const passwordValidation = validateAccountPassword(password);
    if (!passwordValidation.isValid) {
      setError(getLocalizedPasswordPolicyError(passwordValidation));
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError(tt('两次输入的密码不一致', 'The passwords do not match.'));
      setLoading(false);
      return;
    }

    if (!agreedToTerms) {
      setError(tt('请阅读并同意隐私政策和用户协议', 'Read and accept the Privacy Policy and Terms first.'));
      setLoading(false);
      return;
    }

    const normalizedUsername = normalizeUsername(username);
    const usernameValidationCode = normalizedUsername
      ? getUsernameValidationCode(normalizedUsername)
      : null;
    if (usernameValidationCode) {
      setError(getLocalizedUsernameError(usernameValidationCode));
      setLoading(false);
      return;
    }

    try {
      if (captchaAction === 'register' && !captchaReady) {
        setError(tt('请先完成人机验证', 'Complete the bot check first.'));
        setLoading(false);
        return;
      }

      const captchaPayload = await buildVisibleCaptchaPayload('register');
      await sendAuthEmailAction({
        action: 'register_confirmation',
        requestPassword: password,
        requestUsername: normalizedUsername || email.split('@')[0],
        captchaPayload,
      });
      await signInAfterRegister();
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      let errorMessage = tt('注册失败，请重试', 'Sign-up failed. Please try again.');
      const errorText = String(err?.message || '').toLowerCase();

      if (err?.code === 'email_confirmation_pending') {
        setError(getLocalizedAuthError(err));
        setShowDuplicateEmailPrompt(false);
        return;
      }

      if (err?.code === 'captcha_required' || errorText.includes('captcha verification required')) {
        setCaptchaState(null);
        setCaptchaResetKey((current) => current + 1);
        setError(tt(
          '安全验证已失效，请重新完成验证后再创建账号。',
          'The security check expired. Complete it again before creating the account.'
        ));
        setShowDuplicateEmailPrompt(false);
        return;
      }

      if (
        err?.code === 'email_already_registered' ||
        errorText.includes('already registered') ||
        errorText.includes('user already registered') ||
        errorText.includes('email already exists')
      ) {
        setError(tt('该邮箱已被注册', 'This email is already registered.'));
        setShowDuplicateEmailPrompt(true);
        return;
      }

      if (String(err?.message || '').includes('Invalid email')) {
        errorMessage = tt('邮箱格式不正确', 'The email format is invalid.');
      } else if (String(err?.message || '').includes('Password should be at least')) {
        errorMessage = tt('密码长度不足，至少需要 6 位字符', 'Password is too short. Use at least 6 characters.');
      } else if (String(err?.message || '').includes('Unable to validate email')) {
        errorMessage = tt('无法验证邮箱地址，请检查邮箱是否正确', 'Unable to validate this email address. Check it and try again.');
      } else if (
        errorText.includes('sending confirmation') ||
        errorText.includes('confirmation email')
      ) {
        errorMessage = tt('邮件服务暂时不可用，请稍后再试或联系管理员', 'Email delivery is unavailable. Try again later or contact an administrator.');
      } else if (isNetworkConnectivityError(err) || err?.code === 'CLIENT_TIMEOUT' || err?.name === 'TimeoutError') {
        errorMessage = getLocalizedAuthError(err);
      } else if (err?.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    if (!EMAIL_REGEX.test(email)) {
      setError(tt('请输入有效的邮箱地址', 'Enter a valid email address.'));
      setLoading(false);
      return;
    }

    try {
      if (emailLoginCaptchaVisible && !captchaReady) {
        setError(tt('请先完成人机验证', 'Complete the bot check first.'));
        setLoading(false);
        return;
      }

      const captchaPayload = emailLoginCaptchaVisible
        ? await buildVisibleCaptchaPayload('password_reset')
        : await buildAuthCaptchaPayload('password_reset');
      const result = await sendAuthEmailAction({
        action: 'email_login',
        captchaPayload,
      });
      incrementEmailSendAttempt('email_login');
      if (['mail_unavailable', 'mail_paused', 'mail_failed_or_unavailable'].includes(result?.status)) {
        setError(tt(
          '邮件登录暂不可用，请使用密码登录或稍后再试。',
          'Email sign-in is unavailable right now. Use password sign-in or try again later.'
        ));
        return;
      }

      setEmailLoginCaptchaVisible(false);
      setCaptchaState(null);
      setResendCooldown(60);
      setEmailCodeState({
        action: 'email_login',
        email,
        code: '',
        loading: false,
      });
      setMessage(tt(
        '如果该邮箱存在账号，登录验证码已发送。请复制邮件中的 6 位验证码，在这里完成登录。',
        'If this email has an account, a sign-in code has been sent. Copy the 6-digit code here to finish signing in.'
      ));
    } catch (err) {
      if (err?.code === 'captcha_required' || err?.status === 403) {
        setEmailLoginCaptchaVisible(true);
        setError(tt('请先完成下方人机验证，然后再次发送邮件登录验证码。', 'Complete the bot check below, then send the email sign-in code again.'));
      } else {
        setError(getLocalizedAuthError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSkipEmailLoginCode = () => {
    setEmailCodeState({ action: '', email: '', code: '', loading: false });
    setResendCooldown(0);
    setError('');
    setMessage(tt(
      '已切回密码登录。邮件登录可以之后再试；注册或登录后仍可在设置页验证邮箱。',
      'Password sign-in is available again. You can retry email sign-in later, and verify email from Settings after signing in.'
    ));
  };

  const handleSkipPasswordResetEmail = () => {
    setResendCooldown(0);
    setError('');
    openRecoveryRequestForm('password_reset');
  };

  const handleEmailCodeSubmit = async () => {
    const code = String(emailCodeState.code || '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6 || !EMAIL_REGEX.test(emailCodeState.email || email)) {
      setError(tt('请输入邮件中的 6 位验证码。', 'Enter the 6-digit code from the email.'));
      return;
    }

    if (!supabase) {
      setError(tt('当前环境未启用认证服务。', 'Auth service is unavailable in this environment.'));
      return;
    }

    setEmailCodeState((prev) => ({ ...prev, loading: true }));
    setError('');
    try {
      const verifyType = emailCodeState.action === 'password_reset' ? 'recovery' : 'magiclink';
      const { data, error: verifyError } = await withAuthRequestTimeout(supabase.auth.verifyOtp({
        email: emailCodeState.email || email,
        token: code,
        type: verifyType,
      }));

      if (verifyError) {
        throw verifyError;
      }

      if (emailCodeState.action === 'password_reset') {
        await bootstrapSiteSessionAfterAuth(data?.session);
        window.location.assign('/reset-password?from=code');
        return;
      }

      await bootstrapSiteSessionAfterAuth(data?.session);
      onAuthSuccess(data?.user || data?.session?.user);
      onClose();
    } catch {
      setError(tt(
        '验证码无效或已过期，请重新发送邮件后再试。',
        'The code is invalid or expired. Send a new email and try again.'
      ));
    } finally {
      setEmailCodeState((prev) => ({ ...prev, loading: false }));
    }
  };

  const openRecoveryRequestForm = (requestType) => {
    setRecoveryRequestForm((prev) => ({
      ...createEmptyRecoveryForm(requestType),
      claimedAccountCount: prev.claimedAccountCount || '1',
      verificationClaims: prev.verificationClaims?.length
        ? prev.verificationClaims
        : [{ gameUid: '', nickName: '' }],
      note: prev.note || ''
    }));
    setRecoveryRequestError('');
    setRecoveryRequestSuccess(null);
  };

  const closeRecoveryRequestForm = () => {
    resetRecoveryRequestState();
  };

  const handleRecoveryClaimChange = (index, field, value) => {
    setRecoveryRequestForm((prev) => ({
      ...prev,
      verificationClaims: prev.verificationClaims.map((claim, claimIndex) => (
        claimIndex === index
          ? { ...claim, [field]: value }
          : claim
      ))
    }));
  };

  const handleAddRecoveryClaim = () => {
    setRecoveryRequestForm((prev) => ({
      ...prev,
      verificationClaims: prev.verificationClaims.length >= 5
        ? prev.verificationClaims
        : [...prev.verificationClaims, { gameUid: '', nickName: '' }]
    }));
  };

  const handleRemoveRecoveryClaim = (index) => {
    setRecoveryRequestForm((prev) => ({
      ...prev,
      verificationClaims: prev.verificationClaims.length <= 1
        ? prev.verificationClaims
        : prev.verificationClaims.filter((_, claimIndex) => claimIndex !== index)
    }));
  };

  const handleSubmitRecoveryRequest = async () => {
    setRecoveryRequestLoading(true);
    setRecoveryRequestError('');
    setRecoveryRequestSuccess(null);

    if (!EMAIL_REGEX.test(email)) {
      setRecoveryRequestError(tt('请输入有效的邮箱地址', 'Enter a valid email address.'));
      setRecoveryRequestLoading(false);
      return;
    }

    if (!recoveryRequestForm.requestType) {
      setRecoveryRequestError(tt('请选择恢复申请类型', 'Select a recovery request type.'));
      setRecoveryRequestLoading(false);
      return;
    }

    const normalizedClaims = recoveryRequestForm.verificationClaims
      .map((claim) => ({
        gameUid: String(claim.gameUid || '').trim(),
        nickName: String(claim.nickName || '').trim()
      }))
      .filter((claim) => claim.gameUid || claim.nickName);

    if (normalizedClaims.length === 0) {
      setRecoveryRequestError(tt('请至少填写一组 UID 和昵称作为身份核验信息', 'Add at least one UID and nickname pair for verification.'));
      setRecoveryRequestLoading(false);
      return;
    }

    const hasIncompleteClaim = normalizedClaims.some((claim) => !claim.gameUid || !claim.nickName);
    if (hasIncompleteClaim) {
      setRecoveryRequestError(tt('每组核验信息都需要同时填写 UID 和昵称', 'Each verification clue needs both UID and nickname.'));
      setRecoveryRequestLoading(false);
      return;
    }

    try {
      if (captchaAction === 'account_recovery' && !captchaReady) {
        setRecoveryRequestError(tt('请先完成人机验证', 'Complete the bot check first.'));
        setRecoveryRequestLoading(false);
        return;
      }

      const captchaPayload = await buildVisibleCaptchaPayload('account_recovery');
      const result = await createRecoveryRequest({
        email,
        requestType: recoveryRequestForm.requestType,
        claimedAccountCount: recoveryRequestForm.claimedAccountCount,
        verificationClaims: normalizedClaims,
        note: recoveryRequestForm.note,
        ...captchaPayload
      });

      setRecoveryRequestSuccess({
        id: result?.id || null,
        requestType: recoveryRequestForm.requestType
      });
      addDurableNotification?.(buildAccountRecoveryNotification({
        ...result,
        requestType: recoveryRequestForm.requestType,
      }, {
        locale,
        requestType: recoveryRequestForm.requestType,
      }));
      setRecoveryRequestError('');
    } catch (err) {
      setRecoveryRequestError(getLocalizedAuthError(err));
    } finally {
      setRecoveryRequestLoading(false);
    }
  };

  const handleSubmit =
    mode === 'login' ? handleLogin : mode === 'register' ? handleRegister : handleForgotPassword;

  const submitDisabled =
    loading ||
    (mode !== 'login' && Boolean(captchaAction) && !captchaReady) ||
    (mode === 'register' && (hasEmailError || Boolean(emailDomainError) || !agreedToTerms)) ||
    (mode === 'forgotPassword' && resendCooldown > 0);
  const emailLoginDisabled =
    loading ||
    !EMAIL_REGEX.test(email) ||
    resendCooldown > 0 ||
    (emailLoginCaptchaVisible && !captchaReady);

  return (
    <AuthModalView
      agreedToTerms={agreedToTerms}
      confirmPassword={confirmPassword}
      email={email}
      emailDomainError={emailDomainError}
      emailValid={emailValid}
      error={error}
      forgotPasswordStatus={forgotPasswordStatus}
      hasEmailError={hasEmailError}
      captchaAction={captchaAction}
      captchaReady={captchaReady}
      captchaResetKey={captchaResetKey}
      loading={loading}
      message={message}
      mode={mode}
      onAgreedToTermsChange={(event) => setAgreedToTerms(event.target.checked)}
      onClose={onClose}
      onCaptchaStateChange={setCaptchaState}
      onConfirmPasswordChange={(event) => setConfirmPassword(event.target.value)}
      onPasswordChange={(event) => setPassword(event.target.value)}
      onSubmit={handleSubmit}
      onEmailLogin={handleEmailLogin}
      emailCodeAction={emailCodeState.action}
      emailCodeValue={emailCodeState.code}
      emailCodeLoading={emailCodeState.loading}
      onEmailCodeChange={(event) => {
        const code = String(event.target.value || '').replace(/\D/g, '').slice(0, 6);
        setEmailCodeState((prev) => ({ ...prev, code }));
      }}
      onEmailCodeSubmit={handleEmailCodeSubmit}
      oauthProviders={oauthProviders}
      onOAuthLogin={handleOAuthLogin}
      recoverySubmitDisabled={recoveryRequestLoading || (captchaAction === 'account_recovery' && !captchaReady)}
      onSwitchMode={switchMode}
      onSwitchToForgotPassword={switchToForgotPassword}
      onSwitchToLoginWithEmail={switchToLoginWithEmail}
      onUsernameChange={(event) => setUsername(event.target.value)}
      password={password}
      resendCooldown={resendCooldown}
      recoveryRequestError={recoveryRequestError}
      recoveryRequestForm={recoveryRequestForm}
      recoveryRequestLoading={recoveryRequestLoading}
      recoveryRequestSuccess={recoveryRequestSuccess}
      showDuplicateEmailPrompt={showDuplicateEmailPrompt}
      submitDisabled={submitDisabled}
      emailLoginDisabled={emailLoginDisabled}
      username={username}
      onAddRecoveryClaim={handleAddRecoveryClaim}
      onCloseRecoveryRequest={closeRecoveryRequestForm}
      onEmailChange={(event) => {
        if (mode === 'forgotPassword') {
          setForgotPasswordStatus(null);
          setMessage('');
          setError('');
          setEmailCodeState({ action: '', email: '', code: '', loading: false });
          resetEmailSendAttempts();
          resetRecoveryRequestState();
        }
        if (mode === 'login') {
          setEmailLoginCaptchaVisible(false);
          setCaptchaState(null);
          setEmailCodeState({ action: '', email: '', code: '', loading: false });
          resetEmailSendAttempts();
        }
        handleEmailChange(event);
      }}
      emailLoginSendCount={emailSendAttempts.email_login || 0}
      passwordResetSendCount={emailSendAttempts.password_reset || 0}
      onSkipEmailLoginCode={handleSkipEmailLoginCode}
      onSkipPasswordResetEmail={handleSkipPasswordResetEmail}
      onOpenRecoveryRequest={openRecoveryRequestForm}
      onRecoveryClaimChange={handleRecoveryClaimChange}
      onRecoveryClaimedAccountCountChange={(event) => {
        setRecoveryRequestForm((prev) => ({
          ...prev,
          claimedAccountCount: event.target.value
        }));
      }}
      onRecoveryNoteChange={(event) => {
        setRecoveryRequestForm((prev) => ({
          ...prev,
          note: event.target.value
        }));
      }}
      onRemoveRecoveryClaim={handleRemoveRecoveryClaim}
      onSubmitRecoveryRequest={handleSubmitRecoveryRequest}
    />
  );
}
