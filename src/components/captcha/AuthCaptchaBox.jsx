import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import {
  ensureAuthCaptchaProviderScriptLoaded,
  getAuthCaptchaClientConfig,
} from '../../services/authCaptchaClient.js';
import { createAuthPowChallenge } from '../../services/powChallengeService.js';
import { shouldPreferPowCaptcha } from '../../utils/powChallengeCore.js';
import { useI18n } from '../../i18n/index.js';
import TerminalPowCaptcha from './TerminalPowCaptcha.jsx';

function canUseTurnstile(config) {
  return config.enabled && config.configured && config.provider === 'turnstile';
}

export default function AuthCaptchaBox({
  action,
  onStateChange,
}) {
  const { isEnglish } = useI18n();
  const containerRef = React.useRef(null);
  const widgetIdRef = React.useRef(null);
  const config = React.useMemo(() => getAuthCaptchaClientConfig({ action }), [action]);
  const preferPow = React.useMemo(() => shouldPreferPowCaptcha(import.meta.env), []);
  const [mode, setMode] = React.useState(() => (preferPow ? 'pow' : 'turnstile'));
  const [powChallenge, setPowChallenge] = React.useState(null);
  const [status, setStatus] = React.useState('idle');
  const [message, setMessage] = React.useState('');
  const tt = React.useCallback((zh, en) => (isEnglish ? en : zh), [isEnglish]);

  const publishState = React.useCallback((nextStatus, {
    token = '',
    powPayload = null,
    provider = mode,
    message: nextMessage = '',
  } = {}) => {
    setStatus(nextStatus);
    setMessage(nextMessage);
    onStateChange?.({
      action: config.action,
      enabled: config.enabled,
      configured: provider === 'pow' ? true : config.configured,
      provider,
      ready: !config.enabled || !config.required || Boolean(token || powPayload),
      required: config.required,
      status: nextStatus,
      token,
      powPayload,
    });
  }, [config.action, config.configured, config.enabled, config.required, mode, onStateChange]);

  React.useEffect(() => {
    setMode(preferPow ? 'pow' : 'turnstile');
    setPowChallenge(null);
  }, [action, preferPow]);

  React.useEffect(() => {
    if (!config.enabled || mode !== 'pow') {
      return undefined;
    }

    let cancelled = false;
    publishState('loading', {
      provider: 'pow',
      message: tt('正在准备本地校验...', 'Preparing local verification...'),
    });

    createAuthPowChallenge(config.action)
      .then((challenge) => {
        if (cancelled) return;
        setPowChallenge(challenge);
        publishState('ready', {
          provider: 'pow',
          message: tt('点击“开始校验”完成验证。', 'Select Start Check to complete verification.'),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        publishState('error', {
          provider: 'pow',
          message: error?.message || tt('本地校验准备失败，请改用网页验证。', 'Failed to prepare local verification. Use the web check instead.'),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [config.action, config.enabled, mode, publishState, tt]);

  React.useEffect(() => {
    if (!config.enabled || mode !== 'turnstile') {
      return undefined;
    }

    let cancelled = false;

    if (!config.configured || config.provider !== 'turnstile') {
      setMode('pow');
      return undefined;
    }

    publishState('loading', {
      provider: 'turnstile',
      message: tt('正在加载人机验证组件...', 'Loading bot check...'),
    });

    ensureAuthCaptchaProviderScriptLoaded(config, window, document, 10000)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded || !window.turnstile?.render || !containerRef.current) {
          setMode('pow');
          return;
        }

        try {
          containerRef.current.innerHTML = '';
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: config.siteKey,
            action: config.action,
            theme: 'auto',
            size: 'flexible',
            appearance: 'always',
            execution: 'render',
            callback: (token) => {
              if (cancelled) return;
              publishState('success', {
                provider: 'turnstile',
                token,
                message: tt('验证已完成。', 'Verification completed.'),
              });
            },
            'error-callback': (code) => {
              if (cancelled) return;
              publishState('error', {
                provider: 'turnstile',
                message: tt(`网页验证失败：${code || 'unknown'}。你可以改用本地校验。`, `Web verification failed: ${code || 'unknown'}. You can use the local check instead.`),
              });
            },
            'expired-callback': () => {
              if (cancelled) return;
              publishState('expired', {
                provider: 'turnstile',
                message: tt('验证已过期，请重新完成验证。', 'Verification expired. Complete it again.'),
              });
            },
            'timeout-callback': () => {
              if (cancelled) return;
              setMode('pow');
            },
          });
          publishState('ready', {
            provider: 'turnstile',
            message: tt('请完成人机验证。', 'Complete the bot check.'),
          });
        } catch {
          setMode('pow');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMode('pow');
        }
      });

    return () => {
      cancelled = true;
      try {
        if (widgetIdRef.current && window.turnstile?.remove) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch {
        // Best-effort cleanup only.
      }
      widgetIdRef.current = null;
    };
  }, [config, mode, publishState, tt]);

  const selectMode = React.useCallback((nextMode) => {
    if (nextMode === mode) return;

    setPowChallenge(null);
    publishState('loading', {
      provider: nextMode,
      message: nextMode === 'pow'
        ? tt('正在准备本地校验...', 'Preparing local verification...')
        : tt('正在准备网页验证...', 'Preparing web verification...'),
    });
    setMode(nextMode);
  }, [mode, publishState, tt]);

  if (!config.enabled) {
    return null;
  }

  const statusLabel = status === 'success'
    ? tt('已完成', 'Complete')
    : status === 'error' || status === 'expired'
      ? tt('需重试', 'Try Again')
      : status === 'loading'
        ? tt('载入中', 'Loading')
        : status === 'ready'
          ? tt('待操作', 'Action Needed')
          : tt('准备中', 'Preparing');
  const statusTone = status === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
    : status === 'error' || status === 'expired'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
      : 'border-zinc-200 bg-white text-slate-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';

  return (
    <section
      aria-label={tt('安全验证', 'Security verification')}
      data-status={status}
      className={`min-w-0 overflow-hidden border p-2.5 transition-colors duration-200 sm:p-3 ${statusTone}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-current/20 bg-white/55 dark:bg-black/15">
          {status === 'success' ? (
            <CheckCircle2 size={16} />
          ) : status === 'error' || status === 'expired' ? (
            <AlertTriangle size={16} />
          ) : status === 'loading' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ShieldCheck size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.14em]">
                {tt('安全验证', 'Security Check')}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-70">
                {mode === 'pow' ? tt('本地校验', 'Local Check') : tt('网页验证', 'Web Check')}
              </div>
            </div>
            <span className="border border-current/20 bg-white/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider dark:bg-black/15">
              {statusLabel}
            </span>
          </div>
          <p aria-live="polite" className="mt-1 text-xs leading-relaxed">
            {message || tt('请完成下方验证后继续。', 'Complete the verification below before continuing.')}
          </p>
        </div>
      </div>

      {canUseTurnstile(config) && (
        <div role="group" aria-label={tt('选择验证方式', 'Choose verification method')} className="mt-2.5 grid grid-cols-2 border border-current/15 bg-white/50 p-0.5 dark:bg-black/10">
          <button
            type="button"
            aria-pressed={mode === 'turnstile'}
            onClick={() => selectMode('turnstile')}
            className={`min-h-[38px] px-2 py-1.5 text-left transition-[background-color,color,box-shadow] ${
              mode === 'turnstile'
                ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950'
                : 'text-current hover:bg-white/70 dark:hover:bg-white/10'
            }`}
          >
            <span className="block text-[11px] font-bold">{tt('网页验证', 'Web Check')}</span>
            <span className="mt-0.5 block text-[9px] opacity-70">{tt('推荐 · 快速完成', 'Recommended · Quick')}</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === 'pow'}
            onClick={() => selectMode('pow')}
            className={`min-h-[38px] px-2 py-1.5 text-left transition-[background-color,color,box-shadow] ${
              mode === 'pow'
                ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950'
                : 'text-current hover:bg-white/70 dark:hover:bg-white/10'
            }`}
          >
            <span className="block text-[11px] font-bold">{tt('本地校验', 'Local Check')}</span>
            <span className="mt-0.5 block text-[9px] opacity-70">{tt('网络不稳时使用', 'For unstable networks')}</span>
          </button>
        </div>
      )}

      <div key={mode} className="auth-verification-panel-enter mt-2.5 min-w-0">
        {mode === 'turnstile' && canUseTurnstile(config) && (
          <div className="min-h-[68px] w-full min-w-0 overflow-x-auto">
            <div ref={containerRef} className="w-full min-w-0" />
          </div>
        )}

        {mode === 'pow' && powChallenge && (
          <TerminalPowCaptcha
            action={config.action}
            challenge={powChallenge}
            compact
            onVerified={(powPayload) => {
              publishState('success', {
                provider: 'pow',
                powPayload,
                message: tt('本地校验已完成，可以创建账号。', 'Local check completed. You can create the account.'),
              });
            }}
            showFallbackButton={false}
          />
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed opacity-65">
        {tt('验证完成后页面会自动定位到“创建账号”按钮。', 'After verification, the page moves to the Create Account button automatically.')}
      </p>
    </section>
  );
}
