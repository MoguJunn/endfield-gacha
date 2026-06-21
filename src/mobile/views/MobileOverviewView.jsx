import React, { useMemo } from 'react';
import { ArrowRight, BarChart3, ChevronRight, Layers, Sparkles, Star, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../stores/useAuthStore';
import usePoolStore from '../../stores/usePoolStore';
import useHistoryStore from '../../stores/useHistoryStore';
import { useSummaryViewState } from '../../hooks/summary';
import { useDashboardViewState } from '../../hooks';
import {
  formatFreshnessAbsolute,
  formatFreshnessRelative,
  getFreshnessTone
} from '../../utils/dataFreshness.js';
import { getAccountLastImportTimestamp } from '../../utils/accountFreshness.js';
import ResourceSummaryPanel from '../../components/resources/ResourceSummaryPanel.jsx';
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
  resolveEffectiveGameUid
} from '../../utils/accountScopeUtils.js';
import { useHorizontalWheelScroll } from '../../hooks/useHorizontalWheelScroll.js';

function getFreshnessToneClasses(tone) {
  switch (tone) {
    case 'fresh':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300';
    case 'notice':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-300';
    case 'stale':
      return 'border-rose-400/30 bg-rose-500/10 text-rose-300';
    default:
      return 'border-zinc-200 bg-zinc-50 text-slate-500 dark:border-white/8 dark:bg-white/6 dark:text-zinc-400';
  }
}

function RarityBars({ counts }) {
  const { t } = useI18n();
  const items = [
    { key: '6', label: t('summary.chart.sixLimited'), value: Number(counts?.[6] || counts?.['6'] || 0), tone: 'rainbow-progress' },
    { key: '6_std', label: t('summary.chart.sixStandard'), value: Number(counts?.['6_std'] || 0), tone: 'bg-rose-500' },
    { key: '5', label: t('summary.chart.fiveStar'), value: Number(counts?.[5] || counts?.['5'] || 0), tone: 'bg-yellow-500' },
    { key: '4', label: t('summary.chart.fourStar'), value: Number(counts?.[4] || counts?.['4'] || 0), tone: 'bg-violet-500' }
  ];
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="grid h-32 grid-cols-4 items-end gap-3">
      {items.map((item) => (
        <div key={item.key} className="flex flex-col items-center gap-2">
          <span className="tabular-nums text-[11px] font-bold text-slate-500 dark:text-zinc-400">{item.value}</span>
          <div className="flex h-20 w-full items-end overflow-hidden rounded-t-[1.1rem] border border-zinc-200 bg-zinc-100 dark:border-white/6 dark:bg-black/40">
            <div
              className={`w-full rounded-t-[1.1rem] ${item.tone}`}
              style={{ height: `${Math.max(10, (item.value / max) * 100)}%` }}
            />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-500">{item.label}</span>
        </div>
      ))}
    </div>
  );
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

function MobileOverviewView() {
  const navigate = useNavigate();
  const recentSixStarsRef = useHorizontalWheelScroll();
  const user = useAuthStore((state) => state.user);
  const pools = usePoolStore((state) => state.pools);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const history = useHistoryStore((state) => state.history);
  const getGameAccountsFromHistory = useHistoryStore((state) => state.getGameAccountsFromHistory);
  const { t, locale, formatDateTime } = useI18n();
  const userId = user?.id || null;
  const historyArray = useMemo(() => (Array.isArray(history) ? history : []), [history]);
  const accounts = useMemo(() => {
    void history;
    return getGameAccountsFromHistory();
  }, [getGameAccountsFromHistory, history]);
  const effectiveGameUid = useMemo(() => resolveEffectiveGameUid({
    currentGameUid,
    gameAccounts: accounts,
    historyRecords: historyArray
  }), [accounts, currentGameUid, historyArray]);
  const filteredHistory = useMemo(() => {
    const ownedHistory = historyArray.filter((item) => {
      if (userId && item.user_id !== userId) {
        return false;
      }

      return true;
    });

    return filterHistoryForEffectiveGameUid(ownedHistory, effectiveGameUid);
  }, [effectiveGameUid, historyArray, userId]);
  const {
    currentStats,
    ranking
  } = useSummaryViewState({
    history: filteredHistory,
    pools,
    user,
    globalStats: null,
    fetchGlobalStats: null,
    variant: 'mobile',
    initialDataSource: 'local',
    lockedDataSource: 'local',
    initialPoolTypeFilter: 'all'
  });
  const {
    stats,
    effectivePity,
    isLimited,
    isWeapon
  } = useDashboardViewState();

  const currentAccount = useMemo(() => {
    if (effectiveGameUid) {
      return accounts.find((account) => isGameAccountSelectionMatch(account, effectiveGameUid)) || null;
    }

    return accounts[0] || null;
  }, [accounts, effectiveGameUid]);

  const poolNameMap = useMemo(
    () => new Map((Array.isArray(pools) ? pools : []).map((pool) => [pool.id, localizePoolName(pool, { locale })])),
    [locale, pools]
  );
  const poolTypeMap = useMemo(() => new Map((Array.isArray(pools) ? pools : []).map((pool) => [pool.id, normalizePoolType(pool.type)])), [pools]);
  const recentSixStars = useMemo(() => {
      const sorted = [...filteredHistory].sort((left, right) => {
        const leftTime = new Date(left.timestamp || left.created_at || 0).getTime();
        const rightTime = new Date(right.timestamp || right.created_at || 0).getTime();
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }

        return Number(left.id || 0) - Number(right.id || 0);
      });
      const counters = {
        extra: 0,
        limited: 0,
        weapon: 0,
        standard: 0
      };
      const result = [];

      sorted.forEach((item) => {
        const poolId = item.poolId || item.pool_id;
        const bucket = poolTypeMap.get(poolId) || normalizePoolType(item.poolType || item.pool_type);
        const isFree = isFreeHistoryPull(item);
        const isGift = isGiftHistoryPull(item);
        const isStandard = item.isStandard ?? item.is_standard ?? false;

        if (!isFree && !isGift) {
          counters[bucket] = (counters[bucket] || 0) + 1;
        }

        if (Number(item.rarity) === 6) {
          result.push({
            id: item.id || `${poolId || 'unknown'}-${item.timestamp || item.created_at || 'time'}`,
            name: localizeHistoryItemName(item, { locale, fallback: t('common.unknown') }),
            isUp: !isStandard,
            pulls:
              item.pity
              ?? item.pity_count
              ?? item.pityCount
              ?? item.draw_count
              ?? item.drawCount
              ?? item.pull_count
              ?? item.pullCount
              ?? item.pull_index
              ?? item.pullIndex
              ?? (isFree ? t('dashboard.timeline.badge.free', {}, '免费') : String(counters[bucket] || 0)),
            date: item.timestamp || item.created_at,
            pool: poolNameMap.get(poolId) || t('common.unknown')
          });
          counters[bucket] = 0;
        }
      });

      return result
        .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime())
        .slice(0, 6);
  }, [filteredHistory, locale, poolNameMap, poolTypeMap, t]);

  const limitedRanking = ranking?.limited || {};
  const limitedStats = currentStats?.byType?.limited || {};
  const upHits = limitedRanking.sixStarUpExcludingFree ?? limitedRanking.sixStarUpCount ?? limitedStats.limitedSix ?? 0;
  const offStandardHits = limitedRanking.sixStarOffStandardExcludingFree ?? limitedRanking.sixStarOffStandardCount ?? limitedStats.counts?.['6_std'] ?? 0;
  const offLimitedHits = limitedRanking.sixStarOffLimitedExcludingFree ?? limitedRanking.sixStarOffLimitedCount ?? 0;
  const sparkCount = limitedRanking.sparkCount ?? limitedStats.sparkCount ?? limitedStats.pityList?.filter((item) => item.isSpark).length ?? 0;
  const limitedTotalSix = Number(upHits) + Number(offStandardHits) + Number(offLimitedHits);
  const onRate = limitedTotalSix > 0 ? `${((Number(upHits) / limitedTotalSix) * 100).toFixed(1)}%` : '0.0%';
  const averageSixValue = useMemo(() => {
    const characterPool = currentStats?.byType?.character || null;
    if (!characterPool) {
      return null;
    }

    const avgExcludingFree = Number(characterPool.avgPityExcludingFree);
    if (Number.isFinite(avgExcludingFree) && avgExcludingFree > 0) {
      return avgExcludingFree;
    }

    const avgPity = Number(characterPool.avgPity);
    return Number.isFinite(avgPity) && avgPity > 0 ? avgPity : null;
  }, [currentStats]);
  const averageUpValue = useMemo(() => {
    const rawValue = currentStats?.byType?.character?.avgPityUp ?? currentStats?.byType?.limited?.avgPityUp;
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }, [currentStats]);
  const displayPity = isLimited ? effectivePity?.pity6 : stats?.currentPity;
  const pityLimit = isWeapon ? 40 : 80;
  const pityProgress = Math.min(100, Math.max(0, ((Number(displayPity) || 0) / pityLimit) * 100));
  const currentAccountLastImportAt = getAccountLastImportTimestamp(currentAccount);
  const accountTone = getFreshnessTone(currentAccountLastImportAt || currentAccount?.latestRecordAt);

  if (!user) {
    return (
      <MobileAuthRequiredView
        animation="up"
        eyebrow={t('nav.overview')}
        title={t('nav.overview')}
        description={locale === 'en-US'
          ? 'Sign in to load your account overview, rarity breakdown, and recent 6-star drops.'
          : '登录后才能加载个人总览、稀有度分布和近期六星记录。'}
      />
    );
  }

  return (
    <div className="flex-1 h-full overflow-y-auto overflow-x-hidden px-4 pb-20 slide-up-enter scroll-smooth w-full">
        {/* Header */}
        <div className="py-6 flex justify-between items-center sticky top-0 bg-white/90 dark:bg-ef-dark/90 backdrop-blur-md z-20 border-b border-zinc-200 dark:border-zinc-800/50 -mx-4 px-4 mb-4">
            <h1 className="text-2xl font-black tracking-widest text-slate-900 dark:text-white">{t('nav.overview')}</h1>
            <div className="flex gap-2">
                <button onClick={() => navigate(getMobilePathForTab('details'))} className="h-9 px-3 rounded-md bg-white/80 dark:bg-zinc-900/70 backdrop-blur-xl border border-zinc-200 dark:border-white/5 shadow-sm flex items-center justify-center text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:text-white transition-colors text-xs font-bold gap-1 border-zinc-300 dark:border-zinc-700">
                    <Upload size={14} /> {t('overview.action.import')}
                </button>
            </div>
        </div>

        <div className="mobile-ux-card p-4 mb-4 relative overflow-hidden mt-4 mx-[-0.5rem]">
            <div className="flex justify-between items-start mb-2">
                <div className="text-[10px] font-bold tracking-widest text-slate-500 dark:text-zinc-500 uppercase flex items-center gap-2">
                    {t('pool.selector.accountStatus')}
                    {currentAccount?.serverTag && <span className="bg-zinc-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 px-1 py-0.5 rounded-sm text-[8px]">{localizeGameAccountServerTag(currentAccount.serverTag, locale)}</span>}
                </div>
                <button className={`flex items-center gap-1.5 px-2 py-1 border rounded-[0.9rem] text-[10px] font-bold transition-colors ${getFreshnessToneClasses(accountTone)}`}>
                    {formatFreshnessRelative(currentAccountLastImportAt || currentAccount?.latestRecordAt, t('common.unknown'), locale)}
                </button>
            </div>
            <div className="text-lg font-black text-slate-900 dark:text-white truncate mb-3">{currentAccount?.nickName || t('common.unknown')} <span className="text-xs font-mono text-slate-500 dark:text-zinc-500 font-normal ml-1">· {currentAccount?.gameUid || '---'}</span></div>

            <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 dark:border-zinc-800/50 pt-3">
                <div>
                    <div className="text-[9px] text-slate-500 dark:text-zinc-500 mb-1">{t('settings.lastImport', { value: '' }).replace('：', '').trim()}</div>
                    <div className="text-xs font-mono text-slate-700 dark:text-zinc-300">{formatFreshnessAbsolute(currentAccountLastImportAt, t('common.unknown'), locale, { includeYear: false })}</div>
                </div>
                <div>
                    <div className="text-[9px] text-slate-500 dark:text-zinc-500 mb-1">{t('pool.selector.meta.latestRecord', { value: '' }).replace('：', '').trim()}</div>
                    <div className="text-xs font-mono text-slate-700 dark:text-zinc-300">{formatFreshnessAbsolute(currentAccount?.latestRecordAt, t('common.unknown'), locale, { includeYear: false })}</div>
                </div>
            </div>
        </div>

        <div className="px-0 sm:px-4">
            {/* Top Key Metrics */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="mobile-ux-card p-4 relative overflow-hidden group">
                    <div className="absolute -right-4 -bottom-4 text-slate-200 dark:text-zinc-800 opacity-50"><Layers size={80}/></div>
                    <div className="relative z-10">
                        <div className="text-slate-500 dark:text-zinc-400 text-[10px] font-bold tracking-widest mb-1">{t('summary.metric.totalPulls')}</div>
                        <div className="text-3xl font-black text-slate-900 dark:text-white font-mono tracking-tighter">{currentStats?.total || 0}</div>
                    </div>
                </div>
                <div className="mobile-ux-soft-card p-4 relative overflow-hidden group border-amber-500/20 bg-amber-500/5 dark:border-ef-yellow/20 dark:bg-ef-yellow/5">
                    <div className="absolute -right-4 -bottom-4 text-amber-500/10 dark:text-ef-yellow opacity-10"><Star size={80}/></div>
                    <div className="relative z-10">
                        <div className="text-amber-600/80 dark:text-ef-yellow/80 text-[10px] font-bold tracking-widest mb-1">{t('summary.metric.totalSixStars')}</div>
                        <div className="text-3xl font-black text-amber-600 dark:text-ef-yellow font-mono tracking-tighter">{(currentStats?.counts?.['6'] || 0) + (currentStats?.counts?.['6_std'] || 0)}</div>
                    </div>
                </div>
            </div>

            {/* Rarity Breakdown */}
            <div className="mobile-ux-card p-4 mb-4">
                <div className="text-[10px] font-bold tracking-widest text-slate-500 dark:text-zinc-500 mb-3 uppercase">{t('summary.chart.rarityDistribution')}</div>
                <RarityBars counts={currentStats?.counts} />
            </div>

            {/* Pity & Average Grid */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="mobile-ux-card p-4 flex flex-col justify-between">
                    <div>
                        <div className="text-slate-500 dark:text-zinc-500 text-[10px] font-bold tracking-widest mb-1">{t('summary.chart.avgSix')}</div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">{averageSixValue === null ? '-' : averageSixValue.toFixed(1)}</span>
                            <span className="text-[10px] text-slate-500 dark:text-zinc-500">{t('overview.unit.pullsPerItem')}</span>
                        </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800/50">
                        <div className="text-slate-500 dark:text-zinc-500 text-[10px] font-bold tracking-widest mb-1">{t('summary.chart.avgUp')}</div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-lg font-black text-orange-600 dark:text-orange-400 font-mono">{averageUpValue === null ? '-' : averageUpValue.toFixed(1)}</span>
                            <span className="text-[9px] text-slate-500 dark:text-zinc-500">{t('overview.unit.pullsPerUp')}</span>
                        </div>
                    </div>
                </div>
                <div className="mobile-ux-card p-4 flex flex-col justify-between">
                    <div>
                        <div className="text-slate-500 dark:text-zinc-500 text-[10px] font-bold tracking-widest mb-1 flex items-center justify-between">
                            {t('overview.overallPity')}
                            <span className="bg-zinc-200 dark:bg-zinc-800 px-1 rounded text-[8px] text-slate-600 dark:text-zinc-400">ALL</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-black text-amber-600 dark:text-ef-yellow font-mono">{displayPity || 0}</span>
                            <span className="text-[10px] text-slate-500 dark:text-zinc-500">/ {pityLimit}</span>
                        </div>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full mt-2 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-yellow-500 to-amber-400 dark:from-yellow-600 dark:to-ef-yellow" style={{ width: `${pityProgress}%` }}></div>
                    </div>
                    <div className="text-[9px] text-slate-600 dark:text-zinc-400 mt-2">
                      {t('overview.pityDistance')} <span className="text-slate-900 dark:text-white font-bold">{t('common.unit.pulls', { count: Math.max(0, pityLimit - (displayPity || 0)) })}</span>
                    </div>
                </div>
            </div>

            {/* Local Stats for Character & Weapon Pools */}
            <div className="mobile-ux-card p-4 mb-4">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-200 dark:border-zinc-800 border-dashed">
                    <Star size={14} className="text-amber-500" />
                    <h4 className="font-bold text-[11px] text-slate-700 dark:text-zinc-300 uppercase tracking-wide">{t('summary.ranking.limitedUpSix')} {t('nav.summary')}</h4>
                    <span className="mobile-ux-card-chip text-[8px] text-slate-600 dark:text-zinc-400 px-1.5 py-0.5 ml-auto">{t('overview.localData')}</span>
                </div>

                <div className="grid grid-cols-2 gap-y-4 gap-x-3">
                    <div className="space-y-0.5">
                        <div className="text-slate-600 dark:text-zinc-400 text-[9px] uppercase font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> {t('summary.metric.limitedUpSix')}
                        </div>
                        <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-500">{upHits}</div>
                        <div className="text-[8px] text-slate-500 dark:text-zinc-500 font-mono">{t('summary.metric.limitedUpSixHint')}</div>
                    </div>
                    <div className="space-y-0.5">
                        <div className="text-slate-600 dark:text-zinc-400 text-[9px] uppercase font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span> {t('summary.metric.offStandardSix')}
                        </div>
                        <div className="text-lg font-bold font-mono text-rose-600 dark:text-rose-500">{offStandardHits}</div>
                        <div className="text-[8px] text-slate-500 dark:text-zinc-500 font-mono">{t('summary.metric.offStandardSixHint')}</div>
                    </div>
                    <div className="space-y-0.5">
                        <div className="text-slate-600 dark:text-zinc-400 text-[9px] uppercase font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span> {t('summary.metric.offLimitedSix')}
                        </div>
                        <div className="text-lg font-bold font-mono text-orange-600 dark:text-orange-500">{offLimitedHits}</div>
                        <div className="text-[8px] text-slate-500 dark:text-zinc-500 font-mono">{t('summary.metric.offLimitedSixHint')}</div>
                    </div>
                    <div className="space-y-0.5">
                        <div className="text-slate-600 dark:text-zinc-400 text-[9px] uppercase font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> {t('summary.metric.sparkCount')}
                        </div>
                        <div className="text-lg font-bold font-mono text-red-500">{sparkCount}</div>
                        <div className="text-[8px] text-slate-500 dark:text-zinc-500 font-mono">{t('summary.metric.sparkCountHint')}</div>
                    </div>
                    <div className="space-y-0.5">
                        <div className="text-slate-600 dark:text-zinc-400 text-[9px] uppercase font-bold">{t('summary.metric.winRate')}</div>
                        <div className="text-lg font-bold font-mono text-indigo-600 dark:text-indigo-500">{onRate}</div>
                        <div className="text-[8px] text-slate-500 dark:text-zinc-500 font-mono">{t('summary.metric.winRateHint')}</div>
                    </div>
                </div>
            </div>

            {/* Recent 6 Stars */}
            <div className="mb-4 mt-6 mx-[-1rem]">
                <div className="flex justify-between items-center mb-3 px-4">
                    <h3 className="text-sm font-bold tracking-widest text-slate-900 dark:text-white">{t('summary.recentSixStar.title')}</h3>
                    <button onClick={() => navigate(getMobilePathForTab('details'))} className="text-[10px] text-amber-600 dark:text-ef-yellow flex items-center gap-1">
                      {t('overview.action.viewAll')} <ChevronRight size={12}/>
                    </button>
                </div>
                <div
                  ref={recentSixStarsRef}
                  className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x px-4"
                >
                    {recentSixStars.length > 0 ? recentSixStars.map((item) => (
                        <div key={item.id} className="mobile-ux-card snap-start shrink-0 w-[140px] p-3 border-l-4 border-l-orange-500 relative overflow-hidden bg-orange-50/85 dark:bg-zinc-900/70">
                            <div className="absolute -right-4 -bottom-4 text-6xl font-black text-orange-500/10 italic">{item.pulls}</div>
                            <div className="flex justify-between items-start mb-2 relative z-10">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${item.isUp ? 'bg-orange-500 text-white' : 'bg-zinc-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400'}`}>{item.isUp ? t('dashboard.timeline.badge.up') : t('dashboard.timeline.badge.off')}</span>
                                <span className="text-[9px] text-slate-500 dark:text-zinc-500 font-mono bg-white/50 dark:bg-black/50 px-1 rounded truncate max-w-[70px]">{item.pool}</span>
                            </div>
                            <div className="font-bold text-sm text-slate-900 dark:text-white truncate mb-1 relative z-10">{item.name}</div>
                            <div className="flex items-baseline gap-1 relative z-10">
                                <span className="text-2xl font-black font-mono text-orange-600 dark:text-orange-400">{item.pulls}</span>
                                <span className="text-[9px] text-slate-500 dark:text-zinc-500">{t('dashboard.unit.pull')}</span>
                            </div>
                            <div className="text-[9px] text-slate-400 dark:text-zinc-600 mt-1 relative z-10">{formatDateTime(item.date, { includeYear: false, month: 'numeric', day: 'numeric' }, t('common.unknown'))}</div>
                        </div>
                    )) : (
                        <div className="text-xs text-slate-400 dark:text-zinc-500 italic p-4 text-center">{t('pool.selector.noRecords')}</div>
                    )}
                </div>
            </div>
        </div>
    </div>
  );
}

export default MobileOverviewView;
