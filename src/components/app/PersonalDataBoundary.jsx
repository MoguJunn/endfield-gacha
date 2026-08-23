import React, { useEffect } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import {
  usePersonalAnalysisStore,
  usePersonalDataStore,
} from '../../stores/index.js';
import { useI18n } from '../../i18n/index.js';
import { getPersonalDataErrorPresentation } from '../../utils/personalDataError.js';

function PersonalDataStatusPanel({ kind, message, detail = '', onRetry, retryLabel = '重试' }) {
  const isLoading = kind === 'loading' || kind === 'building';

  return (
    <section
      className="border border-zinc-200 bg-white px-5 py-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      aria-live="polite"
      data-testid={`personal-data-${kind}`}
    >
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3">
        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-amber-500 motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-6 w-6 text-rose-500" aria-hidden="true" />
        )}
        <p className="text-sm leading-6 text-slate-600 dark:text-zinc-300">{message}</p>
        {detail && (
          <p
            className="font-mono text-[11px] leading-5 text-slate-500 dark:text-zinc-400"
            data-testid="personal-data-error-diagnostic"
          >
            {detail}
          </p>
        )}
        {!isLoading && typeof onRetry === 'function' && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex min-h-11 items-center gap-2 border border-zinc-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-amber-500 hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
          >
            <RefreshCw size={14} aria-hidden="true" />
            {retryLabel}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Prevents authenticated pages from inferring data availability from empty
 * arrays. A verified empty response is rendered by the page itself; loading
 * and failed reads have distinct, authoritative states here.
 */
export default function PersonalDataBoundary({ user, onRetry, children }) {
  const { isEnglish } = useI18n();
  const ownerId = usePersonalDataStore((state) => state.ownerId);
  const phase = usePersonalDataStore((state) => state.phase);
  const hasSnapshot = usePersonalDataStore((state) => state.hasSnapshot);
  const refreshing = usePersonalDataStore((state) => state.refreshing);
  const error = usePersonalDataStore((state) => state.error);
  const analysisAvailability = usePersonalAnalysisStore((state) => state.availability);
  const analysisMeta = usePersonalAnalysisStore((state) => state.meta);
  const matchesOwner = Boolean(user?.id && ownerId === user.id);
  const errorPresentation = getPersonalDataErrorPresentation(error, { isEnglish });
  const isAnalysisStale = hasSnapshot && analysisAvailability === 'stale' && !error;

  useEffect(() => {
    if (
      !matchesOwner
      || hasSnapshot
      || phase !== 'building'
      || typeof onRetry !== 'function'
    ) {
      return undefined;
    }

    const configuredDelay = Number(analysisMeta?.retryAfterSeconds);
    const retryAfterSeconds = Number.isFinite(configuredDelay)
      ? Math.min(30, Math.max(2, configuredDelay))
      : 3;
    const timerId = window.setTimeout(() => {
      onRetry();
    }, retryAfterSeconds * 1000);

    return () => window.clearTimeout(timerId);
  }, [analysisMeta?.retryAfterSeconds, hasSnapshot, matchesOwner, onRetry, phase]);

  if (!user?.id) {
    return children;
  }

  if (!matchesOwner || (!hasSnapshot && ['idle', 'loading'].includes(phase))) {
    return (
      <PersonalDataStatusPanel
        kind="loading"
        message={isEnglish
          ? 'Signed in. Loading your gacha history and preparing the analysis…'
          : '已登录，正在读取你的抽卡记录并准备分析…'}
      />
    );
  }

  if (!hasSnapshot && phase === 'building') {
    return (
      <PersonalDataStatusPanel
        kind="building"
        message={isEnglish
          ? 'Your statistics are being prepared. This page will retry automatically…'
          : '正在生成你的统计快照，本页面稍后会自动重试…'}
      />
    );
  }

  if (!hasSnapshot && phase === 'error') {
    return (
      <PersonalDataStatusPanel
        kind="error"
        message={errorPresentation.message}
        detail={errorPresentation.diagnostic}
        onRetry={onRetry}
        retryLabel={isEnglish ? 'Retry' : '重试'}
      />
    );
  }

  return (
    <>
      {(refreshing || (error && hasSnapshot) || isAnalysisStale) && (
        <div
          className={`mb-4 flex min-h-11 items-center justify-between gap-3 border px-3 py-2 text-xs ${
            error
              ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300'
              : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200'
          }`}
          aria-live="polite"
          data-testid={error
            ? 'personal-data-stale-error'
            : isAnalysisStale
              ? 'personal-data-analysis-stale'
              : 'personal-data-refreshing'}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span>
              {error
                ? (isEnglish
                  ? 'Refresh failed. The last successful analysis remains visible.'
                  : '刷新失败，继续显示上次成功读取的分析。')
                : isAnalysisStale
                  ? (isEnglish
                    ? 'Statistics are updating. Showing the previous result.'
                    : '统计正在更新，当前显示上次结果')
                  : (isEnglish ? 'Refreshing in the background…' : '正在后台刷新，当前分析仍可使用…')}
            </span>
            {error && <span>{errorPresentation.message}</span>}
            {error && errorPresentation.diagnostic && (
              <span
                className="font-mono text-[11px] opacity-80"
                data-testid="personal-data-error-diagnostic"
              >
                {errorPresentation.diagnostic}
              </span>
            )}
          </span>
          {error && typeof onRetry === 'function' && (
            <button
              type="button"
              onClick={onRetry}
              className="min-h-9 shrink-0 border border-current px-3 py-1 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              {isEnglish ? 'Retry' : '重试'}
            </button>
          )}
        </div>
      )}
      {children}
    </>
  );
}
