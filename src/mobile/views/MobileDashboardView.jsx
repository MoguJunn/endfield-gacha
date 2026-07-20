import React from 'react';
import { useLocation } from 'react-router-dom';
import {
  Star, Calculator, Clock, FileText,
  Layers, Swords, User, PieChart as PieChartIcon,
  BarChart3, LayoutGrid, Share2, Copy, Download, Sun, Moon, Monitor, Loader2, Database, RotateCcw, ChevronDown
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { useDashboardViewState, useToast } from '../../hooks';
import { RARITY_CONFIG } from '../../constants';
import { useTheme } from '../../contexts/ThemeContext';
import { DistributionAreaChart, RainbowGradientDefs } from '../../components/charts';
import MobileChartContainer from '../components/MobileChartContainer';
import MobilePoolRailSelector from '../components/MobilePoolRailSelector';
import ResourceSummaryPanel from '../../components/resources/ResourceSummaryPanel';
import AveragePullStatsPanel from '../../components/dashboard/AveragePullStatsPanel';
import PoolTimelinePanel from '../../components/dashboard/PoolTimelinePanel';
import DashboardShareCard from '../../components/dashboard/DashboardShareCard';
import ShareActionStatus from '../../components/share/ShareActionStatus';
import EditItemModal from '../../components/modals/EditItemModal.jsx';
import HistoryAnomalyReview from '../../components/records/HistoryAnomalyReview.jsx';
import { ConfirmDialog, Toast } from '../../components/ui';
import { calculateCurrentProbability } from '../../utils';
import { buildOverviewPoolAnalysisPityMap, getPoolAnalysisPityState } from '../../utils/poolAnalysisPity';
import { buildDashboardTimelineSections } from '../../utils/dashboardTimelineSections';
import { buildDashboardOverviewSplitStats } from '../../utils/dashboardOverviewSplitStats';
import {
  buildDashboardShareCardFileName,
  buildDashboardSharePayload,
  buildDashboardShareText
} from '../../utils/dashboardShare';
import {
  buildShareFile,
  canCopyImageToClipboard,
  canNativeShareFile,
  copyImageBlobToClipboard,
  downloadShareCard,
  isFirefoxBrowser,
  renderShareCardToBlob,
  shareImageFile
} from '../../utils/simulatorShare';
import { copyToClipboard } from '../../utils/simulatorStorage';
import useShareActionFeedback from '../../hooks/useShareActionFeedback';
import { useI18n } from '../../i18n/index.js';
import { compareHistoryTimelineDesc } from '../../utils/historyTimelineSort.js';
import { localizeEntityName, localizeHistoryItemName, localizePoolFeaturedList, localizePoolFeaturedName, localizePoolName } from '../../utils/gameDataI18n.js';
import appLogger from '../../utils/appLogger.js';
import {
  MobileStatusBadge
} from '../components/ux/MobilePrimitives.jsx';
import MobileAuthRequiredView from '../components/MobileAuthRequiredView.jsx';
import { readStorageValue, STORAGE_KEYS, writeStorageValue } from '../../utils/storageUtils.js';
import { localizeDashboardChartItems } from '../../utils/dashboardChartLabels.js';
import { normalizeShareThemeMode, resolveShareThemeMode } from '../../utils/shareThemeMode.js';
import { useHistoryStore, usePoolStore } from '../../stores';
import {
  deleteAccountGachaRecord,
  loadAccountGachaData,
  updateAccountGachaRecord,
} from '../../services/accountGachaDataService.js';

const PIE_LABEL_MIN_PERCENT = 0.05;
const PIE_LABEL_RADIAN = Math.PI / 180;

function resolvePieLabelColor(fill, isDark) {
  if (typeof fill !== 'string' || !fill.startsWith('#')) {
    return isDark ? '#fafafa' : '#ffffff';
  }

  const hex = fill.slice(1);
  const normalized = hex.length === 3
    ? hex.split('').map((char) => char + char).join('')
    : hex;

  if (normalized.length !== 6) {
    return isDark ? '#fafafa' : '#ffffff';
  }

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luma = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luma > 170 ? '#111827' : '#ffffff';
}

function renderPiePercentLabel(isDark) {
  return ({ cx, cy, midAngle, innerRadius, outerRadius, percent, fill }) => {
    if (!Number.isFinite(percent) || percent < PIE_LABEL_MIN_PERCENT) {
      return null;
    }

    const radius = innerRadius + ((outerRadius - innerRadius) * 0.58);
    const x = cx + (radius * Math.cos(-midAngle * PIE_LABEL_RADIAN));
    const y = cy + (radius * Math.sin(-midAngle * PIE_LABEL_RADIAN));

    return (
      <text
        x={x}
        y={y}
        fill={resolvePieLabelColor(fill, isDark)}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={700}
        style={{ pointerEvents: 'none' }}
      >
        {`${(percent * 100).toFixed(1)}%`}
      </text>
    );
  };
}

function getDistributionVariant(poolType) {
  if (poolType === 'weapon') {
    return 'weapon';
  }

  if (poolType === 'standard') {
    return 'standard';
  }

  return 'character';
}

function buildHistoryRecordLocator(item = {}) {
  return {
    recordId: item.id ?? item.record_id,
    gameUid: item.gameUid || item.game_uid,
    serverScope: item.serverScope || item.server_scope || item.serverId || item.server_id || 'legacy',
    currentPoolId: item.poolId || item.pool_id,
    seqId: item.seqId || item.seq_id,
  };
}

/**
 * 移动端卡池分析视图 - 工业风重构版 (中文)
 */
function MobileDashboardView() {
  const location = useLocation();
  const currentPoolId = usePoolStore(state => state.currentPoolId);
  const switchPool = usePoolStore(state => state.switchPool);
  const pools = usePoolStore(state => state.pools);
  const setHistory = useHistoryStore(state => state.setHistory);
  const { isDark } = useTheme();
  const { t, formatNumber, isEnglish, locale, formatDateTime } = useI18n();
  const { toasts, showToast, removeToast } = useToast();
  const shareCardRef = React.useRef(null);
  const [clipboardImageWarmState, setClipboardImageWarmState] = React.useState('idle');
  const [clipboardImageReadyKey, setClipboardImageReadyKey] = React.useState(null);
  const shareImageCacheRef = React.useRef({
    full: { key: null, blob: null, promise: null },
    clipboard: { key: null, blob: null, promise: null }
  });
  const [showDetailedLogs, setShowDetailedLogs] = React.useState(false);
  const [editAnomalyRecord, setEditAnomalyRecord] = React.useState(null);
  const [deleteAnomalyRecord, setDeleteAnomalyRecord] = React.useState(null);
  const [anomalyMutationBusy, setAnomalyMutationBusy] = React.useState(false);
  const anomalyMutationInFlightRef = React.useRef(false);
  const {
    feedback: shareActionFeedback,
    isBusy: isShareActionBusy,
    isActionRunning,
    beginAction: beginShareAction,
    updateAction: updateShareAction,
    finishAction: finishShareAction,
    failAction: failShareAction,
    resetFeedback: resetShareActionFeedback
  } = useShareActionFeedback();
  const [shareThemeMode, setShareThemeMode] = React.useState(() => {
    if (typeof window === 'undefined') {
      return 'system';
    }

    return normalizeShareThemeMode(readStorageValue(STORAGE_KEYS.DASHBOARD_SHARE_THEME_MODE, null, { raw: true }));
  });
  const resolvedShareTheme = React.useMemo(() => resolveShareThemeMode(shareThemeMode, isDark), [isDark, shareThemeMode]);
  const [showTimelineFiveStarDrops, setShowTimelineFiveStarDrops] = React.useState(true);
  const {
    user,
    charViewMode,
    setCharViewMode,
    currentPool,
    normalizedPoolHistory,
    selectedPools,
    allLimitedHistory,
    crossPoolPityMap,
    normalizedPoolType,
    isLimited,
    isExtra,
    isWeapon,
    isStandard,
    maxPity,
    hasPoolData,
    isGroupMode,
    isAllPoolsOverview,
    hasMergedAccountView,
    stats,
    effectivePity,
    groupedHistory,
    characterStats,
    checkLimitedInFirstN,
    hasReceivedFreeTen,
    includeFreePullsInStats,
    setIncludeFreePullsInStats,
    weaponGifts,
    currentUpPool,
    getProgressClass,
    getCharacterAvatar,
    dashboardResourceSummary,
    resourceSummaryVariant
  } = useDashboardViewState();
  React.useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const requestedPoolId = String(searchParams.get('poolId') || '').trim();
    if (requestedPoolId && requestedPoolId !== currentPoolId) {
      switchPool(requestedPoolId);
    }
  }, [currentPoolId, location.search, switchPool]);

  React.useEffect(() => {
    const state = location.state || {};
    if (state.dashboardCharViewMode === 'waterfall') {
      setCharViewMode('waterfall');
    }
    if (state.openHistoryAnomalies === true) {
      setShowDetailedLogs(true);
    }
    const scrollTargetId = state.scrollTo
      || (state.openHistoryAnomalies === true ? 'mobile-detailed-logs' : '');
    if (!scrollTargetId) {
      return undefined;
    }

    const timer = setTimeout(() => {
      const target = document.getElementById(scrollTargetId);
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('guide-highlight-flash');
      setTimeout(() => target.classList.remove('guide-highlight-flash'), 3000);
    }, 500);

    return () => clearTimeout(timer);
  }, [location.state, setCharViewMode]);
  const localizedCurrentPoolName = React.useMemo(() => localizePoolName(currentPool, { locale }), [currentPool, locale]);
  const localizedCurrentUpName = React.useMemo(() => {
    const localizedFeaturedList = localizePoolFeaturedList(currentPool, {
      locale,
      type: normalizedPoolType === 'weapon' ? 'weapon' : 'character'
    });

    if (isExtra && localizedFeaturedList.length > 0) {
      return localizedFeaturedList.join(' / ');
    }

    return localizePoolFeaturedName(currentPool, { locale })
      || localizeEntityName(currentPool?.up_character || currentPool?.upCharacter || '', {
        locale,
        type: normalizedPoolType === 'weapon' ? 'weapon' : 'character'
      });
  }, [currentPool, isExtra, locale, normalizedPoolType]);
  const displayPity6 = (isLimited || isExtra) ? effectivePity.pity6 : stats.currentPity;
  const paidTotal = stats.paidTotal ?? stats.total;
  const currentProbabilityInfo = !isGroupMode && !hasMergedAccountView
    ? calculateCurrentProbability(displayPity6, normalizedPoolType)
    : null;
  const analysisPity = React.useMemo(
    () => getPoolAnalysisPityState(currentPool, stats, effectivePity),
    [currentPool, effectivePity, stats]
  );
  const overviewAnalysisPityMap = React.useMemo(() => {
    if (!currentPool?.isGroupMode) {
      return null;
    }

    return buildOverviewPoolAnalysisPityMap({
      pools: selectedPools,
      history: normalizedPoolHistory,
      allLimitedHistory
    });
  }, [allLimitedHistory, currentPool?.isGroupMode, normalizedPoolHistory, selectedPools]);
  const timelineSections = React.useMemo(() => buildDashboardTimelineSections({
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
    overviewPoolFilter: 'all',
    hasMergedAccountView,
    locale
  }), [analysisPity, crossPoolPityMap, currentPool, effectivePity, groupedHistory, hasMergedAccountView, isAllPoolsOverview, isGroupMode, locale, normalizedPoolHistory, overviewAnalysisPityMap, selectedPools]);
  const overviewSplitStats = React.useMemo(() => {
    if (!isAllPoolsOverview) {
      return null;
    }

    return buildDashboardOverviewSplitStats({
      history: normalizedPoolHistory,
      selectedPools,
      includeFreePullsInStats
    });
  }, [includeFreePullsInStats, isAllPoolsOverview, normalizedPoolHistory, selectedPools]);
  const detailedLogEntries = React.useMemo(() => (
    [...(normalizedPoolHistory || [])]
      .sort(compareHistoryTimelineDesc)
      .map((item, index) => ({
        id: item.id || `${item.poolId || item.pool_id || 'pool'}-${index}`,
        name: localizeHistoryItemName(item, { locale, fallback: t('common.unknown') }),
        rarity: Number(item.rarity || 0),
        dateLabel: formatDateTime(item.timestamp || item.created_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', includeYear: false }, t('common.timeUnknown')),
        pity: item.pity ?? item.pity_count ?? item.pityCount ?? item.pull_count ?? item.pullCount ?? null,
        isUp: !(item.isStandard ?? item.is_standard ?? false),
        isFree: item.isFree === true || item.is_free === true
      }))
  ), [formatDateTime, locale, normalizedPoolHistory, t]);
  const reloadMobileHistory = React.useCallback(async () => {
    const result = await loadAccountGachaData();
    setHistory(Array.isArray(result?.history) ? result.history : []);
  }, [setHistory]);
  const handleMobileAnomalyUpdate = React.useCallback(async (itemOrId, changes, reason = '') => {
    const record = typeof itemOrId === 'object'
      ? itemOrId
      : (normalizedPoolHistory || []).find((item) => item.id === itemOrId);
    if (!record || anomalyMutationInFlightRef.current) {
      return false;
    }

    anomalyMutationInFlightRef.current = true;
    setAnomalyMutationBusy(true);
    try {
      try {
        await updateAccountGachaRecord({
          ...buildHistoryRecordLocator(record),
          editVersion: Number(record.editVersion || record.edit_version || 1),
          changes,
          reason,
        });
      } catch (error) {
        appLogger.error('[MobileDashboardView] 更新待核对记录失败:', error);
        showToast(t('records.anomaly.editFailed'), 'error');
        return false;
      }

      setEditAnomalyRecord(null);
      try {
        await reloadMobileHistory();
      } catch (error) {
        appLogger.error('[MobileDashboardView] 更新成功后刷新历史失败:', error);
        showToast(t('records.anomaly.refreshAfterMutationFailed'), 'warning');
        return true;
      }
      showToast(t('records.anomaly.editSuccess'), 'success');
      return true;
    } finally {
      anomalyMutationInFlightRef.current = false;
      setAnomalyMutationBusy(false);
    }
  }, [normalizedPoolHistory, reloadMobileHistory, showToast, t]);
  const confirmMobileAnomalyDelete = React.useCallback(async () => {
    if (!deleteAnomalyRecord || anomalyMutationInFlightRef.current) {
      return;
    }

    anomalyMutationInFlightRef.current = true;
    setAnomalyMutationBusy(true);
    try {
      try {
        await deleteAccountGachaRecord({
          ...buildHistoryRecordLocator(deleteAnomalyRecord),
          reason: '用户确认该异常记录不应保留',
        });
      } catch (error) {
        appLogger.error('[MobileDashboardView] 删除待核对记录失败:', error);
        showToast(t('records.anomaly.deleteFailed'), 'error');
        return;
      }

      setDeleteAnomalyRecord(null);
      setEditAnomalyRecord(null);
      try {
        await reloadMobileHistory();
      } catch (error) {
        appLogger.error('[MobileDashboardView] 删除成功后刷新历史失败:', error);
        showToast(t('records.anomaly.refreshAfterMutationFailed'), 'warning');
        return;
      }
      showToast(t('records.anomaly.deleteSuccess'), 'success');
    } finally {
      anomalyMutationInFlightRef.current = false;
      setAnomalyMutationBusy(false);
    }
  }, [deleteAnomalyRecord, reloadMobileHistory, showToast, t]);
  const dashboardSharePayload = React.useMemo(() => buildDashboardSharePayload({
    currentPool,
    normalizedPoolType,
    isGroupMode,
    isAllPoolsOverview,
    hasMergedAccountView,
    overviewPoolFilter: 'all',
    stats,
    analysisPity,
    sections: timelineSections,
    overviewSplitStats,
    includeFreePullsInStats,
    showFiveStarDrops: showTimelineFiveStarDrops
  }, locale), [analysisPity, currentPool, hasMergedAccountView, includeFreePullsInStats, isAllPoolsOverview, isGroupMode, locale, normalizedPoolType, overviewSplitStats, showTimelineFiveStarDrops, stats, timelineSections]);
  const hasDashboardShareData = (Number(stats?.total) || 0) > 0 || timelineSections.length > 0;
  const clipboardImageWarmKey = React.useMemo(() => (
    hasDashboardShareData
      ? JSON.stringify({
          locale,
          theme: resolvedShareTheme,
          payload: dashboardSharePayload
        })
      : null
  ), [dashboardSharePayload, hasDashboardShareData, locale, resolvedShareTheme]);
  const supportsNativeImageShare = React.useMemo(() => {
    if (typeof window === 'undefined' || typeof File === 'undefined' || typeof navigator?.share !== 'function') {
      return false;
    }

    if (typeof navigator.canShare !== 'function') {
      return false;
    }

    try {
      return navigator.canShare({
        files: [
          new File(['share'], 'share.txt', { type: 'text/plain' })
        ]
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

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    writeStorageValue(STORAGE_KEYS.DASHBOARD_SHARE_THEME_MODE, shareThemeMode, { raw: true });
  }, [shareThemeMode]);
  const pullUnitLabel = isEnglish ? 'PULLS' : t('dashboard.unit.pull');
  const standardSixLabel = isEnglish ? 'Standard 6★' : '常驻6★';
  const extraSixLabel = isEnglish ? 'Extra 6★' : '附加6★';
  const shareImageActionLabel = isActionRunning('share') ? t('dashboard.share.trigger.sharing') : t('dashboard.share.systemImage');
  const downloadImageActionLabel = isActionRunning('download') ? t('dashboard.share.trigger.downloading') : t('dashboard.share.downloadImage');
  const copyImageActionLabel = isActionRunning('copy-image')
    ? t('dashboard.share.trigger.copying')
    : isFirefoxClipboardBrowser && (clipboardImageWarmState === 'preparing' || !isClipboardImageReady)
      ? t('dashboard.share.progress.prepareClipboardImage')
      : t('dashboard.share.copyImage');
  const shareTextActionLabel = isActionRunning('copy-text') ? t('dashboard.share.trigger.copying') : t('dashboard.share.copyText');
  const resourceSummaryTitle = isGroupMode
    ? t('dashboard.resources.groupTitle', { name: localizedCurrentPoolName || '' })
    : t('dashboard.resources.title');
  const primarySixStarLabel = isAllPoolsOverview
    ? t('dashboard.overview.targetSixStar')
    : normalizedPoolType === 'weapon'
      ? t('dashboard.overview.upWeapon')
      : normalizedPoolType === 'standard'
        ? standardSixLabel
        : t('dashboard.average.limitedSix');
  const secondarySixStarLabel = isAllPoolsOverview
    ? t('dashboard.overview.offrateSixStar')
    : normalizedPoolType === 'standard'
      ? extraSixLabel
      : standardSixLabel;
  const poolRailShellClass = 'sticky top-0 z-20 overflow-visible border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-ef-card px-4 pt-4 pb-2 shrink-0';
  const localizeChartData = React.useCallback((items = [], primaryLabel, secondaryLabel) => (
    localizeDashboardChartItems(items, {
      primarySixStarLabel: primaryLabel,
      secondarySixStarLabel: secondaryLabel,
    })
  ), []);

  const handleCopyShareText = React.useCallback(async () => {
    if (!hasDashboardShareData) {
      showToast(t('dashboard.share.noData'), 'warning');
      return;
    }

    if (!beginShareAction('copy-text', t('dashboard.share.progress.copyText'))) {
      return;
    }

    try {
      const success = await copyToClipboard(buildDashboardShareText(dashboardSharePayload, locale));
      const message = success ? t('dashboard.share.copyTextSuccess') : t('dashboard.share.copyTextFailure');
      if (success) {
        finishShareAction('copy-text', message);
      } else {
        failShareAction('copy-text', message);
      }
      showToast(message, success ? 'success' : 'error');
    } catch {
      const message = t('dashboard.share.copyTextFailure');
      failShareAction('copy-text', message);
      showToast(message, 'error');
    }
  }, [beginShareAction, dashboardSharePayload, failShareAction, finishShareAction, hasDashboardShareData, locale, showToast, t]);

  const waitForShareCard = React.useCallback(async () => {
    if (shareCardRef.current) return shareCardRef.current;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return shareCardRef.current;
  }, []);

  const getShareImageBlob = React.useCallback(async () => {
    const cardNode = await waitForShareCard();
    if (!cardNode) {
      return null;
    }

    const cacheKey = JSON.stringify({
      locale,
      theme: resolvedShareTheme,
      payload: dashboardSharePayload
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
          promise: null
        };
        setClipboardImageReadyKey(cacheKey);
        return blob;
      })
      .catch((error) => {
        if (shareImageCacheRef.current[cacheBucket].key === cacheKey) {
          shareImageCacheRef.current[cacheBucket] = {
            key: null,
            blob: null,
            promise: null
          };
        }
        setClipboardImageReadyKey((previous) => (previous === cacheKey ? null : previous));
        throw error;
      });

    shareImageCacheRef.current[cacheBucket] = {
      key: cacheKey,
      blob: null,
      promise: renderPromise
    };

    return renderPromise;
  }, [dashboardSharePayload, locale, resolvedShareTheme, waitForShareCard]);

  const prewarmClipboardShareImage = React.useCallback(() => {
    if (!supportsClipboardImageCopy || !hasDashboardShareData) {
      return Promise.resolve(null);
    }

    if (isClipboardImageReady) {
      setClipboardImageWarmState('ready');
      return Promise.resolve(shareImageCacheRef.current.full.blob);
    }

    setClipboardImageWarmState((previous) => (previous === 'ready' ? previous : 'preparing'));
    return getShareImageBlob('full')
      .then((blob) => {
        setClipboardImageWarmState('ready');
        return blob;
      })
      .catch((error) => {
        setClipboardImageWarmState('idle');
        throw error;
      });
  }, [getShareImageBlob, hasDashboardShareData, isClipboardImageReady, supportsClipboardImageCopy]);

  React.useEffect(() => {
    setClipboardImageReadyKey(null);
    setClipboardImageWarmState('idle');
  }, [clipboardImageWarmKey]);

  React.useEffect(() => {
    if (!supportsClipboardImageCopy || !hasDashboardShareData || !isFirefoxClipboardBrowser) {
      return;
    }

    prewarmClipboardShareImage().catch(() => {});
  }, [hasDashboardShareData, isFirefoxClipboardBrowser, prewarmClipboardShareImage, supportsClipboardImageCopy]);

  const handleShareImage = React.useCallback(async () => {
    if (!hasDashboardShareData) {
      showToast(t('dashboard.share.noExportableData'), 'warning');
      return;
    }

    if (!beginShareAction('share', t('dashboard.share.progress.generateImage'))) {
      return;
    }

    const cardNode = await waitForShareCard();
    if (!cardNode) {
      const message = t('dashboard.share.notReady');
      failShareAction('share', message);
      showToast(message, 'error');
      return;
    }

    try {
      const blob = await getShareImageBlob('full');
      const fileName = buildDashboardShareCardFileName(dashboardSharePayload, locale);
      const file = buildShareFile(blob, fileName);

      if (file && supportsNativeImageShare && canNativeShareFile(file)) {
        updateShareAction('share', t('dashboard.share.progress.openSystemShare'));
        await shareImageFile(file, {
          title: t('share.dashboard.scope', { scope: dashboardSharePayload.scopeLabel }),
          text: buildDashboardShareText(dashboardSharePayload, locale)
        });
        const message = t('dashboard.share.systemOpened');
        finishShareAction('share', message);
        showToast(message, 'success');
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
      showToast(message, downloaded ? 'success' : 'error');
    } catch (error) {
      if (error?.name === 'AbortError') {
        resetShareActionFeedback();
        return;
      }

      const message = t('dashboard.share.generateFailure');
      failShareAction('share', message);
      showToast(message, 'error');
    }
  }, [beginShareAction, dashboardSharePayload, failShareAction, finishShareAction, getShareImageBlob, hasDashboardShareData, locale, resetShareActionFeedback, showToast, supportsNativeImageShare, t, updateShareAction, waitForShareCard]);

  const handleDownloadShareImage = React.useCallback(async () => {
    if (!hasDashboardShareData) {
      showToast(t('dashboard.share.noExportableData'), 'warning');
      return;
    }

    if (!beginShareAction('download', t('dashboard.share.progress.generateImage'))) {
      return;
    }

    const cardNode = await waitForShareCard();
    if (!cardNode) {
      const message = t('dashboard.share.notReady');
      failShareAction('download', message);
      showToast(message, 'error');
      return;
    }

    try {
      const blob = await getShareImageBlob('full');
      updateShareAction('download', t('dashboard.share.progress.saveImage'));
      const fileName = buildDashboardShareCardFileName(dashboardSharePayload, locale);
      const downloaded = downloadShareCard(blob, fileName);
      const message = downloaded ? t('dashboard.share.downloadSuccess') : t('dashboard.share.downloadFailure');
      if (downloaded) {
        finishShareAction('download', message);
      } else {
        failShareAction('download', message);
      }
      showToast(message, downloaded ? 'success' : 'error');
    } catch {
      const message = t('dashboard.share.generateFailure');
      failShareAction('download', message);
      showToast(message, 'error');
    }
  }, [beginShareAction, dashboardSharePayload, failShareAction, finishShareAction, getShareImageBlob, hasDashboardShareData, locale, showToast, t, updateShareAction, waitForShareCard]);

  const handleCopyShareImage = React.useCallback(async () => {
    if (!hasDashboardShareData) {
      showToast(t('dashboard.share.noExportableData'), 'warning');
      return;
    }

    if (!beginShareAction('copy-image', t('dashboard.share.progress.generateCopyImage'))) {
      return;
    }

    const cardNode = await waitForShareCard();
    if (!cardNode) {
      const message = t('dashboard.share.notReady');
      failShareAction('copy-image', message);
      showToast(message, 'error');
      return;
    }

    if (!supportsClipboardImageCopy) {
      const message = t('dashboard.share.browserCopyUnsupported');
      failShareAction('copy-image', message);
      showToast(message, 'warning');
      return;
    }

    if (isFirefoxClipboardBrowser && !isClipboardImageReady) {
      prewarmClipboardShareImage().catch(() => {});
      const message = t('dashboard.share.copyImagePreparing');
      failShareAction('copy-image', message);
      showToast(message, 'warning');
      return;
    }

    try {
      const blob = await getShareImageBlob('full');
      updateShareAction('copy-image', t('dashboard.share.progress.writeClipboard'));
      const copied = await copyImageBlobToClipboard(blob);
      const message = copied ? t('dashboard.share.copyImageSuccess') : t('dashboard.share.copyImageFailure');
      if (copied) {
        finishShareAction('copy-image', message);
      } else {
        failShareAction('copy-image', message);
      }
      showToast(message, copied ? 'success' : 'error');
    } catch {
      const message = t('dashboard.share.copyImageFailure');
      failShareAction('copy-image', message);
      showToast(message, 'error');
    }
  }, [beginShareAction, failShareAction, finishShareAction, getShareImageBlob, hasDashboardShareData, isClipboardImageReady, isFirefoxClipboardBrowser, prewarmClipboardShareImage, showToast, supportsClipboardImageCopy, t, updateShareAction, waitForShareCard]);

  if (!user) {
    return (
      <MobileAuthRequiredView
        animation="right"
        eyebrow={t('nav.details')}
        title={t('nav.details')}
        description={t('dashboard.authRequiredDescription')}
      />
    );
  }

  if (!hasPoolData) {
    return (
      <div className="flex-1 h-full overflow-y-auto overflow-x-hidden slide-right-enter scroll-smooth w-full bg-ef-light dark:bg-ef-dark flex flex-col px-4 pb-[calc(env(safe-area-inset-bottom,0px)+7.5rem)] space-y-3">
        <div className={poolRailShellClass}>
          <MobilePoolRailSelector />
        </div>

        <div className="mobile-ux-card mx-4 p-8 text-center">
          <Calculator size={48} className="mx-auto mb-4 text-slate-700 dark:text-zinc-300 dark:text-zinc-700" />
          <p className="text-slate-500 dark:text-zinc-500 dark:text-slate-600 dark:text-zinc-400">
            {user ? t('dashboard.empty.importOrCreatePool') : t('dashboard.empty.loginToStart')}
          </p>
        </div>
      </div>
    );
  }

  if (!currentPool) {
    return (
      <div className="flex-1 h-full overflow-y-auto overflow-x-hidden slide-right-enter scroll-smooth w-full bg-ef-light dark:bg-ef-dark flex flex-col px-4 pb-[calc(env(safe-area-inset-bottom,0px)+7.5rem)] space-y-3">
        <div className={poolRailShellClass}>
          <MobilePoolRailSelector />
        </div>
        <div className="mobile-ux-card mx-4 p-8 text-center">
          <Calculator size={48} className="mx-auto mb-4 text-slate-700 dark:text-zinc-300 dark:text-zinc-700" />
          <p className="text-slate-500 dark:text-zinc-500 dark:text-slate-600 dark:text-zinc-400">{t('dashboard.empty.selectOrCreatePool')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-y-auto overflow-x-hidden slide-right-enter scroll-smooth w-full bg-ef-light dark:bg-ef-dark flex flex-col pb-[calc(env(safe-area-inset-bottom,0px)+7.5rem)] [&>*]:shrink-0">
      {hasDashboardShareData && (isShareActionBusy || (supportsClipboardImageCopy && isFirefoxClipboardBrowser)) && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: '-200vw',
            top: 0,
            width: '1200px',
            opacity: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <DashboardShareCard
            ref={shareCardRef}
            payload={dashboardSharePayload}
            sections={timelineSections}
            theme={resolvedShareTheme}
            showFiveStarDrops={showTimelineFiveStarDrops}
          />
        </div>
      )}
      <div className={poolRailShellClass}>
        <MobilePoolRailSelector />
      </div>

      <div className="mobile-ux-card relative mb-4 mx-4 mt-4 overflow-hidden border-pink-500/30">
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-pink-500 to-orange-500"></div>
        <div className="p-4 relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className={`mobile-ux-card-inset p-2.5 ${
                  isExtra ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300' :
                  isLimited ? 'border-fuchsia-500/25 bg-pink-500/10 text-pink-600 dark:text-pink-400' :
                  isWeapon ? 'border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-300' :
                  'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                }`}>
                  {isWeapon ? <Swords size={18} /> : (isLimited || isExtra) ? <Star size={18} /> : <Layers size={18} />}
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">{localizedCurrentPoolName}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">
                    <MobileStatusBadge>{isExtra ? t('dashboard.pool.type.extra') : isLimited ? t('dashboard.pool.type.limited') : isWeapon ? t('dashboard.pool.type.weapon') : t('dashboard.pool.type.standard')}</MobileStatusBadge>
                    <span className="tabular-nums">{formatNumber(stats.total)} {pullUnitLabel}</span>
                  </div>
                </div>
              </div>
              {(isLimited || isExtra) ? (
                <div className="mobile-ux-card-inset mt-3 flex items-center gap-2 border-endfield-yellow/10 bg-endfield-yellow/10 px-3 py-2 text-[11px] text-slate-700 dark:text-zinc-300">
                  <Clock size={12} className="text-endfield-yellow" />
                  <span className="font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">{t('dashboard.pool.status')}</span>
                  <span className="countdown-nums text-slate-900 dark:text-white">
                    {t('dashboard.pool.remainingTime', {
                      days: currentUpPool.remainingDays || 0,
                      hours: currentUpPool.remainingHours || 0,
                    })}
                  </span>
                </div>
              ) : null}
            </div>

            {!isStandard && localizedCurrentUpName ? (
              <div className="mobile-ux-card-inset shrink-0 px-3 py-2 text-right">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">{isWeapon ? t('dashboard.pool.upWeapon') : t('dashboard.pool.upCharacter')}</div>
                <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{localizedCurrentUpName}</div>
              </div>
            ) : null}
          </div>

          {hasDashboardShareData ? (
            <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">{t('dashboard.share.theme')}</div>
                  <div className="mt-1 text-[11px] text-slate-600 dark:text-zinc-400">{t('dashboard.share.copyText')}</div>
                </div>
                <div className="flex overflow-hidden rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-200 dark:bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShareThemeMode('system')}
                    disabled={isShareActionBusy}
                    className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold ${
                      shareThemeMode === 'system' ? 'bg-white/14 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-zinc-500'
                    } ${isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <Monitor size={12} />
                    {t('settings.theme.system')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareThemeMode('light')}
                    disabled={isShareActionBusy}
                    className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold ${
                      shareThemeMode === 'light' ? 'bg-white/14 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-zinc-500'
                    } ${isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <Sun size={12} />
                    {t('settings.theme.light')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareThemeMode('dark')}
                    disabled={isShareActionBusy}
                    className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold ${
                      shareThemeMode === 'dark' ? 'bg-white/14 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-zinc-500'
                    } ${isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <Moon size={12} />
                    {t('settings.theme.dark')}
                  </button>
                </div>
              </div>
              <div className={`mt-4 grid gap-2 ${supportsNativeImageShare || supportsClipboardImageCopy ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {supportsNativeImageShare ? (
                  <button
                    type="button"
                    disabled={isShareActionBusy}
                    onClick={() => void handleShareImage()}
                    className={`mobile-ux-card-inset flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-900 dark:text-zinc-100 ${
                      isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                  >
                    {isActionRunning('share') ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
                    {shareImageActionLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={isShareActionBusy}
                  onClick={() => void handleDownloadShareImage()}
                  className={`mobile-ux-card-inset flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-900 dark:text-zinc-100 ${
                    isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''
                  }`}
                >
                  {isActionRunning('download') ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {downloadImageActionLabel}
                </button>
                {supportsClipboardImageCopy ? (
                  <button
                    type="button"
                    disabled={isShareActionBusy || (isFirefoxClipboardBrowser && !isClipboardImageReady)}
                    onClick={() => void handleCopyShareImage()}
                    className={`mobile-ux-card-inset flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-900 dark:text-zinc-100 ${
                      isShareActionBusy || (isFirefoxClipboardBrowser && !isClipboardImageReady) ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                  >
                    {isActionRunning('copy-image') ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                    {copyImageActionLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={isShareActionBusy}
                  onClick={() => void handleCopyShareText()}
                  className={`mobile-ux-card-inset flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-900 dark:text-zinc-100 ${
                    isShareActionBusy ? 'cursor-not-allowed opacity-60' : ''
                  }`}
                >
                  {isActionRunning('copy-text') ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                  {shareTextActionLabel}
                </button>
              </div>

              {shareActionFeedback.phase !== 'idle' ? (
                <ShareActionStatus feedback={shareActionFeedback} className="mt-3" />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {/* Total Resources Input */}
      <div className="mobile-ux-card mx-4 mb-4 flex items-center gap-3 border-l-4 border-amber-500 px-3 py-3 text-amber-600 dark:border-ef-yellow dark:text-ef-yellow">
          <Database size={14} />
          <span className="text-xs font-bold tracking-widest">{t('dashboard.resources.totalInvested')}</span>
          <span className="ml-auto text-2xl font-black font-mono">{stats.total}</span>
          <span className="text-xs text-slate-500 dark:text-zinc-500">{t('dashboard.unit.pull')}</span>
          <div className="mobile-ux-card-chip ml-1 flex h-8 w-8 items-center justify-center text-slate-500 dark:text-zinc-500"><Layers size={16}/></div>
          <button
            type="button"
            aria-pressed={includeFreePullsInStats}
            onClick={() => setIncludeFreePullsInStats((value) => !value)}
            className={`ml-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
              includeFreePullsInStats
                ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300'
                : 'border-zinc-200 bg-zinc-100 text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500'
            }`}
          >
            {includeFreePullsInStats ? t('dashboard.analysis.includeFreeTen') : t('dashboard.analysis.freeTenExcluded')}
          </button>
      </div>

      <ResourceSummaryPanel
        title={resourceSummaryTitle}
        resources={dashboardResourceSummary}
        variant={resourceSummaryVariant}
        compact={true}
        mobile={true}
        className="mx-4 mb-4"
      />

      {/* 保底进度（聚合模式下隐藏） */}
      {!isGroupMode && !hasMergedAccountView && (
      <div className="mx-4 mb-4 grid grid-cols-2 gap-2">
        {/* 6星保底 */}
        {(() => {
          const displayPity = displayPity6;
          return (
            <div className="mobile-ux-soft-card relative p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-slate-500 dark:text-zinc-500 uppercase font-bold tracking-wide">{t('dashboard.analysis.pity6', { max: maxPity })}</span>
                {currentProbabilityInfo?.hasSoftPity && currentProbabilityInfo?.isInSoftPity && (
                  <span className="animate-pulse rounded-full bg-red-500/15 px-1.5 py-0.5 text-[11px] font-mono font-bold text-red-300">
                    {t('dashboard.analysis.rateBoost', { percent: (currentProbabilityInfo.probability * 100).toFixed(0) })}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-3xl font-bold font-mono text-slate-900 dark:text-zinc-100">
                  {Math.max(maxPity - displayPity, 0)}
                </span>
                <span className="text-[10px] text-slate-600 dark:text-zinc-400 uppercase">{t('dashboard.unit.remaining')}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-full transition-all ${getProgressClass()}`}
                  style={{ width: `${(displayPity / maxPity) * 100}%` }}
                />
              </div>
               <div className="mt-1.5 flex justify-between text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
                 <span>{t('dashboard.analysis.currentPity', { count: displayPity })}{effectivePity?.isInherited && isLimited ? ` (${t('dashboard.analysis.crossPoolCarry')})` : ''}</span>
                 <span>{t('dashboard.unit.limit', { count: maxPity })}</span>
               </div>
            </div>
          );
        })()}

        {/* 5星保底 */}
        {(() => {
          const displayPity5 = isLimited ? effectivePity.pity5 : stats.currentPity5;
          return (
            <div className="mobile-ux-soft-card p-3">
              <div className="mb-2 text-[10px] text-slate-500 dark:text-zinc-500 uppercase font-bold tracking-wide">{t('dashboard.analysis.pity5')}</div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-3xl font-bold font-mono text-slate-900 dark:text-zinc-100">
                  {Math.max(10 - displayPity5, 0)}
                </span>
                <span className="text-[10px] text-slate-600 dark:text-zinc-400 uppercase">{t('dashboard.unit.remaining')}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${(displayPity5 / 10) * 100}%` }}
                />
              </div>
               <div className="mt-1.5 flex justify-between text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
                 <span>{t('dashboard.analysis.currentPity', { count: displayPity5 })}{effectivePity?.isInherited && isLimited ? ` (${t('dashboard.analysis.crossPoolCarry')})` : ''}</span>
                 <span>{t('dashboard.unit.limit', { count: 10 })}</span>
               </div>
            </div>
          );
        })()}
      </div>
      )}

      {!isGroupMode && hasMergedAccountView && (
        <div className="mobile-ux-card-inset mx-4 border border-dashed border-zinc-200 bg-zinc-50/85 p-3 text-xs text-slate-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-500">
          {t('dashboard.analysis.mergedViewNote')}
        </div>
      )}

      {/* 核心数据网格 */}
      <div className={`mx-4 mb-4 grid ${normalizedPoolType !== 'standard' ? 'grid-cols-4' : 'grid-cols-3'} gap-2`}>
        {normalizedPoolType !== 'standard' && (
          <div className="mobile-ux-card-inset py-3 text-center">
            <div className="text-[11px] text-slate-600 dark:text-zinc-400 uppercase font-bold tracking-tight mb-1">{primarySixStarLabel}</div>
            <div className={`text-xl font-bold font-mono ${isLimited ? 'rainbow-text' : isExtra ? 'text-cyan-600 dark:text-cyan-400' : 'text-zinc-700 dark:text-slate-700 dark:text-zinc-300'}`}>
              {stats.counts[6]}
            </div>
          </div>
        )}
        <div className="mobile-ux-card-inset py-3 text-center">
          <div className="text-[11px] text-slate-600 dark:text-zinc-400 uppercase font-bold tracking-tight mb-1">{secondarySixStarLabel}</div>
          <div className="text-xl font-bold font-mono text-red-600 dark:text-red-400">{stats.counts['6_std']}</div>
        </div>
        <div className="mobile-ux-card-inset py-3 text-center">
          <div className="text-[11px] text-slate-600 dark:text-zinc-400 uppercase font-bold tracking-tight mb-1">5★</div>
          <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400">{stats.counts[5]}</div>
        </div>
        <div className="mobile-ux-card-inset py-3 text-center">
          <div className="text-[11px] text-slate-600 dark:text-zinc-400 uppercase font-bold tracking-tight mb-1">4★</div>
          <div className="text-xl font-bold font-mono text-purple-600 dark:text-purple-400">{stats.counts[4]}</div>
        </div>
      </div>

      {/* 图表：分布概览 + 出货分布 */}
      {stats.total > 0 && (
        <div className="space-y-2">
          {/* 饼图 - 分布概览 */}
          <MobileChartContainer title={t('dashboard.chart.distribution')} defaultExpanded={true} className="mb-4 mx-4">
            <div className="h-52 w-full pt-2">
              {stats.chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
                  <PieChart>
                    <RainbowGradientDefs />
                      <Pie
                        data={localizeChartData(stats.chartData, primarySixStarLabel, secondarySixStarLabel)}
                        cx="50%"
                        cy="45%"
                        innerRadius={32}
                        outerRadius={68}
                        paddingAngle={2}
                        dataKey="displayValue"
                        isAnimationActive={false}
                        labelLine={false}
                        label={renderPiePercentLabel(isDark)}
                      >
                      {localizeChartData(stats.chartData, primarySixStarLabel, secondarySixStarLabel).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value, name, props) => [`${props.payload.value} (${(props.payload.value / stats.total * 100).toFixed(1)}%)`, name]}
                      contentStyle={{
                        backgroundColor: isDark ? '#18181b' : '#fff',
                        border: `1px solid ${isDark ? '#3f3f46' : '#e4e4e7'}`,
                        borderRadius: 16,
                        fontSize: 12,
                      }}
                      itemStyle={{ color: isDark ? '#e4e4e7' : '#27272a' }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      iconSize={8}
                      formatter={(value) => <span className="text-[11px] text-slate-500 dark:text-zinc-500 dark:text-slate-600 dark:text-zinc-400 ml-1">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-700 dark:text-zinc-300 dark:text-zinc-700 text-sm">{t('dashboard.empty.noChartData')}</div>
              )}
            </div>
          </MobileChartContainer>

          {/* 面积图 - 6星出货趋势 */}
          {stats.pityStats.history.length > 0 && (
            <MobileChartContainer title={t('dashboard.chart.trend')} defaultExpanded={true} className="mb-4 mx-4">
              <div className="h-48 w-full pt-2">
                <DistributionAreaChart
                  data={stats.pityStats.distribution}
                  isDark={isDark}
                  variant={getDistributionVariant(normalizedPoolType)}
                  tooltipStyle={{
                    backgroundColor: isDark ? '#18181b' : '#fff',
                    border: `1px solid ${isDark ? '#3f3f46' : '#e4e4e7'}`,
                    borderRadius: 16,
                    fontSize: 12,
                  }}
                  margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                />
              </div>
            </MobileChartContainer>
          )}
        </div>
      )}

      {/* 不歪率和平均出货（限定/武器池） */}
      {(isLimited || isExtra || isWeapon) && (
        <div className="mx-4 mb-4 grid grid-cols-1 gap-2">
          {/* 不歪率 */}
          <div className="mobile-ux-soft-card p-3">
            <div className="text-[10px] text-slate-600 dark:text-zinc-400 uppercase font-bold mb-2 flex justify-between">
              <span>{t('dashboard.analysis.winRate')}</span>
              {(isLimited || isExtra) && (
                <span className="text-[11px] text-slate-700 dark:text-zinc-300">
                  ({includeFreePullsInStats ? t('dashboard.analysis.includeFreeTen') : t('dashboard.analysis.freeTenExcluded')})
                </span>
              )}
            </div>
            <div className="mb-2 text-2xl font-bold font-mono text-slate-900 dark:text-zinc-100">
              {stats.sixStarCount > 0 ? `${stats.winRate}%` : '-'}
            </div>
            <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className={`h-full ${isLimited ? 'rainbow-progress' : isExtra ? 'bg-cyan-500' : 'bg-blue-500'}`}
                style={{ width: `${parseFloat(stats.winRate) || 0}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-zinc-500 font-mono uppercase">
              <span>{primarySixStarLabel}: {stats.counts[6]}</span>
              <span>{t('dashboard.timeline.badge.offrate')}: {stats.counts['6_std']}</span>
            </div>
          </div>
        </div>
      )}

      <AveragePullStatsPanel
        stats={stats}
        poolType={normalizedPoolType}
        isAllPoolsOverview={isAllPoolsOverview}
        compact={true}
        mobile={true}
        className="mx-4 mb-4"
      />

      {/* 特殊机制进度（聚合模式下隐藏） */}
      {!isGroupMode && (
      <MobileChartContainer title={t('dashboard.analysis.specialProgress')} defaultExpanded={true} className="mb-4 mx-4">
        <div className="space-y-3 pt-2">
          {/* 限定池特殊进度 */}
          {isLimited && (
            <>
              {/* 免费十连 */}
              <div className="mobile-ux-soft-card mobile-ux-soft-card--info p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{t('dashboard.analysis.freeTenOnce')}</span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                    {hasReceivedFreeTen ? t('dashboard.analysis.claimed') : '0 / 1'}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className={`h-full ${hasReceivedFreeTen ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: hasReceivedFreeTen ? '100%' : '0%' }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-slate-600 dark:text-zinc-400 font-mono">{t('dashboard.analysis.notCountPity')}</div>
              </div>

              {/* 120必出限定 */}
              <div className="mobile-ux-soft-card mobile-ux-soft-card--success p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{t('dashboard.analysis.guaranteedLimited120')}</span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                    {checkLimitedInFirstN.firstLimitedIndex120 > 0 ? t('dashboard.analysis.reached') : `${Math.min(checkLimitedInFirstN.validPullCount, 120)} / 120`}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className={`h-full ${checkLimitedInFirstN.firstLimitedIndex120 > 0 ? 'bg-green-500' : 'rainbow-progress'}`}
                    style={{ width: checkLimitedInFirstN.firstLimitedIndex120 > 0 ? '100%' : `${Math.min((checkLimitedInFirstN.validPullCount / 120) * 100, 100)}%` }}
                  />
                </div>
              </div>

              {/* 240赠送潜能 */}
              <div className="mobile-ux-soft-card p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{t('dashboard.analysis.potential240')}</span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">{paidTotal % 240} / 240</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className="h-full bg-purple-500" style={{ width: `${((paidTotal % 240) / 240) * 100}%` }} />
                </div>
                {Math.floor(paidTotal / 240) > 0 && (
                  <div className="mt-1 text-[10px] text-purple-600 dark:text-purple-400 font-bold font-mono">
                    {t('dashboard.analysis.obtained', { count: Math.floor(paidTotal / 240) })}
                  </div>
                )}
              </div>

              {/* 情报书 */}
              <div className="mobile-ux-soft-card mobile-ux-soft-card--info p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-zinc-200">
                    <FileText size={12} /> {t('dashboard.analysis.infoBook60')}
                  </span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                    {stats.hasInfoBook ? t('dashboard.analysis.reached') : `${Math.min(paidTotal, 60)} / 60`}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className={`h-full ${stats.hasInfoBook ? 'bg-green-500' : 'bg-cyan-500'}`}
                    style={{ width: stats.hasInfoBook ? '100%' : `${Math.min((paidTotal / 60) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </>
          )}

          {isExtra && (
            <div className="mobile-ux-soft-card mobile-ux-soft-card--info p-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{t('dashboard.analysis.freeTenOnce')}</span>
                <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                  {hasReceivedFreeTen ? t('dashboard.analysis.claimed') : '0 / 1'}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-full ${hasReceivedFreeTen ? 'bg-green-500' : 'bg-cyan-500'}`}
                  style={{ width: hasReceivedFreeTen ? '100%' : '0%' }}
                />
              </div>
              <div className="mt-1 text-[11px] text-slate-600 dark:text-zinc-400 font-mono">{t('dashboard.analysis.notCountPity')}</div>
            </div>
          )}

          {/* 武器池特殊进度 */}
          {isWeapon && (
            <>
              {/* 80必出限定 */}
              <div className="mobile-ux-soft-card p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{t('dashboard.analysis.guaranteedWeapon80')}</span>
                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">
                    {checkLimitedInFirstN.firstLimitedIndex80 > 0 ? t('dashboard.analysis.reached') : `${Math.min(paidTotal, 80)} / 80`}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className={`h-full ${checkLimitedInFirstN.firstLimitedIndex80 > 0 ? 'bg-green-500' : 'bg-slate-500'}`}
                    style={{ width: checkLimitedInFirstN.firstLimitedIndex80 > 0 ? '100%' : `${Math.min((paidTotal / 80) * 100, 100)}%` }}
                  />
                </div>
              </div>

              {/* 武器赠送 */}
              {weaponGifts && (
                <div className="mobile-ux-soft-card mobile-ux-soft-card--danger p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="flex items-center gap-2 text-xs font-bold uppercase text-slate-700 dark:text-zinc-200">
                      {t('dashboard.analysis.nextGift')}
                      <span className={`px-1 py-0.5 text-[11px] font-bold text-slate-900 dark:text-white ${weaponGifts.nextGiftType === 'limited' ? 'rainbow-bg' : 'bg-red-500'}`}>
                        {weaponGifts.nextGiftType === 'limited' ? t('dashboard.analysis.limitedShort') : t('dashboard.analysis.standardShort')}
                      </span>
                    </span>
                    <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">{paidTotal} / {weaponGifts.nextGift}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className={`h-full ${weaponGifts.nextGiftType === 'limited' ? 'rainbow-progress' : 'bg-red-500'}`}
                      style={{ width: `${Math.min((paidTotal / weaponGifts.nextGift) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex gap-3 text-[11px] text-slate-500 dark:text-zinc-500 font-mono uppercase">
                    <span>{t('dashboard.analysis.obtainedSummary')}</span>
                    <span className="text-red-600 dark:text-red-400 font-medium">{weaponGifts.standardCount} {t('dashboard.analysis.standardShort')}</span>
                    <span className="text-cyan-600 dark:text-cyan-400 font-medium">{weaponGifts.limitedCount} {t('dashboard.analysis.limitedShort')}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 常驻池特殊进度 */}
          {isStandard && (
              <div className="mobile-ux-soft-card mobile-ux-soft-card--warning p-3">
                <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{t('dashboard.analysis.firstSelector300')}</span>
                <span className="text-xs font-mono text-slate-500 dark:text-zinc-500">{Math.min(paidTotal, 300)} / 300</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-full ${paidTotal >= 300 ? 'bg-green-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min((paidTotal / 300) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </MobileChartContainer>
      )}

      {/* 角色出货统计 */}
      <MobileChartContainer
        title={t('dashboard.chart.characterStatsCount', { count: characterStats.length })}
        defaultExpanded={characterStats.length > 0 || normalizedPoolHistory.length > 0}
        className="mb-4 mx-4"
        headerRight={(characterStats.length > 0 || normalizedPoolHistory.length > 0) ? (
          <div className="flex overflow-hidden rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
            <button
              onClick={() => setCharViewMode('card')}
              className={`flex items-center gap-1 px-3 py-2 text-[11px] font-medium transition-colors ${
                charViewMode === 'card'
                  ? 'border-r border-zinc-200 bg-white text-slate-900 shadow-sm dark:border-zinc-700 dark:bg-white/10 dark:text-zinc-100'
                  : 'text-slate-500 dark:text-zinc-500'
              }`}
            >
              <LayoutGrid size={14} />
              {t('dashboard.view.card')}
            </button>
            <button
              onClick={() => setCharViewMode('waterfall')}
              className={`flex items-center gap-1 px-3 py-2 text-[11px] font-medium transition-colors ${
                charViewMode === 'waterfall'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-zinc-100'
                  : 'text-slate-500 dark:text-zinc-500'
              }`}
            >
              <BarChart3 size={14} />
              {t('dashboard.view.timeline')}
            </button>
          </div>
        ) : null}
      >
        {characterStats.length > 0 ? (
          charViewMode === 'waterfall' ? (
            <div className="pt-2">
              <PoolTimelinePanel
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
                overviewPoolFilter="all"
                hasMergedAccountView={hasMergedAccountView}
                embedded={true}
                mobile={true}
                showFiveStarDrops={showTimelineFiveStarDrops}
                onToggleShowFiveStarDrops={setShowTimelineFiveStarDrops}
              />
            </div>
          ) : (
          <div className="space-y-2 pt-2">
            {characterStats.map((char) => {
              const isSixStar = char.rarity === 6;
              const isLimitedChar = isSixStar && !char.isStandard;
              const isStandardChar = isSixStar && char.isStandard;
              const avatarUrl = getCharacterAvatar(char.name);
              const localizedCharacterName = localizeEntityName(char.name, {
                locale,
                type: normalizedPoolType === 'weapon' ? 'weapon' : 'character'
              });

              // 生成出货抽数描述
              const pullInfoParts = char.pullIndices.map((idx, i) => {
                const pity = char.pities[i];
                const isInfoBook = char.infoBookFlags?.[i] === true;
                if (idx === 'free' || pity === 'free') return { type: 'free', text: isEnglish ? 'Free' : '免费' };
                if (pity) return { type: isInfoBook ? 'infoBook' : 'normal', text: isEnglish ? `${pity} pulls (#${idx})` : `${pity}抽(#${idx})` };
                return { type: isInfoBook ? 'infoBook' : 'normal', text: `#${idx}` };
              });

              return (
                <div
                  key={char.name}
                  className={`relative flex items-center gap-3 rounded-[1rem] p-2 border transition-all hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                    isLimitedChar
                      ? 'bg-orange-500/6 border-orange-400/20'
                      : isStandardChar
                        ? 'bg-red-500/6 border-red-400/18'
                        : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  {/* 左侧颜色条 */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                    isLimitedChar ? 'rainbow-bg' : isStandardChar ? 'bg-red-500' : 'bg-amber-400'
                  }`} />

                  {/* 头像 */}
                  <div className={`ml-2 flex h-10 w-10 items-center justify-center shrink-0 overflow-hidden rounded-[0.95rem] border ${
                    isLimitedChar
                      ? 'border-orange-300 dark:border-orange-700 bg-gradient-to-br from-orange-400 to-pink-500 text-slate-900 dark:text-white'
                      : isStandardChar
                        ? 'border-red-200 dark:border-red-800 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300'
                        : 'border-amber-200 dark:border-amber-800 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300'
                  }`}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={localizedCharacterName} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <User size={18} />
                    )}
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold truncate uppercase tracking-tight ${
                        isLimitedChar ? 'text-slate-900 dark:text-zinc-100' : 'text-slate-700 dark:text-zinc-300'
                      }`}>
                        {localizedCharacterName}
                      </span>
                      <div className="flex gap-0.5">
                        {Array.from({ length: char.rarity }).map((_, i) => (
                          <Star key={i} size={8} className={`${isSixStar ? 'text-orange-400' : 'text-amber-400'} fill-current`} />
                        ))}
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-slate-600 dark:text-zinc-400 dark:text-slate-500 dark:text-zinc-500 truncate">
                      {pullInfoParts.map((part, i) => (
                        <span key={i}>
                          {part.type === 'free' ? (
                            <span className="text-blue-500 font-bold">{part.text}</span>
                          ) : part.type === 'infoBook' ? (
                            <span className="text-amber-600 dark:text-amber-400 font-bold">
                              {t('dashboard.analysis.infoBookPrefix', { value: part.text })}
                            </span>
                          ) : (
                            <span>{part.text}</span>
                          )}
                          {i < pullInfoParts.length - 1 && ', '}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 数量 */}
                  <div className="flex items-center gap-1">
                    {char.infoBookCount > 0 && (
                      <div className="text-[10px] font-mono font-bold px-1.5 py-0.5 border bg-amber-50 dark:bg-amber-900/20 border-amber-200 text-amber-700 dark:text-amber-300">
                        {t('simulator.characterStats.infoBookCount', { count: char.infoBookCount })}
                      </div>
                    )}
                    {char.freeCount > 0 && (
                      <div className="rounded-full border border-blue-400/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-blue-300">
                        {t('simulator.characterStats.freeCount', { count: char.freeCount })}
                      </div>
                    )}
                    <div className={`text-xs font-mono font-bold px-1.5 py-0.5 border ${
                      isLimitedChar ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 text-orange-600 dark:text-orange-400' :
                      isStandardChar ? 'bg-red-50 dark:bg-red-900/10 border-red-200 text-red-600 dark:text-red-400' :
                      'rounded-full bg-white/6 border-white/10 text-slate-600 dark:text-zinc-400'
                    }`}>
                      x{char.count}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )
        ) : normalizedPoolHistory.length > 0 && charViewMode === 'waterfall' ? (
          <div className="pt-2">
            <PoolTimelinePanel
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
              overviewPoolFilter="all"
              hasMergedAccountView={hasMergedAccountView}
              embedded={true}
              mobile={true}
              showFiveStarDrops={showTimelineFiveStarDrops}
              onToggleShowFiveStarDrops={setShowTimelineFiveStarDrops}
            />
          </div>
        ) : (
          <p className="text-xs text-slate-600 dark:text-zinc-400 font-mono text-center py-4 uppercase tracking-widest">{t('dashboard.empty.noHighRarityRecords')}</p>
        )}
      </MobileChartContainer>
      {/* 详细日志 Accordion */}
      <div id="mobile-detailed-logs" className="mobile-ux-card relative z-10 mt-8 mx-4 mb-40 scroll-mb-40 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowDetailedLogs((value) => !value)}
          className="relative z-10 flex w-full scroll-mb-40 items-center justify-between border-b border-zinc-200/90 bg-zinc-50/85 p-4 text-slate-700 transition-colors hover:text-slate-900 dark:border-zinc-800 dark:bg-zinc-900/45 dark:text-zinc-300 dark:hover:text-white"
        >
          <div className="flex min-h-7 items-center gap-2 text-[12px] font-black tracking-[0.08em]">
            <RotateCcw size={14} /> {t('dashboard.logs')}
          </div>
          <ChevronDown size={14} className={`transition-transform ${showDetailedLogs ? 'rotate-180' : ''}`} />
        </button>
        {showDetailedLogs ? (
          <div className="relative z-10 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <HistoryAnomalyReview
              history={normalizedPoolHistory}
              currentPool={currentPool}
              user={user}
              onEdit={setEditAnomalyRecord}
              onDeleteItem={setDeleteAnomalyRecord}
              className="mb-3"
            />
            {detailedLogEntries.length > 0 ? (
              <div className="space-y-2">
                {detailedLogEntries.map((entry) => (
                  <div key={entry.id} className="mobile-ux-card-inset flex items-center gap-3 px-3 py-2.5 text-left">
                    <div className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-black ${
                      entry.rarity >= 6
                        ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                        : entry.rarity === 5
                          ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300'
                          : 'border-zinc-200 bg-white text-slate-500 dark:border-zinc-800 dark:bg-[#111] dark:text-zinc-400'
                    }`}>
                      {entry.rarity > 0 ? `${entry.rarity}★` : '--'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900 dark:text-white break-words">
                        {entry.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500 dark:text-zinc-500">
                        <span>{entry.dateLabel}</span>
                        {entry.pity !== null ? <span>{t('dashboard.analysis.currentPity', { count: entry.pity })}</span> : null}
                        {entry.isFree ? <span className="text-blue-600 dark:text-blue-400">{t('dashboard.timeline.badge.free')}</span> : null}
                        {!entry.isFree && entry.rarity >= 6 ? <span className={entry.isUp ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}>{entry.isUp ? t('dashboard.timeline.badge.up') : t('dashboard.timeline.badge.offrate')}</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[1rem] border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-4 text-center text-[11px] font-mono text-slate-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-500">
                {t('dashboard.logsEmpty')}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 底部留白 */}
      <div className="h-20" />

      {editAnomalyRecord ? (
        <EditItemModal
          item={editAnomalyRecord}
          pools={pools}
          onClose={() => setEditAnomalyRecord(null)}
          onUpdate={handleMobileAnomalyUpdate}
          onDelete={(record) => {
            setEditAnomalyRecord(null);
            setDeleteAnomalyRecord(record);
          }}
        />
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(deleteAnomalyRecord)}
        type="danger"
        title={t('records.anomaly.deleteConfirmTitle')}
        message={t('records.anomaly.deleteConfirmDesc')}
        confirmText={anomalyMutationBusy ? t('common.loading') : t('records.anomaly.delete')}
        onCancel={() => {
          if (!anomalyMutationBusy) setDeleteAnomalyRecord(null);
        }}
        onConfirm={confirmMobileAnomalyDelete}
      />

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

export default MobileDashboardView;
