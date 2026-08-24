import React, { useMemo } from 'react';
import { List } from 'react-window';
import { Pencil } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useScopedHistoryPages } from '../../hooks/app/useScopedHistoryPages.js';
import { compareHistoryTimelineDesc } from '../../utils/historyTimelineSort.js';
import { localizeHistoryItemName } from '../../utils/gameDataI18n.js';
import { resolveMobileDetailedLogAvatarUrl } from '../../utils/mobileDetailedLogAvatar.js';

function buildMobileDetailedLogEntries(history, { locale, t, formatDateTime }) {
  return [...(Array.isArray(history) ? history : [])]
    .sort(compareHistoryTimelineDesc)
    .map((item, index) => ({
      id: item.id || `${item.poolId || item.pool_id || 'pool'}-${index}`,
      item,
      name: localizeHistoryItemName(item, { locale, fallback: t('common.unknown') }),
      avatarUrl: resolveMobileDetailedLogAvatarUrl(item),
      rarity: Number(item.rarity || 0),
      dateLabel: formatDateTime(
        item.timestamp || item.created_at,
        { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', includeYear: false },
        t('common.timeUnknown')
      ),
      pity: item.pity ?? item.pity_count ?? item.pityCount ?? item.pull_count ?? item.pullCount ?? null,
      isUp: !(item.isStandard ?? item.is_standard ?? false),
      isFree: item.isFree === true || item.is_free === true,
    }));
}

function DetailedLogRow({ index, style, ariaAttributes, entries, onEdit, t }) {
  const entry = entries[index];
  if (!entry) {
    return null;
  }

  return (
    <div style={style} {...ariaAttributes} className="px-1 py-1">
      <div className="mobile-ux-card-inset flex h-full items-center gap-3 px-3 py-2 text-left">
        <div className={`inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border font-mono text-xs font-black ${
          entry.rarity >= 6
            ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
            : entry.rarity === 5
              ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300'
              : 'border-zinc-200 bg-white text-slate-500 dark:border-zinc-800 dark:bg-[#111] dark:text-zinc-400'
        }`}>
          {entry.avatarUrl ? (
            <img
              src={entry.avatarUrl}
              alt={entry.name}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
                if (event.currentTarget.nextElementSibling) {
                  event.currentTarget.nextElementSibling.style.display = 'flex';
                }
              }}
            />
          ) : null}
          <span className={`h-full w-full items-center justify-center ${entry.avatarUrl ? 'hidden' : 'flex'}`}>
            {entry.rarity > 0 ? `${entry.rarity}★` : '--'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{entry.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-500 dark:text-zinc-500">
            <span>{entry.dateLabel}</span>
            {entry.pity !== null ? <span>{t('dashboard.analysis.currentPity', { count: entry.pity })}</span> : null}
            {entry.isFree ? <span className="text-blue-600 dark:text-blue-400">{t('dashboard.timeline.badge.free')}</span> : null}
            {!entry.isFree && entry.rarity >= 6 ? (
              <span className={entry.isUp ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}>
                {entry.isUp ? t('dashboard.timeline.badge.up') : t('dashboard.timeline.badge.offrate')}
              </span>
            ) : null}
          </div>
        </div>
        {typeof onEdit === 'function' ? (
          <button
            type="button"
            onClick={() => onEdit(entry.item)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-zinc-400"
            aria-label={`${t('common.edit')} ${entry.name}`}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function MobileDetailedLogList({ history, poolId = '', onEdit }) {
  const { isEnglish, locale, t, formatDateTime, formatNumber } = useI18n();
  const {
    phase,
    hasMore,
    total,
    error,
    loadedCount,
    loadMore,
    retry,
  } = useScopedHistoryPages({ poolId });
  const entries = useMemo(() => buildMobileDetailedLogEntries(history, {
    locale,
    t,
    formatDateTime,
  }), [formatDateTime, history, locale, t]);
  const rowProps = useMemo(() => ({ entries, onEdit, t }), [entries, onEdit, t]);

  if ((phase === 'unloaded' || phase === 'loading') && entries.length === 0) {
    return (
      <div className="rounded-[1rem] border border-zinc-200 bg-zinc-50/80 px-3 py-4 text-center font-mono text-[11px] text-slate-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-500">
        {isEnglish ? 'Loading records…' : '正在加载记录…'}
      </div>
    );
  }

  if (phase === 'error' && entries.length === 0) {
    return (
      <div className="rounded-[1rem] border border-red-200 bg-red-50/80 px-3 py-4 text-center text-[11px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        <div>{error?.message || (isEnglish ? 'Failed to load records' : '记录加载失败')}</div>
        <button type="button" onClick={() => void retry()} className="mt-3 min-h-11 border border-red-300 px-4 font-bold dark:border-red-500/40">
          {isEnglish ? 'Retry' : '重试'}
        </button>
      </div>
    );
  }

  if (phase === 'ready' && entries.length === 0) {
    return (
      <div className="rounded-[1rem] border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-4 text-center font-mono text-[11px] text-slate-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-500">
        {t('dashboard.logsEmpty')}
      </div>
    );
  }

  return (
    <div>
      <List
        aria-label={t('dashboard.logs')}
        rowComponent={DetailedLogRow}
        rowCount={entries.length}
        rowHeight={76}
        rowProps={rowProps}
        overscanCount={5}
        defaultHeight={420}
        style={{ height: 'min(58vh, 520px)', width: '100%' }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 border-t border-zinc-200 pt-3 font-mono text-[10px] text-slate-500 dark:border-zinc-800 dark:text-zinc-500">
        <span>
          {isEnglish ? 'Loaded' : '已加载'} {formatNumber(loadedCount)}
          {total === null ? '' : ` / ${formatNumber(total)}`}
        </span>
        {hasMore ? (
          <button
            type="button"
            disabled={phase === 'loading'}
            onClick={() => void loadMore()}
            className="min-h-11 border border-zinc-300 px-4 font-bold text-slate-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            {phase === 'loading'
              ? (isEnglish ? 'Loading…' : '加载中…')
              : (isEnglish ? 'Load more' : '加载更多')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
