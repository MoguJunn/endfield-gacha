import React, { useMemo } from 'react';
import { ArrowRight, ChevronRight, Layers, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../stores/useAuthStore';
import usePoolStore from '../../stores/usePoolStore';
import useHistoryStore from '../../stores/useHistoryStore';
import usePersonalAnalysisStore from '../../stores/usePersonalAnalysisStore.js';
import { usePersonalGameAccounts } from '../../hooks/app/usePersonalGameAccounts.js';
import { useSummaryViewState } from '../../hooks/summary';
import {
  formatFreshnessAbsolute,
  formatFreshnessRelative,
  getFreshnessTone,
} from '../../utils/dataFreshness.js';
import { getAccountLastImportTimestamp } from '../../utils/accountFreshness.js';
import { getMobilePathForTab } from '../../constants/appRoutes.js';
import { useI18n } from '../../i18n/index.js';
import MobileAuthRequiredView from '../components/MobileAuthRequiredView.jsx';
import { localizeHistoryItemName, localizePoolName } from '../../utils/gameDataI18n.js';
import {
  isGameAccountSelectionMatch,
  localizeGameAccountServerTag,
} from '../../utils/gameAccountMetadata.js';
import {
  filterHistoryForEffectiveGameUid,
  resolveEffectiveGameUid,
} from '../../utils/accountScopeUtils.js';
import { useHorizontalWheelScroll } from '../../hooks/useHorizontalWheelScroll.js';

function getFreshnessToneClasses(tone) {
  switch (tone) {
    case 'fresh':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'notice':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'stale':
      return 'border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
    default:
      return 'border-zinc-200 bg-zinc-50 text-slate-500 dark:border-white/8 dark:bg-white/6 dark:text-zinc-400';
  }
}

function normalizePoolType(type) {
  if (type === 'extra') return 'extra';
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'beginner') return 'standard';
  return type || 'standard';
}

function isFreeHistoryPull(item) {
  return item?.isFree === true || item?.is_free === true;
}

function isGiftHistoryPull(item) {
  return item?.specialType === 'gift' || item?.special_type === 'gift';
}

function buildRecentSixStars({ history, poolTypeMap, poolNameMap, locale, t }) {
  const sortedHistory = [...history].sort((left, right) => {
    const timeDifference = new Date(left.timestamp || left.created_at || 0).getTime()
      - new Date(right.timestamp || right.created_at || 0).getTime();
    if (timeDifference !== 0) {
      return timeDifference;
    }
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
  const pityByType = { extra: 0, limited: 0, weapon: 0, standard: 0 };
  const result = [];

  sortedHistory.forEach((item) => {
    const poolId = item.poolId || item.pool_id;
    const bucket = poolTypeMap.get(poolId) || normalizePoolType(item.poolType || item.pool_type);
    const isFree = isFreeHistoryPull(item);
    const isGift = isGiftHistoryPull(item);
    if (!isFree && !isGift) {
      pityByType[bucket] = (pityByType[bucket] || 0) + 1;
    }

    if (Number(item.rarity) !== 6) {
      return;
    }

    result.push({
      id: item.id || `${poolId || 'unknown'}-${item.timestamp || item.created_at || 'time'}`,
      name: localizeHistoryItemName(item, { locale, fallback: t('common.unknown') }),
      isUp: !(item.isStandard ?? item.is_standard ?? false),
      pulls: item.pity
        ?? item.pity_count
        ?? item.pityCount
        ?? (isFree ? t('dashboard.timeline.badge.free', {}, '免费') : String(pityByType[bucket] || 0)),
      date: item.timestamp || item.created_at,
      pool: poolNameMap.get(poolId) || t('common.unknown'),
    });
    pityByType[bucket] = 0;
  });

  return result
    .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime())
    .slice(0, 6);
}

export default function MobileOverviewView() {
  const navigate = useNavigate();
  const recentSixStarsRef = useHorizontalWheelScroll();
  const user = useAuthStore((state) => state.user);
  const pools = usePoolStore((state) => state.pools);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const history = useHistoryStore((state) => state.history);
  const analysisAvailability = usePersonalAnalysisStore((state) => state.availability);
  const analysisScope = usePersonalAnalysisStore((state) => state.scope);
  const hasAnalysisSnapshot = ['ready', 'stale', 'empty'].includes(analysisAvailability);
  const { t, locale, formatDateTime } = useI18n();
  const userId = user?.id || null;
  const historyArray = useMemo(() => (Array.isArray(history) ? history : []), [history]);
  const accounts = usePersonalGameAccounts();
  const effectiveGameUid = useMemo(() => resolveEffectiveGameUid({
    currentGameUid,
    gameAccounts: accounts,
    historyRecords: historyArray,
  }), [accounts, currentGameUid, historyArray]);
  const filteredHistory = useMemo(() => {
    const ownedHistory = historyArray.filter((item) => !userId || item.user_id === userId);
    return filterHistoryForEffectiveGameUid(ownedHistory, effectiveGameUid);
  }, [effectiveGameUid, historyArray, userId]);
  const { currentStats: legacyCurrentStats } = useSummaryViewState({
    history: filteredHistory,
    pools,
    user,
    globalStats: null,
    fetchGlobalStats: null,
    variant: 'mobile',
    initialDataSource: 'local',
    lockedDataSource: 'local',
    initialPoolTypeFilter: 'all',
  });
  const isAnalysisScopeCurrent = analysisScope?.account?.accountKey === effectiveGameUid;
  const scopeOverviewStats = analysisScope?.dashboard?.views?.__group_all?.excludeFree?.stats || null;
  const currentStats = hasAnalysisSnapshot && isAnalysisScopeCurrent && scopeOverviewStats
    ? {
        ...scopeOverviewStats,
        sixStar: scopeOverviewStats.totalSixStar,
      }
    : hasAnalysisSnapshot
      ? null
      : legacyCurrentStats;
  const currentAccount = useMemo(() => (
    accounts.find((account) => isGameAccountSelectionMatch(account, effectiveGameUid))
    || accounts[0]
    || null
  ), [accounts, effectiveGameUid]);
  const poolNameMap = useMemo(
    () => new Map((Array.isArray(pools) ? pools : []).map((pool) => [pool.id, localizePoolName(pool, { locale })])),
    [locale, pools]
  );
  const poolTypeMap = useMemo(
    () => new Map((Array.isArray(pools) ? pools : []).map((pool) => [pool.id, normalizePoolType(pool.type)])),
    [pools]
  );
  const recentSixStars = useMemo(() => {
    if (
      hasAnalysisSnapshot
      && isAnalysisScopeCurrent
      && Array.isArray(analysisScope?.recentSixStars)
    ) {
      return analysisScope.recentSixStars.map((item) => ({
        id: item.id,
        name: item.name || t('common.unknown'),
        isUp: item.isStandard !== true,
        pulls: item.pity ?? '—',
        date: item.timestamp,
        pool: poolNameMap.get(item.poolId) || t('common.unknown'),
      }));
    }
    if (hasAnalysisSnapshot) {
      return [];
    }
    return buildRecentSixStars({
      history: filteredHistory,
      poolTypeMap,
      poolNameMap,
      locale,
      t,
    });
  }, [analysisScope, filteredHistory, hasAnalysisSnapshot, isAnalysisScopeCurrent, locale, poolNameMap, poolTypeMap, t]);
  const currentAccountLastImportAt = getAccountLastImportTimestamp(currentAccount);
  const accountTone = getFreshnessTone(currentAccountLastImportAt || currentAccount?.latestRecordAt);
  const totalSixStars = Number(currentStats?.counts?.['6'] || 0)
    + Number(currentStats?.counts?.['6_std'] || 0);

  if (!user) {
    return (
      <MobileAuthRequiredView
        animation="up"
        eyebrow={t('nav.overview')}
        title={t('nav.overview')}
        description={locale === 'en-US'
          ? 'Sign in to view your account snapshot and recent 6-star drops.'
          : '登录后查看账号快照和近期六星记录。'}
      />
    );
  }

  return (
    <div className="h-full flex-1 overflow-y-auto overflow-x-hidden px-4 pb-24 slide-up-enter">
      <header className="sticky top-0 z-20 -mx-4 mb-4 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-4 backdrop-blur-md dark:border-zinc-800/50 dark:bg-ef-dark/90">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-zinc-500">
            {t('pool.selector.accountStatus')}
          </p>
          <h1 className="text-xl font-black tracking-wider text-slate-900 dark:text-white">{t('nav.overview')}</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate(getMobilePathForTab('details'))}
          className="inline-flex min-h-11 items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          {locale === 'en-US' ? 'Analyze banner' : '查看卡池分析'}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </header>

      <section className="mobile-ux-card mb-4 px-4 py-3" aria-label={t('pool.selector.accountStatus')}>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900 dark:text-white">
              {currentAccount?.nickName || t('common.unknown')}
              <span className="ml-2 font-mono text-[10px] font-normal text-slate-500 dark:text-zinc-500">
                {currentAccount?.gameUid || '---'}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-slate-500 dark:text-zinc-500">
              {currentAccount?.serverTag
                ? localizeGameAccountServerTag(currentAccount.serverTag, locale)
                : t('common.unknown')}
              {' · '}
              {formatFreshnessAbsolute(currentAccountLastImportAt, t('common.unknown'), locale, { includeYear: false })}
            </div>
          </div>
          <span className={`shrink-0 border px-2 py-1 text-[10px] font-bold ${getFreshnessToneClasses(accountTone)}`}>
            {formatFreshnessRelative(
              currentAccountLastImportAt || currentAccount?.latestRecordAt,
              t('common.unknown'),
              locale
            )}
          </span>
        </div>
      </section>

      <section className="mb-4 grid grid-cols-2 gap-3" aria-label={t('nav.overview')}>
        <div className="mobile-ux-card relative overflow-hidden p-4">
          <Layers className="absolute -bottom-4 -right-4 h-20 w-20 text-slate-200/50 dark:text-zinc-800/50" aria-hidden="true" />
          <div className="relative">
            <div className="text-[10px] font-bold tracking-widest text-slate-500 dark:text-zinc-400">{t('summary.metric.totalPulls')}</div>
            <div className="mt-1 font-mono text-3xl font-black text-slate-900 dark:text-white">{currentStats?.total || 0}</div>
          </div>
        </div>
        <div className="mobile-ux-soft-card relative overflow-hidden border-amber-500/20 bg-amber-500/5 p-4 dark:border-ef-yellow/20 dark:bg-ef-yellow/5">
          <Star className="absolute -bottom-4 -right-4 h-20 w-20 text-amber-500/10" aria-hidden="true" />
          <div className="relative">
            <div className="text-[10px] font-bold tracking-widest text-amber-600/80 dark:text-ef-yellow/80">{t('summary.metric.totalSixStars')}</div>
            <div className="mt-1 font-mono text-3xl font-black text-amber-600 dark:text-ef-yellow">{totalSixStars}</div>
          </div>
        </div>
      </section>

      <section className="mobile-ux-card mb-6 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900 dark:text-white">
              {locale === 'en-US' ? 'Next: review the selected banner' : '下一步：查看当前卡池'}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-zinc-400">
              {locale === 'en-US'
                ? 'Pity, mechanics and detailed results are kept in Banner Details.'
                : '保底、机制和详细结果集中在“详情”，总览不再重复完整统计。'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(getMobilePathForTab('details'))}
            className="inline-flex min-h-11 shrink-0 items-center justify-center border border-amber-500 px-3 text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-endfield-yellow"
            aria-label={locale === 'en-US' ? 'Open banner details' : '打开卡池详情'}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="-mx-4 mb-4">
        <div className="mb-3 flex items-center justify-between px-4">
          <h2 className="text-sm font-bold tracking-widest text-slate-900 dark:text-white">{t('summary.recentSixStar.title')}</h2>
          <button
            type="button"
            onClick={() => navigate(getMobilePathForTab('details'))}
            className="inline-flex min-h-11 items-center gap-1 px-2 text-[10px] font-bold text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-ef-yellow"
          >
            {t('overview.action.viewAll')} <ChevronRight size={12} aria-hidden="true" />
          </button>
        </div>
        <div ref={recentSixStarsRef} className="flex snap-x gap-3 overflow-x-auto px-4 pb-4 scrollbar-hide">
          {recentSixStars.length > 0 ? recentSixStars.map((item) => (
            <article key={item.id} className="mobile-ux-card relative w-[140px] shrink-0 snap-start overflow-hidden border-l-4 border-l-orange-500 bg-orange-50/85 p-3 dark:bg-zinc-900/70">
              <div className="absolute -bottom-4 -right-4 text-6xl font-black italic text-orange-500/10" aria-hidden="true">{item.pulls}</div>
              <div className="relative mb-2 flex items-start justify-between gap-1">
                <span className={`px-1.5 py-0.5 text-[9px] font-bold ${item.isUp ? 'bg-orange-500 text-white' : 'bg-zinc-200 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                  {item.isUp ? t('dashboard.timeline.badge.up') : t('dashboard.timeline.badge.off')}
                </span>
                <span className="max-w-[70px] truncate bg-white/50 px-1 font-mono text-[9px] text-slate-500 dark:bg-black/50 dark:text-zinc-500">{item.pool}</span>
              </div>
              <div className="relative mb-1 truncate text-sm font-bold text-slate-900 dark:text-white">{item.name}</div>
              <div className="relative flex items-baseline gap-1">
                <span className="font-mono text-2xl font-black text-orange-600 dark:text-orange-400">{item.pulls}</span>
                <span className="text-[9px] text-slate-500 dark:text-zinc-500">{t('dashboard.unit.pull')}</span>
              </div>
              <div className="relative mt-1 text-[9px] text-slate-400 dark:text-zinc-600">
                {formatDateTime(item.date, { includeYear: false, month: 'numeric', day: 'numeric' }, t('common.unknown'))}
              </div>
            </article>
          )) : (
            <div className="w-full p-4 text-center text-xs italic text-slate-400 dark:text-zinc-500">{t('pool.selector.noRecords')}</div>
          )}
        </div>
      </section>
    </div>
  );
}
