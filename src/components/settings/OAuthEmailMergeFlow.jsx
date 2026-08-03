import React, { useState } from 'react';
import { AlertTriangle, MailCheck, ShieldCheck } from 'lucide-react';

import { useI18n } from '../../i18n/index.js';
import {
  confirmOAuthEmailArtifactMerge,
  prepareOAuthEmailArtifactMerge,
  verifyOAuthEmailArtifactMerge,
} from '../../services/accountEmailService.js';

function getMergeErrorMessage(error, t) {
  switch (error?.code) {
    case 'oauth_email_merge_code_invalid':
      return t('settings.oauthEmailMerge.codeInvalid');
    case 'oauth_email_merge_not_available':
    case 'oauth_email_merge_target_changed':
      return t('settings.oauthEmailMerge.noLongerAvailable');
    case 'oauth_email_merge_coordination_required':
      return t('settings.oauthEmailMerge.coordinationRequired');
    case 'oauth_email_merge_session_recreate_failed':
      return t('settings.oauthEmailMerge.sessionRefreshRequired');
    default:
      return error?.message || t('settings.oauthEmailMerge.failed');
  }
}

export default function OAuthEmailMergeFlow({
  targetEmail,
  initialMaskedEmail = '',
  variant = 'desktop',
  onCancel,
  onCompleted,
  onDone,
}) {
  const { t, locale } = useI18n();
  const [stage, setStage] = useState('offer');
  const [intentId, setIntentId] = useState('');
  const [maskedEmail, setMaskedEmail] = useState(initialMaskedEmail);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isMobile = variant === 'mobile';
  const boxClass = isMobile
    ? 'mobile-ux-soft-card border border-amber-400/35 bg-amber-400/10 p-4 text-xs text-amber-100'
    : 'border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-500/10 dark:text-amber-100';
  const inputClass = isMobile
    ? 'mobile-ux-input px-4 py-3 text-center text-base font-mono tracking-[0.35em]'
    : 'w-full border border-zinc-300 bg-white px-3 py-2 text-center font-mono tracking-[0.35em] outline-none focus:border-endfield-yellow dark:border-zinc-700 dark:bg-zinc-950';
  const primaryClass = isMobile
    ? 'w-full rounded-full bg-endfield-yellow py-3 text-xs font-bold uppercase tracking-widest text-black disabled:opacity-50'
    : 'w-full bg-endfield-yellow py-2.5 text-xs font-bold uppercase tracking-wider text-black disabled:bg-zinc-300 disabled:text-zinc-500';
  const secondaryClass = isMobile
    ? 'w-full rounded-full border border-white/15 py-3 text-xs font-bold text-zinc-200'
    : 'w-full border border-zinc-300 py-2.5 text-xs font-bold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300';

  const prepare = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await prepareOAuthEmailArtifactMerge({ email: targetEmail, locale });
      setIntentId(result?.data?.mergeIntentId || '');
      setMaskedEmail(result?.data?.maskedEmail || initialMaskedEmail);
      setStage('code');
    } catch (mergeError) {
      setError(getMergeErrorMessage(mergeError, t));
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    const normalizedCode = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (normalizedCode.length !== 6) {
      setError(t('settings.oauthEmailMerge.codeInvalid'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await verifyOAuthEmailArtifactMerge({ intentId, code: normalizedCode });
      setMaskedEmail(result?.data?.maskedEmail || maskedEmail);
      setStage('confirm');
    } catch (mergeError) {
      setError(getMergeErrorMessage(mergeError, t));
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await confirmOAuthEmailArtifactMerge({ intentId });
      setStage('completed');
      onCompleted?.(result);
    } catch (mergeError) {
      setError(getMergeErrorMessage(mergeError, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={boxClass}>
        <div className="flex items-start gap-2">
          {stage === 'completed'
            ? <ShieldCheck size={18} className="mt-0.5 shrink-0" />
            : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
          <div className="space-y-1.5">
            <p className="font-bold">{t(`settings.oauthEmailMerge.${stage}.title`)}</p>
            <p>{t(`settings.oauthEmailMerge.${stage}.desc`, { email: maskedEmail || targetEmail })}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {stage === 'code' && (
        <div className="space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {t('settings.oauthEmailMerge.codeLabel')}
          </label>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className={inputClass}
          />
        </div>
      )}

      {stage === 'confirm' && (
        <ul className="space-y-1.5 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
          <li>• {t('settings.oauthEmailMerge.confirm.keepCurrent')}</li>
          <li>• {t('settings.oauthEmailMerge.confirm.releaseArtifact')}</li>
          <li>• {t('settings.oauthEmailMerge.confirm.noBusinessDataMove')}</li>
          <li>• {t('settings.oauthEmailMerge.confirm.revokeSessions')}</li>
        </ul>
      )}

      <div className="space-y-2">
        {stage === 'offer' && (
          <button type="button" onClick={prepare} disabled={loading} className={primaryClass}>
            {loading ? t('settings.oauthEmailMerge.preparing') : t('settings.oauthEmailMerge.startAction')}
          </button>
        )}
        {stage === 'code' && (
          <button type="button" onClick={verify} disabled={loading || code.length !== 6} className={primaryClass}>
            {loading ? t('settings.oauthEmailMerge.verifying') : t('settings.oauthEmailMerge.verifyAction')}
          </button>
        )}
        {stage === 'confirm' && (
          <button type="button" onClick={confirm} disabled={loading} className={primaryClass}>
            {loading ? t('settings.oauthEmailMerge.merging') : t('settings.oauthEmailMerge.confirmAction')}
          </button>
        )}
        {stage === 'completed' && (
          <button type="button" onClick={() => onDone?.()} className={primaryClass}>
            <span className="inline-flex items-center gap-2"><MailCheck size={15} />{t('settings.oauthEmailMerge.doneAction')}</span>
          </button>
        )}
        {stage !== 'completed' && (
          <button type="button" onClick={() => onCancel?.()} disabled={loading} className={secondaryClass}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
