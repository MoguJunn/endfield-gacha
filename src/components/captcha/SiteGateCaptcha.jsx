import React from 'react';
import { Globe2, ShieldCheck, TerminalSquare } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { ensureAuthCaptchaProviderScriptLoaded, getAuthCaptchaClientConfig } from '../../services/authCaptchaClient.js';
import { createAuthPowChallenge } from '../../services/powChallengeService.js';
import { shouldPreferPowCaptcha } from '../../utils/powChallengeCore.js';
import OracleCaptchaHub from './OracleCaptchaHub.jsx';
import TerminalPowCaptcha from './TerminalPowCaptcha.jsx';

function TurnstileGate({ onVerified, onFallbackPow }) {
  const { isEnglish } = useI18n();
  const tt = React.useCallback((zh, en) => (isEnglish ? en : zh), [isEnglish]);
  const containerRef = React.useRef(null);
  const widgetIdRef = React.useRef(null);
  const config = React.useMemo(() => getAuthCaptchaClientConfig({
    action: 'site_gate',
    env: {
      ...import.meta.env,
      VITE_AUTH_CAPTCHA_MODE: import.meta.env?.VITE_AUTH_CAPTCHA_MODE || 'enforce',
      VITE_AUTH_CAPTCHA_REQUIRED_ACTIONS: [
        import.meta.env?.VITE_AUTH_CAPTCHA_REQUIRED_ACTIONS,
        'site_gate',
      ].filter(Boolean).join(','),
    },
  }), []);
  const [message, setMessage] = React.useState(() => tt('正在连接 Turnstile 验证节点...', 'Connecting to the Turnstile verification node...'));

  React.useEffect(() => {
    let cancelled = false;

    if (!config.configured || config.provider !== 'turnstile') {
      onFallbackPow();
      return undefined;
    }

    ensureAuthCaptchaProviderScriptLoaded(config, window, document, 10000)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded || !window.turnstile?.render || !containerRef.current) {
          onFallbackPow();
          return;
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: config.siteKey,
          action: 'site_gate',
          theme: 'auto',
          size: 'normal',
          appearance: 'always',
          execution: 'render',
          callback: () => {
            if (!cancelled) {
              setMessage(tt('Turnstile 已确认来访请求。', 'Turnstile confirmed the access request.'));
              onVerified();
            }
          },
          'error-callback': (code) => {
            if (!cancelled) {
              setMessage(tt(
                `Turnstile 暂不可用：${code || 'unknown'}，正在切换到值守终端。`,
                `Turnstile is unavailable: ${code || 'unknown'}. Switching to the sentry terminal.`,
              ));
              window.setTimeout(onFallbackPow, 700);
            }
          },
          'timeout-callback': () => {
            if (!cancelled) {
              onFallbackPow();
            }
          },
        });
        setMessage(tt('请完成 Turnstile 来访验证。', 'Complete the Turnstile access check.'));
      })
      .catch(() => {
        if (!cancelled) {
          onFallbackPow();
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
    };
  }, [config, onFallbackPow, onVerified, tt]);

  return (
    <div className="mx-auto w-full max-w-[390px] border border-zinc-700 bg-black p-4 font-mono text-zinc-300">
      <div className="mb-3 flex items-center gap-2 text-xs tracking-[0.16em] text-endfield-yellow">
        <Globe2 className="h-4 w-4" />
        <span>{tt('Turnstile 来访验证', 'Turnstile Access Check')}</span>
      </div>
      <p className="mb-4 text-xs leading-5 text-zinc-400">{message}</p>
      <div className="min-h-[70px]">
        <div ref={containerRef} />
      </div>
      <button
        type="button"
        onClick={onFallbackPow}
        className="mt-4 border border-zinc-700 px-4 py-2 text-xs tracking-[0.18em] text-zinc-300 transition-colors hover:border-endfield-yellow hover:text-endfield-yellow"
      >
        {tt('改用值守终端', 'Use Sentry Terminal')}
      </button>
    </div>
  );
}

function PowGate({ onVerified, isMobile }) {
  const { isEnglish } = useI18n();
  const tt = React.useCallback((zh, en) => (isEnglish ? en : zh), [isEnglish]);
  const [challenge, setChallenge] = React.useState(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    createAuthPowChallenge('site_gate')
      .then((nextChallenge) => {
        if (!cancelled) {
          setChallenge(nextChallenge);
          setError('');
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason?.message || tt('值守终端挑战签发失败。', 'Failed to issue a sentry terminal challenge.'));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tt]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[390px] border border-red-800 bg-black p-4 font-mono text-red-300">
        <div className="mb-2 flex items-center gap-2 text-xs tracking-[0.16em]">
          <TerminalSquare className="h-4 w-4" />
          <span>{tt('值守终端离线', 'Sentry Terminal Offline')}</span>
        </div>
        <p className="text-xs leading-5">{error}</p>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="mx-auto w-full max-w-[390px] border border-zinc-700 bg-black p-4 font-mono text-zinc-400">
        <div className="mb-2 flex items-center gap-2 text-xs tracking-[0.16em] text-endfield-yellow">
          <TerminalSquare className="h-4 w-4" />
          <span>{tt('正在签发值守终端挑战', 'Issuing Sentry Terminal Challenge')}</span>
        </div>
        <p className="text-xs leading-5">{tt('请稍候，终端正在生成本次来访记录。', 'Please wait while the terminal creates this access record.')}</p>
      </div>
    );
  }

  return (
    <TerminalPowCaptcha
      action="site_gate"
      challenge={challenge}
      isMobile={isMobile}
      onVerified={onVerified}
      showFallbackButton={false}
    />
  );
}

export default function SiteGateCaptcha({ onVerified, isMobile = false }) {
  const { isEnglish } = useI18n();
  const tt = React.useCallback((zh, en) => (isEnglish ? en : zh), [isEnglish]);
  const [mode, setMode] = React.useState(() => (shouldPreferPowCaptcha(import.meta.env) ? 'pow' : 'turnstile'));
  const [showLegacy, setShowLegacy] = React.useState(false);
  const handleFallbackPow = React.useCallback(() => {
    setMode('pow');
  }, []);

  if (showLegacy) {
    return <OracleCaptchaHub isMobile={isMobile} onVerified={onVerified} />;
  }

  return (
    <div className="space-y-4">
      {mode === 'turnstile' ? (
        <TurnstileGate
          onFallbackPow={handleFallbackPow}
          onVerified={onVerified}
        />
      ) : (
        <PowGate isMobile={isMobile} onVerified={onVerified} />
      )}
      <div className="mx-auto flex max-w-[390px] justify-center gap-2 font-mono">
        <button
          type="button"
          onClick={() => setMode((current) => (current === 'pow' ? 'turnstile' : 'pow'))}
          className="inline-flex items-center gap-2 border border-zinc-700 px-3 py-2 text-[11px] tracking-[0.16em] text-zinc-300 transition-colors hover:border-endfield-yellow hover:text-endfield-yellow"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {mode === 'pow'
            ? tt('切换 Turnstile', 'Switch to Turnstile')
            : tt('切换 PoW', 'Switch to PoW')}
        </button>
        <button
          type="button"
          onClick={() => setShowLegacy(true)}
          className="border border-zinc-700 px-3 py-2 text-[11px] tracking-[0.16em] text-zinc-300 transition-colors hover:border-endfield-yellow hover:text-endfield-yellow"
        >
          {tt('旧版验证', 'Legacy Verification')}
        </button>
      </div>
    </div>
  );
}
