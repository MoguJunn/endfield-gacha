import React from 'react';
import {
  RefreshCw,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  User,
  ArrowRight,
  Clock,
  Loader2,
  Upload,
  Clipboard
} from 'lucide-react';
import { ImportStatus } from '../importStatus';
import { getPoolName } from '../importShared';
import { useI18n } from '../../../i18n/index.js';
import { evaluateImportHealth } from '../../../utils/importHealth.js';
import { localizeGameAccountServerTag } from '../../../utils/gameAccountMetadata.js';

const FetchProgressBar = ({ progress, message, t }) => (
  <div className="w-full">
    <div className="flex justify-between items-center mb-2 text-[10px] uppercase text-slate-500 dark:text-zinc-500 transition-colors tracking-widest">
      <span className="flex items-center gap-2">
        <RefreshCw size={12} className="animate-spin text-yellow-600 dark:text-yellow-500" />
        {t('import.official.fetching')}
      </span>
      <span className="text-yellow-600 dark:text-yellow-500 font-bold">{progress}%</span>
    </div>
    <div className="h-1.5 w-full bg-slate-200 dark:bg-zinc-900 relative overflow-hidden transition-colors" style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)' }}>
      <div
        className="h-full bg-yellow-500 transition-all duration-300"
        style={{ width: `${progress}%` }}
      />
    </div>
    <div className="mt-2 flex justify-between items-center text-xs">
      <span className="text-slate-600 dark:text-zinc-400 transition-colors">{message}</span>
    </div>
  </div>
);

const QueueStatusDisplay = ({ queueStatus, retryInfo, t }) => {
  if (!queueStatus && !retryInfo) return null;

  return (
    <div className="mt-3 p-3 bg-slate-100 dark:bg-zinc-800/70 border border-slate-300 dark:border-zinc-600 rounded transition-colors">
      <div className="flex items-start gap-2">
        <Clock size={14} className="text-amber-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          {queueStatus && (
            <div className="text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-slate-700 dark:text-zinc-300 font-semibold">{t('import.official.queueStatus')}</span>
                {queueStatus.isProcessing && (
                  <Loader2 size={12} className="animate-spin text-amber-500 dark:text-yellow-500" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-zinc-400">{t('import.official.queueLength')}</span>
                  <span className="text-slate-700 dark:text-zinc-200 font-semibold">{queueStatus.queueLength}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-zinc-400">{t('import.official.activeRequests')}</span>
                  <span className="text-slate-700 dark:text-zinc-200 font-semibold">{queueStatus.activeRequests || 0}</span>
                </div>
              </div>
              {queueStatus.oldestTaskAge > 0 && (
                <div className="mt-1 text-[10px] text-slate-500 dark:text-zinc-400">
                  {t('import.official.oldestTaskAge', { seconds: Math.round(queueStatus.oldestTaskAge / 1000) })}
                </div>
              )}
            </div>
          )}

          {retryInfo && (
            <div className="text-xs border-t border-slate-300 dark:border-zinc-600 pt-2">
              <div className="flex items-center gap-2 mb-1">
                <RefreshCw size={12} className="text-orange-500 dark:text-orange-400" />
                <span className="text-slate-700 dark:text-zinc-300 font-semibold">{t('import.official.retrying')}</span>
              </div>
              <div className="text-[10px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-zinc-400">{t('import.official.retryCount')}</span>
                  <span className="text-orange-600 dark:text-orange-400 font-semibold">
                    {retryInfo.currentRetry}/{retryInfo.maxRetries}
                  </span>
                </div>
                {retryInfo.nextRetryIn && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-zinc-400">{t('import.official.nextRetry')}</span>
                    <span className="text-slate-700 dark:text-zinc-200 font-semibold">
                      {Math.round(retryInfo.nextRetryIn / 1000)}s
                    </span>
                  </div>
                )}
                {retryInfo.reason && (
                  <div className="mt-1 text-orange-600 dark:text-orange-400">
                    {t('import.official.retryReason', { reason: retryInfo.reason })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ImportReviewPanel = ({
  status,
  importSummary,
  reviewRecords = [],
  reviewDecisions = {},
  onReviewDecision,
  onConfirmImport,
  onCancel,
}) => {
  const issueRecords = Number(importSummary?.review?.issueRecords || 0);
  const blockingRecords = Number(importSummary?.review?.blockingRecords || 0);
  const selectedCounts = reviewRecords.reduce((counts, record) => {
    const action = reviewDecisions[String(record.ordinal)] || record.selectedAction || 'keep';
    counts[action] = (counts[action] || 0) + 1;
    return counts;
  }, { keep: 0, skip: 0 });
  const hasBlockingKept = reviewRecords.some((record) => {
    const blocked = (record.issues || []).some((issue) => issue?.severity === 'blocking');
    const action = reviewDecisions[String(record.ordinal)] || record.selectedAction || 'keep';
    return blocked && action === 'keep';
  });
  const confirming = status === ImportStatus.CONFIRMING;

  return (
    <div className="space-y-4">
      <div className="border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/70 dark:bg-amber-950/30">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={20} />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-amber-800 dark:text-amber-200">导入尚未写入，请先确认</h3>
            <p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-200/75">
              系统已暂存 {reviewRecords.length} 条新记录。{issueRecords > 0
                ? `其中 ${issueRecords} 条存在字段缺失或格式异常，下面会逐条说明。`
                : '当前没有发现字段异常，确认后才会写入记录和统计。'}
              {blockingRecords > 0 ? ` ${blockingRecords} 条无法安全识别的记录已默认设为跳过。` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="border border-zinc-200 bg-white px-2 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">待写入</div>
          <div className="mt-1 font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">{selectedCounts.keep}</div>
        </div>
        <div className="border border-zinc-200 bg-white px-2 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">将跳过</div>
          <div className="mt-1 font-mono text-xl font-bold text-zinc-600 dark:text-zinc-300">{selectedCounts.skip}</div>
        </div>
        <div className="border border-zinc-200 bg-white px-2 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">需重点核对</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-600 dark:text-amber-400">{issueRecords}</div>
        </div>
      </div>

      <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {reviewRecords.map((record) => {
          const issues = Array.isArray(record.issues) ? record.issues : [];
          const blocked = issues.some((issue) => issue?.severity === 'blocking');
          const action = reviewDecisions[String(record.ordinal)] || record.selectedAction || (blocked ? 'skip' : 'keep');
          const timestamp = record.timestamp
            ? new Date(record.timestamp).toLocaleString('zh-CN', { hour12: false })
            : '时间缺失';
          return (
            <div
              key={record.ordinal}
              className={`border p-3 ${blocked
                ? 'border-red-300 bg-red-50/70 dark:border-red-800 dark:bg-red-950/25'
                : issues.length > 0
                  ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                  : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-800 dark:text-white">{record.itemName || '物品名称缺失'}</span>
                    <span className="text-xs font-bold text-yellow-700 dark:text-yellow-400">{record.quality ? `${record.quality}★` : '品质缺失'}</span>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">{record.itemType === 'weapon' ? '武器' : record.itemType === 'character' ? '角色' : '类型待确认'}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    卡池 {record.poolId || '缺失'} · {timestamp} · 序号 {record.seqId || '缺失'}
                  </div>
                  {issues.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {issues.map((issue, index) => (
                        <p key={`${issue.code || 'issue'}-${index}`} className={`text-xs ${issue.severity === 'blocking' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                          {issue.message || '这条记录需要确认'}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={blocked || confirming}
                    onClick={() => onReviewDecision?.(record.ordinal, 'keep')}
                    className={`px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${action === 'keep'
                      ? 'bg-emerald-500 text-black'
                      : 'border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'}`}
                  >
                    保留
                  </button>
                  <button
                    type="button"
                    disabled={confirming}
                    onClick={() => onReviewDecision?.(record.ordinal, 'skip')}
                    className={`px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 ${action === 'skip'
                      ? 'bg-zinc-700 text-white dark:bg-zinc-200 dark:text-black'
                      : 'border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'}`}
                  >
                    跳过
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hasBlockingKept && (
        <p className="text-xs text-red-600 dark:text-red-400">仍有无法识别的记录被选为保留，请先改为跳过。</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={confirming}
          onClick={onCancel}
          className="border border-zinc-300 bg-white py-3 text-xs font-bold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          取消本次导入
        </button>
        <button
          type="button"
          disabled={confirming || hasBlockingKept}
          onClick={onConfirmImport}
          className="bg-yellow-500 py-3 text-xs font-bold text-black transition-colors hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {confirming ? '正在写入...' : `确认写入 ${selectedCounts.keep} 条记录`}
        </button>
      </div>
    </div>
  );
};

function getAccountAccent(account = {}) {
  const tag = account.serverTag || '';

  if (tag === 'B服') {
    return {
      border: 'border-pink-300 dark:border-pink-600 bg-pink-50 dark:bg-pink-900/20 hover:bg-pink-100 dark:hover:bg-pink-900/30',
      iconBg: 'bg-pink-100 dark:bg-pink-800/50',
      iconText: 'text-pink-600 dark:text-pink-400',
      badge: 'bg-pink-500 dark:bg-pink-600 text-white'
    };
  }

  if (tag?.includes('国际服')) {
    return {
      border: 'border-sky-300 dark:border-sky-600 bg-sky-50 dark:bg-sky-900/20 hover:bg-sky-100 dark:hover:bg-sky-900/30',
      iconBg: 'bg-sky-100 dark:bg-sky-800/50',
      iconText: 'text-sky-600 dark:text-sky-400',
      badge: 'bg-sky-500 dark:bg-sky-600 text-white'
    };
  }

  return {
    border: 'border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30',
    iconBg: 'bg-amber-100 dark:bg-amber-800/50',
    iconText: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500 dark:bg-amber-600 text-white'
  };
}

function getClipboardMessage(clipboardState, t) {
  switch (clipboardState?.status) {
    case 'reading':
      return t('import.official.clipboardReading');
    case 'success':
      return t('import.official.clipboardSuccess');
    case 'empty':
      return t('import.official.clipboardEmpty');
    case 'no_token':
      return t('import.official.clipboardNoToken');
    case 'denied':
      return t('import.official.clipboardDenied');
    case 'unsupported':
      return t('import.official.clipboardUnsupported');
    default:
      return '';
  }
}

export default function OfficialImportContent({
  source,
  status,
  tokenInput,
  autoDetected,
  availableAccounts,
  progress,
  statusMessage,
  queueStatus,
  retryInfo,
  sourceSwitchInfo,
  inputDetection,
  clipboardState,
  importMode,
  backendImportAvailable,
  accountCompletionRequired = false,
  error,
  importSummary,
  reviewRecords,
  reviewDecisions,
  userInfo,
  onSourceChange,
  onTokenChange,
  onClipboardRead,
  onImportModeChange,
  onStartImport,
  onOpenSettings,
  onOpenFileImport,
  onSelectAccount,
  onCancel,
  onReset,
  onConfirmImport,
  onReviewDecision
}) {
  const { t, locale } = useI18n();
  const IMPORT_SOURCE_OPTIONS = [
    { key: 'cn', label: t('import.source.cn.label'), description: t('import.source.cn.description') },
    { key: 'intl', label: t('import.source.intl.label'), description: t('import.source.intl.description') }
  ];
  const IMPORT_SOURCE_GUIDES = {
    cn: {
      bindingTitle: t('import.source.cn.bindingTitle'),
      bindingDesc: t('import.source.cn.bindingDesc'),
      bindingUrl: 'https://user.hypergryph.com/bindCharacters?game=endfield',
      bindingHost: 'user.hypergryph.com',
      tokenTitle: t('import.source.cn.tokenTitle'),
      tokenDesc: t('import.source.cn.tokenDesc'),
      tokenUrl: 'https://web-api.hypergryph.com/account/info/hg',
      tokenHost: 'web-api.hypergryph.com'
    },
    intl: {
      bindingTitle: t('import.source.intl.bindingTitle'),
      bindingDesc: t('import.source.intl.bindingDesc'),
      bindingUrl: 'https://topup.gryphline.com/endfield',
      bindingHost: 'topup.gryphline.com',
      tokenTitle: t('import.source.intl.tokenTitle'),
      tokenDesc: t('import.source.intl.tokenDesc'),
      tokenUrl: 'https://web-api.gryphline.com/cookie_store/account_token',
      tokenHost: 'web-api.gryphline.com'
    }
  };
  const guide = IMPORT_SOURCE_GUIDES[source] || IMPORT_SOURCE_GUIDES.cn;
  const userInfoAccent = userInfo ? getAccountAccent(userInfo) : null;
  const switchCountdown = sourceSwitchInfo?.countdown > 0 ? ` (${sourceSwitchInfo.countdown}s)` : '';
  const health = evaluateImportHealth({ status, queueStatus, retryInfo, error });
  const healthToneClasses = {
    healthy: 'border-emerald-300/80 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
    queue: 'border-amber-300/80 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
    warning: 'border-orange-300/80 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-300',
    error: 'border-red-300/80 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300',
  };
  const clipboardReadAvailable = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);
  const clipboardMessage = getClipboardMessage(clipboardState, t);
  const detectedSourceLabel = inputDetection?.detectedSource === 'intl'
    ? t('import.source.intl.label')
    : t('import.source.cn.label');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className={`inline-flex w-fit items-center gap-2 border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] transition-colors ${healthToneClasses[health.tone] || healthToneClasses.healthy}`} style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
          <span className="opacity-80">{t('import.official.healthLabel')}</span>
          <span>{t(health.key)}</span>
        </div>
        {status === ImportStatus.IDLE && typeof onOpenFileImport === 'function' && (
          <button
            type="button"
            onClick={onOpenFileImport}
            className="group inline-flex items-center justify-between gap-3 border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-left text-[11px] leading-4 text-cyan-700 transition-colors hover:border-cyan-500 hover:bg-cyan-500/15 dark:text-cyan-300"
            style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
          >
            <Upload size={14} className="shrink-0 text-cyan-600 transition-transform group-hover:-translate-y-0.5 dark:text-cyan-300" />
            <span className="min-w-0">
              <span className="block font-bold uppercase tracking-widest">{t('import.official.fileImportHintTitle')}</span>
              <span className="block text-cyan-700/75 dark:text-cyan-300/75">{t('import.official.fileImportHintDesc')}</span>
            </span>
          </button>
        )}
      </div>
      {status === ImportStatus.IDLE && (
        <div className="bg-slate-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)' }}>
          <div className="mb-4">
            <div className="text-[11px] text-slate-600 dark:text-zinc-400 font-bold uppercase tracking-widest mb-3">
              {t('import.official.sourceLabel')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {IMPORT_SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onSourceChange(option.key)}
                  className={`border p-4 text-left transition-all duration-300 relative group overflow-hidden ${
                    source === option.key
                      ? 'border-yellow-500 bg-zinc-100 dark:bg-yellow-500/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]'
                      : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:border-yellow-500/50'
                  }`}
                  style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}
                >
                  <div className={`absolute inset-y-0 left-0 w-1 transition-transform duration-300 origin-bottom ${source === option.key ? 'bg-yellow-500 scale-y-100' : 'bg-zinc-400 dark:bg-zinc-600 scale-y-0 group-hover:scale-y-100'}`} />
                  <div className={`text-sm font-bold tracking-widest uppercase transition-colors relative z-10 ${source === option.key ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-800 dark:text-zinc-200 group-hover:text-yellow-600 dark:group-hover:text-yellow-500'}`}>{option.label}</div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-500 mt-1.5 relative z-10">{option.description}</div>
                  {source === option.key && <div className="absolute top-2 right-2 w-2 h-2 bg-yellow-500 animate-pulse" style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)' }} />}
                </button>
              ))}
            </div>
          </div>

          {backendImportAvailable && (
            <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-zinc-400">
                    {t('import.official.modeLabel')}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-zinc-500">
                    {t('import.official.modeDesc')}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    key: 'incremental',
                    label: t('import.official.modeIncremental'),
                    desc: t('import.official.modeIncrementalDesc'),
                  },
                  {
                    key: 'full',
                    label: t('import.official.modeFull'),
                    desc: t('import.official.modeFullDesc'),
                  },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => onImportModeChange?.(option.key)}
                    className={`border px-3 py-2 text-left transition-colors ${
                      importMode === option.key
                        ? 'border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
                        : 'border-zinc-300 bg-slate-50 text-slate-600 hover:border-yellow-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400'
                    }`}
                    style={{ clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)' }}
                  >
                    <span className="block text-[11px] font-black uppercase tracking-widest">{option.label}</span>
                    <span className="mt-1 block text-[10px] leading-4 opacity-80">{option.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <h3 className="text-slate-800 dark:text-zinc-300 font-bold mb-2 flex items-center gap-2 uppercase tracking-widest">
            <HelpCircle size={14} className="text-yellow-600 dark:text-yellow-500" />
            {t('import.official.quickGuide')}
          </h3>

          <div className="space-y-4 pt-2 text-xs text-slate-500 dark:text-zinc-400">
            <div className="flex gap-3">
              <div
                className="w-5 h-5 flex-shrink-0 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-slate-600 dark:text-zinc-300"
                style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)' }}
              >
                1
              </div>
              <div>
                <p className="text-slate-800 dark:text-zinc-300 font-bold mb-1 uppercase tracking-widest">{guide.bindingTitle}</p>
                <p className="mb-1 text-slate-500 dark:text-zinc-500">{guide.bindingDesc}</p>
                <a href={guide.bindingUrl} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 flex items-center gap-1 underline">
                  {guide.bindingHost} <ExternalLink size={10} />
                </a>
              </div>
            </div>
            <div className="flex gap-3">
              <div
                className="w-5 h-5 flex-shrink-0 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-slate-600 dark:text-zinc-300"
                style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)' }}
              >
                2
              </div>
              <div>
                <p className="text-slate-800 dark:text-zinc-300 font-bold mb-1 uppercase tracking-widest">{guide.tokenTitle}</p>
                <p className="mb-1 text-slate-500 dark:text-zinc-500">{guide.tokenDesc}</p>
                <a href={guide.tokenUrl} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 flex items-center gap-1 underline">
                  {guide.tokenHost} <ExternalLink size={10} />
                </a>
              </div>
            </div>
            <div className="flex gap-3">
              <div
                className="w-5 h-5 flex-shrink-0 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-slate-600 dark:text-zinc-300"
                style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)' }}
              >
                3
              </div>
              <div>
                <p className="text-slate-800 dark:text-zinc-300 font-bold mb-1 uppercase tracking-widest">{t('import.official.pasteTitle')}</p>
                <p className="text-slate-500 dark:text-zinc-500 mb-2">{t('import.official.pasteDesc')}</p>
                <div className="bg-slate-100 dark:bg-black/40 border border-zinc-200 dark:border-zinc-700 p-2 text-[10px] font-mono leading-relaxed transition-colors">
                  <span className="text-slate-500 dark:text-zinc-500">{'{'}</span><br />
                  <span className="text-slate-500 dark:text-zinc-500 ml-2">"code": 0,</span><br />
                  <span className="text-slate-500 dark:text-zinc-500 ml-2">"data": {'{'}</span><br />
                  <span className="text-purple-600 dark:text-purple-400 ml-4">"content"</span><span className="text-slate-500 dark:text-zinc-500">: </span>
                  <span className="text-green-600 dark:text-green-400">"AbCdEf123456789012345678"</span><br />
                  <span className="text-slate-500 dark:text-zinc-500 ml-2">{'}'}</span><span className="text-slate-400 dark:text-zinc-600 ml-2">{t('import.official.copyHint')}</span><br />
                  <span className="text-slate-500 dark:text-zinc-500">{'}'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {status === ImportStatus.IDLE && (
        <div className="space-y-4">
          <div className="relative">
            <label className="block text-[11px] text-slate-600 dark:text-zinc-400 font-bold uppercase tracking-widest mb-3">
              {t('import.official.tokenLabel')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={tokenInput}
                onChange={onTokenChange}
                className="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 p-4 font-mono text-center text-lg text-slate-800 dark:text-white focus:border-yellow-500 dark:focus:border-yellow-500 focus:outline-none transition-colors placeholder:text-slate-300 dark:placeholder:text-zinc-700 shadow-inner"
                style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' }}
                placeholder={t('import.official.tokenPlaceholder', { region: source === 'intl' ? t('import.source.intl.label') : t('import.source.cn.label') })}
              />
              <div className="absolute right-3 top-[38px] text-[10px] text-slate-400 dark:text-zinc-600 font-mono pointer-events-none">
                {tokenInput.trim().length} chars
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {clipboardReadAvailable && (
                <button
                  type="button"
                  onClick={onClipboardRead}
                  disabled={clipboardState?.status === 'reading'}
                  className="inline-flex w-fit items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600 transition-colors hover:border-yellow-500 hover:text-yellow-700 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-yellow-500 dark:hover:text-yellow-400"
                  style={{ clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)' }}
                >
                  <Clipboard size={13} />
                  {t('import.official.clipboardPaste')}
                </button>
              )}
              {clipboardMessage && (
                <span className="text-[11px] text-slate-500 dark:text-zinc-500">
                  {clipboardMessage}
                </span>
              )}
            </div>
          </div>

          {autoDetected && tokenInput.length === 24 && (
            <div
                className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 px-3 py-2 transition-colors"
              style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
            >
              <CheckCircle size={14} />
              <span>
                {inputDetection?.fromText
                  ? t('import.official.autoDetectedText')
                  : t('import.official.autoDetected')}
              </span>
            </div>
          )}

          {inputDetection?.detectedSource && (
            <div
              className="flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/50 px-3 py-2 transition-colors"
              style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
            >
              <CheckCircle size={14} />
              <span>
                {inputDetection.sourceAutoSwitched
                  ? t('import.official.sourceAutoSwitched', { target: detectedSourceLabel })
                  : t('import.official.sourceDetected', { target: detectedSourceLabel })}
              </span>
            </div>
          )}

          {accountCompletionRequired && (
            <div
              className="border border-amber-300 bg-amber-50 px-3 py-3 text-amber-800 transition-colors dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
              style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
            >
              <div className="flex items-start gap-3">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black uppercase tracking-widest">
                    {t('import.official.accountCompletionTitle')}
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-amber-700 dark:text-amber-200/90">
                    {t('import.official.accountCompletionDesc')}
                  </p>
                  {typeof onOpenSettings === 'function' && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="mt-3 inline-flex items-center gap-2 border border-amber-400 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-600 dark:bg-zinc-950 dark:text-amber-200 dark:hover:bg-amber-900/20"
                      style={{ clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)' }}
                    >
                      {t('import.official.accountCompletionOpenSettings')}
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={onStartImport}
            disabled={!tokenInput.trim() || accountCompletionRequired}
            className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-bold py-4 text-sm tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-2 group relative overflow-hidden disabled:cursor-not-allowed"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)' }}
          >
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 ease-in-out" />
            <span className="relative z-10">{t('import.official.start')}</span>
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform relative z-10" />
          </button>
        </div>
      )}

      {status === ImportStatus.ACCOUNT_SELECTION && availableAccounts.length > 1 && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 p-4 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)' }}>
            <div className="flex items-center gap-2 mb-3">
              <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span className="text-blue-700 dark:text-blue-400 font-bold uppercase tracking-widest text-sm">{t('import.official.multipleAccounts')}</span>
            </div>
            <p className="text-slate-600 dark:text-zinc-400 text-xs mb-4">
              {t('import.official.selectAccount')}
            </p>

            <div className="space-y-2">
              {availableAccounts.map((account) => {
                const accent = getAccountAccent(account);
                return (
                <button
                  key={`${account.uid}-${account.gameUid || 'unknown'}-${account.serverId || 'unknown'}`}
                  onClick={() => onSelectAccount(account)}
                  className={`w-full p-4 border transition-all duration-300 text-left flex items-center gap-4 group hover:-translate-y-0.5 hover:shadow-lg relative overflow-hidden ${accent.border}`}
                  style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' }}
                >
                  <div className={`w-12 h-12 flex items-center justify-center shrink-0 border border-black/10 dark:border-white/10 ${accent.iconBg}`} style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
                    <User size={24} className={accent.iconText} />
                  </div>
                  <div className="flex-1 min-w-0 z-10 relative">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-800 dark:text-white truncate">{account.nickName}</span>
                      <span className={`shrink-0 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider ${accent.badge}`} style={{ clipPath: 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 0 100%)' }}>
                        {account.serverTag ? localizeGameAccountServerTag(account.serverTag, locale) : account.channelName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-slate-500 dark:text-zinc-500 font-mono flex items-center gap-1">
                        <span className="text-[9px] uppercase tracking-widest">UID</span>
                        <span className="text-slate-700 dark:text-zinc-300 font-bold">{account.gameUid}</span>
                      </p>
                      <p className="text-xs text-slate-500 dark:text-zinc-500 font-mono flex items-center gap-1">
                        <span className="text-[9px] uppercase tracking-widest">LV</span>
                        <span className="text-slate-700 dark:text-zinc-300 font-bold">{account.level}</span>
                      </p>
                    </div>
                  </div>
                  <ArrowRight size={20} className="text-slate-400 dark:text-zinc-500 group-hover:translate-x-1 group-hover:text-slate-800 dark:group-hover:text-white transition-all z-10 relative" />
                </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={onReset}
            className="w-full text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/50 py-3 text-xs font-bold uppercase tracking-widest transition-all duration-200"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)' }}
          >
            {t('import.official.cancelAndBack')}
          </button>
        </div>
      )}

      {(status === ImportStatus.AUTHENTICATING || status === ImportStatus.FETCHING || status === ImportStatus.PROCESSING) && (
        <div className="py-8 px-4 border border-zinc-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50 transition-colors">
          <FetchProgressBar progress={progress} message={statusMessage} t={t} />
          {sourceSwitchInfo && (
            <div className="mt-3 flex items-center gap-2 text-xs bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-2 text-sky-700 dark:text-sky-400 transition-colors">
              <RefreshCw size={12} className="animate-spin" />
              <span>
                {t('import.official.switching', {
                  target: sourceSwitchInfo.to === 'intl' ? t('import.source.intl.label') : t('import.source.cn.label'),
                  countdown: switchCountdown
                })}
              </span>
            </div>
          )}
          <QueueStatusDisplay queueStatus={queueStatus} retryInfo={retryInfo} t={t} />
          <button
            onClick={onCancel}
            className="mt-6 w-full text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300 text-xs uppercase tracking-widest transition-colors"
          >
            {t('import.official.cancelOperation')}
          </button>
        </div>
      )}

      {status === ImportStatus.ERROR && (
        <div className="space-y-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 p-4 flex gap-3 transition-colors">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-500 shrink-0" />
            <div>
              <h4 className="text-red-600 dark:text-red-500 font-bold text-sm mb-1">{t('import.official.failure')}</h4>
              <p className="text-slate-600 dark:text-zinc-400 text-xs">{error}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              onClick={onStartImport}
              disabled={!tokenInput.trim() || accountCompletionRequired}
              className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-bold py-3 text-sm tracking-wider transition-colors disabled:cursor-not-allowed"
            >
              {t('import.official.retrySameToken')}
            </button>
            <button
              onClick={onReset}
              className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-transparent hover:bg-slate-50 dark:hover:bg-zinc-700 text-slate-700 dark:text-white font-bold py-3 text-sm tracking-wider transition-colors"
            >
              {t('import.official.editToken')}
            </button>
          </div>
        </div>
      )}

      {(status === ImportStatus.REVIEW_REQUIRED || status === ImportStatus.CONFIRMING) && importSummary && (
        <ImportReviewPanel
          status={status}
          importSummary={importSummary}
          reviewRecords={reviewRecords}
          reviewDecisions={reviewDecisions}
          onReviewDecision={onReviewDecision}
          onConfirmImport={onConfirmImport}
          onCancel={onCancel}
        />
      )}

      {status === ImportStatus.SUCCESS && importSummary && (
        <div className="space-y-6">
          {userInfo && userInfoAccent && (
            <div className="flex items-center gap-4 p-4 border border-zinc-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)' }}>
              <div className={`w-12 h-12 flex items-center justify-center shrink-0 border border-black/10 dark:border-white/10 ${userInfoAccent.iconBg}`} style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
                <User size={24} className={userInfoAccent.iconText} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-slate-800 dark:text-white truncate">{userInfo.nickName || 'Unknown User'}</span>
                  {(userInfo.serverTag || userInfo.channelName) && (
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider ${userInfoAccent.badge}`} style={{ clipPath: 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 0 100%)' }}>
                      {userInfo.serverTag ? localizeGameAccountServerTag(userInfo.serverTag, locale) : userInfo.channelName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-slate-500 dark:text-zinc-500 font-mono flex items-center gap-1">
                    <span className="text-[9px] uppercase tracking-widest">UID</span>
                    <span className="text-slate-700 dark:text-zinc-300 font-bold">{userInfo.gameUid || userInfo.hgUid}</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 p-4 transition-colors" style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="text-emerald-600 dark:text-emerald-500" size={16} />
              <span className="text-emerald-600 dark:text-emerald-500 font-bold uppercase tracking-widest text-sm">{t('import.official.fetchSuccess')}</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-colors py-2" style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
                <div className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">TOTAL</div>
                <div className="text-xl font-mono font-bold text-slate-800 dark:text-white mt-1">{importSummary.total}</div>
              </div>

              {['6', '5', '4'].map(rarity => (
                <div key={rarity} className="text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-colors py-2" style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
                  <div className={`text-[10px] font-bold uppercase tracking-widest ${rarity === '6' ? 'text-yellow-600 dark:text-yellow-500' : rarity === '5' ? 'text-purple-600 dark:text-purple-400' : 'text-blue-600 dark:text-blue-400'}`}>
                    {rarity}★
                  </div>
                  <div className="text-xl font-mono font-bold text-slate-700 dark:text-zinc-300 mt-1">{importSummary.byRarity[rarity] || 0}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-5 border-t border-zinc-200 dark:border-zinc-800/50 transition-colors">
              <p className="text-[10px] text-slate-400 dark:text-zinc-500 uppercase tracking-widest mb-3">{t('import.official.poolDistribution')}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(importSummary.byPoolType || importSummary.byPool).map(([pool, count]) => (
                  <span
                    key={pool}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-[11px] text-slate-500 dark:text-zinc-400 font-bold transition-colors uppercase tracking-wider"
                    style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
                  >
                    {getPoolName(pool, t)} <span className="text-slate-800 dark:text-white ml-2">{count}</span>
                  </span>
                ))}
              </div>
            </div>

            {importSummary.sixStars && importSummary.sixStars.length > 0 && (
              <div className="mt-5">
                <p className="text-[10px] text-yellow-600/80 dark:text-yellow-500/80 uppercase tracking-widest mb-3">{t('import.official.sixStarDrops')}</p>
                <div className="flex flex-wrap gap-2">
                  {importSummary.sixStars.map((record, index) => (
                    <span
                      key={index}
                      className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 px-3 py-1.5 text-[11px] text-yellow-700 dark:text-yellow-500 font-bold transition-colors tracking-widest flex items-center gap-2"
                      style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
                    >
                      {record.name}
                      {record.isNew && <span className="text-[9px] bg-yellow-500 text-black px-1.5 font-black uppercase tracking-wider" style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)' }}>NEW</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <button
              onClick={onReset}
              className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:border-yellow-500 dark:hover:border-yellow-500 text-slate-700 dark:text-zinc-300 font-bold py-3 text-xs tracking-widest uppercase transition-all duration-200 relative group overflow-hidden"
              style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-yellow-500 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-bottom" />
              <span className="relative z-10 group-hover:text-yellow-600 dark:group-hover:text-yellow-500 transition-colors">{t('import.official.refetch')}</span>
            </button>
            <button
              onClick={onConfirmImport}
              className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 text-xs tracking-widest uppercase transition-all duration-300 hover:shadow-[0_0_15px_rgba(234,179,8,0.4)] active:scale-95 group relative overflow-hidden"
              style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' }}
            >
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 ease-in-out" />
              <span className="relative z-10">{t('import.official.confirmSave')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
