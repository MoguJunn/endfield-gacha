import React, { useCallback, useState } from 'react';
import SiteGateCaptcha from '../captcha/SiteGateCaptcha.jsx';
import { STORAGE_KEYS, writeNumberStorageValue } from '../../utils/storageUtils.js';
import { hasTrustedGateSession } from '../../utils/startupGateSession.js';
import { useI18n } from '../../i18n/index.js';

/**
 * The site gate is a real mount boundary: application effects do not run until
 * the visitor has a trusted gate session. Trusted visitors enter immediately;
 * first-time visitors see the verification control without an artificial
 * loading animation or module-warmup delay.
 */
export default function AppStartupGate({ children, isMobile = false }) {
  const { t } = useI18n();
  const [verified, setVerified] = useState(hasTrustedGateSession);

  const handleVerified = useCallback(() => {
    writeNumberStorageValue(
      STORAGE_KEYS.CAPTCHA_LAST_VERIFIED,
      Date.now(),
      { raw: true }
    );
    setVerified(true);
  }, []);

  if (verified) {
    return children;
  }

  return (
    <main
      className="fixed inset-0 z-[9999] flex min-h-[100dvh] w-full items-center justify-center overflow-y-auto overflow-x-hidden bg-black px-3 py-8 font-mono text-endfield-yellow"
      aria-labelledby="site-gate-title"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-5">
        <img
          src="/endfield-logo.svg"
          alt="Endfield Logo"
          className={isMobile ? 'h-auto w-20 invert' : 'h-auto w-24 invert'}
        />
        <div className="text-center">
          <h1 id="site-gate-title" className="text-lg font-black tracking-[0.18em] text-endfield-yellow">
            {t('loading.gate.title', {}, '访问验证')}
          </h1>
        </div>
        <div className="w-full">
          <SiteGateCaptcha isMobile={isMobile} onVerified={handleVerified} />
        </div>
      </div>
    </main>
  );
}
