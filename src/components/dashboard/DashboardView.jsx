import React from 'react';
import { useLocation } from 'react-router-dom';
import {
  Calculator,
  Star,
  FileText,
  Sparkles,
  User,
  TrendingUp,
  Layers,
  Clock,
  Upload,
  BarChart3,
  LayoutGrid,
  Share2,
  Download,
  Copy,
  ChevronDown,
  ChevronRight,
  Loader2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { RARITY_CONFIG } from '../../constants';
import { useDashboardViewState } from '../../hooks';
import { useTheme } from '../../contexts/ThemeContext';
import PoolAnalysisCard from './PoolAnalysisCard';
import PoolTimelinePanel from './PoolTimelinePanel';
import AveragePullStatsPanel from './AveragePullStatsPanel';
import DashboardShareCard from './DashboardShareCard';
import ShareActionStatus from '../share/ShareActionStatus';
import { characterCache } from '../../utils/characterUtils';
import ResourceSummaryPanel from '../resources/ResourceSummaryPanel';
import { buildCharacterStats } from '../../utils/dashboardCharacterStats';
import { buildPoolSelectorGroups, normalizePoolGroupType } from '../../utils/poolSelectorDisplay';
import { buildOverviewPoolAnalysisPityMap, getPoolAnalysisPityState } from '../../utils/poolAnalysisPity';
import { buildDashboardTimelineSections } from '../../utils/dashboardTimelineSections';
import { buildDashboardOverviewSplitStats } from '../../utils/dashboardOverviewSplitStats';
import {
  buildDashboardShareCardFileName,
  buildDashboardSharePayload,
  buildDashboardShareText,
} from '../../utils/dashboardShare';
import {
  buildShareFile,
  canCopyImageToClipboard,
  canNativeShareFile,
  copyImageBlobToClipboard,
  downloadShareCard,
  isFirefoxBrowser,
  renderShareCardToBlob,
  shareImageFile,
} from '../../utils/simulatorShare';
import { copyToClipboard } from '../../utils/simulatorStorage';
import useShareActionFeedback from '../../hooks/useShareActionFeedback';
import { useI18n } from '../../i18n/index.js';
import { localizeEntityName, localizePoolFeaturedName, localizePoolName } from '../../utils/gameDataI18n.js';
import appLogger from '../../utils/appLogger.js';
import { readStorageValue, STORAGE_KEYS, writeStorageValue } from '../../utils/storageUtils.js';
import { localizeDashboardChartItems } from '../../utils/dashboardChartLabels.js';
import { normalizeShareThemeMode, resolveShareThemeMode } from '../../utils/shareThemeMode.js';
import DeferredSection from '../ui/DeferredSection.jsx';
import { useHistoryPageStore, useHistoryStore } from '../../stores/index.js';

const DashboardCharts = React.lazy(() => import('./DashboardCharts.jsx'));

const ALL_OVERVIEW_FILTER_OPTIONS = [
  { id: 'all', label: '全部卡池' },
  { id: 'limited', label: '限定池' },
  { id: 'extra', label: '附加寻访' },
  { id: 'weapon', label: '武器池' },
  { id: 'standard', label: '常驻池' },
];

const CHARACTER_OVERVIEW_TYPE_OPTIONS = [
  { id: 'limited', labelKey: 'dashboard.overview.filter.limited' },
  { id: 'extra', labelKey: 'dashboard.overview.filter.extra' },
  { id: 'standard', labelKey: 'dashboard.overview.filter.standard' },
];

const WEAPON_OVERVIEW_TYPE_OPTIONS = [
  { id: 'weapon_limited', labelKey: 'dashboard.overview.filter.weaponLimited' },
  { id: 'weapon_standard', labelKey: 'dashboard.overview.filter.weaponStandard' },
];

function getDistributionVariant(poolType) {
  if (poolType === 'weapon') {
    return 'weapon';
  }

  if (poolType === 'standard') {
    return 'standard';
  }

  return 'character';
}

function getOverviewPoolBucket(pool) {
  const groupType = normalizePoolGroupType(pool);
  if (groupType === 'extra') {
    return 'extra';
  }

  if (groupType === 'limited') {
    return 'limited';
  }

  if (groupType === 'weapon_limited' || groupType === 'weapon_standard') {
    return 'weapon';
  }

  return 'standard';
}

function getOverviewPoolTypeKey(pool) {
  const groupType = normalizePoolGroupType(pool);
  if (groupType === 'weapon_limited' || groupType === 'weapon_standard') {
    return groupType;
  }

  if (groupType === 'extra') {
    return 'extra';
  }

  if (groupType === 'limited') {
    return 'limited';
  }

  return 'standard';
}

function getHistoryPoolId(item) {
  return item?.poolId || item?.pool_id || null;
}

function buildCustomSharePoolName(pools, locale, isEnglish) {
  const localizedNames = pools.map((pool) => localizePoolName(pool, { locale })).filter(Boolean);

  if (localizedNames.length === 0) {
    return isEnglish ? 'No banner selected' : '未选择卡池';
  }

  if (localizedNames.length <= 2) {
    return localizedNames.join(' / ');
  }

  return isEnglish
    ? `${localizedNames[0]} + ${localizedNames.length - 1} more`
    : `${localizedNames[0]} 等 ${localizedNames.length} 个卡池`;
}

/**
 * 仪表盘小统计卡片 (Updated Style)
 */
const StatBox = ({ title, value, subValue, colorClass, icon: Icon, isAnimated }) => (
  <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 relative overflow-hidden group hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors">
    {isAnimated && (
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
    )}

    <div className="flex justify-between items-start mb-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-500 font-bold">{title}</div>
      {Icon && <Icon size={14} className="text-slate-400 dark:text-zinc-600" />}
    </div>

    <div className="flex items-baseline gap-2">
      <div className={`text-2xl font-bold font-mono ${colorClass || 'text-slate-800 dark:text-zinc-100'}`}>{value}</div>
    </div>

    {subValue && <div className="text-[10px] text-slate-400 dark:text-zinc-500 mt-1 font-mono">{subValue}</div>}
  </div>
);

const OverviewBanner = ({
  title,
  value,
  accentClass = 'text-slate-800 dark:text-zinc-100',
  unitLabel = 'PULLS',
  children,
}) => (
  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 flex flex-col gap-4 shadow-sm relative overflow-hidden group">
    <div className="absolute right-0 top-0 h-full w-24 bg-gradient-to-l from-zinc-50 dark:from-zinc-800 to-transparent" />
    <div className="relative z-10 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-xs text-slate-500 dark:text-zinc-500 font-bold uppercase tracking-wider mb-1">{title}</h3>
        <div className={`text-4xl font-black font-mono flex items-baseline gap-2 ${accentClass}`}>
          {value}
          <span className="text-lg font-medium text-slate-400 dark:text-zinc-600">{unitLabel}</span>
        </div>
      </div>
      <div className="h-12 w-12 bg-zinc-100 dark:bg-zinc-800 rounded-sm flex items-center justify-center text-slate-400 dark:text-zinc-500 shrink-0">
        <Layers size={24} />
      </div>
    </div>
    {children ? <div className="relative z-10">{children}</div> : null}
  </div>
);

const FreePullStatsToggle = ({ enabled, onToggle, t }) => (
  <button
    type="button"
    aria-pressed={enabled}
    onClick={onToggle}
    className={`relative z-10 flex w-full items-center justify-between gap-3 rounded-sm border px-3 py-2.5 text-left transition-colors ${
      enabled
        ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-500 dark:text-cyan-300'
        : 'border-zinc-200 bg-zinc-100 text-slate-500 hover:border-zinc-300 hover:text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300'
    }`}
    title={enabled ? t('dashboard.analysis.includeFreeTenTitle') : t('dashboard.analysis.excludeFreeTenTitle')}
  >
    <span>
      <span className="block text-[11px] font-black uppercase tracking-wider">
        {t('dashboard.analysis.freeTenToggleLabel')}
      </span>
    </span>
    {enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
  </button>
);

const OverviewTypeMultiSelect = ({ title, options, value, onChange, t }) => {
  const selected = new Set(value);

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-600">{title}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                const next = new Set(selected);
                if (active) {
                  next.delete(option.id);
                } else {
                  next.add(option.id);
                }
                onChange(Array.from(next));
              }}
              className={`rounded-sm border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                active
                  ? 'border-endfield-yellow bg-endfield-yellow/15 text-amber-700 dark:text-endfield-yellow'
                  : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-300'
              }`}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>
      {selected.size === 0 && (
        <div className="text-[10px] text-amber-600 dark:text-amber-400">
          {t('dashboard.overview.filter.emptySelection')}
        </div>
      )}
    </div>
  );
};

/**
 * 仪表盘视图组件
 */
const DashboardView = ({ showToast }) => {
  const location = useLocation();
  const { isDark } = useTheme();
  const { t, formatNumber, isEnglish, locale } = useI18n();
  const [allOverviewPoolFilter, setAllOverviewPoolFilter] = React.useState('all');
  const [characterOverviewPoolTypes, setCharacterOverviewPoolTypes] = React.useState(() =>
    CHARACTER_OVERVIEW_TYPE_OPTIONS.map((option) => option.id)
  );
  const [weaponOverviewPoolTypes, setWeaponOverviewPoolTypes] = React.useState(() =>
    WEAPON_OVERVIEW_TYPE_OPTIONS.map((option) => option.id)
  );
  const [showShareMenu, setShowShareMenu] = React.useState(false);
  const [shareMode, setShareMode] = React.useState('current');
  const [customSharePoolIds, setCustomSharePoolIds] = React.useState([]);
  const [customShareExpandedGroupIds, setCustomShareExpandedGroupIds] = React.useState([]);
  const [showTimelineFiveStarDrops, setShowTimelineFiveStarDrops] = React.useState(true);
  const loadedRawHistoryCount = useHistoryStore((state) => (
    Array.isArray(state.history) ? state.history.length : 0
  ));
  const historyPagePhase = useHistoryPageStore((state) => state.phase);
  const historyPageHasMore = useHistoryPageStore((state) => state.hasMore);
  const historyPageTotal = useHistoryPageStore((state) => state.total);
  const hasCompleteRawHistory = historyPagePhase === 'ready'
    && historyPageHasMore === false
    && historyPageTotal !== null
    && loadedRawHistoryCount >= historyPageTotal;
  const [clipboardImageWarmState, setClipboardImageWarmState] = React.useState('idle');
  const [clipboardImageReadyKey, setClipboardImageReadyKey] = React.useState(null);
  const [shareThemeMode, setShareThemeMode] = React.useState(() => {
    if (typeof window === 'undefined') {
      return 'system';
    }

    return normalizeShareThemeMode(readStorageValue(STORAGE_KEYS.DASHBOARD_SHARE_THEME_MODE, null, { raw: true }));
  });
  const resolvedShareTheme = React.useMemo(
    () => resolveShareThemeMode(shareThemeMode, isDark),
    [isDark, shareThemeMode]
  );
  const shareCardRef = React.useRef(null);
  const shareMenuRef = React.useRef(null);
  const shareImageCacheRef = React.useRef({
    full: { key: null, blob: null, promise: null },
    clipboard: { key: null, blob: null, promise: null },
  });
  const {
    feedback: shareActionFeedback,
    isBusy: isShareActionBusy,
    beginAction: beginShareAction,
    updateAction: updateShareAction,
    finishAction: finishShareAction,
    failAction: failShareAction,
    resetFeedback: resetShareActionFeedback,
  } = useShareActionFeedback();
  const {
    user,
    charViewMode,
    setCharViewMode,
    poolsArray,
    accountHistory,
    currentPool,
    currentPoolHistory,
    allLimitedHistory,
    selectedPools,
    normalizedPoolType,
    hasPoolData,
    isGroupMode,
    isAllPoolsOverview,
    hasMergedAccountView,
    normalizedPoolHistory,
    crossPoolPityMap,
    stats,
    effectivePity,
    groupedHistory,
    characterStats,
    checkLimitedInFirstN,
    hasReceivedFreeTen,
    includeFreePullsInStats,
    setIncludeFreePullsInStats,
    dashboardResourceSummary,
    resourceSummaryVariant,
    isAnalysisBacked,
    snapshotSplitOverviewStats,
    snapshotTimelineSections,
  } = useDashboardViewState();

  React.useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const shouldOpenShareMenu = searchParams.get('share') === 'open';

    if (shouldOpenShareMenu) {
      setShowShareMenu(true);
    }
  }, [location.search]);
  React.useEffect(() => {
    const state = location.state || {};
    if (state.dashboardCharViewMode === 'waterfall') {
      setCharViewMode('waterfall');
    }
    if (state.dashboardOverviewPoolFilter) {
      setAllOverviewPoolFilter(state.dashboardOverviewPoolFilter);
    }
  }, [location.state, setCharViewMode]);
  const allOverviewFilterOptions = React.useMemo(
    () =>
      ALL_OVERVIEW_FILTER_OPTIONS.map((option) => ({
        ...option,
        label: t(`dashboard.overview.filter.${option.id}`),
      })),
    [t]
  );
  const pullUnitLabel = isEnglish ? 'PULLS' : t('dashboard.unit.pull');
  const characterPoolLabel = isEnglish ? 'Character Banner' : '角色池';
  const weaponPoolLabel = isEnglish ? 'Weapon Banner' : '武器池';
  const standardSixLabel = isEnglish ? 'Standard 6★' : '常驻6★';
  const crossBannerSummary = isEnglish ? 'Cross-banner summary' : '跨卡池汇总';
  const offrateShort = isEnglish ? 'Off-rate' : '歪';
  const localizedCurrentPoolName = React.useMemo(
    () => localizePoolName(currentPool, { locale }),
    [currentPool, locale]
  );
  const totalPullBannerTitle = isGroupMode
    ? isEnglish
      ? `${localizedCurrentPoolName || ''} Total Pulls`
      : `${localizedCurrentPoolName || ''}总投入`
    : isEnglish
      ? 'Current Banner Total Pulls'
      : '当前卡池总投入';
  const primarySixStarLabel = isAllPoolsOverview
    ? t('dashboard.overview.targetSixStar')
    : normalizedPoolType === 'weapon'
      ? t('dashboard.overview.upWeapon')
      : t('dashboard.average.limitedSix');
  const secondarySixStarLabel = isAllPoolsOverview ? t('dashboard.overview.offrateSixStar') : standardSixLabel;
  const resourceSummaryTitle = isGroupMode
    ? t('dashboard.resources.groupTitle', { name: localizedCurrentPoolName || '' })
    : t('dashboard.resources.title');
  const formatPercentValue = React.useCallback(
    (value) =>
      formatNumber(value, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [formatNumber]
  );
  const localizeChartData = React.useCallback(
    (items = [], primaryLabel, secondaryLabel) =>
      localizeDashboardChartItems(items, {
        primarySixStarLabel: primaryLabel,
        secondarySixStarLabel: secondaryLabel,
      }),
    []
  );
  const customShareRecordCountByPoolId = React.useMemo(() => {
    const counts = new Map();
    accountHistory.forEach((item) => {
      const poolId = getHistoryPoolId(item);
      if (!poolId) {
        return;
      }

      counts.set(poolId, (counts.get(poolId) || 0) + 1);
    });
    return counts;
  }, [accountHistory]);
  const customShareCandidatePools = React.useMemo(
    () => poolsArray.filter((pool) => customShareRecordCountByPoolId.has(pool?.id)),
    [customShareRecordCountByPoolId, poolsArray]
  );
  const customShareCandidateIdSet = React.useMemo(
    () => new Set(customShareCandidatePools.map((pool) => pool.id)),
    [customShareCandidatePools]
  );
  const customSharePoolGroups = React.useMemo(() => {
    const poolPullCounts = Object.fromEntries(
      customShareCandidatePools.map((pool) => [pool.id, customShareRecordCountByPoolId.get(pool.id) || 0])
    );

    return buildPoolSelectorGroups({
      pools: customShareCandidatePools,
      poolPullCounts,
      locale,
    }).map((group) => ({
      id: group.groupId,
      label: group.label,
      pools: group.pools,
    }));
  }, [customShareCandidatePools, customShareRecordCountByPoolId, locale]);

  React.useEffect(() => {
    setCustomShareExpandedGroupIds((previous) =>
      previous.filter((groupId) => customSharePoolGroups.some((group) => group.id === groupId))
    );
  }, [customSharePoolGroups]);

  React.useEffect(() => {
    setCustomSharePoolIds((previous) => {
      const validSelection = previous.filter((poolId) => customShareCandidateIdSet.has(poolId));
      if (validSelection.length > 0) {
        return validSelection;
      }

      const fallbackSelection = (isGroupMode ? selectedPools : [currentPool])
        .map((pool) => pool?.id)
        .filter((poolId) => customShareCandidateIdSet.has(poolId));

      return [...new Set(fallbackSelection)];
    });
  }, [currentPool, customShareCandidateIdSet, isGroupMode, selectedPools]);

  const allOverviewFilterPoolIds = React.useMemo(() => {
    if (!isAllPoolsOverview || allOverviewPoolFilter === 'all') {
      return null;
    }

    return new Set(
      selectedPools.filter((pool) => getOverviewPoolBucket(pool) === allOverviewPoolFilter).map((pool) => pool.id)
    );
  }, [allOverviewPoolFilter, isAllPoolsOverview, selectedPools]);
  const overviewStatsSelection = React.useMemo(() => {
    if (!isAllPoolsOverview) {
      return {
        pools: selectedPools,
        poolIds: null,
      };
    }

    const characterTypeSet = new Set(characterOverviewPoolTypes);
    const weaponTypeSet = new Set(weaponOverviewPoolTypes);
    const pools = selectedPools.filter((pool) => {
      const typeKey = getOverviewPoolTypeKey(pool);
      if (typeKey === 'weapon_limited' || typeKey === 'weapon_standard') {
        return weaponTypeSet.has(typeKey);
      }
      return characterTypeSet.has(typeKey);
    });

    return {
      pools,
      poolIds: new Set(pools.map((pool) => pool.id).filter(Boolean)),
    };
  }, [characterOverviewPoolTypes, isAllPoolsOverview, selectedPools, weaponOverviewPoolTypes]);
  const overviewStatsHistory = React.useMemo(() => {
    if (!isAllPoolsOverview || !overviewStatsSelection.poolIds) {
      return normalizedPoolHistory;
    }

    return normalizedPoolHistory.filter((item) => {
      const poolId = getHistoryPoolId(item);
      return poolId && overviewStatsSelection.poolIds.has(poolId);
    });
  }, [isAllPoolsOverview, normalizedPoolHistory, overviewStatsSelection]);
  const visibleLimitedPoolIds = React.useMemo(
    () =>
      new Set(
        selectedPools
          .filter((pool) => {
            if (pool?.type !== 'limited' && pool?.type !== 'limited_character') {
              return false;
            }

            if (!allOverviewFilterPoolIds) {
              return true;
            }

            return allOverviewFilterPoolIds.has(pool.id);
          })
          .map((pool) => pool.id)
          .filter(Boolean)
      ),
    [allOverviewFilterPoolIds, selectedPools]
  );

  const visibleCharacterStats = React.useMemo(() => {
    if (
      !isAllPoolsOverview
      || !allOverviewFilterPoolIds
      || (isAnalysisBacked && !hasCompleteRawHistory)
    ) {
      return characterStats;
    }

    const filteredHistory = normalizedPoolHistory.filter((item) => {
      const poolId = item?.poolId || item?.pool_id || null;
      return poolId && allOverviewFilterPoolIds.has(poolId);
    });

    return buildCharacterStats({
      history: filteredHistory,
      isLimitedPool: normalizedPoolType === 'limited',
      limitedPoolIds: visibleLimitedPoolIds,
      crossPoolPityMap,
      includeFreePullsInStats,
    });
  }, [
    allOverviewFilterPoolIds,
    characterStats,
    crossPoolPityMap,
    hasCompleteRawHistory,
    isAllPoolsOverview,
    isAnalysisBacked,
    normalizedPoolHistory,
    normalizedPoolType,
    visibleLimitedPoolIds,
    includeFreePullsInStats,
  ]);

  const visibleTotalCharacterCount = React.useMemo(
    () => visibleCharacterStats.reduce((sum, char) => sum + char.count, 0),
    [visibleCharacterStats]
  );
  const analysisPity = React.useMemo(
    () => getPoolAnalysisPityState(currentPool, stats, effectivePity),
    [currentPool, effectivePity, stats]
  );
  const overviewAnalysisPityMap = React.useMemo(() => {
    if (!isGroupMode) {
      return null;
    }

    return buildOverviewPoolAnalysisPityMap({
      pools: selectedPools,
      history: normalizedPoolHistory,
      allLimitedHistory,
    });
  }, [allLimitedHistory, isGroupMode, normalizedPoolHistory, selectedPools]);
  const timelineSections = React.useMemo(
    () => {
      if (isAnalysisBacked && Array.isArray(snapshotTimelineSections)) {
        return snapshotTimelineSections;
      }
      if (isAnalysisBacked && !hasCompleteRawHistory) {
        return [];
      }
      return buildDashboardTimelineSections({
        currentPool,
        currentPoolHistory: normalizedPoolHistory,
        groupedHistory,
        selectedPools,
        crossPoolPityMap,
        isGroupMode,
        isAllPoolsOverview,
        effectivePity,
        analysisPity,
        overviewAnalysisPityMap,
        overviewPoolFilter: allOverviewPoolFilter,
        hasMergedAccountView,
        locale,
        showFiveStarDrops: showTimelineFiveStarDrops,
      });
    },
    [
      allOverviewPoolFilter,
      analysisPity,
      crossPoolPityMap,
      currentPool,
      effectivePity,
      groupedHistory,
      hasMergedAccountView,
      hasCompleteRawHistory,
      isAnalysisBacked,
      isAllPoolsOverview,
      isGroupMode,
      locale,
      normalizedPoolHistory,
      overviewAnalysisPityMap,
      showTimelineFiveStarDrops,
      snapshotTimelineSections,
      selectedPools,
    ]
  );
  const splitOverviewStats = React.useMemo(() => {
    if (!isAllPoolsOverview) {
      return null;
    }

    if (isAnalysisBacked && snapshotSplitOverviewStats) {
      return snapshotSplitOverviewStats;
    }

    return buildDashboardOverviewSplitStats({
      history: overviewStatsHistory,
      selectedPools: overviewStatsSelection.pools,
      includeFreePullsInStats,
    });
  }, [
    includeFreePullsInStats,
    isAllPoolsOverview,
    isAnalysisBacked,
    overviewStatsHistory,
    overviewStatsSelection,
    snapshotSplitOverviewStats,
  ]);
  const customShareSelectedPools = React.useMemo(
    () => customShareCandidatePools.filter((pool) => customSharePoolIds.includes(pool.id)),
    [customShareCandidatePools, customSharePoolIds]
  );
  const customSharePoolIdSet = React.useMemo(
    () => new Set(customShareSelectedPools.map((pool) => pool.id)),
    [customShareSelectedPools]
  );
  const shouldBuildCustomShareData = shareMode === 'custom'
    && (!isAnalysisBacked || hasCompleteRawHistory);
  const customShareHistory = React.useMemo(
    () =>
      shouldBuildCustomShareData
        ? accountHistory.filter((item) => customSharePoolIdSet.has(getHistoryPoolId(item)))
        : [],
    [accountHistory, customSharePoolIdSet, shouldBuildCustomShareData]
  );
  const customShareSplitStats = React.useMemo(() => {
    if (!shouldBuildCustomShareData || customShareSelectedPools.length === 0) {
      return null;
    }

    return buildDashboardOverviewSplitStats({
      history: customShareHistory,
      selectedPools: customShareSelectedPools,
      includeFreePullsInStats,
    });
  }, [customShareHistory, customShareSelectedPools, includeFreePullsInStats, shouldBuildCustomShareData]);
  const customShareTimelineSections = React.useMemo(() => {
    if (!shouldBuildCustomShareData || customShareSelectedPools.length === 0) {
      return [];
    }

    return buildDashboardTimelineSections({
      currentPool: {
        id: 'custom-share',
        name: t('dashboard.share.custom.scope'),
        type: 'all',
        isGroupMode: true,
        isAllPoolsOverview: true,
        up_character: null,
        locked: true,
      },
      currentPoolHistory: customShareHistory,
      groupedHistory: [],
      selectedPools: customShareSelectedPools,
      isGroupMode: true,
      isAllPoolsOverview: true,
      effectivePity: null,
      analysisPity: null,
      overviewAnalysisPityMap: null,
      overviewPoolFilter: 'all',
      hasMergedAccountView,
      locale,
      showFiveStarDrops: showTimelineFiveStarDrops,
    });
  }, [
    customShareHistory,
    customShareSelectedPools,
    hasMergedAccountView,
    locale,
    shouldBuildCustomShareData,
    showTimelineFiveStarDrops,
    t,
  ]);
  const customShareBucketSet = React.useMemo(
    () => new Set(customShareSelectedPools.map((pool) => getOverviewPoolBucket(pool))),
    [customShareSelectedPools]
  );
  const customSharePoolTypeLabel = React.useMemo(() => {
    if (customShareBucketSet.has('weapon') && customShareBucketSet.size > 1) {
      return isEnglish ? 'Character + Weapon Banners' : '角色池 + 武器池';
    }

    if (customShareBucketSet.has('weapon')) {
      return weaponPoolLabel;
    }

    if (customShareBucketSet.has('limited') && customShareBucketSet.has('standard')) {
      return isEnglish ? 'Character Banners' : '角色池';
    }

    if (customShareBucketSet.has('limited')) {
      return characterPoolLabel;
    }

    if (customShareBucketSet.has('standard')) {
      return isEnglish ? 'Standard Banner' : '常驻池';
    }

    return isEnglish ? 'Custom Selection' : '自选组合';
  }, [characterPoolLabel, customShareBucketSet, isEnglish, weaponPoolLabel]);
  const customShareFeatured = React.useMemo(() => {
    if (customShareSelectedPools.length !== 1) {
      return null;
    }

    const pool = customShareSelectedPools[0];
    return (
      localizePoolFeaturedName(pool, { locale }) ||
      localizeEntityName(pool?.up_character || pool?.upCharacter || null, {
        locale,
        type: getOverviewPoolBucket(pool) === 'weapon' ? 'weapon' : 'character',
      }) ||
      null
    );
  }, [customShareSelectedPools, locale]);
  const customSharePayload = React.useMemo(() => {
    if (customShareSelectedPools.length === 0 || !customShareSplitStats) {
      return null;
    }

    return buildDashboardSharePayload(
      {
        currentPool: {
          id: 'custom-share',
          name: t('dashboard.share.custom.scope'),
          type: 'all',
          isGroupMode: true,
          isAllPoolsOverview: true,
          up_character: null,
        },
        normalizedPoolType: 'all',
        isGroupMode: true,
        isAllPoolsOverview: true,
        hasMergedAccountView,
        overviewPoolFilter: 'all',
        stats: {},
        analysisPity: null,
        sections: customShareTimelineSections,
        overviewSplitStats: customShareSplitStats,
        includeFreePullsInStats,
        scopeLabelOverride: t('dashboard.share.custom.scope'),
        poolNameOverride: buildCustomSharePoolName(customShareSelectedPools, locale, isEnglish),
        poolTypeLabelOverride: customSharePoolTypeLabel,
        featuredOverride: customShareFeatured,
        showFiveStarDrops: showTimelineFiveStarDrops,
      },
      locale
    );
  }, [
    customShareFeatured,
    customSharePoolTypeLabel,
    customShareSelectedPools,
    customShareSplitStats,
    customShareTimelineSections,
    hasMergedAccountView,
    includeFreePullsInStats,
    isEnglish,
    locale,
    showTimelineFiveStarDrops,
    t,
  ]);
  const dashboardSharePayload = React.useMemo(
    () =>
      buildDashboardSharePayload(
        {
          currentPool,
          normalizedPoolType,
          isGroupMode,
          isAllPoolsOverview,
          hasMergedAccountView,
          overviewPoolFilter: allOverviewPoolFilter,
          stats,
          analysisPity,
          sections: timelineSections,
          overviewSplitStats: splitOverviewStats,
          includeFreePullsInStats,
          showFiveStarDrops: showTimelineFiveStarDrops,
        },
        locale
      ),
    [
      allOverviewPoolFilter,
      analysisPity,
      currentPool,
      hasMergedAccountView,
      isAllPoolsOverview,
      isGroupMode,
      includeFreePullsInStats,
      locale,
      normalizedPoolType,
      showTimelineFiveStarDrops,
      splitOverviewStats,
      stats,
      timelineSections,
    ]
  );
  const hasDashboardShareData = (Number(stats?.total) || 0) > 0 || timelineSections.length > 0;
  const hasCustomShareData = customShareSelectedPools.length > 0 && customShareTimelineSections.length > 0;
  const isCustomShareMode = shareMode === 'custom' && hasCustomShareData;
  const activeSharePayload = isCustomShareMode ? customSharePayload : dashboardSharePayload;
  const activeTimelineSections = isCustomShareMode ? customShareTimelineSections : timelineSections;
  const hasActiveShareData = isCustomShareMode ? hasCustomShareData : hasDashboardShareData;
  const clipboardImageWarmKey = React.useMemo(
    () =>
      hasActiveShareData && activeSharePayload
        ? JSON.stringify({
            locale,
            theme: resolvedShareTheme,
            payload: activeSharePayload,
          })
        : null,
    [activeSharePayload, hasActiveShareData, locale, resolvedShareTheme]
  );
  const canOpenShareMenu = hasDashboardShareData || customShareCandidatePools.length > 0;
  const supportsNativeImageShare = React.useMemo(() => {
    if (typeof window === 'undefined' || typeof File === 'undefined' || typeof navigator?.share !== 'function') {
      return false;
    }

    if (typeof navigator.canShare !== 'function') {
      return false;
    }

    try {
      return navigator.canShare({
        files: [new File(['share'], 'share.txt', { type: 'text/plain' })],
      });
    } catch {
      return false;
    }
  }, []);
  const supportsClipboardImageCopy = React.useMemo(() => canCopyImageToClipboard(), []);
  const isFirefoxClipboardBrowser = React.useMemo(() => isFirefoxBrowser(), []);
  const isClipboardImageReady = React.useMemo(() => {
    if (!supportsClipboardImageCopy) {
      return false;
    }

    if (!isFirefoxClipboardBrowser) {
      return true;
    }

    return clipboardImageReadyKey === clipboardImageWarmKey;
  }, [clipboardImageReadyKey, clipboardImageWarmKey, isFirefoxClipboardBrowser, supportsClipboardImageCopy]);
  const copyImageMenuLabel =
    isFirefoxClipboardBrowser && (clipboardImageWarmState === 'preparing' || !isClipboardImageReady)
      ? t('dashboard.share.progress.prepareClipboardImage')
      : t('dashboard.share.copyImage');
  const shouldMountShareCard =
    hasActiveShareData &&
    activeSharePayload &&
    (showShareMenu || isShareActionBusy || (supportsClipboardImageCopy && isFirefoxClipboardBrowser));

  React.useEffect(() => {
    if (!showShareMenu) {
      return undefined;
    }

    const handleOutsideClick = (event) => {
      if (!shareMenuRef.current?.contains(event.target)) {
        setShowShareMenu(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showShareMenu]);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    writeStorageValue(STORAGE_KEYS.DASHBOARD_SHARE_THEME_MODE, shareThemeMode, { raw: true });
  }, [shareThemeMode]);

  const activeShareAction = shareActionFeedback.action;
  const shareTriggerLabel =
    shareActionFeedback.phase === 'running'
      ? activeShareAction === 'download'
        ? t('dashboard.share.trigger.downloading')
        : activeShareAction === 'copy-image' || activeShareAction === 'copy-text'
          ? t('dashboard.share.trigger.copying')
          : t('dashboard.share.trigger.sharing')
      : t('dashboard.share.trigger.idle');

  const handleCopyShareText = React.useCallback(async () => {
    if (!hasActiveShareData || !activeSharePayload) {
      showToast?.(t('dashboard.share.noData'), 'warning');
      return;
    }

    if (!beginShareAction('copy-text', t('dashboard.share.progress.copyText'))) {
      return;
    }

    try {
      const shareText = buildDashboardShareText(activeSharePayload, locale);
      const success = await copyToClipboard(shareText);
      const message = success ? t('dashboard.share.copyTextSuccess') : t('dashboard.share.copyTextFailure');
      if (success) {
        finishShareAction('copy-text', message);
      } else {
        failShareAction('copy-text', message);
      }
      showToast?.(message, success ? 'success' : 'error');
    } catch {
      const message = t('dashboard.share.copyTextFailure');
      failShareAction('copy-text', message);
      showToast?.(message, 'error');
    }
  }, [
    activeSharePayload,
    beginShareAction,
    failShareAction,
    finishShareAction,
    hasActiveShareData,
    locale,
    showToast,
    t,
  ]);

  const waitForShareCard = React.useCallback(async () => {
    if (shareCardRef.current) return shareCardRef.current;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return shareCardRef.current;
  }, []);

  const getActiveShareImageBlob = React.useCallback(async () => {
    const cardNode = await waitForShareCard();
    if (!cardNode) {
      return null;
    }

    const cacheKey = JSON.stringify({
      locale,
      theme: resolvedShareTheme,
      payload: activeSharePayload,
    });
    const cacheBucket = 'full';
    const cache = shareImageCacheRef.current[cacheBucket];

    if (cache.key === cacheKey && cache.blob) {
      setClipboardImageReadyKey(cacheKey);
      return cache.blob;
    }

    if (cache.key === cacheKey && cache.promise) {
      return cache.promise;
    }

    const renderPromise = renderShareCardToBlob(cardNode, {
      backgroundColor: resolvedShareTheme === 'dark' ? '#09090b' : '#f4f4f5',
    })
      .then((blob) => {
        shareImageCacheRef.current[cacheBucket] = {
          key: cacheKey,
          blob,
          promise: null,
        };
        setClipboardImageReadyKey(cacheKey);
        return blob;
      })
      .catch((error) => {
        if (shareImageCacheRef.current[cacheBucket].key === cacheKey) {
          shareImageCacheRef.current[cacheBucket] = {
            key: null,
            blob: null,
            promise: null,
          };
        }
        setClipboardImageReadyKey((previous) => (previous === cacheKey ? null : previous));
        throw error;
      });

    shareImageCacheRef.current[cacheBucket] = {
      key: cacheKey,
      blob: null,
      promise: renderPromise,
    };

    return renderPromise;
  }, [activeSharePayload, locale, resolvedShareTheme, waitForShareCard]);

  const prewarmClipboardShareImage = React.useCallback(() => {
    if (!supportsClipboardImageCopy || !hasActiveShareData || !activeSharePayload) {
      return Promise.resolve(null);
    }

    if (isClipboardImageReady) {
      setClipboardImageWarmState('ready');
      return Promise.resolve(shareImageCacheRef.current.full.blob);
    }

    setClipboardImageWarmState((previous) => (previous === 'ready' ? previous : 'preparing'));
    return getActiveShareImageBlob('full')
      .then((blob) => {
        setClipboardImageWarmState('ready');
        return blob;
      })
      .catch((error) => {
        setClipboardImageWarmState('idle');
        throw error;
      });
  }, [
    activeSharePayload,
    getActiveShareImageBlob,
    hasActiveShareData,
    isClipboardImageReady,
    supportsClipboardImageCopy,
  ]);

  React.useEffect(() => {
    setClipboardImageReadyKey(null);
    setClipboardImageWarmState('idle');
  }, [clipboardImageWarmKey]);

  React.useEffect(() => {
    if (!hasActiveShareData || !activeSharePayload || !supportsClipboardImageCopy) {
      return;
    }

    if (!showShareMenu && !isFirefoxClipboardBrowser) {
      return;
    }

    prewarmClipboardShareImage().catch(() => {});
  }, [
    activeSharePayload,
    hasActiveShareData,
    isFirefoxClipboardBrowser,
    prewarmClipboardShareImage,
    showShareMenu,
    supportsClipboardImageCopy,
  ]);

  const handleShareImage = React.useCallback(async () => {
    if (!hasActiveShareData || !activeSharePayload) {
      showToast?.(t('dashboard.share.noData'), 'warning');
      return;
    }

    if (!beginShareAction('share', t('dashboard.share.progress.generateImage'))) {
      return;
    }

    const cardNode = await waitForShareCard();
    if (!cardNode) {
      const message = t('dashboard.share.notReady');
      failShareAction('share', message);
      showToast?.(message, 'error');
      return;
    }

    try {
      const blob = await getActiveShareImageBlob('full');
      const fileName = buildDashboardShareCardFileName(activeSharePayload, locale);
      const file = buildShareFile(blob, fileName);

      if (file && supportsNativeImageShare && canNativeShareFile(file)) {
        updateShareAction('share', t('dashboard.share.progress.openSystemShare'));
        await shareImageFile(file, {
          title: t('share.dashboard.scope', { scope: activeSharePayload.scopeLabel }),
          text: buildDashboardShareText(activeSharePayload, locale),
        });
        const message = t('dashboard.share.systemOpened');
        finishShareAction('share', message);
        showToast?.(message, 'success');
        return;
      }

      updateShareAction('share', t('dashboard.share.progress.downloadImage'));
      const downloaded = downloadShareCard(blob, fileName);
      const message = downloaded
        ? t('dashboard.share.systemUnavailableDownloaded')
        : t('dashboard.share.downloadFailure');
      if (downloaded) {
        finishShareAction('share', message);
      } else {
        failShareAction('share', message);
      }
      showToast?.(message, downloaded ? 'success' : 'error');
    } catch (error) {
      if (error?.name === 'AbortError') {
        resetShareActionFeedback();
        return;
      }

      appLogger.error('[DashboardView] share card generation failed:', error);
      const message = t('dashboard.share.generateFailure');
      failShareAction('share', message);
      showToast?.(message, 'error');
    }
  }, [
    activeSharePayload,
    beginShareAction,
    failShareAction,
    finishShareAction,
    hasActiveShareData,
    resetShareActionFeedback,
    getActiveShareImageBlob,
    locale,
    showToast,
    supportsNativeImageShare,
    t,
    updateShareAction,
    waitForShareCard,
  ]);

  const handleDownloadShareImage = React.useCallback(async () => {
    if (!hasActiveShareData || !activeSharePayload) {
      showToast?.(t('dashboard.share.noData'), 'warning');
      return;
    }

    if (!beginShareAction('download', t('dashboard.share.progress.generateImage'))) {
      return;
    }

    const cardNode = await waitForShareCard();
    if (!cardNode) {
      const message = t('dashboard.share.notReady');
      failShareAction('download', message);
      showToast?.(message, 'error');
      return;
    }

    try {
      const blob = await getActiveShareImageBlob('full');
      updateShareAction('download', t('dashboard.share.progress.saveImage'));
      const fileName = buildDashboardShareCardFileName(activeSharePayload, locale);
      const downloaded = downloadShareCard(blob, fileName);
      const message = downloaded ? t('dashboard.share.downloadSuccess') : t('dashboard.share.downloadFailure');
      if (downloaded) {
        finishShareAction('download', message);
      } else {
        failShareAction('download', message);
      }
      showToast?.(message, downloaded ? 'success' : 'error');
    } catch {
      const message = t('dashboard.share.generateFailure');
      failShareAction('download', message);
      showToast?.(message, 'error');
    }
  }, [
    activeSharePayload,
    beginShareAction,
    failShareAction,
    finishShareAction,
    hasActiveShareData,
    getActiveShareImageBlob,
    locale,
    showToast,
    t,
    updateShareAction,
    waitForShareCard,
  ]);

  const handleCopyShareImage = React.useCallback(async () => {
    if (!hasActiveShareData || !activeSharePayload) {
      showToast?.(t('dashboard.share.noData'), 'warning');
      return;
    }

    if (!beginShareAction('copy-image', t('dashboard.share.progress.generateCopyImage'))) {
      return;
    }

    const cardNode = await waitForShareCard();
    if (!cardNode) {
      const message = t('dashboard.share.notReady');
      failShareAction('copy-image', message);
      showToast?.(message, 'error');
      return;
    }

    if (!supportsClipboardImageCopy) {
      const message = t('dashboard.share.browserCopyUnsupported');
      failShareAction('copy-image', message);
      showToast?.(message, 'warning');
      return;
    }

    if (isFirefoxClipboardBrowser && !isClipboardImageReady) {
      prewarmClipboardShareImage().catch(() => {});
      const message = t('dashboard.share.copyImagePreparing');
      failShareAction('copy-image', message);
      showToast?.(message, 'warning');
      return;
    }

    try {
      const blob = await getActiveShareImageBlob('full');
      updateShareAction('copy-image', t('dashboard.share.progress.writeClipboard'));
      const copied = await copyImageBlobToClipboard(blob);
      const message = copied ? t('dashboard.share.copyImageSuccess') : t('dashboard.share.copyImageFailure');
      if (copied) {
        finishShareAction('copy-image', message);
      } else {
        failShareAction('copy-image', message);
      }
      showToast?.(message, copied ? 'success' : 'error');
    } catch {
      const message = t('dashboard.share.copyImageFailure');
      failShareAction('copy-image', message);
      showToast?.(message, 'error');
    }
  }, [
    activeSharePayload,
    beginShareAction,
    failShareAction,
    finishShareAction,
    hasActiveShareData,
    getActiveShareImageBlob,
    isClipboardImageReady,
    isFirefoxClipboardBrowser,
    prewarmClipboardShareImage,
    showToast,
    supportsClipboardImageCopy,
    t,
    updateShareAction,
    waitForShareCard,
  ]);

  const tooltipStyle = {
    borderRadius: '0px',
    border: isDark ? '1px solid #3f3f46' : '1px solid #e4e4e7',
    boxShadow: isDark ? '0 4px 6px -1px rgb(0 0 0 / 0.3)' : '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    fontSize: '12px',
    backgroundColor: isDark ? '#18181b' : '#ffffff',
    color: isDark ? '#e4e4e7' : '#27272a',
  };
  const dashboardChartGroups = splitOverviewStats
    ? [
        {
          key: 'character',
          title: characterPoolLabel,
          total: splitOverviewStats.character.total,
          chartData: localizeChartData(
            splitOverviewStats.character.chartData,
            t('dashboard.overview.targetSixStar'),
            t('dashboard.overview.offrateSixStar')
          ),
          hasPityHistory: splitOverviewStats.character.pityStats.history.length > 0,
          distribution: splitOverviewStats.character.pityStats.distribution,
          variant: 'character',
        },
        {
          key: 'weapon',
          title: weaponPoolLabel,
          total: splitOverviewStats.weapon.total,
          chartData: localizeChartData(
            splitOverviewStats.weapon.chartData,
            t('dashboard.overview.upSixStar'),
            t('dashboard.overview.offrateSixStar')
          ),
          hasPityHistory: splitOverviewStats.weapon.pityStats.history.length > 0,
          distribution: splitOverviewStats.weapon.pityStats.distribution,
          variant: 'weapon',
        },
      ]
    : [
        {
          key: 'current',
          title: null,
          total: stats.total,
          chartData: localizeChartData(stats.chartData, primarySixStarLabel, secondarySixStarLabel),
          hasPityHistory: stats.pityStats.history.length > 0,
          distribution: stats.pityStats.distribution,
          variant: getDistributionVariant(normalizedPoolType),
        },
      ];

  // 只有已经成功读取的空快照才会到达这里；加载和错误状态由
  // PersonalDataBoundary 处理。
  if (!hasPoolData) {
    return (
      <div className="space-y-6">
        {/* 欢迎提示 */}
        {user && (
          <div className="bg-gradient-to-br from-zinc-50 to-slate-50 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-800 p-8 text-center">
            <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload size={28} className="text-zinc-400 dark:text-zinc-500" />
            </div>
            <h3 className="font-bold text-lg text-slate-700 dark:text-zinc-300 mb-2">
              {t('dashboard.empty.startRecordTitle')}
            </h3>
            <p className="text-sm text-slate-500 dark:text-zinc-500 max-w-md mx-auto">
              {t('dashboard.empty.startRecordBody')}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {shouldMountShareCard && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: '-200vw',
            top: 0,
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          <DashboardShareCard
            ref={shareCardRef}
            payload={activeSharePayload}
            sections={activeTimelineSections}
            theme={resolvedShareTheme}
            showFiveStarDrops={showTimelineFiveStarDrops}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 左列：保底机制分析 (聚合模式下隐藏) */}
        {!isGroupMode && (
          <div className="md:col-span-1 space-y-6">
            <PoolAnalysisCard
              currentPool={currentPool}
              stats={stats}
              effectivePity={effectivePity}
              checkLimitedInFirstN={checkLimitedInFirstN}
              hasReceivedFreeTen={hasReceivedFreeTen}
              hasMergedAccountView={hasMergedAccountView}
            />
          </div>
        )}

        {/* 右列：详细数据与图表（聚合模式下全宽） */}
        <div className={`${isGroupMode ? 'md:col-span-3' : 'md:col-span-2'} space-y-6`}>
          {splitOverviewStats ? (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <OverviewBanner
                  title={t('dashboard.overview.characterTotal')}
                  value={formatNumber(splitOverviewStats.character.total)}
                  accentClass="rainbow-text"
                  unitLabel={pullUnitLabel}
                >
                  <div className="space-y-4">
                    <FreePullStatsToggle
                      enabled={includeFreePullsInStats}
                      onToggle={() => setIncludeFreePullsInStats((value) => !value)}
                      t={t}
                    />
                    <OverviewTypeMultiSelect
                      title={t('dashboard.overview.characterTypeFilter')}
                      options={CHARACTER_OVERVIEW_TYPE_OPTIONS}
                      value={characterOverviewPoolTypes}
                      onChange={setCharacterOverviewPoolTypes}
                      t={t}
                    />
                  </div>
                </OverviewBanner>
                <OverviewBanner
                  title={t('dashboard.overview.weaponTotal')}
                  value={formatNumber(splitOverviewStats.weapon.total)}
                  accentClass="text-amber-600 dark:text-amber-400"
                  unitLabel={pullUnitLabel}
                >
                  <OverviewTypeMultiSelect
                    title={t('dashboard.overview.weaponTypeFilter')}
                    options={WEAPON_OVERVIEW_TYPE_OPTIONS}
                    value={weaponOverviewPoolTypes}
                    onChange={setWeaponOverviewPoolTypes}
                    t={t}
                  />
                </OverviewBanner>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-500">
                    {t('dashboard.overview.characterStats')}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <StatBox
                      title={t('dashboard.overview.targetSixStar')}
                      value={splitOverviewStats.character.counts[6]}
                      subValue={
                        splitOverviewStats.character.totalSixStar > 0
                          ? t('dashboard.overview.allSixRate', {
                              percent: formatPercentValue(
                                (splitOverviewStats.character.counts[6] / splitOverviewStats.character.totalSixStar) *
                                  100
                              ),
                            })
                          : t('dashboard.empty.noSixStarData')
                      }
                      colorClass="rainbow-text"
                      icon={Star}
                      isAnimated
                    />
                    <StatBox
                      title={t('dashboard.overview.offrateSixStar')}
                      value={splitOverviewStats.character.counts['6_std']}
                      subValue={t('dashboard.overview.characterSummary')}
                      colorClass="text-red-600 dark:text-red-400"
                      icon={Star}
                    />
                    <StatBox
                      title={t('dashboard.overview.fiveStarTotal')}
                      value={splitOverviewStats.character.counts[5]}
                      subValue={t('dashboard.overview.ratio', {
                        percent: formatPercentValue(
                          splitOverviewStats.character.total > 0
                            ? (splitOverviewStats.character.counts[5] / splitOverviewStats.character.total) * 100
                            : 0
                        ),
                      })}
                      colorClass="text-amber-600 dark:text-amber-400"
                      icon={Star}
                    />
                    <StatBox
                      title={t('dashboard.overview.fourStarTotal')}
                      value={splitOverviewStats.character.counts[4]}
                      subValue={t('dashboard.overview.ratio', {
                        percent: formatPercentValue(
                          splitOverviewStats.character.total > 0
                            ? (splitOverviewStats.character.counts[4] / splitOverviewStats.character.total) * 100
                            : 0
                        ),
                      })}
                      colorClass="text-purple-600 dark:text-purple-400"
                      icon={Star}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <StatBox
                      title={t('dashboard.overview.targetSixStarRate')}
                      value={`${splitOverviewStats.character.winRate}%`}
                      subValue={`${splitOverviewStats.character.winRateTargetCount || 0}/${splitOverviewStats.character.winRateTotalCount || 0}`}
                      colorClass="text-green-600 dark:text-green-400"
                      icon={TrendingUp}
                    />
                    <StatBox
                      title={t('dashboard.overview.allSixStar')}
                      value={splitOverviewStats.character.totalSixStar}
                      subValue={t('dashboard.pool.totalPulls', { count: splitOverviewStats.character.total })}
                      colorClass="text-slate-700 dark:text-zinc-200"
                      icon={Star}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-500">
                    {t('dashboard.overview.weaponStats')}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <StatBox
                      title={t('dashboard.overview.upSixStar')}
                      value={splitOverviewStats.weapon.counts[6]}
                      subValue={
                        splitOverviewStats.weapon.totalSixStar > 0
                          ? t('dashboard.overview.allSixRate', {
                              percent: formatPercentValue(
                                (splitOverviewStats.weapon.counts[6] / splitOverviewStats.weapon.totalSixStar) * 100
                              ),
                            })
                          : t('dashboard.empty.noSixStarData')
                      }
                      colorClass="text-amber-600 dark:text-amber-400"
                      icon={Star}
                    />
                    <StatBox
                      title={t('dashboard.overview.offrateSixStar')}
                      value={splitOverviewStats.weapon.counts['6_std']}
                      subValue={t('dashboard.overview.weaponSummary')}
                      colorClass="text-red-600 dark:text-red-400"
                      icon={Star}
                    />
                    <StatBox
                      title={t('dashboard.overview.fiveStarTotal')}
                      value={splitOverviewStats.weapon.counts[5]}
                      subValue={t('dashboard.overview.ratio', {
                        percent: formatPercentValue(
                          splitOverviewStats.weapon.total > 0
                            ? (splitOverviewStats.weapon.counts[5] / splitOverviewStats.weapon.total) * 100
                            : 0
                        ),
                      })}
                      colorClass="text-amber-600 dark:text-amber-400"
                      icon={Star}
                    />
                    <StatBox
                      title={t('dashboard.overview.fourStarTotal')}
                      value={splitOverviewStats.weapon.counts[4]}
                      subValue={t('dashboard.overview.ratio', {
                        percent: formatPercentValue(
                          splitOverviewStats.weapon.total > 0
                            ? (splitOverviewStats.weapon.counts[4] / splitOverviewStats.weapon.total) * 100
                            : 0
                        ),
                      })}
                      colorClass="text-purple-600 dark:text-purple-400"
                      icon={Star}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <StatBox
                      title={t('dashboard.overview.upSixStarRate')}
                      value={`${splitOverviewStats.weapon.winRate}%`}
                      subValue={`${splitOverviewStats.weapon.winRateTargetCount || 0}/${splitOverviewStats.weapon.winRateTotalCount || 0}`}
                      colorClass="text-green-600 dark:text-green-400"
                      icon={TrendingUp}
                    />
                    <StatBox
                      title={t('dashboard.overview.allSixStar')}
                      value={splitOverviewStats.weapon.totalSixStar}
                      subValue={t('dashboard.pool.totalPulls', { count: splitOverviewStats.weapon.total })}
                      colorClass="text-slate-700 dark:text-zinc-200"
                      icon={Star}
                    />
                  </div>
                </div>
              </div>

              <DeferredSection
                title={t('dashboard.chart.deepAnalysis', {}, '资源、平均与趋势')}
                description={t('dashboard.chart.deepAnalysisHint', {}, '按需展开角色池与武器池的长期统计，避免阻塞核心结果。')}
                contentClassName="space-y-6"
              >
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <AveragePullStatsPanel
                    stats={splitOverviewStats.character}
                    poolType="limited"
                    isAllPoolsOverview={true}
                  />
                  <AveragePullStatsPanel stats={splitOverviewStats.weapon} poolType="weapon" isAllPoolsOverview={true} />
                </div>
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <ResourceSummaryPanel
                    title={t('dashboard.resources.groupTitle', { name: characterPoolLabel })}
                    resources={splitOverviewStats.character.resourceSummary}
                    variant="character"
                    layout="fixed3"
                    className="bg-white dark:bg-zinc-900 shadow-sm"
                  />
                  <ResourceSummaryPanel
                    title={t('dashboard.resources.groupTitle', { name: weaponPoolLabel })}
                    resources={splitOverviewStats.weapon.resourceSummary}
                    variant="weapon"
                    layout="fixed3"
                    className="bg-white dark:bg-zinc-900 shadow-sm"
                  />
                </div>
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <React.Suspense fallback={<div className="p-6 text-center text-sm text-zinc-500">{t('common.loading')}</div>}>
                    <DashboardCharts groups={dashboardChartGroups} isDark={isDark} tooltipStyle={tooltipStyle} />
                  </React.Suspense>
                </div>
              </DeferredSection>
            </>
          ) : (
            <>
              {/* 总投入 Banner */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 flex items-center justify-between shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 h-full w-32 bg-gradient-to-l from-zinc-50 dark:from-zinc-800 to-transparent"></div>
                <div className="relative z-10">
                  <h3 className="text-xs text-slate-500 dark:text-zinc-500 font-bold uppercase tracking-wider mb-1">
                    {totalPullBannerTitle}
                  </h3>
                  <div className="text-4xl font-black font-mono text-slate-800 dark:text-zinc-100 flex items-baseline gap-2">
                    {formatNumber(stats.total)}
                    <span className="text-lg font-medium text-slate-400 dark:text-zinc-600">{pullUnitLabel}</span>
                  </div>
                </div>
                {(normalizedPoolType === 'limited' || normalizedPoolType === 'extra') && (
                  <div className="relative z-10 w-full max-w-[18rem]">
                    <FreePullStatsToggle
                      enabled={includeFreePullsInStats}
                      onToggle={() => setIncludeFreePullsInStats((value) => !value)}
                      t={t}
                    />
                  </div>
                )}
              </div>

              {/* 核心数据网格 */}
              <div
                className={`grid grid-cols-2 ${normalizedPoolType !== 'standard' ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4`}
              >
                {normalizedPoolType !== 'standard' && (
                  <StatBox
                    title={primarySixStarLabel}
                    value={stats.counts[6]}
                    subValue={(() => {
                      if (isAllPoolsOverview) {
                        return stats.totalSixStar > 0
                          ? t('dashboard.overview.allSixRate', {
                              percent: formatPercentValue((stats.counts[6] / stats.totalSixStar) * 100),
                            })
                          : t('dashboard.empty.noSixStarData');
                      }
                      if (isGroupMode) {
                        return `${t('dashboard.analysis.winRate')} ${stats.winRate}%`;
                      }
                      let bonusCount = 0;
                      if (normalizedPoolType === 'limited') {
                        bonusCount = Math.floor(stats.total / 240);
                      } else if (normalizedPoolType === 'weapon') {
                        if (stats.total >= 180) bonusCount = 1 + Math.floor((stats.total - 180) / 160);
                      }
                      return bonusCount > 0
                        ? isEnglish
                          ? `Includes ${bonusCount} bonus`
                          : `含赠送 ${bonusCount}`
                        : t('dashboard.overview.ratio', { percent: formatPercentValue(stats.winRate) });
                    })()}
                    colorClass={normalizedPoolType === 'limited' ? 'rainbow-text' : 'text-slate-700 dark:text-zinc-300'}
                    icon={Star}
                    isAnimated={normalizedPoolType === 'limited' && !isAllPoolsOverview}
                  />
                )}
                <StatBox
                  title={secondarySixStarLabel}
                  value={stats.counts['6_std']}
                  subValue={
                    isAllPoolsOverview
                      ? crossBannerSummary
                      : normalizedPoolType === 'standard' && stats.total >= 300
                        ? isEnglish
                          ? 'Includes 1 bonus'
                          : '含赠送 1'
                        : offrateShort
                  }
                  colorClass="text-red-600 dark:text-red-400"
                  icon={Star}
                />
                <StatBox
                  title={t('dashboard.overview.fiveStarTotal')}
                  value={stats.counts[5]}
                  subValue={t('dashboard.overview.ratio', {
                    percent: formatPercentValue(stats.total > 0 ? (stats.counts[5] / stats.total) * 100 : 0),
                  })}
                  colorClass="text-amber-600 dark:text-amber-400"
                  icon={Star}
                />
                <StatBox
                  title={t('dashboard.overview.fourStarTotal')}
                  value={stats.counts[4]}
                  subValue={t('dashboard.overview.ratio', {
                    percent: formatPercentValue(stats.total > 0 ? (stats.counts[4] / stats.total) * 100 : 0),
                  })}
                  colorClass="text-purple-600 dark:text-purple-400"
                  icon={Star}
                />
              </div>

              {isGroupMode && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <StatBox
                    title={
                      isAllPoolsOverview ? t('dashboard.overview.targetSixStarRate') : t('dashboard.analysis.winRate')
                    }
                    value={`${stats.winRate}%`}
                    subValue={`${stats.upSixStarCount || 0}/${stats.sixStarCount || 0}`}
                    colorClass="text-green-600 dark:text-green-400"
                    icon={TrendingUp}
                  />
                  <StatBox
                    title={primarySixStarLabel}
                    value={stats.counts[6] ?? 0}
                    subValue={
                      isEnglish ? `Standard 6★ ${stats.counts['6_std'] ?? 0}` : `常驻6星 ${stats.counts['6_std'] ?? 0}`
                    }
                    colorClass={normalizedPoolType === 'weapon' ? 'text-slate-700 dark:text-zinc-300' : 'rainbow-text'}
                    icon={Star}
                    isAnimated={normalizedPoolType !== 'weapon' && !isAllPoolsOverview}
                  />
                </div>
              )}

              {isGroupMode && (
                <AveragePullStatsPanel
                  stats={stats}
                  poolType={normalizedPoolType}
                  isAllPoolsOverview={isAllPoolsOverview}
                />
              )}

              <DeferredSection
                title={t('dashboard.chart.deepAnalysis', {}, '资源、分布与趋势')}
                description={t('dashboard.chart.deepAnalysisHint', {}, '核心保底和出货结果优先展示；深度图表按需加载。')}
                contentClassName="grid grid-cols-1 gap-6 xl:grid-cols-3"
                defaultOpen={true}
              >
                <ResourceSummaryPanel
                  title={resourceSummaryTitle}
                  resources={dashboardResourceSummary}
                  variant={resourceSummaryVariant}
                  stacked={true}
                  className="bg-white dark:bg-zinc-900 shadow-sm"
                />
                <React.Suspense fallback={<div className="p-6 text-center text-sm text-zinc-500">{t('common.loading')}</div>}>
                  <DashboardCharts groups={dashboardChartGroups} isDark={isDark} tooltipStyle={tooltipStyle} />
                </React.Suspense>
              </DeferredSection>
            </>
          )}

          {/* 角色出货列表 (Updated Style) */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-2">
              <User size={18} className="text-slate-400 dark:text-zinc-500" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">
                {t('dashboard.chart.characterStats')}
              </h3>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {/* 视图切换按钮组 */}
                {(characterStats.length > 0 || currentPoolHistory.length > 0) && (
                  <div className="flex border border-zinc-200 dark:border-zinc-700 rounded-sm overflow-hidden">
                    <button
                      onClick={() => setCharViewMode('card')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                        charViewMode === 'card'
                          ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                          : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <LayoutGrid size={14} />
                      {t('dashboard.view.card')}
                    </button>
                    <button
                      onClick={() => setCharViewMode('waterfall')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                        charViewMode === 'waterfall'
                          ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                          : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <BarChart3 size={14} />
                      {t('dashboard.view.timeline')}
                    </button>
                  </div>
                )}
                {canOpenShareMenu && (
                  <div className="relative" ref={shareMenuRef}>
                    <button
                      type="button"
                      onClick={() => setShowShareMenu((visible) => !visible)}
                      disabled={isShareActionBusy}
                      className={`group px-3.5 py-1.5 text-xs font-bold tracking-wide transition-all rounded-sm flex items-center gap-2 bg-endfield-yellow text-black shadow-sm ${
                        isShareActionBusy
                          ? 'cursor-not-allowed opacity-70'
                          : 'hover:bg-yellow-400 hover:shadow-[0_0_16px_rgba(255,250,0,0.35)] active:scale-95'
                      }`}
                    >
                      {isShareActionBusy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Share2 size={14} className="group-hover:-rotate-12 transition-transform" />
                      )}
                      {shareTriggerLabel}
                      <ChevronDown size={12} className={`transition-transform ${showShareMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showShareMenu && (
                      <div className="absolute right-0 top-full mt-1 w-80 max-h-[70vh] overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-none shadow-lg z-50">
                        <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            {t('dashboard.share.mode')}
                          </div>
                          <div className="mt-2 flex border border-zinc-200 dark:border-zinc-700 rounded-sm overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setShareMode('current')}
                              disabled={isShareActionBusy}
                              className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                                shareMode === 'current'
                                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100'
                                  : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                              } ${isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              {t('dashboard.share.mode.current')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShareMode('custom')}
                              disabled={isShareActionBusy || customShareCandidatePools.length === 0}
                              className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                                shareMode === 'custom'
                                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100'
                                  : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                              } ${isShareActionBusy || customShareCandidatePools.length === 0 ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              {t('dashboard.share.mode.custom')}
                            </button>
                          </div>
                        </div>
                        {shareMode === 'custom' && (
                          <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                                  {t('dashboard.share.custom.title')}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                                  {t('dashboard.share.custom.description')}
                                </div>
                              </div>
                              <div className="text-[11px] font-mono text-zinc-500">
                                {t('dashboard.share.custom.selectionCount', { count: customSharePoolIds.length })}
                              </div>
                            </div>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                disabled={isShareActionBusy || customShareCandidatePools.length === 0}
                                onClick={() => setCustomSharePoolIds(customShareCandidatePools.map((pool) => pool.id))}
                                className={`px-2 py-1 text-[11px] border border-zinc-200 dark:border-zinc-700 transition-colors ${
                                  isShareActionBusy || customShareCandidatePools.length === 0
                                    ? 'cursor-not-allowed opacity-60'
                                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                }`}
                              >
                                {t('dashboard.share.custom.selectAll')}
                              </button>
                              <button
                                type="button"
                                disabled={isShareActionBusy || customSharePoolIds.length === 0}
                                onClick={() => setCustomSharePoolIds([])}
                                className={`px-2 py-1 text-[11px] border border-zinc-200 dark:border-zinc-700 transition-colors ${
                                  isShareActionBusy || customSharePoolIds.length === 0
                                    ? 'cursor-not-allowed opacity-60'
                                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                }`}
                              >
                                {t('dashboard.share.custom.clear')}
                              </button>
                            </div>
                            {customShareCandidatePools.length === 0 ? (
                              <div className="mt-3 text-[11px] text-slate-500 dark:text-zinc-400">
                                {t('dashboard.share.custom.empty')}
                              </div>
                            ) : (
                              <div className="mt-3 space-y-3">
                                {customSharePoolGroups.map((group) => (
                                  <div key={group.id}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCustomShareExpandedGroupIds((previous) =>
                                          previous.includes(group.id)
                                            ? previous.filter((groupId) => groupId !== group.id)
                                            : [...previous, group.id]
                                        );
                                      }}
                                      className="flex w-full items-center justify-between text-left"
                                    >
                                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                                        {group.label}
                                      </span>
                                      <span className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
                                        {group.pools.length}
                                        {customShareExpandedGroupIds.includes(group.id) ? (
                                          <ChevronDown size={12} />
                                        ) : (
                                          <ChevronRight size={12} />
                                        )}
                                      </span>
                                    </button>
                                    {customShareExpandedGroupIds.includes(group.id) && (
                                      <div className="mt-2 space-y-1">
                                        {group.pools.map((pool) => {
                                          const checked = customSharePoolIds.includes(pool.id);
                                          const localizedPoolName = localizePoolName(pool, { locale });
                                          const recordCount = customShareRecordCountByPoolId.get(pool.id) || 0;

                                          return (
                                            <label
                                              key={pool.id}
                                              className={`flex items-start gap-2 px-2 py-1.5 border transition-colors ${
                                                checked
                                                  ? 'border-endfield-yellow bg-yellow-50 dark:bg-yellow-500/10'
                                                  : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={isShareActionBusy}
                                                onChange={() => {
                                                  setCustomSharePoolIds((previous) =>
                                                    previous.includes(pool.id)
                                                      ? previous.filter((poolId) => poolId !== pool.id)
                                                      : [...previous, pool.id]
                                                  );
                                                }}
                                                className="mt-0.5"
                                              />
                                              <span className="min-w-0 flex-1">
                                                <span className="block text-xs text-slate-700 dark:text-zinc-200 truncate">
                                                  {localizedPoolName}
                                                </span>
                                                <span className="block text-[11px] text-zinc-500 font-mono">
                                                  {recordCount} {pullUnitLabel}
                                                </span>
                                              </span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            {t('dashboard.share.theme')}
                          </div>
                          <div className="mt-2 flex border border-zinc-200 dark:border-zinc-700 rounded-sm overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setShareThemeMode('system')}
                              disabled={isShareActionBusy}
                              className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                                shareThemeMode === 'system'
                                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100'
                                  : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                              } ${isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              {t('settings.theme.system')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShareThemeMode('light')}
                              disabled={isShareActionBusy}
                              className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                                shareThemeMode === 'light'
                                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100'
                                  : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                              } ${isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              {t('settings.theme.light')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShareThemeMode('dark')}
                              disabled={isShareActionBusy}
                              className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                                shareThemeMode === 'dark'
                                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100'
                                  : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                              } ${isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              {t('settings.theme.dark')}
                            </button>
                          </div>
                        </div>
                        {supportsNativeImageShare && (
                          <button
                            type="button"
                            disabled={isShareActionBusy || !hasActiveShareData}
                            onClick={() => {
                              setShowShareMenu(false);
                              void handleShareImage();
                            }}
                            className={`w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-zinc-400 transition-colors flex items-center gap-2 ${
                              isShareActionBusy || !hasActiveShareData
                                ? 'cursor-not-allowed opacity-60'
                                : 'hover:bg-slate-50 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <Share2 size={14} />
                            <span>{t('dashboard.share.systemImage')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isShareActionBusy || !hasActiveShareData}
                          onClick={() => {
                            setShowShareMenu(false);
                            void handleDownloadShareImage();
                          }}
                          className={`w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-zinc-400 transition-colors flex items-center gap-2 ${
                            supportsNativeImageShare ? 'border-t border-zinc-100 dark:border-zinc-800' : ''
                          } ${isShareActionBusy || !hasActiveShareData ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 dark:hover:bg-zinc-800'}`}
                        >
                          <Download size={14} />
                          <span>{t('dashboard.share.downloadImage')}</span>
                        </button>
                        {supportsClipboardImageCopy && (
                          <button
                            type="button"
                            disabled={
                              isShareActionBusy ||
                              !hasActiveShareData ||
                              (isFirefoxClipboardBrowser && !isClipboardImageReady)
                            }
                            onClick={() => {
                              setShowShareMenu(false);
                              void handleCopyShareImage();
                            }}
                            className={`w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-zinc-400 transition-colors border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2 ${
                              isShareActionBusy ||
                              !hasActiveShareData ||
                              (isFirefoxClipboardBrowser && !isClipboardImageReady)
                                ? 'cursor-not-allowed opacity-60'
                                : 'hover:bg-slate-50 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <Copy size={14} />
                            <span>{copyImageMenuLabel}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isShareActionBusy || !hasActiveShareData}
                          onClick={() => {
                            setShowShareMenu(false);
                            void handleCopyShareText();
                          }}
                          className={`w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-zinc-400 transition-colors border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2 ${
                            isShareActionBusy || !hasActiveShareData
                              ? 'cursor-not-allowed opacity-60'
                              : 'hover:bg-slate-50 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <Copy size={14} />
                          <span>{t('dashboard.share.copyText')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {shareActionFeedback.phase !== 'idle' && (
                  <ShareActionStatus
                    feedback={shareActionFeedback}
                    compact
                    className="w-full sm:w-auto sm:max-w-[280px]"
                  />
                )}
                {isAllPoolsOverview && (
                  <div className="flex border border-zinc-200 dark:border-zinc-700 rounded-sm overflow-hidden">
                    {allOverviewFilterOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setAllOverviewPoolFilter(option.id)}
                        className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                          allOverviewPoolFilter === option.id
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                            : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                {visibleTotalCharacterCount > 0 && (
                  <span className="text-xs text-slate-400 dark:text-zinc-500 font-mono">
                    {t('dashboard.totalCharacters', { count: visibleTotalCharacterCount })}
                  </span>
                )}
              </div>
            </div>

            {charViewMode === 'waterfall'
              && isAnalysisBacked
              && !hasCompleteRawHistory
              && !Array.isArray(snapshotTimelineSections) ? (
              <div className="border border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
                {isEnglish
                  ? 'The complete timeline is available after all detailed record pages are loaded.'
                  : '完整时间线将在详细记录全部分页加载后显示。'}
              </div>
            ) : charViewMode === 'waterfall' ? (
              <PoolTimelinePanel
                sections={timelineSections}
                currentPool={currentPool}
                currentPoolHistory={normalizedPoolHistory}
                groupedHistory={groupedHistory}
                selectedPools={selectedPools}
                crossPoolPityMap={crossPoolPityMap}
                isGroupMode={isGroupMode}
                isAllPoolsOverview={isAllPoolsOverview}
                effectivePity={effectivePity}
                analysisPity={analysisPity}
                overviewAnalysisPityMap={overviewAnalysisPityMap}
                overviewPoolFilter={allOverviewPoolFilter}
                hasMergedAccountView={hasMergedAccountView}
                embedded={true}
                showFiveStarDrops={showTimelineFiveStarDrops}
                onToggleShowFiveStarDrops={setShowTimelineFiveStarDrops}
              />
            ) : visibleCharacterStats.length === 0 ? (
              <div className="text-center py-8 text-slate-400 dark:text-zinc-600 text-sm">
                {t('dashboard.empty.noHighRarityRecords')}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleCharacterStats.map((char) => {
                  const isSixStar = char.rarity === 6;
                  const isLimitedChar = isSixStar && !char.isStandard;
                  const isStandardChar = isSixStar && char.isStandard;
                  const localizedCharacterName = localizeEntityName(char.name, {
                    locale,
                    type: normalizedPoolType === 'weapon' ? 'weapon' : 'character',
                  });

                  // 生成出货抽数描述
                  // 格式：68抽(#120), 24抽(#300) - 保底计数(总抽数位置)
                  const pullInfoParts = char.pullIndices.map((idx, i) => {
                    const pity = char.pities[i];
                    const isFree = idx === 'free' || pity === 'free';
                    const isInfoBook = char.infoBookFlags?.[i] === true;

                    if (isFree) {
                      return { type: 'free', text: isEnglish ? 'Free' : '免费' };
                    }

                    if (pity) {
                      // 显示 保底计数(#总抽数位置)
                      return {
                        type: isInfoBook ? 'infoBook' : 'normal',
                        text: isEnglish ? `${pity} pulls (#${idx})` : `${pity}抽(#${idx})`,
                      };
                    } else {
                      // 没有保底数据时只显示总抽数位置
                      return { type: isInfoBook ? 'infoBook' : 'normal', text: `#${idx}` };
                    }
                  });

                  return (
                    <div
                      key={char.name}
                      className={`
                        relative flex flex-col justify-between p-3 border transition-all h-full
                        hover:translate-y-[-1px] hover:shadow-sm
                        ${
                          isLimitedChar
                            ? 'bg-zinc-50 dark:bg-zinc-900/50 border-orange-200 dark:border-orange-900/30'
                            : isStandardChar
                              ? 'bg-white dark:bg-zinc-900 border-red-100 dark:border-red-900/20'
                              : 'bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800'
                        }
                      `}
                    >
                      {/* 左侧颜色条 */}
                      <div
                        className={`absolute left-0 top-0 bottom-0 w-1 ${
                          isLimitedChar ? 'rainbow-bg' : isStandardChar ? 'bg-red-500' : 'bg-amber-400'
                        }`}
                      ></div>

                      {/* 角色头像和信息 */}
                      <div className="ml-2 mb-2 flex items-start gap-2">
                        {/* 角色头像 */}
                        <div
                          className={`
                          w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden
                          ${
                            isLimitedChar
                              ? 'bg-gradient-to-br from-orange-400 to-pink-500 text-white'
                              : isStandardChar
                                ? 'bg-red-200 dark:bg-red-800 text-red-600 dark:text-red-300'
                                : 'bg-amber-200 dark:bg-amber-800 text-amber-600 dark:text-amber-300'
                          }
                        `}
                        >
                          {(() => {
                            const charData = characterCache.searchByName(char.name, false);
                            const avatarUrl = charData?.avatar_url;
                            if (avatarUrl) {
                              return (
                                <img
                                  src={avatarUrl}
                                  alt={localizedCharacterName}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'flex';
                                  }}
                                />
                              );
                            }
                            return null;
                          })()}
                          <div
                            className={`w-full h-full items-center justify-center ${
                              characterCache.searchByName(char.name, false)?.avatar_url ? 'hidden' : 'flex'
                            }`}
                          >
                            <User size={18} />
                          </div>
                        </div>

                        {/* 角色名和星星 */}
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-sm font-bold truncate ${
                              isLimitedChar ? 'text-slate-800 dark:text-zinc-200' : 'text-slate-700 dark:text-zinc-400'
                            }`}
                          >
                            {localizedCharacterName}
                          </div>
                          <div className="flex gap-0.5 mt-0.5">
                            {Array.from({ length: char.rarity }).map((_, i) => (
                              <Star
                                key={i}
                                size={8}
                                className={`${isSixStar ? 'text-orange-400' : 'text-amber-400'} fill-current`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* 底部信息栏：抽数详情 + 数量 */}
                      <div className="ml-2 mt-auto">
                        {/* 抽数详情 - 允许换行，但每项作为整体 */}
                        <div className="text-xs font-mono leading-relaxed mb-1">
                          {pullInfoParts.map((part, i) => (
                            <span key={i}>
                              <span className="whitespace-nowrap">
                                {part.type === 'free' ? (
                                  <span className="text-blue-500 font-bold">{part.text}</span>
                                ) : part.type === 'infoBook' ? (
                                  <span className="text-amber-600 dark:text-amber-400 font-bold">
                                    {isEnglish ? `Intel ${part.text}` : `情报书 ${part.text}`}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 dark:text-zinc-600">{part.text}</span>
                                )}
                              </span>
                              {i < pullInfoParts.length - 1 && (
                                <span className="text-slate-400 dark:text-zinc-600">, </span>
                              )}
                            </span>
                          ))}
                        </div>
                        {/* 数量标签 - 右下角 */}
                        <div className="flex justify-end">
                          <div className="flex items-center gap-1.5">
                            {char.infoBookCount > 0 && (
                              <div className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                                {isEnglish ? `Intel×${char.infoBookCount}` : `情报书×${char.infoBookCount}`}
                              </div>
                            )}
                            {char.freeCount > 0 && (
                              <div className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                                {isEnglish ? `Free×${char.freeCount}` : `免费×${char.freeCount}`}
                              </div>
                            )}
                            <div
                              className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                                isLimitedChar
                                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                                  : isStandardChar
                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                                    : 'bg-zinc-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-500'
                              }`}
                            >
                              x{char.count}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
