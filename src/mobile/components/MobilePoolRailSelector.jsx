import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Layers, Search, SlidersHorizontal, Star, Swords, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { POOL_GROUP_PREFIX, isPoolGroupId } from '../../stores/usePoolStore';
import ImportManager from '../../features/import/ImportManager';
import { getImportAnomalyCount } from '../../features/import/importCompletionPolicy.js';
import { getMobilePathForTab } from '../../constants/appRoutes';
import { useI18n } from '../../i18n/index.js';
import {
  getPoolSelectorFeaturedCharacters,
  getPoolTypeLabel,
  shouldShowPoolFeaturedSummary
} from '../../utils/poolSelectorDisplay';
import { getPreferredPool } from '../../utils/poolSelectionUtils';
import { formatFreshnessRelative, getFreshnessTone, getLatestHistoryTimestampMs } from '../../utils/dataFreshness.js';
import { MobileGlassPanel } from './ux/MobilePrimitives.jsx';
import { localizeEntityName, localizePoolName } from '../../utils/gameDataI18n.js';
import { usePoolScopeSelectorState } from '../../hooks/app/usePoolScopeSelectorState.js';

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

function toneClass(tone) {
  switch (tone) {
    case 'fresh': return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'notice': return 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'stale': return 'border-red-400/30 bg-red-500/10 text-red-700 dark:text-red-300';
    default: return 'border-zinc-200 bg-zinc-100 text-slate-500 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-400';
  }
}

function getPoolTypeConfig(pool) {
  const type = pool?.type === 'extra'
    ? 'extra'
    : pool?.type === 'limited_character'
      ? 'limited'
      : pool?.type === 'limited_weapon'
        ? 'weapon'
        : pool?.type || 'standard';
  if (type === 'weapon') return { icon: Swords, accent: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-400/25 dark:bg-slate-400/8 dark:text-slate-200' };
  if (type === 'extra') return { icon: Star, accent: 'border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-400/25 dark:bg-cyan-400/8 dark:text-cyan-300' };
  if (type === 'limited') return { icon: Star, accent: 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-400/25 dark:bg-orange-400/8 dark:text-orange-300' };
  return { icon: Layers, accent: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/8 dark:text-amber-300' };
}

export default function MobilePoolRailSelector() {
  const { t, locale, formatNumber } = useI18n();
  const navigate = useNavigate();
  const [showImportManager, setShowImportManager] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hideZeroPullPools, setHideZeroPullPools] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showPoolMenu, setShowPoolMenu] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [expandedOldPoolGroups, setExpandedOldPoolGroups] = useState({});
  const poolMenuRef = React.useRef(null);
  const {
    user,
    pools,
    currentPoolId,
    switchPool,
    switchToPoolGroup,
    filteredHistory,
    poolPullCounts,
    zeroPullPoolCount,
    selectorPools,
    groupedPools,
    totalPulls,
    showOverviewOptions,
  } = usePoolScopeSelectorState({
    locale,
    searchQuery,
    hideZeroPullPools,
  });
  const selectedPool = useMemo(() => {
    if (isPoolGroupId(currentPoolId)) {
      const groupType = currentPoolId.slice(POOL_GROUP_PREFIX.length);
      return { id: currentPoolId, name: groupType === 'all' ? t('pool.selector.allOverview') : t('pool.card.allGroupTitle', { label: getPoolTypeLabel(groupType, locale) }), isGroupMode: true, type: groupType };
    }
    const preferredPool = getPreferredPool(pools, { preferredPoolId: currentPoolId, includeDefaultPool: true });
    return preferredPool
      ? {
          ...preferredPool,
          displayName: preferredPool.displayName || localizePoolName(preferredPool, { locale })
        }
      : preferredPool;
  }, [currentPoolId, locale, pools, t]);
  const allOverviewId = `${POOL_GROUP_PREFIX}all`;
  const currentViewLatestRecordAt = useMemo(() => {
    const timestamp = getLatestHistoryTimestampMs(filteredHistory);
    return timestamp ? new Date(timestamp).toISOString() : null;
  }, [filteredHistory]);
  const currentPoolLatestRecordAt = useMemo(() => {
    if (!currentPoolId || isPoolGroupId(currentPoolId)) return currentViewLatestRecordAt;
    const timestamp = getLatestHistoryTimestampMs(filteredHistory.filter((item) => (item.poolId || item.pool_id) === currentPoolId));
    return timestamp ? new Date(timestamp).toISOString() : null;
  }, [currentPoolId, currentViewLatestRecordAt, filteredHistory]);
  const railItems = useMemo(() => {
    const items = [];
    if (showOverviewOptions) items.push({ id: allOverviewId, kind: 'overview', name: t('pool.selector.allOverview'), meta: t('pool.card.groupStats', { pools: formatNumber(selectorPools.length), pulls: formatNumber(totalPulls) }), pulls: totalPulls });
    groupedPools.forEach((group) => {
      if (showOverviewOptions && group.pools.length > 1) {
        items.push({ id: `${POOL_GROUP_PREFIX}${group.type}`, kind: 'group', groupType: group.type, name: t('pool.card.allGroupTitle', { label: group.label }), meta: t('pool.card.groupStats', { pools: formatNumber(group.pools.length), pulls: formatNumber(group.pools.reduce((sum, pool) => sum + (poolPullCounts[pool.id] || 0), 0)) }), pulls: group.pools.reduce((sum, pool) => sum + (poolPullCounts[pool.id] || 0), 0), type: group.type });
      }
      group.pools.forEach((pool) => items.push({
        id: pool.id,
        kind: 'pool',
        name: pool.displayName || pool.name,
        meta: shouldShowPoolFeaturedSummary(pool)
          ? pool.displayUpCharacter || getPoolSelectorFeaturedCharacters(pool, { locale }).join(' / ') || localizeEntityName(pool.up_character || pool.upCharacter || '', { locale }) || t('pool.card.overviewDesc')
          : t('pool.card.overviewDesc'),
        pulls: poolPullCounts[pool.id] || 0,
        pool,
      }));
    });
    return items;
  }, [allOverviewId, formatNumber, groupedPools, locale, poolPullCounts, selectorPools.length, showOverviewOptions, t, totalPulls]);
  const selectedPullCount = useMemo(() => {
    if (currentPoolId === allOverviewId) {
      return totalPulls;
    }

    if (isPoolGroupId(currentPoolId)) {
      const groupType = currentPoolId.slice(POOL_GROUP_PREFIX.length);
      const targetGroup = groupedPools.find((group) => group.type === groupType);
      return targetGroup?.totalPulls || 0;
    }

    return poolPullCounts[currentPoolId] || 0;
  }, [allOverviewId, currentPoolId, groupedPools, poolPullCounts, totalPulls]);

  useEffect(() => {
    if (!showPoolMenu) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (poolMenuRef.current && !poolMenuRef.current.contains(event.target)) {
        setShowPoolMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [showPoolMenu]);

  const selectedConfig = selectedPool && !selectedPool.isGroupMode ? getPoolTypeConfig(selectedPool) : { icon: Layers, accent: 'border-zinc-200 bg-zinc-100 text-slate-600 dark:border-white/8 dark:bg-white/[0.04] dark:text-zinc-300' };
  const SelectedIcon = selectedConfig.icon;

  const handleSelectItem = (item) => {
    if (item.kind === 'overview') {
      switchToPoolGroup('all');
    } else if (item.kind === 'group') {
      switchToPoolGroup(item.groupType);
    } else {
      switchPool(item.id);
    }

    setShowPoolMenu(false);
  };
  const toggleGroup = (groupType) => {
    setExpandedGroups((prev) => ({ ...prev, [groupType]: prev[groupType] === false }));
  };
  const getGroupHeaderConfig = (groupType) => {
    if (groupType === 'weapon_limited' || groupType === 'weapon_standard') {
      return { icon: Swords, accent: 'text-slate-700 dark:text-slate-200' };
    }
    if (groupType === 'extra') {
      return { icon: Star, accent: 'text-cyan-700 dark:text-cyan-300' };
    }
    if (groupType === 'limited') {
      return { icon: Star, accent: 'text-orange-700 dark:text-orange-300' };
    }
    return { icon: Layers, accent: 'text-amber-700 dark:text-amber-300' };
  };

  return (
    <div className="space-y-1.5 overflow-visible">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {user ? (
            <button
              type="button"
              onClick={() => setShowImportManager(true)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded border border-zinc-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-white"
            >
              <Upload size={14} />
              {t('pool.selector.import')}
            </button>
          ) : (
            <div className="text-[10px] font-mono text-zinc-500">{t('pool.selector.loginToImport')}</div>
          )}
          {(zeroPullPoolCount > 0 || pools.length > 5) ? (
            <button
              type="button"
              onClick={() => setShowFilters((value) => !value)}
              className={cx(
                'inline-flex h-8 items-center justify-center gap-1 rounded border px-3 text-xs font-bold transition-colors',
                showFilters
                  ? 'border-endfield-yellow/30 bg-endfield-yellow/10 text-endfield-yellow'
                  : 'border-zinc-200 bg-white text-slate-700 hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-white'
              )}
            >
              <SlidersHorizontal size={13} />
              {t('pool.selector.filterShort', {}, '筛选')}
              <ChevronDown size={12} className={showFilters ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
          ) : null}
        </div>
        <div className="text-[10px] font-mono text-slate-500 dark:text-zinc-500">
          <span className="text-slate-900 dark:text-white">{formatNumber(selectorPools.length)}</span>
          {selectorPools.length !== pools.length ? <span>/{formatNumber(pools.length)}</span> : null}
          <span> {t('pool.selector.poolCountShort', {}, '池')} / </span>
          <span className="text-slate-900 dark:text-white">{formatNumber(totalPulls)}</span>
          <span> {t('dashboard.unit.pull')}</span>
        </div>
      </div>

      {currentPoolLatestRecordAt ? (
        <div className="grid gap-2 text-[10px]">
          <div className="mobile-ux-card-inset flex min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-slate-700 dark:text-zinc-300">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-500">{t('pool.selector.currentFilter')}</div>
              <div className="mt-0.5 truncate text-[11px] font-bold text-slate-900 dark:text-white">
                {selectedPool?.displayName || selectedPool?.name || t('common.unknown')}
              </div>
            </div>
            <span className={cx('shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]', toneClass(getFreshnessTone(currentPoolLatestRecordAt)))}>
              {formatFreshnessRelative(currentPoolLatestRecordAt, t('pool.selector.noRecords'), locale)}
            </span>
          </div>
        </div>
      ) : null}

      {showFilters && (zeroPullPoolCount > 0 || pools.length > 5) ? (
        <MobileGlassPanel compact className="space-y-2 border-zinc-200 bg-white/90 dark:border-zinc-800 dark:bg-zinc-950/70">
          <div className="flex items-center gap-2">
            {zeroPullPoolCount > 0 ? <button type="button" onClick={() => setHideZeroPullPools((value) => !value)} className={cx('rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em]', hideZeroPullPools ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-zinc-200 bg-zinc-100 text-slate-500 dark:border-white/8 dark:bg-white/6 dark:text-zinc-400')}>{hideZeroPullPools ? t('pool.selector.hideZeroLabel') : t('pool.selector.showZeroLabel')}</button> : null}
            {pools.length > 5 ? <div className="relative flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('pool.selector.searchPlaceholder')} className="mobile-ux-input py-2 pl-9 pr-9 text-xs font-mono" />{searchQuery ? <button type="button" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400"><X size={14} /></button> : null}</div> : null}
          </div>
        </MobileGlassPanel>
      ) : null}

      {pools.length === 0 ? <div className="rounded-[1rem] border border-dashed border-zinc-200 bg-white/80 py-4 text-center text-sm font-mono text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-500">{user ? t('pool.selector.noPoolDataImport') : t('pool.selector.noPoolData')}</div> : railItems.length === 0 ? <div className="rounded-[1rem] border border-dashed border-zinc-200 bg-white/80 py-4 text-center text-sm font-mono text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-500">{searchQuery ? t('pool.selector.noMatches') : t('pool.selector.noBanners')}</div> : (
        <div className="relative mt-0.5" ref={poolMenuRef}>
          <button
            type="button"
            onClick={() => setShowPoolMenu((value) => !value)}
            className={cx(
              'mobile-ux-card flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors',
              showPoolMenu
                ? 'border-endfield-yellow/40 bg-endfield-yellow/10'
                : 'hover:border-zinc-300'
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className={cx('shrink-0 rounded-md border p-2', selectedPool?.isGroupMode ? 'border-zinc-200 bg-zinc-100 text-slate-600 dark:border-white/8 dark:bg-white/6 dark:text-zinc-300' : selectedConfig.accent)}>
                <SelectedIcon size={14} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                  {selectedPool?.displayName || selectedPool?.name || t('pool.selector.selectPool')}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500 dark:text-zinc-500">
                  <span className="truncate">{shouldShowPoolFeaturedSummary(selectedPool) ? selectedPool?.displayUpCharacter || getPoolSelectorFeaturedCharacters(selectedPool, { locale }).join(' / ') || localizeEntityName(selectedPool?.up_character || selectedPool?.upCharacter || '', { locale }) || (selectedPool?.isGroupMode ? t('pool.card.groupStats', { pools: formatNumber(selectorPools.length), pulls: formatNumber(totalPulls) }) : t('pool.card.overviewDesc')) : (selectedPool?.isGroupMode ? t('pool.card.groupStats', { pools: formatNumber(selectorPools.length), pulls: formatNumber(totalPulls) }) : t('pool.card.overviewDesc'))}</span>
                  <span className="shrink-0 font-mono text-slate-700 dark:text-zinc-300">
                    {formatNumber(selectedPullCount)} {t('dashboard.unit.pull')}
                  </span>
                </div>
              </div>
            </div>
            <ChevronDown size={16} className={cx('shrink-0 text-slate-500 transition-transform dark:text-zinc-400', showPoolMenu && 'rotate-180')} />
          </button>

          {showPoolMenu ? (
            <div className="mobile-ux-dropdown absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 max-h-[min(60vh,28rem)] overflow-y-auto p-2">
              <div className="space-y-2">
                {showOverviewOptions ? (
                  <button
                    type="button"
                    onClick={() => handleSelectItem({ id: allOverviewId, kind: 'overview' })}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      currentPoolId === allOverviewId
                        ? 'border-endfield-yellow/35 bg-endfield-yellow/10'
                        : 'border-transparent bg-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/70'
                    )}
                  >
                    <div className="shrink-0 rounded-md border border-zinc-200 bg-zinc-100 p-1.5 text-slate-600 dark:border-white/8 dark:bg-white/6 dark:text-zinc-300">
                      <Layers size={12} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cx('truncate text-sm font-bold', currentPoolId === allOverviewId ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-zinc-200')}>
                        {t('pool.selector.allOverview')}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500 dark:text-zinc-500">
                        <span className="truncate">{t('pool.card.groupStats', { pools: formatNumber(selectorPools.length), pulls: formatNumber(totalPulls) })}</span>
                        <span className="shrink-0 font-mono">{formatNumber(totalPulls)} {t('dashboard.unit.pull')}</span>
                      </div>
                    </div>
                    {currentPoolId === allOverviewId ? <Check size={14} className="shrink-0 text-endfield-yellow" /> : null}
                  </button>
                ) : null}

                {groupedPools.map((group) => {
                  const groupId = `${POOL_GROUP_PREFIX}${group.type}`;
                  const groupSelected = currentPoolId === groupId;
                  const groupExpanded = group.disableCollapse ? true : expandedGroups[group.type] !== false;
                  const versionFoldEnabled = group.versionFold?.enabled === true && !group.disableCollapse;
                  const directPools = versionFoldEnabled ? group.versionFold.directPools : group.pools;
                  const foldedPools = versionFoldEnabled ? group.versionFold.foldedPools : [];
                  const selectedOldPool = foldedPools.some((pool) => pool.id === currentPoolId);
                  const oldPoolsExpanded = selectedOldPool || expandedOldPoolGroups[group.type] === true;
                  const displayedPools = oldPoolsExpanded
                    ? [...directPools, ...foldedPools]
                    : directPools;
                  const headerConfig = getGroupHeaderConfig(group.type);
                  const HeaderIcon = headerConfig.icon;

                  return (
                    <div key={group.type} className="mobile-ux-card-inset overflow-hidden">
                      <button
                        type="button"
                        onClick={() => (group.disableCollapse ? undefined : toggleGroup(group.type))}
                        className="flex w-full items-center justify-between gap-3 bg-zinc-50/80 px-3 py-2.5 text-left dark:bg-zinc-900/40"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <HeaderIcon size={13} className={headerConfig.accent} />
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-zinc-200">
                              {group.label}
                            </div>
                            <div className="mt-0.5 text-[10px] font-mono text-slate-500 dark:text-zinc-500">
                              {t('pool.card.groupStats', { pools: formatNumber(group.pools.length), pulls: formatNumber(group.totalPulls) })}
                            </div>
                          </div>
                        </div>
                        {!group.disableCollapse ? (
                          <ChevronDown size={14} className={cx('shrink-0 text-slate-500 transition-transform dark:text-zinc-500', groupExpanded && 'rotate-180')} />
                        ) : null}
                      </button>

                      {groupExpanded ? (
                        <div className="space-y-1 border-t border-zinc-200/80 p-2 dark:border-zinc-800">
                          {showOverviewOptions && group.pools.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => handleSelectItem({
                                id: groupId,
                                kind: 'group',
                                groupType: group.type,
                              })}
                              className={cx(
                                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                                groupSelected
                                  ? 'border-endfield-yellow/35 bg-endfield-yellow/10'
                                  : 'border-transparent bg-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/70'
                              )}
                            >
                              <div className="shrink-0 rounded-md border border-zinc-200 bg-zinc-100 p-1.5 text-slate-600 dark:border-white/8 dark:bg-white/6 dark:text-zinc-300">
                                <HeaderIcon size={12} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className={cx('truncate text-sm font-bold', groupSelected ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-zinc-200')}>
                                  {t('pool.card.allGroupTitle', { label: group.label })}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500 dark:text-zinc-500">
                                  <span className="truncate">{t('pool.card.groupStats', { pools: formatNumber(group.pools.length), pulls: formatNumber(group.totalPulls) })}</span>
                                  <span className="shrink-0 font-mono">{formatNumber(group.totalPulls)} {t('dashboard.unit.pull')}</span>
                                </div>
                              </div>
                              {groupSelected ? <Check size={14} className="shrink-0 text-endfield-yellow" /> : null}
                            </button>
                          ) : null}

                          {displayedPools.map((pool) => {
                            const active = currentPoolId === pool.id;
                            const config = getPoolTypeConfig(pool);
                            const Icon = config.icon;
                            return (
                              <button
                                key={pool.id}
                                type="button"
                                onClick={() => handleSelectItem({ id: pool.id, kind: 'pool' })}
                                className={cx(
                                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                                  active
                                    ? 'border-endfield-yellow/35 bg-endfield-yellow/10'
                                    : 'border-transparent bg-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/70'
                                )}
                              >
                                <div className={cx('shrink-0 rounded-md border p-1.5', config.accent)}>
                                  <Icon size={12} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className={cx('truncate text-sm font-bold', active ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-zinc-200')}>
                                    {pool.displayName || pool.name}
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500 dark:text-zinc-500">
                                    <span className="truncate">{shouldShowPoolFeaturedSummary(pool) ? pool.displayUpCharacter || getPoolSelectorFeaturedCharacters(pool, { locale }).join(' / ') || localizeEntityName(pool.up_character || pool.upCharacter || '', { locale }) || t('pool.card.overviewDesc') : t('pool.card.overviewDesc')}</span>
                                    <span className="shrink-0 font-mono">{formatNumber(pool.pullCount || 0)} {t('dashboard.unit.pull')}</span>
                                  </div>
                                </div>
                                {active ? <Check size={14} className="shrink-0 text-endfield-yellow" /> : null}
                              </button>
                            );
                          })}

                          {foldedPools.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setExpandedOldPoolGroups((current) => ({
                                ...current,
                                [group.type]: !oldPoolsExpanded,
                              }))}
                              className="flex w-full items-center justify-between rounded-lg border border-dashed border-zinc-300 px-3 py-2.5 text-left text-[11px] font-bold text-slate-600 transition-colors hover:border-endfield-yellow/50 hover:bg-endfield-yellow/8 dark:border-zinc-700 dark:text-zinc-300"
                            >
                              <span>
                                {oldPoolsExpanded
                                  ? t('pool.card.keepLatest')
                                  : t('pool.card.hasMore', { count: formatNumber(foldedPools.length) })}
                              </span>
                              <ChevronDown
                                size={14}
                                className={cx('transition-transform', oldPoolsExpanded && 'rotate-180')}
                              />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showImportManager ? (
        <ImportManager
          isOpen={showImportManager}
          onClose={() => setShowImportManager(false)}
          onImportComplete={(result) => {
            navigate(getMobilePathForTab('details'), {
              state: {
                openHistoryAnomalies: getImportAnomalyCount(result) > 0,
              },
            });
          }}
        />
      ) : null}
    </div>
  );
}
