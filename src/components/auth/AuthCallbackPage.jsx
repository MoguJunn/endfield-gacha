import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, LogIn } from 'lucide-react';
import { supabase } from '../../supabaseClient.js';
import { normalizeOAuthReturnTo } from '../../services/authOAuthService.js';
import useAuthStore from '../../stores/useAuthStore.js';
import { useI18n } from '../../i18n/index.js';
import {
  buildBridgeCallbackForwardUrl,
  getBridgeProviderFromState,
} from './authCallbackBridge.js';
import { isContributorDemoModeEnabled } from '../../dev/contributorDemoMode.js';

function cleanCallbackUrl(next) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('next', next);
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}`);
}

function getCallbackParams() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  return {
    next: searchParams.get('next') || hashParams.get('next') || '/',
    error: searchParams.get('error') || hashParams.get('error') || '',
    errorDescription: searchParams.get('error_description') || hashParams.get('error_description') || '',
    code: searchParams.get('code') || hashParams.get('code') || '',
    state: searchParams.get('state') || hashParams.get('state') || '',
  };
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { isEnglish } = useI18n();
  const setUser = useAuthStore((state) => state.setUser);
  const openAuthModal = useAuthStore((state) => state.openAuthModal);
  const tt = React.useCallback((zh, en) => (isEnglish ? en : zh), [isEnglish]);
  const processedRef = React.useRef(false);
  const [status, setStatus] = React.useState({
    type: 'loading',
    message: tt('正在完成登录授权...', 'Finishing sign-in authorization...'),
    next: '/',
  });

  React.useEffect(() => {
    if (processedRef.current) {
      return undefined;
    }
    processedRef.current = true;

    let cancelled = false;
    let redirectTimer = null;

    if (isContributorDemoModeEnabled()) {
      setStatus({
        type: 'error',
        next: '/',
        message: tt('本地内容沙盒不处理真实登录回调。', 'Real sign-in callbacks are disabled in the local content sandbox.'),
      });
      redirectTimer = window.setTimeout(() => navigate('/', { replace: true }), 300);
      return () => {
        cancelled = true;
        window.clearTimeout(redirectTimer);
      };
    }

    function finishSuccess(next) {
      if (cancelled) {
        return;
      }
      cleanCallbackUrl(next);
      setStatus({
        type: 'success',
        next,
        message: tt('登录已完成，正在返回原页面。', 'Sign-in is complete. Returning to the previous page.'),
      });
      redirectTimer = window.setTimeout(() => {
        navigate(next, { replace: true });
      }, 900);
    }

    async function loadCurrentUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        return session.user;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        throw userError;
      }
      return userData?.user || null;
    }

    async function finishCallback() {
      const callbackParams = getCallbackParams();
      const next = normalizeOAuthReturnTo(callbackParams.next);
      const providerError = callbackParams.error;
      const providerErrorDescription = callbackParams.errorDescription;
      const code = callbackParams.code;
      const bridgeProvider = getBridgeProviderFromState(callbackParams.state);

      if (bridgeProvider) {
        window.location.replace(buildBridgeCallbackForwardUrl({
          provider: bridgeProvider,
          code,
          state: callbackParams.state,
          error: providerError,
          errorDescription: providerErrorDescription,
        }));
        return;
      }

      if (providerError) {
        cleanCallbackUrl(next);
        if (!cancelled) {
          setStatus({
            type: 'error',
            next,
            message: providerErrorDescription || providerError,
          });
        }
        return;
      }

      if (!supabase) {
        cleanCallbackUrl(next);
        if (!cancelled) {
          setStatus({
            type: 'error',
            next,
            message: tt('当前环境未配置认证服务。', 'Auth service is not configured in this environment.'),
          });
        }
        return;
      }

      if (!code) {
        try {
          const existingUser = await loadCurrentUser();
          if (existingUser) {
            setUser(existingUser);
            finishSuccess(next);
            return;
          }
        } catch {
          // Fall through to the explicit missing-code error below.
        }

        cleanCallbackUrl(next);
        if (!cancelled) {
          setStatus({
            type: 'error',
            next,
            message: tt('回调地址缺少授权码，请重新登录。', 'The callback is missing an authorization code. Sign in again.'),
          });
        }
        return;
      }

      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          throw error;
        }

        const nextUser = data?.session?.user || data?.user || await loadCurrentUser();

        if (nextUser) {
          setUser(nextUser);
        }

        finishSuccess(next);
      } catch (callbackError) {
        try {
          const existingUser = await loadCurrentUser();
          if (existingUser) {
            setUser(existingUser);
            finishSuccess(next);
            return;
          }
        } catch {
          // Keep the original callback error as the user-facing reason.
        }

        cleanCallbackUrl(next);
        if (!cancelled) {
          setStatus({
            type: 'error',
            next,
            message: callbackError?.message || tt('登录授权失败，请重新尝试。', 'Authorization failed. Try again.'),
          });
        }
      }
    }

    finishCallback();

    return () => {
      cancelled = true;
      if (redirectTimer) {
        window.clearTimeout(redirectTimer);
      }
    };
  }, [navigate, setUser, tt]);

  const isSuccess = status.type === 'success';
  const isError = status.type === 'error';

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center border ${
            isSuccess
              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-500'
              : isError
                ? 'border-red-400/40 bg-red-500/10 text-red-500'
                : 'border-endfield-yellow/40 bg-endfield-yellow/10 text-endfield-yellow'
          }`}>
            {isSuccess ? <CheckCircle2 size={22} /> : isError ? <AlertTriangle size={22} /> : <Loader2 size={22} className="animate-spin" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-black uppercase tracking-widest text-slate-900 dark:text-zinc-100">
              {isSuccess
                ? tt('登录成功', 'Sign-In Complete')
                : isError
                  ? tt('登录未完成', 'Sign-In Failed')
                  : tt('正在处理', 'Processing')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {status.message}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => navigate(status.next || '/', { replace: true })}
            className="min-h-[42px] flex-1 border border-endfield-yellow/50 bg-endfield-yellow px-4 py-2 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-yellow-300"
          >
            {tt('返回原页面', 'Return')}
          </button>
          {isError ? (
            <button
              type="button"
              onClick={() => {
                openAuthModal();
                navigate('/', { replace: true });
              }}
              className="min-h-[42px] flex-1 border border-zinc-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <LogIn size={14} />
                {tt('重新登录', 'Sign In Again')}
              </span>
            </button>
          ) : null}
        </div>

        {isError ? (
          <p className="mt-4 text-[11px] leading-5 text-zinc-500 dark:text-zinc-500">
            {tt(
              '如果多次失败，请先使用邮箱登录，并联系管理员检查第三方平台的回调地址和服务端凭据。',
              'If this keeps failing, use email sign-in for now and ask the administrator to check the provider callback URL and server credentials.'
            )}
          </p>
        ) : null}
      </div>
    </main>
  );
}
