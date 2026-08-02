import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import {
  bootstrapSiteSessionFromSupabaseToken,
} from '../../services/siteSessionService.js';
import { useI18n } from '../../i18n/index.js';
import {
  getPrimaryAccountPasswordError,
  validateAccountPassword,
} from '../../utils/authSecurity.js';

function normalizeFriendlyError(error, fallback) {
  return error?.message || fallback;
}

function getLocalizedPasswordPolicyError(errorCode, tt) {
  switch (errorCode) {
    case 'required':
    case 'too_short':
      return tt('密码至少需要 8 位字符。', 'Password must be at least 8 characters.');
    case 'too_long':
      return tt('密码长度不能超过 100 位字符。', 'Password must be 100 characters or fewer.');
    case 'too_simple':
      return tt(
        '密码需要至少包含两类字符，例如字母和数字。',
        'Password must include at least two character groups, such as letters and numbers.'
      );
    default:
      return tt('密码不符合安全要求。', 'Password does not meet the security requirements.');
  }
}

export default function ResetPasswordPage() {
  const { isEnglish } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recoveryReady, setRecoveryReady] = useState(false);
  const tt = useCallback((zh, en) => (isEnglish ? en : zh), [isEnglish]);
  const enteredFromCode = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return new URLSearchParams(window.location.search).get('from') === 'code';
  }, []);

  const passwordMismatch = useMemo(() => (
    confirmPassword.length > 0 && password !== confirmPassword
  ), [confirmPassword, password]);

  useEffect(() => {
    let active = true;

    async function checkRecoverySession() {
      if (!supabase) {
        if (active) {
          setError(tt('当前环境未启用认证服务，无法重置密码。', 'Auth service is unavailable in this environment, so password reset cannot continue.'));
          setCheckingSession(false);
        }
        return;
      }

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const recoveryType = hash.get('type');

      try {
        const {
          data: { session }
        } = await supabase.auth.getSession();

        if (!active) {
          return;
        }

        if (session?.user || recoveryType === 'recovery') {
          setRecoveryReady(true);
          setError('');
        } else if (enteredFromCode) {
          setRecoveryReady(false);
          setError(tt('验证码已提交，但当前浏览器没有拿到重置会话。请重新发送密码重置验证码后再试。', 'The code was submitted, but this browser did not receive a recovery session. Request a new password reset code and try again.'));
        } else {
          setRecoveryReady(false);
          setError(tt('重置链接无效、已过期，或当前未进入密码重置流程。', 'This reset link is invalid, expired, or the recovery flow was not started.'));
        }
      } catch (sessionError) {
        if (!active) {
          return;
        }

        setRecoveryReady(false);
        setError(normalizeFriendlyError(sessionError, tt('无法验证重置链接，请重新申请密码重置邮件。', 'Unable to verify the reset link. Request a new password reset email and try again.')));
      } finally {
        if (active) {
          setCheckingSession(false);
        }
      }
    }

    checkRecoverySession();

    return () => {
      active = false;
    };
  }, [enteredFromCode, tt]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setError(tt('当前环境未启用认证服务，无法重置密码。', 'Auth service is unavailable in this environment, so password reset cannot continue.'));
      return;
    }

    const passwordValidation = validateAccountPassword(password);
    if (!passwordValidation.isValid) {
      setError(getLocalizedPasswordPolicyError(getPrimaryAccountPasswordError(passwordValidation), tt));
      return;
    }

    if (password !== confirmPassword) {
      setError(tt('两次输入的密码不一致。', 'The passwords do not match.'));
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const {
        data: { session: recoverySession } = {},
      } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const recoveryEmail = String(recoverySession?.user?.email || '').trim();
      if (!recoveryEmail) {
        throw new Error(tt(
          '无法确认当前账号邮箱，请重新打开密码重置邮件中的链接。',
          'The account email could not be confirmed. Reopen the link from the password reset email.'
        ));
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password
      });

      if (updateError) {
        throw updateError;
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: recoveryEmail,
        password,
      });
      if (signInError) {
        throw signInError;
      }
      const freshAccessToken = signInData?.session?.access_token || '';
      const bootstrapResult = freshAccessToken
        ? await bootstrapSiteSessionFromSupabaseToken(freshAccessToken)
        : { authenticated: false };
      if (!bootstrapResult.authenticated) {
        throw new Error(tt(
          '密码已更新，旧登录状态已撤销，但当前浏览器未能建立新的登录状态。请重新登录。',
          'Password changed and old sign-ins were revoked, but this browser could not create a new sign-in. Sign in again.'
        ));
      }

      setSuccess(tt('密码已更新。3 秒后将返回首页，您也可以立即手动跳转。', 'Password updated. You will return to the home page in 3 seconds, or you can jump back immediately.'));
      window.setTimeout(() => {
        navigate('/', { replace: true });
      }, 3000);
    } catch (updateError) {
      setError(normalizeFriendlyError(updateError, tt('密码更新失败，请重新打开重置邮件中的链接。', 'Failed to update the password. Reopen the link from the reset email and try again.')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.18),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] dark:bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.12),transparent_28%),linear-gradient(180deg,#09090b_0%,#18181b_100%)] px-4 py-10">
      <div className="mx-auto max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 shadow-2xl backdrop-blur">
        <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-950 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center border border-endfield-yellow/60 bg-endfield-yellow/10 text-endfield-yellow">
              <KeyRound size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide">{tt('重置密码', 'Reset Password')}</h1>
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-400">{tt('密码找回', 'Password Recovery')}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 py-6">
          {checkingSession ? (
            <div className="flex items-center gap-3 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-4 text-sm text-zinc-600 dark:text-zinc-300">
              <Loader2 size={16} className="animate-spin" />
              {tt('正在验证重置链接...', 'Verifying the reset link...')}
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-start gap-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="flex items-start gap-3 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                  <span>{success}</span>
                </div>
              )}

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {tt('新密码', 'New Password')}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={tt('至少 8 位字符，包含两类字符', 'At least 8 characters with two character groups')}
                    disabled={!recoveryReady || submitting}
                    className="w-full border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-endfield-yellow dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    {tt('确认新密码', 'Confirm New Password')}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder={tt('再次输入新密码', 'Enter the new password again')}
                    disabled={!recoveryReady || submitting}
                    className="w-full border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-endfield-yellow dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                  {passwordMismatch && (
                    <p className="text-xs text-red-600 dark:text-red-400">{tt('两次输入的密码不一致。', 'The passwords do not match.')}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!recoveryReady || submitting || passwordMismatch}
                  className="w-full bg-endfield-yellow px-4 py-3 text-sm font-bold uppercase tracking-[0.18em] text-black transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
                >
                  {submitting ? tt('提交中...', 'Submitting...') : tt('更新密码', 'Update Password')}
                </button>
              </form>

              <div className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                {enteredFromCode
                  ? tt('验证码失效时，请返回登录弹窗重新发送密码重置邮件。', 'If the code expires, return to the login modal and request a new password reset email.')
                  : tt('链接失效时，请返回登录弹窗重新发送密码重置邮件。', 'If the link expires, return to the login modal and request a new password reset email.')}
              </div>

              <Link
                to="/"
                className="inline-flex text-xs font-bold uppercase tracking-[0.18em] text-zinc-600 transition hover:text-endfield-yellow dark:text-zinc-300"
              >
                {tt('返回首页', 'Back to Home')}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
