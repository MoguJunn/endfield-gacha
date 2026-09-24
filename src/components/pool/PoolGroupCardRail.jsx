import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Layers, Lock, Star, Swords, User } from 'lucide-react';
import {
  getPoolFeaturedLabel,
  getPoolTimingMeta,
  getSelectorVisiblePools,
  shouldShowPoolFeaturedSummary,
} from '../../utils/poolSelectorDisplay';
import { useI18n } from '../../i18n/index.js';
import { getCharacterAvatarUrl } from '../../utils/characterUtils.js';
import { useHorizontalWheelScroll } from '../../hooks/useHorizontalWheelScroll.js';
import { isPoolSelectorGroupCollapsed } from './poolGroupCardRailState.js';

const TYPE_CONFIG = {
  extra: { icon: Star, color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-100 dark:bg-cyan-900/20' },
  limited: { icon: Star, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/20' },
  standard: { icon: Layers, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/20' },
  beginner: { icon: User, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/20' },
  weapon_limited: { icon: Swords, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-zinc-800' },
  weapon_standard: { icon: Swords, color: 'text-zinc-500 dark:text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800' },
};

function GroupLabel({ groupType, label, collapsed, onToggle, t }) {
  const accentClass =
    groupType === 'limited'
      ? 'bg-orange-500 text-orange-600 dark:text-orange-400'
      : groupType === 'extra'
        ? 'bg-cyan-500 text-cyan-600 dark:text-cyan-400'
        : groupType === 'weapon_limited'
          ? 'bg-slate-500 text-slate-600 dark:text-slate-300'
          : groupType === 'standard'
            ? 'bg-yellow-500 text-yellow-600 dark:text-yellow-400'
            : groupType === 'weapon_standard'
              ? 'bg-zinc-400 text-zinc-500 dark:text-zinc-400'
              : 'bg-green-500 text-green-600 dark:text-green-400';

  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex-shrink-0 flex flex-col items-center justify-end h-full pb-3 group opacity-70 hover:opacity-100 transition-opacity duration-200"
      title={collapsed ? t('pool.card.groupToggleExpand', { label }) : t('pool.card.groupToggleCollapse', { label })}
    >
      <div className="flex flex-col items-center gap-2" style={{ writingMode: 'vertical-rl' }}>
        <span
          className={`w-[3px] h-8 flex-shrink-0 ${accentClass.split(' ')[0]}`}
          style={{ writingMode: 'horizontal-tb' }}
        />
        <span
          className={`text-[11px] font-bold tracking-[0.2em] uppercase ${accentClass.split(' ').slice(1).join(' ')}`}
        >
          {label}
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-300 ${accentClass.split(' ').slice(1).join(' ')} ${collapsed ? '-rotate-90' : 'rotate-0'}`}
          style={{ writingMode: 'horizontal-tb' }}
        />
      </div>
    </button>
  );
}

function GroupCard({ group, isSelected, onClick, interactive, locale, t }) {
  const config = TYPE_CONFIG[group.type] || TYPE_CONFIG.standard;
  const TypeIcon = config.icon;
  const formattedPoolCount = new Intl.NumberFormat(locale).format(group.pools.length);
  const formattedPullCount = new Intl.NumberFormat(locale).format(group.totalPulls || 0);

  return (
    <div
      onClick={interactive ? onClick : undefined}
      className={`
        relative flex-shrink-0 w-32 p-3 border border-dashed transition-all duration-200 group
        ${interactive ? 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:border-yellow-500' : 'cursor-default'}
        ${
          isSelected
            ? 'bg-zinc-50 dark:bg-zinc-900/80 border-yellow-500 dark:border-yellow-500 shadow-[inset_0_0_20px_rgba(234,179,8,0.1)]'
            : 'bg-transparent border-zinc-300 dark:border-zinc-700'
        }
      `}
      style={{
        clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
      }}
    >
      <div className={`absolute top-2 left-2 p-1 ${config.bg} border border-black/5 dark:border-white/5`}>
        <TypeIcon size={12} className={config.color} />
      </div>
      <div
        className={`text-xs font-bold tracking-widest uppercase truncate mb-2 mt-6 ${isSelected ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-600 dark:text-zinc-400 group-hover:text-yellow-600 dark:group-hover:text-yellow-500'}`}
      >
        {t('pool.card.allGroupTitle', { label: group.label })}
      </div>
      <div className="flex flex-col gap-1 mt-auto">
        <div className="flex justify-between items-end">
          <span className="text-[9px] text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
            {t('pool.card.poolCountLabel', 'POOLS')}
          </span>
          <span className="text-[11px] font-mono text-slate-700 dark:text-zinc-300 group-hover:text-yellow-600 dark:group-hover:text-yellow-500">
            {formattedPoolCount}
          </span>
        </div>
        <div className="flex justify-between items-end">
          <span className="text-[9px] text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
            {t('pool.card.pullCountLabel', 'PULLS')}
          </span>
          <span
            className={`text-sm font-mono font-bold leading-none ${isSelected ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-700 dark:text-zinc-300 group-hover:text-yellow-600 dark:group-hover:text-yellow-500'}`}
          >
            {formattedPullCount}
          </span>
        </div>
      </div>
    </div>
  );
}

function CollapseCard({ count, expanded, onClick, locale, t }) {
  const formattedCount = new Intl.NumberFormat(locale).format(count);

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex-shrink-0 w-32 p-3 border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all duration-200 text-left group"
      style={{
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
      }}
    >
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 group-hover:text-yellow-600 dark:group-hover:text-yellow-500">
        {expanded ? t('pool.card.collapseOld') : t('pool.card.expandOld')}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-700 dark:text-zinc-300 group-hover:text-yellow-600 dark:group-hover:text-yellow-500">
        {expanded ? t('pool.card.keepLatest') : t('pool.card.hasMore', { count: formattedCount })}
      </div>
      <div className="mt-4 flex items-center justify-between text-[10px] text-zinc-400 dark:text-zinc-500 group-hover:text-yellow-600 dark:group-hover:text-yellow-500">
        <span>{expanded ? 'COLLAPSE' : 'EXPAND'}</span>
        <ChevronDown size={14} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </div>
    </button>
  );
}

function OverviewCard({ title, totalPools, totalPulls, isSelected, onClick, locale, t }) {
  const formattedPoolCount = new Intl.NumberFormat(locale).format(totalPools);
  const formattedPullCount = new Intl.NumberFormat(locale).format(totalPulls);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative flex-shrink-0 w-32 p-4 text-left transition-all duration-200 border-l-4 overflow-hidden group
        ${
          isSelected
            ? 'bg-zinc-100 dark:bg-zinc-800/80 border-yellow-500 dark:border-yellow-500 shadow-[inset_0_0_20px_rgba(234,179,8,0.1)]'
            : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-yellow-500'
        }
      `}
      style={{
        clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
      }}
    >
      <div className="absolute top-0 right-0 p-1 bg-zinc-100 dark:bg-zinc-800">
        <Layers size={14} className="text-slate-400 dark:text-zinc-500" />
      </div>
      <div
        className={`mt-2 text-xs font-bold tracking-widest uppercase ${isSelected ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-800 dark:text-zinc-200 group-hover:text-yellow-600 dark:group-hover:text-yellow-500'}`}
      >
        {title}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex justify-between items-end">
          <span className="text-[9px] text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
            {t('pool.card.poolCountLabel', 'POOLS')}
          </span>
          <span className="text-[11px] font-mono text-slate-700 dark:text-zinc-300 group-hover:text-yellow-600 dark:group-hover:text-yellow-500">
            {formattedPoolCount}
          </span>
        </div>
        <div className="flex justify-between items-end">
          <span className="text-[9px] text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
            {t('pool.card.pullCountLabel', 'PULLS')}
          </span>
          <span
            className={`text-sm font-mono font-bold leading-none ${isSelected ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-700 dark:text-zinc-200 group-hover:text-yellow-600 dark:group-hover:text-yellow-500'}`}
          >
            {formattedPullCount}
          </span>
        </div>
      </div>

      <div className="absolute bottom-2 right-2 opacity-10 group-hover:opacity-20 transition-opacity">
        <Layers size={48} />
      </div>
    </button>
  );
}

function getPoolNameFontSizeClass(poolName = '') {
  if (poolName.length > 30) {
    return 'text-[10px] leading-[1.2]';
  }
  if (poolName.length > 22) {
    return 'text-[11px] leading-[1.25]';
  }
  if (poolName.length > 16) {
    return 'text-[12px] leading-[1.25]';
  }
  return 'text-[15px] leading-tight';
}

function getFeaturedTextFontSizeClass(featuredText = '') {
  if (featuredText.length > 42) {
    return 'text-[9px] leading-[1.2]';
  }
  if (featuredText.length > 28) {
    return 'text-[10px] leading-[1.25]';
  }
  return 'text-[12px] leading-4';
}

function PoolCard({ pool, isSelected, onClick, locale, t }) {
  const groupType = pool.selectorGroupType || 'standard';
  const config = TYPE_CONFIG[groupType] || TYPE_CONFIG.standard;
  const TypeIcon = config.icon;
  const isActive = pool.selectorTiming?.isActive;
  const remainingLabel = pool.selectorTiming?.remainingLabel;
  const formattedPullCount = new Intl.NumberFormat(locale).format(pool.pullCount || 0);
  const featuredCharacterNames =
    Array.isArray(pool.displayFeaturedCharacters) && pool.displayFeaturedCharacters.length > 0
      ? pool.displayFeaturedCharacters
      : [pool.displayUpCharacter || pool.up_character || pool.upCharacter].filter(Boolean);
  const featuredText = featuredCharacterNames.join(' / ');
  const featuredLabel = getPoolFeaturedLabel(pool, { locale, short: true });
  const showFeaturedSummary = shouldShowPoolFeaturedSummary(pool) && Boolean(featuredText);
  const avatarLookupNames =
    Array.isArray(pool.avatarLookupNames) && pool.avatarLookupNames.length > 0
      ? pool.avatarLookupNames
      : [pool.up_character || pool.upCharacter].filter(Boolean);
  const characterAvatarUrls = useMemo(
    () =>
      avatarLookupNames
        .map((name) => getCharacterAvatarUrl(name))
        .filter(Boolean)
        .slice(0, 4),
    [avatarLookupNames]
  );
  const hasMultiCharacterBackdrop = characterAvatarUrls.length > 1;
  const progressPercent = Math.max(Number(pool.selectorTiming?.progressPercent || 0), 4);
  const progressBarClass = isActive
    ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]'
    : pool.selectorTiming?.isUpcoming
      ? 'bg-blue-400'
      : 'bg-zinc-400 dark:bg-zinc-600';

  const poolName = pool.displayName || pool.name;
  const nameFontSizeClass = getPoolNameFontSizeClass(poolName);
  const featuredTextFontSizeClass = getFeaturedTextFontSizeClass(featuredText);

  return (
    <div
      onClick={onClick}
      className={`
        relative flex-shrink-0 w-36 min-h-[192px] flex flex-col p-0 cursor-pointer transition-all duration-300 ease-out overflow-hidden group
        ${
          isSelected
            ? 'bg-zinc-100 dark:bg-zinc-800 scale-[1.02] z-10 shadow-lg ring-1 ring-yellow-500/30'
            : 'bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 hover:scale-[1.01]'
        }
      `}
      style={{
        clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)',
      }}
    >
      {/* Background Image Area */}
      <div className="relative h-20 w-full bg-zinc-200 dark:bg-zinc-900 overflow-hidden shrink-0">
        {characterAvatarUrls.length > 0 ? (
          <>
            <div
              className={`absolute inset-0 ${hasMultiCharacterBackdrop ? 'grid grid-cols-2 grid-rows-2' : ''} transition-all duration-700 ${isSelected ? 'scale-110' : 'group-hover:scale-105'}`}
            >
              {hasMultiCharacterBackdrop ? (
                characterAvatarUrls.map((avatarUrl, index) => (
                  <div key={`${avatarUrl}-${index}`} className="overflow-hidden">
                    <img
                      src={avatarUrl}
                      alt={featuredCharacterNames[index] || ''}
                      className={`h-full w-full object-cover object-center transition-all duration-500 ${isSelected ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}
                    />
                  </div>
                ))
              ) : (
                <img
                  src={characterAvatarUrls[0]}
                  alt={featuredText}
                  className={`h-full w-full object-cover object-[72%_center] transition-all duration-500 ${isSelected ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}
                />
              )}
            </div>
            <div
              className={`absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white dark:from-zinc-800 to-transparent transition-opacity duration-300 ${isSelected ? 'opacity-40' : 'opacity-100'}`}
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-zinc-200 dark:bg-zinc-900" />
        )}

        <div
          className={`absolute top-0 left-0 p-1.5 ${config.bg} border-b border-r border-black/10 dark:border-white/10 z-20`}
        >
          <TypeIcon size={12} className={config.color} />
        </div>

        {pool.locked && (
          <div className="absolute top-2 right-2 z-20 p-1 bg-black/50 backdrop-blur-sm border border-white/10 rounded-sm">
            <Lock size={10} className="text-amber-500" />
          </div>
        )}

        {isActive && (
          <div className="absolute top-0 right-0 z-20 px-2 py-0.5 bg-yellow-500 text-zinc-900 text-[9px] font-bold tracking-widest uppercase shadow-sm">
            {t('pool.card.currentUp')}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div
        className={`relative flex flex-1 flex-col p-3 pt-1.5 border-x border-b pb-2 transition-colors duration-300 ${isSelected ? 'border-yellow-500 dark:border-yellow-500/70 bg-zinc-50 dark:bg-zinc-900/50' : 'border-zinc-200 dark:border-zinc-800'}`}
      >
        <div
          className={`font-bold line-clamp-2 transition-all duration-300 ${nameFontSizeClass} ${isSelected ? 'text-slate-900 dark:text-yellow-500' : 'text-slate-700 dark:text-zinc-200'}`}
        >
          {poolName}
        </div>

        <div className="mt-1">
          {showFeaturedSummary ? (
            <div className="text-slate-500 dark:text-zinc-400 border-l-2 border-slate-300 dark:border-zinc-700 pl-1.5">
              <span className="text-[10px] leading-3 text-slate-600 dark:text-zinc-300 block mb-px tracking-tighter opacity-80">
                {featuredLabel}
              </span>
              <span className={`block line-clamp-2 text-slate-800 dark:text-zinc-200 ${featuredTextFontSizeClass}`}>
                {featuredText}
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-auto pt-2 flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] leading-3 text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
              {t('pool.card.pullCountLabel', 'PULLS')}
            </span>
            <span
              className={`mt-0.5 text-lg font-mono font-bold leading-none transition-colors duration-300 ${isSelected ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-700 dark:text-zinc-300'}`}
            >
              {formattedPullCount}
            </span>
          </div>

          {isActive && remainingLabel && (
            <div className="text-[10px] text-yellow-600 dark:text-yellow-500 text-right animate-pulse leading-none mb-0.5">
              {remainingLabel}
            </div>
          )}
          {!isActive && pool.selectorTiming?.isUpcoming && remainingLabel && (
            <div className="text-[10px] text-blue-600 dark:text-blue-400 text-right leading-none mb-0.5">
              {remainingLabel}
            </div>
          )}
        </div>

        {/* Selected Frame Corner Tech Decoration */}
        <div
          className={`absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-yellow-500 transition-all duration-500 ${isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
        />
        <div
          className={`absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-yellow-500 transition-all duration-500 ${isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
        />
      </div>

      {/* Progress Bar (Industrial Style) */}
      {pool.selectorTiming?.isTimed && (
        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full transition-all duration-500 ${progressBarClass}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </div>
  );
}

const PoolGroupCardRail = ({
  groups = [],
  currentSelectionId = null,
  onSelectGroup,
  onSelectPool,
  onToggleSubgroup,
  leadingOverview = null,
  showGroupOverviewCards = true,
  collapseLimit = 5,
  collapsibleTypes = ['limited'],
  className = '',
}) => {
  const { t, locale } = useI18n();
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [collapsedGroupTypes, setCollapsedGroupTypes] = useState(() => new Set());
  const [tick, setTick] = useState(0);
  const railRef = useHorizontalWheelScroll();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((current) => current + 1);
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  void tick;
  const referenceDate = new Date();
  const decoratePoolsWithTiming = (pools) =>
    (pools || []).map((pool) => ({
      ...pool,
      selectorTiming: getPoolTimingMeta(pool, referenceDate, locale),
    }));
  const effectiveGroups = groups.map((group) => {
    const pools = decoratePoolsWithTiming(group.pools);
    const poolsById = new Map(pools.map((pool) => [pool.id, pool]));
    const decorateGroupPools = (poolList) =>
      (poolList || []).map(
        (pool) =>
          poolsById.get(pool.id) || {
            ...pool,
            selectorTiming: getPoolTimingMeta(pool, referenceDate, locale),
          }
      );

    return {
      ...group,
      pools,
      ...(group.versionFold
        ? {
            versionFold: {
              ...group.versionFold,
              directPools: decorateGroupPools(group.versionFold.directPools),
              foldedPools: decorateGroupPools(group.versionFold.foldedPools),
            },
          }
        : {}),
      ...(Array.isArray(group.subgroups)
        ? {
            subgroups: group.subgroups.map((subgroup) => ({
              ...subgroup,
              allPools: decorateGroupPools(subgroup.allPools || subgroup.pools),
              pools: decorateGroupPools(subgroup.pools),
            })),
          }
        : {}),
    };
  });

  if (effectiveGroups.length === 0) {
    return null;
  }

  return (
    <div className={`relative border-t border-zinc-100 dark:border-zinc-800 pt-4 ${className}`}>
      <div
        ref={railRef}
        className="pool-card-rail-scrollbar flex flex-nowrap items-end gap-2 overflow-x-scroll overflow-y-hidden pb-2 -mx-1 px-1"
      >
        {leadingOverview && showGroupOverviewCards ? (
          <OverviewCard
            title={leadingOverview.title}
            totalPools={leadingOverview.totalPools}
            totalPulls={leadingOverview.totalPulls}
            isSelected={leadingOverview.isSelected}
            onClick={leadingOverview.onClick}
            locale={locale}
            t={t}
          />
        ) : null}

        {effectiveGroups.map((group) => {
          const hasSubgroups = Array.isArray(group.subgroups);
          const versionFoldEnabled = !hasSubgroups && group.versionFold?.enabled === true && !group.disableCollapse;
          const allowCollapse =
            versionFoldEnabled || (!hasSubgroups && collapsibleTypes.includes(group.type) && !group.disableCollapse);
          const expanded = expandedGroups.has(group.type);
          const hasSelectedPool = group.pools.some((pool) => pool.id === currentSelectionId);
          const hasSelectedSubgroup = group.subgroups?.some((subgroup) => subgroup.groupId === currentSelectionId);
          const isGroupCollapsed = isPoolSelectorGroupCollapsed({
            group,
            collapsedGroupTypes,
            hasSelectedSubgroup,
          });
          const collapsedPreviewPools = isGroupCollapsed
            ? group.pools.filter((pool) => pool.selectorTiming?.isActive)
            : [];
          if (isGroupCollapsed && hasSelectedPool && currentSelectionId !== group.groupId) {
            const selectedPool = group.pools.find((pool) => pool.id === currentSelectionId);
            if (selectedPool && !collapsedPreviewPools.some((pool) => pool.id === selectedPool.id)) {
              collapsedPreviewPools.push(selectedPool);
            }
          }
          const { visiblePools, hiddenPools, autoExpanded } = versionFoldEnabled
            ? {
                visiblePools: group.versionFold.directPools,
                hiddenPools: group.versionFold.foldedPools,
                autoExpanded: group.versionFold.foldedPools.some((pool) => pool.id === currentSelectionId),
              }
            : allowCollapse
              ? getSelectorVisiblePools({
                  pools: group.pools,
                  currentPoolId: currentSelectionId,
                  expanded,
                  limit: collapseLimit,
                })
              : {
                  visiblePools: group.pools,
                  hiddenPools: [],
                  autoExpanded: false,
                };
          const showExpanded = expanded || autoExpanded;
          const selectDefaultPoolInGroup = () => {
            const activePool = group.pools.find((pool) => pool.selectorTiming?.isActive);
            const fallbackPool = activePool || group.pools[0];
            if (fallbackPool?.id) {
              onSelectPool?.(fallbackPool.id);
            }
          };
          const toggleGroupCollapse = () => {
            setCollapsedGroupTypes((current) => {
              const next = new Set(current);
              if (next.has(group.type)) {
                next.delete(group.type);
              } else {
                next.add(group.type);
              }
              return next;
            });
          };

          return (
            <div key={group.type} className="flex flex-nowrap items-end gap-2">
              <GroupLabel
                groupType={group.type}
                label={group.label}
                collapsed={isGroupCollapsed}
                t={t}
                onToggle={() => {
                  if (!showGroupOverviewCards && !hasSelectedPool) {
                    selectDefaultPoolInGroup();
                    return;
                  }
                  toggleGroupCollapse();
                }}
              />

              {showGroupOverviewCards ? (
                <GroupCard
                  group={group}
                  isSelected={currentSelectionId === group.groupId}
                  interactive={typeof onSelectGroup === 'function'}
                  onClick={() => onSelectGroup?.(group.type)}
                  locale={locale}
                  t={t}
                />
              ) : null}

              {!isGroupCollapsed &&
                hasSubgroups &&
                group.subgroups.map((subgroup) => (
                  <div key={subgroup.groupId} className="flex flex-nowrap items-end gap-2">
                    <GroupLabel
                      groupType="extra"
                      label={subgroup.label}
                      collapsed={!subgroup.isExpanded}
                      t={t}
                      onToggle={() => onToggleSubgroup?.(subgroup.groupId, subgroup.isExpanded)}
                    />

                    {showGroupOverviewCards ? (
                      <GroupCard
                        group={{
                          ...subgroup,
                          type: 'extra',
                          pools: subgroup.allPools,
                        }}
                        isSelected={currentSelectionId === subgroup.groupId}
                        interactive={typeof onSelectGroup === 'function'}
                        onClick={() => onSelectGroup?.(`extra:${subgroup.subtype}`)}
                        locale={locale}
                        t={t}
                      />
                    ) : null}

                    {subgroup.isExpanded &&
                      subgroup.pools.map((pool) => (
                        <PoolCard
                          key={pool.id}
                          pool={{ ...pool, selectorGroupType: 'extra' }}
                          isSelected={currentSelectionId === pool.id}
                          onClick={() => onSelectPool?.(pool.id)}
                          locale={locale}
                          t={t}
                        />
                      ))}
                  </div>
                ))}

              {isGroupCollapsed &&
                collapsedPreviewPools.map((pool) => (
                  <PoolCard
                    key={pool.id}
                    pool={{ ...pool, selectorGroupType: group.type }}
                    isSelected={currentSelectionId === pool.id}
                    onClick={() => onSelectPool?.(pool.id)}
                    locale={locale}
                    t={t}
                  />
                ))}

              {!hasSubgroups &&
                !isGroupCollapsed &&
                visiblePools.map((pool) => (
                  <PoolCard
                    key={pool.id}
                    pool={{ ...pool, selectorGroupType: group.type }}
                    isSelected={currentSelectionId === pool.id}
                    onClick={() => onSelectPool?.(pool.id)}
                    locale={locale}
                    t={t}
                  />
                ))}

              {!hasSubgroups && !isGroupCollapsed && allowCollapse && hiddenPools.length > 0 && !showExpanded && (
                <CollapseCard
                  count={hiddenPools.length}
                  expanded={false}
                  locale={locale}
                  t={t}
                  onClick={() => {
                    setExpandedGroups((current) => {
                      const next = new Set(current);
                      next.add(group.type);
                      return next;
                    });
                  }}
                />
              )}

              {!hasSubgroups &&
                !isGroupCollapsed &&
                allowCollapse &&
                showExpanded &&
                hiddenPools.length > 0 &&
                hiddenPools.map((pool) => (
                  <PoolCard
                    key={pool.id}
                    pool={{ ...pool, selectorGroupType: group.type }}
                    isSelected={currentSelectionId === pool.id}
                    onClick={() => onSelectPool?.(pool.id)}
                    locale={locale}
                    t={t}
                  />
                ))}

              {!hasSubgroups && !isGroupCollapsed && allowCollapse && showExpanded && hiddenPools.length > 0 && (
                <CollapseCard
                  count={hiddenPools.length}
                  expanded={true}
                  locale={locale}
                  t={t}
                  onClick={() => {
                    setExpandedGroups((current) => {
                      const next = new Set(current);
                      next.delete(group.type);
                      return next;
                    });
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PoolGroupCardRail;
