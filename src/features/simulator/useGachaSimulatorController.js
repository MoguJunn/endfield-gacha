import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSimulator } from '../../utils/gachaSimulator';
import { WEAPON_POOL_RULES } from '../../constants';
import { useAuthStore, useHistoryStore, usePoolStore } from '../../stores';
import { usePersonalGameAccounts } from '../../hooks/app/usePersonalGameAccounts.js';
import { loadAllAccountGachaHistoryForAccounts } from '../../services/accountGachaDataService.js';
import { getBootstrapVisiblePools } from '../../services/bootstrapService';
import { loadAllPoolsForCatalog, loadVisiblePools, mergePoolCollections } from '../../services/poolReadService';
import {
  buildSimulatorStorageScope,
  migrateLegacySimulatorStorageToScope,
  clearSimulatorResourceSettings,
  clearInfoBookState,
  clearSimulatorCurrentPoolId,
  clearSimulatorMultipleFreeTenPreference,
  clearSimulatorSkipAnimationPreference,
  clearSharedPityState,
  clearSimulatorState,
  clearSimulatorSeriesState,
  copyToClipboard,
  downloadAnalysisReport,
  downloadSimulatorData,
  loadSimulatorCurrentPoolId,
  loadSimulatorResourceSettings,
  loadInfoBookState,
  loadSimulatorOriginitePromptSuppressDate,
  loadSimulatorSkipAnimationPreference,
  loadSharedPityState,
  loadSimulatorState,
  loadSimulatorSeriesState,
  saveSimulatorCurrentPoolId,
  saveSimulatorOriginitePromptSuppressDate,
  saveSimulatorResourceSettings,
  saveInfoBookState,
  saveSimulatorSkipAnimationPreference,
  saveSharedPityState,
  saveSimulatorState,
  saveSimulatorSeriesState,
} from '../../utils/simulatorStorage';
import {
  DEFAULT_SIMULATOR_RESOURCE_SETTINGS,
  buildSimulatorResourceLedger,
  canAffordSimulatorPull,
  getOriginiteConversionPlanForJadeCost,
  getSimulatorPullCost,
  normalizeResourceSettings,
} from '../../utils/resourceEconomy';
import {
  buildSimulatorShareCardFileName,
  buildSimulatorShareFile,
  buildSimulatorSharePayload,
  buildSimulatorShareText,
  canCopyImageToClipboard,
  canNativeShareSimulatorFile,
  copyImageBlobToClipboard,
  downloadSimulatorShareCard,
  renderSimulatorShareCardToBlob,
  shareSimulatorShareCardFile,
} from '../../utils/simulatorShare';
import { buildSinglePoolTimelineSection } from '../../utils/poolTimelineView.js';
import { buildDashboardStats, buildPityInfoWithGuarantee, processHistoryGroups } from './simulatorViewUtils';
import { buildInheritedSimulatorSnapshot, normalizeSimulatorPoolType } from './simulatorInheritance';
import { getLatestPendingInfoBook, reconcileInfoBookState, sortLimitedPoolsByStartTime } from './simulatorInfoBook';
import { getCurrentUpPoolName } from '../../utils/poolTimeUtils';
import { resolvePoolRosterBuckets } from '../../utils/poolRoster.js';
import { appLogger } from '../../utils/appLogger.js';
import useShareActionFeedback from '../../hooks/useShareActionFeedback';
import { useI18n } from '../../i18n/index.js';
import { POOL_GROUP_PREFIX } from '../../utils/poolGroupUtils.js';
import { getPoolFeaturedLead } from '../../utils/poolFeaturedResolver.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { getPoolSeriesStateKey } from '../../utils/poolScopedHistory.js';
import { applySimulatorSeriesState, buildSimulatorSeriesState } from './simulatorSeriesState.js';
import {
  getGameAccountSelectionValue,
  isGameAccountSelectionMatch,
} from '../../utils/gameAccountMetadata.js';

function dedupeRosterEntries(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = String(item?.name || '').trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeSimulatorRoster(roster) {
  if (!roster) {
    return null;
  }

  const items = Array.isArray(roster.items) ? roster.items : [];
  const mapNamesToEntries = (names = [], rarity = 0, isUp = false) =>
    (Array.isArray(names) ? names : []).map((name) => ({
      id: String(name || '').trim(),
      name: String(name || '').trim(),
      rarity,
      isUp,
    })).filter((item) => item.name);

  const resolvedUp = Array.isArray(roster.up) ? roster.up : [];
  const resolvedOffBanner = Array.isArray(roster.offBanner)
    ? roster.offBanner
    : [];
  const resolvedFiveStar = items.filter((item) => Number(item?.rarity) === 5);
  const resolvedFourStar = items.filter((item) => Number(item?.rarity) === 4);

  return {
    up: dedupeRosterEntries(resolvedUp),
    offBanner: dedupeRosterEntries(resolvedOffBanner),
    fiveStar: dedupeRosterEntries(
      resolvedFiveStar.length > 0 ? resolvedFiveStar : mapNamesToEntries(roster.fiveStar, 5)
    ),
    fourStar: dedupeRosterEntries(
      resolvedFourStar.length > 0 ? resolvedFourStar : mapNamesToEntries(roster.fourStar, 4)
    ),
  };
}

function normalizeRosterForCompare(roster) {
  if (!roster) {
    return null;
  }

  const mapEntry = (entry) => {
    if (typeof entry === 'string') {
      return entry.trim();
    }

    return [
      String(entry?.id || '').trim(),
      String(entry?.name || '').trim(),
      Number(entry?.rarity) || 0,
      Boolean(entry?.isUp),
    ];
  };
  const mapEntries = (items) => (Array.isArray(items) ? items.map(mapEntry) : []);

  return {
    up: mapEntries(roster.up),
    offBanner: mapEntries(roster.offBanner),
    fiveStar: mapEntries(roster.fiveStar),
    fourStar: mapEntries(roster.fourStar),
  };
}

function areSimulatorRostersEqual(left, right) {
  return JSON.stringify(normalizeRosterForCompare(left)) === JSON.stringify(normalizeRosterForCompare(right));
}

function isAggregateSimulatorPool(pool) {
  const rawId = String(pool?.id || pool?.pool_id || '').trim();
  const rawName = String(pool?.name || '').trim();

  if (!rawId && !rawName) {
    return false;
  }

  if (rawId.startsWith(POOL_GROUP_PREFIX)) {
    return true;
  }

  return [
    /^全部.+池$/,
    /^全部.+卡池$/,
    /^全部.+寻访$/,
    /^全.+池$/,
    /汇总/,
    /总览/,
    /概览/
  ].some((pattern) => pattern.test(rawName));
}

const getWeaponPoolRules = (pool) =>
  pool?.isLimitedWeapon !== false
    ? WEAPON_POOL_RULES
    : {
        ...WEAPON_POOL_RULES,
        giftInterval: Infinity,
      };

const getCustomRulesForPool = (pool) => {
  const capabilities = resolvePoolCapabilities(pool);
  if (capabilities.basePoolType === 'weapon' && capabilities.rawPoolType !== 'extra') {
    return getWeaponPoolRules(pool);
  }

  return capabilities.rules;
};

function getTodayPromptKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeStoredPoolId(value) {
  if (!value || value === 'null' || value === 'undefined') {
    return null;
  }

  return value;
}

function getRosterPoolTypeForSimulator(capabilities) {
  if (capabilities.basePoolType === 'weapon') {
    return 'weapon';
  }

  if (capabilities.basePoolType === 'limited' || capabilities.basePoolType === 'extra') {
    return 'limited';
  }

  return 'standard';
}

export function buildSimulatorCurrentPoolView({
  currentSimPool,
  simulator,
  resolvedRoster = null,
  fallbackName = '',
} = {}) {
  const sourcePool = currentSimPool || {};
  const capabilities = resolvePoolCapabilities(
    currentSimPool || simulator?.poolInfo || { type: simulator?.rawPoolType || simulator?.poolType || 'limited' }
  );
  const effectivePoolType = normalizeSimulatorPoolType(
    simulator?.poolType || capabilities.basePoolType
  );

  return {
    ...sourcePool,
    type: sourcePool.type || capabilities.rawPoolType,
    source_pool_id: sourcePool.source_pool_id || sourcePool.sourcePoolId || sourcePool.id || null,
    effectivePoolType,
    effective_pool_type: effectivePoolType,
    basePoolType: capabilities.basePoolType,
    base_pool_type: capabilities.basePoolType,
    extra_subtype: sourcePool.extra_subtype ?? sourcePool.extraSubtype ?? capabilities.extraSubtype,
    extra_rule_profile: sourcePool.extra_rule_profile ?? sourcePool.extraRuleProfile ?? capabilities.ruleProfile,
    extra_series_key: sourcePool.extra_series_key ?? sourcePool.extraSeriesKey ?? capabilities.seriesKey,
    extra_series_phase: sourcePool.extra_series_phase ?? sourcePool.extraSeriesPhase ?? null,
    isLimitedWeapon: sourcePool.isLimitedWeapon !== false,
    name: sourcePool.original_name || sourcePool.name || fallbackName,
    name_en: sourcePool.name_en || null,
    up_character: sourcePool.up_character,
    featured_characters: sourcePool.featured_characters || null,
    resolved_roster: resolvedRoster || sourcePool.resolved_roster || null,
  };
}

function hydrateSimulatorStateForPool(pool, savedState, storageScope) {
  const seriesStateKey = getPoolSeriesStateKey(pool);
  const seriesState = seriesStateKey
    ? loadSimulatorSeriesState(seriesStateKey, storageScope)
    : null;
  return applySimulatorSeriesState(pool, savedState || {}, seriesState);
}

function persistSimulatorPoolState(pool, state, storageScope) {
  if (!pool?.id || !state) {
    return;
  }

  saveSimulatorState(pool.id, state, storageScope);
  const seriesState = buildSimulatorSeriesState(pool, state);
  if (seriesState?.seriesStateKey) {
    saveSimulatorSeriesState(seriesState.seriesStateKey, seriesState, storageScope);
  }
}

function clearSimulatorSeriesStatesForPools(pools, storageScope) {
  const clearedKeys = new Set();
  (Array.isArray(pools) ? pools : []).forEach((pool) => {
    const seriesStateKey = getPoolSeriesStateKey(pool);
    if (!seriesStateKey || clearedKeys.has(seriesStateKey)) {
      return;
    }
    clearSimulatorSeriesState(seriesStateKey, storageScope);
    clearedKeys.add(seriesStateKey);
  });
}

export function useGachaSimulatorController() {
  const { t, locale } = useI18n();
  const currentUserId = useAuthStore((state) => state.user?.id || null);
  const history = useHistoryStore((state) => state.history);
  const personalGameAccounts = usePersonalGameAccounts();
  const storePools = usePoolStore((state) => state.pools);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const switchGameAccount = usePoolStore((state) => state.switchGameAccount);
  const simulatorStorageScope = useMemo(
    () =>
      buildSimulatorStorageScope({
        currentUserId,
        currentGameUid,
      }),
    [currentGameUid, currentUserId]
  );
  const [publicPools, setPublicPools] = useState([]);
  const realPools = storePools.length > 0 ? storePools : publicPools;
  const fallbackLimitedPoolName = useMemo(() => getCurrentUpPoolName(realPools) || '莱万汀', [realPools]);
  const resolvePoolTargetName = useCallback(
    (pool, fallbackName = null) => {
      const capabilities = resolvePoolCapabilities(pool);

      if (capabilities.targetMode === 'single-up' && capabilities.entityType === 'character') {
        return pool?.up_character || fallbackName || fallbackLimitedPoolName;
      }

      if (capabilities.targetMode === 'single-up' && capabilities.entityType === 'weapon') {
        return pool?.up_character || fallbackName || null;
      }

      if (capabilities.targetMode === 'four-target-equal') {
        return getPoolFeaturedLead(pool) || fallbackName || null;
      }

      return null;
    },
    [fallbackLimitedPoolName]
  );

  useEffect(() => {
    if (storePools.length > 0) {
      return undefined;
    }

    let cancelled = false;

    const loadPublicPools = async () => {
      try {
        const bootstrapPools = await getBootstrapVisiblePools().catch(() => null);
        const directPools =
          Array.isArray(bootstrapPools) && bootstrapPools.length > 0
            ? bootstrapPools
            : await loadVisiblePools().catch(() => null);
        const catalogPools = await loadAllPoolsForCatalog().catch(() => []);
        const mergedPools = mergePoolCollections(
          Array.isArray(directPools) ? directPools : [],
          Array.isArray(catalogPools) ? catalogPools : []
        );

        if (!cancelled && mergedPools.length > 0) {
          setPublicPools(mergedPools);
        }
      } catch (error) {
        appLogger.warn('加载公开卡池失败，继续使用本地/已缓存卡池:', error);
      }
    };

    loadPublicPools();
    return () => {
      cancelled = true;
    };
  }, [storePools.length]);

  const [poolCharactersList, setPoolCharactersList] = useState(null);
  const [simulator, setSimulator] = useState(() => createSimulator('limited', null, fallbackLimitedPoolName, null));
  const [isAnimating, setIsAnimating] = useState(false);
  const [lastResults, setLastResults] = useState(null);
  const [stats, setStats] = useState(simulator.getStatistics());
  const [pityInfo, setPityInfo] = useState(simulator.getPityInfo());
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [pullHistory, setPullHistory] = useState([]);
  const [expandedTenPulls, setExpandedTenPulls] = useState(new Set());
  const [availableFreePulls, setAvailableFreePulls] = useState(0);
  const [infoBookTenPullAvailable, setInfoBookTenPullAvailable] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showOriginitePrompt, setShowOriginitePrompt] = useState(null);
  const [disableOriginitePromptToday, setDisableOriginitePromptToday] = useState(false);
  const [resetAllPools, setResetAllPools] = useState(false);
  const [resetKeepResources, setResetKeepResources] = useState(false);
  const [resetSettings, setResetSettings] = useState(false);
  const [skipAnimation, setSkipAnimation] = useState(() => loadSimulatorSkipAnimationPreference());
  const [showPoolMenu, setShowPoolMenu] = useState(false);
  const [selectedLimitedPool, setSelectedLimitedPool] = useState(() => fallbackLimitedPoolName);
  const [resourceSettings, setResourceSettings] = useState(() => loadSimulatorResourceSettings(simulatorStorageScope));
  const [currentSimulatorState, setCurrentSimulatorState] = useState(() => simulator.getState());
  const {
    feedback: shareActionFeedback,
    isBusy: isShareActionBusy,
    beginAction: beginShareAction,
    updateAction: updateShareAction,
    finishAction: finishShareAction,
    failAction: failShareAction,
    resetFeedback: resetShareActionFeedback,
  } = useShareActionFeedback();

  const simulatorPools = useMemo(() => {
    const poolsArray = Array.isArray(realPools) ? realPools : [];
    const sortedPools = [...poolsArray]
      .filter((pool) => !isAggregateSimulatorPool(pool))
      .sort((left, right) => {
      if (!left.start_time && !right.start_time) return 0;
      if (!left.start_time) return 1;
      if (!right.start_time) return -1;
      return new Date(left.start_time).getTime() - new Date(right.start_time).getTime();
      });

    return sortedPools.map((pool) => ({
      ...pool,
      source_pool_id: pool.id,
      id: `sim_${pool.id}`,
      original_name: pool.name,
      name: `${pool.name} [模拟]`,
      isSimulator: true,
    }));
  }, [realPools]);

  const [currentSimPoolId, setCurrentSimPoolId] = useState(() =>
    normalizeStoredPoolId(loadSimulatorCurrentPoolId(simulatorStorageScope))
  );
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (simulatorPools.length === 0) {
      return;
    }

    migrateLegacySimulatorStorageToScope({
      scope: simulatorStorageScope,
      poolIds: simulatorPools.map((pool) => pool.id),
    });
  }, [simulatorPools, simulatorStorageScope]);

  useEffect(() => {
    const fallbackUpPool = fallbackLimitedPoolName;
    const nextSimulator = createSimulator('limited', null, fallbackUpPool, null);
    const nextResourceSettings = loadSimulatorResourceSettings(simulatorStorageScope);
    const nextPoolId = normalizeStoredPoolId(loadSimulatorCurrentPoolId(simulatorStorageScope));
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setResourceSettings(nextResourceSettings);
      setCurrentSimPoolId(nextPoolId);
      setSimulator(nextSimulator);
      setCurrentSimulatorState(nextSimulator.getState());
      setStats(nextSimulator.getStatistics());
      setPityInfo(nextSimulator.getPityInfo());
      setPullHistory([]);
      setLastResults(null);
      setExpandedTenPulls(new Set());
      setAvailableFreePulls(0);
      setInfoBookTenPullAvailable(false);
      setPoolCharactersList(null);
      setSelectedLimitedPool(fallbackUpPool);
      setIsInitialized(false);
    });

    return () => {
      cancelled = true;
    };
  }, [fallbackLimitedPoolName, simulatorStorageScope]);

  const currentSimPool = useMemo(
    () => simulatorPools.find((pool) => pool.id === currentSimPoolId),
    [simulatorPools, currentSimPoolId]
  );
  const currentSimPoolSource = useMemo(
    () => (
      currentSimPool
        ? {
            ...currentSimPool,
            resolved_roster: poolCharactersList || currentSimPool?.resolved_roster || null,
          }
        : null
    ),
    [currentSimPool, poolCharactersList]
  );
  const currentPoolCapabilities = useMemo(
    () => resolvePoolCapabilities(currentSimPool || { type: 'limited' }),
    [currentSimPool]
  );
  const currentPoolType = currentPoolCapabilities.basePoolType;
  const getLocalizedSimulatorPoolTypeName = useCallback(
    (poolType) => {
      const normalizedType = normalizeSimulatorPoolType(poolType || 'limited');
      if (normalizedType === 'weapon') {
        return t('simulator.poolTypeName.weapon');
      }

      if (normalizedType === 'extra') {
        return t('simulator.poolTypeName.extra');
      }

      if (normalizedType === 'standard') {
        return t('simulator.poolTypeName.standard');
      }

      return t('simulator.poolTypeName.limited');
    },
    [t]
  );
  const allSimulatorStates = useMemo(
    () =>
      simulatorPools.map((pool) => {
        if (pool.id === currentSimPoolId && simulator) {
          const state = currentSimulatorState || simulator.exportState();
          return {
            ...state,
            poolId: pool.id,
            poolType: resolvePoolCapabilities(pool).basePoolType,
            extraRuleProfile: pool.extra_rule_profile || pool.extraRuleProfile || null,
            extraSeriesKey: pool.extra_series_key || pool.extraSeriesKey || null,
          };
        }

        const savedState = loadSimulatorState(pool.id, simulatorStorageScope) || {};
        return {
          ...savedState,
          poolId: pool.id,
          poolType: resolvePoolCapabilities(pool).basePoolType,
          extraRuleProfile: pool.extra_rule_profile || pool.extraRuleProfile || null,
          extraSeriesKey: pool.extra_series_key || pool.extraSeriesKey || null,
          pullHistory: Array.isArray(savedState.pullHistory) ? savedState.pullHistory : [],
        };
      }),
    [currentSimPoolId, currentSimulatorState, simulator, simulatorPools, simulatorStorageScope]
  );
  const poolPullCounts = useMemo(
    () =>
      simulatorPools.reduce((accumulator, pool, index) => {
        accumulator[pool.id] = allSimulatorStates[index]?.pullHistory?.length || 0;
        return accumulator;
      }, {}),
    [allSimulatorStates, simulatorPools]
  );
  const resourceLedger = useMemo(
    () => buildSimulatorResourceLedger(allSimulatorStates, resourceSettings),
    [allSimulatorStates, resourceSettings]
  );
  const currentPullCosts = useMemo(() => {
    const normalizedSettings = normalizeResourceSettings(resourceSettings);
      const tenPullContext = {
      poolType: currentPoolType,
      pullType: 'ten',
      settings: normalizedSettings,
      isFree: availableFreePulls > 0 && (currentPoolType === 'limited' || currentPoolType === 'extra'),
      isInfoBook: infoBookTenPullAvailable && currentPoolType === 'limited',
    };

    return {
      single: getSimulatorPullCost({
        poolType: currentPoolType,
        pullType: 'single',
        settings: normalizedSettings,
      }),
      ten: getSimulatorPullCost(tenPullContext),
      settings: normalizedSettings,
    };
  }, [availableFreePulls, currentPoolType, infoBookTenPullAvailable, resourceSettings]);
  const isWeaponPool = currentPoolType === 'weapon';
  const canAffordSinglePull = isWeaponPool
    ? false
    : canAffordSimulatorPull(resourceLedger, currentPullCosts.single);
  const canAffordTenPull = canAffordSimulatorPull(resourceLedger, currentPullCosts.ten);
  const getPullDisabledReason = useCallback(
    (cost, canAfford) => {
      if (isAnimating) {
        return t('simulator.toast.animating');
      }

      if (!poolCharactersList) {
        return t('simulator.toast.syncingPool');
      }

      if (canAfford) {
        return '';
      }

      if (cost?.resource === 'arsenalQuota') {
        const shortfall = Math.max(
          Number(cost.amount || 0) - Math.max(Number(resourceLedger?.arsenalBalance || 0), 0),
          0
        );
        return t('simulator.toast.arsenalShortfall', { count: shortfall.toLocaleString(locale) });
      }

      const shortfall = Math.max(
        Number(cost?.amount || 0) - Math.max(Number(resourceLedger?.availableJadeBudget || 0), 0),
        0
      );
      return t('simulator.toast.fullJadeShortfall', { count: shortfall.toLocaleString(locale) });
    },
    [isAnimating, locale, poolCharactersList, resourceLedger, t]
  );
  const singlePullDisabledReason = isWeaponPool
    ? t('simulator.toast.weaponSingleDisabled')
    : getPullDisabledReason(currentPullCosts.single, canAffordSinglePull);
  const tenPullDisabledReason = getPullDisabledReason(currentPullCosts.ten, canAffordTenPull);
  const currentSimPoolIdValue = currentSimPool?.id ?? null;
  const currentSimPoolFeaturedLead = currentSimPoolSource ? getPoolFeaturedLead(currentSimPoolSource) : null;

  useEffect(() => {
    if (!currentSimPoolIdValue) {
      return undefined;
    }

    let cancelled = false;

    const loadPoolCharacters = async () => {
      if (!currentPoolCapabilities.isResolved || currentPoolCapabilities.entityType === 'unknown') {
        setPoolCharactersList(null);
        return;
      }

      const expectedType = currentPoolCapabilities.entityType;
      const realPoolId = currentSimPoolIdValue.replace(/^sim_/, '');
      const roster = await resolvePoolRosterBuckets({
        poolId: realPoolId,
        expectedType,
        currentUpName: currentSimPoolFeaturedLead,
        poolType: getRosterPoolTypeForSimulator(currentPoolCapabilities),
        poolInfo: currentSimPool || null,
        mergeStrategy: currentPoolType === 'limited' || currentPoolType === 'extra' ? 'fill-missing' : 'append',
      });
      const mergedRoster = normalizeSimulatorRoster(roster);

      if (
        mergedRoster
        && (mergedRoster.up.length > 0
          || mergedRoster.offBanner.length > 0
          || mergedRoster.fiveStar.length > 0
          || mergedRoster.fourStar.length > 0)
      ) {
        if (!cancelled) {
          setPoolCharactersList((currentRoster) =>
            areSimulatorRostersEqual(currentRoster, mergedRoster) ? currentRoster : mergedRoster
          );
        }
        return;
      }
      appLogger.warn('[GachaSimulator] 当前卡池未配置显式阵容，模拟器已禁用默认回退');
      if (!cancelled) {
        setPoolCharactersList((currentRoster) => (currentRoster === null ? currentRoster : null));
      }
    };

    loadPoolCharacters();
    return () => {
      cancelled = true;
    };
  }, [
    currentSimPool,
    currentPoolCapabilities,
    currentPoolType,
    currentSimPoolFeaturedLead,
    currentSimPoolIdValue
  ]);

  useEffect(() => {
    if (currentSimPoolId && isInitialized) {
      saveSimulatorCurrentPoolId(currentSimPoolId, simulatorStorageScope);
      return;
    }

    if (isInitialized) {
      clearSimulatorCurrentPoolId(simulatorStorageScope);
    }
  }, [currentSimPoolId, isInitialized, simulatorStorageScope]);

  const getDefaultPool = useCallback(() => {
    if (simulatorPools.length === 0) {
      return null;
    }

    return simulatorPools.find((pool) => normalizeSimulatorPoolType(pool.type) === 'limited') || simulatorPools[0];
  }, [simulatorPools]);

  useEffect(() => {
    if (poolCharactersList && simulator) {
      simulator.setPoolCharactersList(poolCharactersList);
    }
  }, [poolCharactersList, simulator]);

  useEffect(() => {
    saveSimulatorSkipAnimationPreference(skipAnimation);
  }, [skipAnimation]);

  useEffect(() => {
    saveSimulatorResourceSettings(resourceSettings, simulatorStorageScope);
  }, [resourceSettings, simulatorStorageScope]);

  useEffect(() => {
    if (simulatorPools.length === 0 || isInitialized) {
      return;
    }

    const savedPoolId = normalizeStoredPoolId(loadSimulatorCurrentPoolId(simulatorStorageScope));
    let targetPool = null;
    let targetPoolId = null;

    if (savedPoolId) {
      targetPool = simulatorPools.find((pool) => pool.id === savedPoolId);
      if (targetPool) {
        targetPoolId = savedPoolId;
      }
    }

    if (!targetPool) {
      targetPool = getDefaultPool();
      targetPoolId = targetPool?.id || null;
    }

    if (targetPool && targetPoolId) {
      const savedState = loadSimulatorState(targetPoolId, simulatorStorageScope);
      const upCharacter = resolvePoolTargetName(targetPool);
      const nextSimulator = createSimulator(
        targetPool,
        getCustomRulesForPool(targetPool),
        upCharacter,
        poolCharactersList
      );

      nextSimulator.importState(hydrateSimulatorStateForPool(
        targetPool,
        savedState,
        simulatorStorageScope
      ));
      if (poolCharactersList) {
        nextSimulator.setPoolCharactersList(poolCharactersList);
      }

      queueMicrotask(() => {
        setCurrentSimPoolId(targetPoolId);
        setSimulator(nextSimulator);
        setCurrentSimulatorState(nextSimulator.getState());
        setStats(nextSimulator.getStatistics());
        setPityInfo(nextSimulator.getPityInfo());
        if (resolvePoolCapabilities(targetPool).basePoolType === 'limited') {
          setSelectedLimitedPool(upCharacter || fallbackLimitedPoolName);
        }
      });
    }

    queueMicrotask(() => {
      setIsInitialized(true);
    });
  }, [
    fallbackLimitedPoolName,
    getDefaultPool,
    isInitialized,
    poolCharactersList,
    resolvePoolTargetName,
    simulatorPools,
    simulatorStorageScope,
  ]);

  useEffect(() => {
    const updateUI = () => {
      const state = simulator.getState();
      setCurrentSimulatorState(state);
      setStats(simulator.getStatistics());
      setPityInfo(simulator.getPityInfo());
      setPullHistory(state.pullHistory || []);

      const simulatorCapabilities = simulator.capabilities;

      if (simulatorCapabilities.freeTenPullLimit > 0 || simulatorCapabilities.infoBookEnabled) {
        const nextStats = simulator.getStatistics();
        const earnedFreePulls = nextStats.freeTenPulls?.count || 0;
        const usedFreePulls = state.freeTenPullsReceived || 0;
        setAvailableFreePulls(Math.max(0, earnedFreePulls - usedFreePulls));

        if (!simulatorCapabilities.infoBookEnabled) {
          setInfoBookTenPullAvailable(false);
          if (currentSimPool) {
            persistSimulatorPoolState(currentSimPool, simulator.exportState(), simulatorStorageScope);
          }
          return;
        }

        const limitedPools = sortLimitedPoolsByStartTime(simulatorPools);
        const storedInfoBooks = loadInfoBookState(simulatorStorageScope);
        let nextInfoBooks = reconcileInfoBookState(storedInfoBooks, limitedPools);

        if (state.hasUnactivatedInfoBook && !nextInfoBooks[currentSimPoolId]) {
          const currentIndex = limitedPools.findIndex((pool) => pool.id === currentSimPoolId);
          if (currentIndex !== -1) {
            const nextPool = limitedPools[currentIndex + 1];
            nextInfoBooks = reconcileInfoBookState(
              {
                ...nextInfoBooks,
                [currentSimPoolId]: {
                  activated: false,
                  used: false,
                  targetPoolId: nextPool?.id || null,
                  obtainedAt: Date.now(),
                },
              },
              limitedPools
            );
          }
        }

        if (JSON.stringify(nextInfoBooks) !== JSON.stringify(storedInfoBooks)) {
          saveInfoBookState(nextInfoBooks, simulatorStorageScope);
        }

        const latestInfoBook = getLatestPendingInfoBook(nextInfoBooks, limitedPools);
        const isInfoBookAvailable = Boolean(
          latestInfoBook &&
          latestInfoBook.targetPoolId === currentSimPoolId &&
          latestInfoBook.activated &&
          !latestInfoBook.used
        );
        setInfoBookTenPullAvailable(isInfoBookAvailable);

        if (state.infoBookTenPullAvailable !== isInfoBookAvailable) {
          simulator.updateState({
            infoBookTenPullAvailable: isInfoBookAvailable,
          });
        }

        if (simulatorCapabilities.pityScope === 'shared') {
          saveSharedPityState(
            {
              sixStarPity: state.sixStarPity,
              fiveStarPity: state.fiveStarPity,
            },
            simulatorStorageScope
          );
        }
      } else {
        setAvailableFreePulls(0);
        setInfoBookTenPullAvailable(false);
      }

      if (currentSimPool) {
        persistSimulatorPoolState(currentSimPool, simulator.exportState(), simulatorStorageScope);
      }
    };

    simulator.addListener(updateUI);
    updateUI();
    return () => simulator.removeListener(updateUI);
  }, [currentSimPool, currentSimPoolId, simulator, simulatorPools, simulatorStorageScope]);

  const showToastMessage = useCallback((message) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }, []);

  const adjustResourceAmount = useCallback(
    (resourceKey, mode, amount) => {
      const normalizedAmount = Math.max(0, Math.floor(Number(amount) || 0));
      if (!normalizedAmount && (mode === 'add' || mode === 'convertOriginite')) {
        return;
      }

      setResourceSettings((current) => {
        const normalized = normalizeResourceSettings(current);

        if (resourceKey === 'jade') {
          if (mode === 'convertOriginite') {
            const currentOriginiteBalance = Math.max(Number(resourceLedger?.originiteBalance || 0), 0);
            if (normalizedAmount > currentOriginiteBalance) {
              showToastMessage(t('simulator.toast.availableOriginiteShortfall', { count: currentOriginiteBalance.toLocaleString(locale) }));
              return normalized;
            }

            return normalizeResourceSettings({
              ...normalized,
              manualConvertedOriginite: normalized.manualConvertedOriginite + normalizedAmount,
            });
          }

          const nextBaseJade =
            mode === 'add'
              ? normalized.baseJade + normalizedAmount
              : normalizedAmount + Number(resourceLedger?.jadeSpent || 0) - Number(resourceLedger?.convertedJade || 0);

          return normalizeResourceSettings({
            ...normalized,
            baseJade: nextBaseJade,
          });
        }

        if (resourceKey === 'originite') {
          const nextBaseOriginite =
            mode === 'add'
              ? normalized.baseOriginite + normalizedAmount
              : Math.max(0, normalizedAmount + Number(resourceLedger?.originiteSpent || 0));

          return normalizeResourceSettings({
            ...normalized,
            baseOriginite: nextBaseOriginite,
          });
        }

        if (resourceKey === 'arsenalQuota') {
          const nextBaseArsenalQuota =
            mode === 'add'
              ? normalized.baseArsenalQuota + normalizedAmount
              : normalizedAmount +
                Number(resourceLedger?.arsenalSpent || 0) -
                Number(resourceLedger?.arsenalGained || 0);

          return normalizeResourceSettings({
            ...normalized,
            baseArsenalQuota: nextBaseArsenalQuota,
          });
        }

        return normalized;
      });
    },
    [locale, resourceLedger, showToastMessage, t]
  );

  const toggleCnOriginiteDoubleBonus = useCallback(() => {
    setResourceSettings((current) =>
      normalizeResourceSettings({
        ...current,
        cnOriginiteDoubleBonusEnabled: !normalizeResourceSettings(current).cnOriginiteDoubleBonusEnabled,
      })
    );
  }, []);

  const toggleInfiniteResources = useCallback(() => {
    setResourceSettings((current) =>
      normalizeResourceSettings({
        ...current,
        infiniteResources: !normalizeResourceSettings(current).infiniteResources,
      })
    );
  }, []);

  const executeResolvedPull = useCallback(
    (type, options = {}) => {
      const { isInfoBookPull = false, isFreePull = false, conversionPlan = null } = options;

      if (type === 'single' && normalizeSimulatorPoolType(simulator.poolType) === 'weapon') {
        showToastMessage(t('simulator.toast.weaponSingleDisabled'));
        return;
      }

      if (conversionPlan?.originiteNeeded > 0) {
        adjustResourceAmount('jade', 'convertOriginite', conversionPlan.originiteNeeded);
      }

      setIsAnimating(true);
      setLastResults(null);

      const animationDelay = skipAnimation ? 0 : 2500;
      setTimeout(() => {
        let results;

        if (type === 'single') {
          results = [simulator.pullSingle()];
        } else if (isInfoBookPull) {
          const limitedPools = sortLimitedPoolsByStartTime(simulatorPools);
          const infoBooks = reconcileInfoBookState(loadInfoBookState(simulatorStorageScope), limitedPools);
          const latestInfoBook = getLatestPendingInfoBook(infoBooks, limitedPools);
          const sourcePoolId =
            latestInfoBook?.targetPoolId === currentSimPoolId && latestInfoBook?.activated
              ? latestInfoBook.sourcePoolId
              : null;

          if (sourcePoolId) {
            saveInfoBookState(
              {
                ...infoBooks,
                [sourcePoolId]: {
                  ...infoBooks[sourcePoolId],
                  used: true,
                },
              },
              simulatorStorageScope
            );
          }

          setInfoBookTenPullAvailable(false);
          results = simulator.pullInfoBookTen();
          showToastMessage(t('simulator.toast.infoBookTenUsed'));
        } else if (isFreePull) {
          results = simulator.pullFreeTen();
          showToastMessage(t('simulator.toast.freeTenUsed'));
        } else {
          results = simulator.pullTen();
        }

        setLastResults(results);
        setIsAnimating(false);
      }, animationDelay);
    },
    [
      adjustResourceAmount,
      currentSimPoolId,
      simulatorPools,
      simulatorStorageScope,
      showToastMessage,
      simulator,
      skipAnimation,
      t,
    ]
  );

  const closeOriginiteConversionPrompt = useCallback(() => {
    setShowOriginitePrompt(null);
    setDisableOriginitePromptToday(false);
  }, []);

  const confirmOriginiteConversionPrompt = useCallback(() => {
    if (!showOriginitePrompt) {
      return;
    }

    if (disableOriginitePromptToday) {
      saveSimulatorOriginitePromptSuppressDate(getTodayPromptKey());
    }

    const pendingPrompt = showOriginitePrompt;
    setShowOriginitePrompt(null);
    setDisableOriginitePromptToday(false);
    executeResolvedPull(pendingPrompt.type, pendingPrompt);
  }, [disableOriginitePromptToday, executeResolvedPull, showOriginitePrompt]);

  const handlePull = useCallback(
    (type) => {
      if (isAnimating) {
        return;
      }

      if (type === 'single' && normalizeSimulatorPoolType(simulator.poolType) === 'weapon') {
        showToastMessage(t('simulator.toast.weaponSingleDisabled'));
        return;
      }

      const isInfoBookPull =
        type === 'ten' && infoBookTenPullAvailable && normalizeSimulatorPoolType(simulator.poolType) === 'limited';
      const isFreePull =
        !isInfoBookPull &&
        type === 'ten' &&
        availableFreePulls > 0 &&
        ['limited', 'extra'].includes(normalizeSimulatorPoolType(simulator.poolType));
      const pullCost = getSimulatorPullCost({
        poolType: simulator.poolType,
        pullType: type,
        settings: currentPullCosts.settings,
        isFree: isFreePull,
        isInfoBook: isInfoBookPull,
      });

      if (!canAffordSimulatorPull(resourceLedger, pullCost)) {
        if (pullCost.resource === 'arsenalQuota') {
          const shortfall = Math.max(pullCost.amount - Math.max(resourceLedger.arsenalBalance, 0), 0);
          showToastMessage(t('simulator.toast.arsenalShortfall', { count: shortfall.toLocaleString(locale) }));
        } else {
          const shortfall = Math.max(pullCost.amount - Math.max(resourceLedger.availableJadeBudget, 0), 0);
          showToastMessage(t('simulator.toast.resourceShortfall', { count: shortfall.toLocaleString(locale) }));
        }
        return;
      }

      let conversionPlan = null;
      if (!isFreePull && !isInfoBookPull && pullCost.resource === 'jade') {
        conversionPlan = getOriginiteConversionPlanForJadeCost({
          ledger: resourceLedger,
          jadeCost: pullCost.amount,
          settings: currentPullCosts.settings,
        });

        if (conversionPlan.canConvert && conversionPlan.originiteNeeded > 0) {
          const actionLabel = type === 'ten' ? t('simulator.toast.action.ten') : t('simulator.toast.action.single');
          const suppressToday = loadSimulatorOriginitePromptSuppressDate() === getTodayPromptKey();

          if (!suppressToday) {
            setDisableOriginitePromptToday(false);
            setShowOriginitePrompt({
              type,
              isInfoBookPull,
              isFreePull,
              conversionPlan,
              message: t('simulator.toast.originiteConfirmMessage', {
                actionLabel,
                originite: conversionPlan.originiteNeeded.toLocaleString(locale),
                jade: (conversionPlan.originiteNeeded * conversionPlan.rate).toLocaleString(locale),
              }),
            });
            return;
          }
        }
      }

      executeResolvedPull(type, {
        isInfoBookPull,
        isFreePull,
        conversionPlan,
      });
    },
    [
      availableFreePulls,
      currentPullCosts.settings,
      infoBookTenPullAvailable,
      isAnimating,
      locale,
      resourceLedger,
      executeResolvedPull,
      showToastMessage,
      simulator.poolType,
      t,
    ]
  );

  const handleReset = useCallback(() => {
    setShowResetConfirm(true);
  }, []);

  const handleInheritRealState = useCallback(
    async (selectedAccount = null) => {
      if (!currentSimPoolId || !currentSimPool) {
        showToastMessage(t('simulator.toast.noInheritablePool'));
        return;
      }

      const availableAccounts = personalGameAccounts;
      const resolvedAccount =
        selectedAccount ||
        (currentGameUid ? availableAccounts.find((account) => isGameAccountSelectionMatch(account, currentGameUid)) : null) ||
        (availableAccounts.length === 1 ? availableAccounts[0] : null);
      const selectedAccountValue = getGameAccountSelectionValue(resolvedAccount);
      const selectedGameUid = resolvedAccount?.gameUid || resolvedAccount?.game_uid || null;
      const selectedAccountName = resolvedAccount?.nickName || resolvedAccount?.nick_name || selectedGameUid;

      if (!selectedAccountValue) {
        showToastMessage(t('simulator.toast.selectAccount'));
        return;
      }

      const targetStorageScope = buildSimulatorStorageScope({
        currentUserId,
        currentGameUid: selectedAccountValue,
      });
      let inheritanceHistory = history;
      if (currentUserId) {
        try {
          const loaded = await loadAllAccountGachaHistoryForAccounts({
            accounts: [resolvedAccount],
            expectedOwnerId: currentUserId,
          });
          inheritanceHistory = loaded.history;
        } catch (error) {
          showToastMessage(error?.message || t('simulator.toast.noRealHistory', { name: selectedAccountName }));
          return;
        }
      }

      const inheritedSnapshot = buildInheritedSimulatorSnapshot({
        history: inheritanceHistory,
        realPools,
        currentGameUid: selectedAccountValue,
        currentUserId,
        currentSimPoolId,
      });

      if (!inheritedSnapshot.hasAnyData) {
        showToastMessage(t('simulator.toast.noRealHistory', { name: selectedAccountName }));
        return;
      }

      simulatorPools.forEach((pool) => {
        clearSimulatorState(pool.id, targetStorageScope);
      });
      clearSimulatorSeriesStatesForPools(simulatorPools, targetStorageScope);

      Object.entries(inheritedSnapshot.statesByPoolId).forEach(([poolId, state]) => {
        saveSimulatorState(poolId, state, targetStorageScope);
      });
      Object.entries(inheritedSnapshot.seriesStates || {}).forEach(([seriesStateKey, state]) => {
        saveSimulatorSeriesState(seriesStateKey, state, targetStorageScope);
      });

      clearSharedPityState(targetStorageScope);
      if (inheritedSnapshot.sharedPityState) {
        saveSharedPityState(inheritedSnapshot.sharedPityState, targetStorageScope);
      }

      clearInfoBookState(targetStorageScope);
      if (Object.keys(inheritedSnapshot.infoBooks).length > 0) {
        saveInfoBookState(inheritedSnapshot.infoBooks, targetStorageScope);
      }

      const targetResourceSettings =
        selectedAccountValue === currentGameUid ? resourceSettings : loadSimulatorResourceSettings(targetStorageScope);
      const inheritedLedger = buildSimulatorResourceLedger(
        Object.values(inheritedSnapshot.statesByPoolId),
        targetResourceSettings
      );

      if (Number(inheritedLedger?.arsenalBalance || 0) < 0) {
        const nextResourceSettings = normalizeResourceSettings({
          ...targetResourceSettings,
          baseArsenalQuota:
            Number(targetResourceSettings?.baseArsenalQuota || 0) +
            Math.abs(Number(inheritedLedger.arsenalBalance || 0)),
        });

        saveSimulatorResourceSettings(nextResourceSettings, targetStorageScope);

        if (selectedAccountValue === currentGameUid) {
          setResourceSettings(nextResourceSettings);
        }
      }

      saveSimulatorCurrentPoolId(currentSimPoolId, targetStorageScope);

      if (selectedAccountValue !== currentGameUid) {
        switchGameAccount(selectedAccountValue);
        showToastMessage(t('simulator.toast.inheritAllSuccess', { name: selectedAccountName }));
        return;
      }

      const inheritedState = inheritedSnapshot.statesByPoolId[currentSimPoolId];
      const upCharacter = resolvePoolTargetName(currentSimPool);
      const nextSimulator = createSimulator(
        currentSimPool,
        getCustomRulesForPool(currentSimPool),
        upCharacter,
        poolCharactersList
      );

      if (inheritedState) {
        nextSimulator.importState(inheritedState);
      }
      if (upCharacter) {
        nextSimulator.setCurrentUpCharacter(upCharacter);
        setSelectedLimitedPool(upCharacter);
      }
      if (poolCharactersList) {
        nextSimulator.setPoolCharactersList(poolCharactersList);
      }
      setExpandedTenPulls(new Set());
      setLastResults(null);
      setSimulator(nextSimulator);
      setCurrentSimulatorState(nextSimulator.getState());
      setStats(nextSimulator.getStatistics());
      setPityInfo(nextSimulator.getPityInfo());
      setPullHistory(nextSimulator.getState().pullHistory || []);
      showToastMessage(t('simulator.toast.inheritAllSuccess', { name: selectedAccountName }));
    },
    [
      currentGameUid,
      currentSimPool,
      currentSimPoolId,
      currentUserId,
      history,
      personalGameAccounts,
      poolCharactersList,
      realPools,
      resourceSettings,
      simulatorPools,
      showToastMessage,
      resolvePoolTargetName,
      switchGameAccount,
      t,
    ]
  );

  const closeResetDialog = useCallback(() => {
    setShowResetConfirm(false);
    setResetAllPools(false);
    setResetKeepResources(false);
    setResetSettings(false);
  }, []);

  const confirmReset = useCallback(() => {
    let resetMessage = '';

    if (resetAllPools) {
      simulatorPools.forEach((pool) => {
        clearSimulatorState(pool.id, simulatorStorageScope);
      });
      clearSimulatorSeriesStatesForPools(simulatorPools, simulatorStorageScope);
      clearSharedPityState(simulatorStorageScope);
      clearInfoBookState(simulatorStorageScope);
      resetMessage = t('simulator.toast.resetAllSuccess');
    } else {
      const type = normalizeSimulatorPoolType(currentSimPool?.type || 'limited');
      const resetPools = simulatorPools
        .filter((pool) => normalizeSimulatorPoolType(pool.type) === type);
      resetPools.forEach((pool) => {
          clearSimulatorState(pool.id, simulatorStorageScope);
        });
      clearSimulatorSeriesStatesForPools(resetPools, simulatorStorageScope);

      if (type === 'limited') {
        clearSharedPityState(simulatorStorageScope);
        clearInfoBookState(simulatorStorageScope);
      }

      resetMessage = t('simulator.toast.resetTypeSuccess', {
        typeName: getLocalizedSimulatorPoolTypeName(type),
      });
    }

    simulator.reset();
    setCurrentSimulatorState(simulator.getState());
    setPullHistory([]);
    setAvailableFreePulls(0);
    setInfoBookTenPullAvailable(false);
    setLastResults(null);

    if (!resetKeepResources) {
      clearSimulatorResourceSettings(simulatorStorageScope);
      setResourceSettings((current) =>
        normalizeResourceSettings({
          ...current,
          baseJade: 0,
          baseOriginite: 0,
          baseArsenalQuota: 0,
          manualConvertedOriginite: 0,
          cnOriginiteDoubleBonusEnabled: DEFAULT_SIMULATOR_RESOURCE_SETTINGS.cnOriginiteDoubleBonusEnabled,
          infiniteResources: DEFAULT_SIMULATOR_RESOURCE_SETTINGS.infiniteResources,
        })
      );
    }

    if (resetSettings) {
      setSkipAnimation(false);
      clearSimulatorSkipAnimationPreference();
      clearSimulatorMultipleFreeTenPreference();
    }

    closeResetDialog();
    showToastMessage(
      resetKeepResources ? `${resetMessage}${t('simulator.toast.resetKeepResources')}` : resetMessage
    );
  }, [
    closeResetDialog,
    currentSimPool?.type,
    getLocalizedSimulatorPoolTypeName,
    resetAllPools,
    resetKeepResources,
    resetSettings,
    showToastMessage,
    simulator,
    simulatorPools,
    simulatorStorageScope,
    t,
  ]);

  const switchPool = useCallback(
    (poolId) => {
      if (currentSimPoolId === poolId) {
        return;
      }

      const targetPool = simulatorPools.find((pool) => pool.id === poolId);
      if (!targetPool) {
        return;
      }

      if (currentSimPool) {
        persistSimulatorPoolState(currentSimPool, simulator.exportState(), simulatorStorageScope);
      }

      if (simulator.capabilities.pityScope === 'shared') {
        const state = simulator.getState();
        saveSharedPityState(
          {
            sixStarPity: state.sixStarPity,
            fiveStarPity: state.fiveStarPity,
          },
          simulatorStorageScope
        );
      }

      setPoolCharactersList(null);

      const savedState = loadSimulatorState(poolId, simulatorStorageScope);
      const upCharacter = resolvePoolTargetName(targetPool, selectedLimitedPool);
      const targetCapabilities = resolvePoolCapabilities(targetPool);
      const nextSimulator = createSimulator(targetPool, getCustomRulesForPool(targetPool), upCharacter, null);

      nextSimulator.importState(hydrateSimulatorStateForPool(
        targetPool,
        savedState,
        simulatorStorageScope
      ));
      if (upCharacter) {
        nextSimulator.setCurrentUpCharacter(upCharacter);
      }

      if (targetCapabilities.pityScope === 'shared') {
        const sharedPity = loadSharedPityState(simulatorStorageScope);
        if (sharedPity) {
          nextSimulator.updateState({
            sixStarPity: Number(sharedPity.sixStarPity || 0),
            fiveStarPity: Number(sharedPity.fiveStarPity || 0),
          });
        }

        const limitedPools = sortLimitedPoolsByStartTime(simulatorPools);
        const infoBooks = reconcileInfoBookState(loadInfoBookState(simulatorStorageScope), limitedPools);
        const latestInfoBook = getLatestPendingInfoBook(infoBooks, limitedPools);

        if (JSON.stringify(infoBooks) !== JSON.stringify(loadInfoBookState(simulatorStorageScope))) {
          saveInfoBookState(infoBooks, simulatorStorageScope);
        }

        if (latestInfoBook?.targetPoolId === poolId && !latestInfoBook.activated) {
          saveInfoBookState(
            {
              ...infoBooks,
              [latestInfoBook.sourcePoolId]: {
                ...infoBooks[latestInfoBook.sourcePoolId],
                activated: true,
              },
            },
            simulatorStorageScope
          );
          showToastMessage(t('simulator.toast.infoBookActivated'));
          nextSimulator.updateState({
            infoBookTenPullAvailable: true,
          });
        } else {
          nextSimulator.updateState({
            infoBookTenPullAvailable: Boolean(
              latestInfoBook &&
              latestInfoBook.targetPoolId === poolId &&
              latestInfoBook.activated &&
              !latestInfoBook.used
            ),
          });
        }
      }

      if (targetCapabilities.basePoolType === 'limited' && upCharacter) {
        setSelectedLimitedPool(upCharacter);
      }

      setCurrentSimPoolId(poolId);
      setSimulator(nextSimulator);
      setCurrentSimulatorState(nextSimulator.getState());
      setLastResults(null);
      setStats(nextSimulator.getStatistics());
      setPityInfo(nextSimulator.getPityInfo());
      setShowPoolMenu(false);
    },
    [
      currentSimPoolId,
      currentSimPool,
      resolvePoolTargetName,
      selectedLimitedPool,
      showToastMessage,
      simulator,
      simulatorPools,
      simulatorStorageScope,
      t,
    ]
  );

  const historyGroups = useMemo(() => processHistoryGroups(pullHistory), [pullHistory]);
  const dashboardStats = useMemo(
    () => buildDashboardStats(stats, pityInfo, simulator, locale),
    [locale, pityInfo, simulator, stats]
  );
  const pityInfoWithGuarantee = useMemo(() => buildPityInfoWithGuarantee(stats, simulator), [stats, simulator]);
  const currentSharePity6 = pityInfo?.sixStar?.current;
  const currentSharePity5 = pityInfo?.fiveStar?.current;
  const currentPoolObj = useMemo(
    () => buildSimulatorCurrentPoolView({
      currentSimPool,
      simulator,
      resolvedRoster: poolCharactersList,
      fallbackName: t('simulator.toast.noSelection'),
    }),
    [
      currentSimPool,
      poolCharactersList,
      simulator,
      t
    ]
  );
  const sharePayload = useMemo(
    () =>
      buildSimulatorSharePayload({
        currentPoolObj,
        dashboardStats,
        pityInfoWithGuarantee,
        resourceLedger,
      }, locale),
    [currentPoolObj, dashboardStats, locale, pityInfoWithGuarantee, resourceLedger]
  );
  const shareTimelineSections = useMemo(() => {
    const section = buildSinglePoolTimelineSection({
      pool: {
        id: currentSimPoolId || 'simulator-pool',
        type: currentPoolObj?.type,
        name: currentPoolObj?.name,
        up_character: currentPoolObj?.up_character,
        featured_characters: currentPoolObj?.featured_characters,
        resolved_roster: currentPoolObj?.resolved_roster,
        extra_subtype: currentPoolObj?.extra_subtype,
        extra_rule_profile: currentPoolObj?.extra_rule_profile,
        extra_series_key: currentPoolObj?.extra_series_key,
        extra_series_phase: currentPoolObj?.extra_series_phase,
        source_pool_id: currentPoolObj?.source_pool_id,
      },
      history: pullHistory,
      currentPityOverride: currentSharePity6,
      currentPity5Override: currentSharePity5,
      locale,
    });

    return section ? [section] : [];
  }, [currentPoolObj, currentSimPoolId, currentSharePity5, currentSharePity6, locale, pullHistory]);
  const supportsNativeImageShare = useMemo(() => {
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
  const supportsClipboardImageCopy = useMemo(() => canCopyImageToClipboard(), []);
  const effectivePityObj = {
    pity6: pityInfo.sixStar.current,
    pity5: pityInfo.fiveStar.current,
    isInherited: false,
  };

  const handleExportReport = useCallback(() => {
    downloadAnalysisReport(stats, pityInfo, currentPoolType);
    showToastMessage(t('simulator.toast.exportReport'));
  }, [currentPoolType, pityInfo, showToastMessage, stats, t]);

  const handleExportData = useCallback(
    (format) => {
      const poolName = currentSimPool?.name || t('simulator.defaultPoolName');
      downloadSimulatorData(simulator.getState().pullHistory, currentSimPoolId, poolName, currentPoolType, format);
      showToastMessage(t('simulator.toast.exportData', { format: format.toUpperCase() }));
    },
    [currentPoolType, currentSimPool?.name, currentSimPoolId, showToastMessage, simulator, t]
  );

  const handleCopyShareText = useCallback(async () => {
    if (!beginShareAction('copy-text', t('simulator.share.progress.copyText'))) {
      return;
    }

    try {
      const shareText = buildSimulatorShareText(sharePayload, locale);
      const success = await copyToClipboard(shareText);
      const message = success ? t('simulator.share.copyTextSuccess') : t('simulator.share.copyTextFailure');
      if (success) {
        finishShareAction('copy-text', message);
      } else {
        failShareAction('copy-text', message);
      }
      showToastMessage(message);
    } catch {
      const message = t('simulator.share.copyTextFailure');
      failShareAction('copy-text', message);
      showToastMessage(message);
    }
  }, [beginShareAction, failShareAction, finishShareAction, locale, sharePayload, showToastMessage, t]);

  const handleShareImage = useCallback(
    async (shareCardNode) => {
      if (!beginShareAction('share', t('simulator.share.progress.generateImage'))) {
        return;
      }

      if (!shareCardNode) {
        const message = t('simulator.share.notReady');
        failShareAction('share', message);
        showToastMessage(message);
        return;
      }

      try {
        const blob = await renderSimulatorShareCardToBlob(shareCardNode);
        const file = buildSimulatorShareFile(blob, sharePayload);
        const canUseNativeShare = canNativeShareSimulatorFile(file);

        if (supportsNativeImageShare && canUseNativeShare) {
          updateShareAction('share', t('simulator.share.progress.openSystemShare'));
          await shareSimulatorShareCardFile(file, sharePayload, locale);
          const message = t('simulator.share.systemOpened');
          finishShareAction('share', message);
          showToastMessage(message);
          return;
        }

        updateShareAction('share', t('simulator.share.progress.downloadImage'));
        const downloaded = downloadSimulatorShareCard(blob, sharePayload);
        const message = downloaded ? t('simulator.share.systemUnavailableDownloaded') : t('simulator.share.downloadFailure');
        if (downloaded) {
          finishShareAction('share', message);
        } else {
          failShareAction('share', message);
        }
        showToastMessage(message);
      } catch (error) {
        if (error?.name === 'AbortError') {
          resetShareActionFeedback();
          return;
        }

        appLogger.error('[GachaSimulator] share card generation failed:', error);
        const message = t('simulator.share.generateFailure');
        failShareAction('share', message);
        showToastMessage(message);
      }
    },
    [
      beginShareAction,
      failShareAction,
      finishShareAction,
      locale,
      resetShareActionFeedback,
      sharePayload,
      showToastMessage,
      supportsNativeImageShare,
      t,
      updateShareAction,
    ]
  );

  const handleDownloadShareImage = useCallback(
    async (shareCardNode) => {
      if (!beginShareAction('download', t('simulator.share.progress.generateLongImage'))) {
        return;
      }

      if (!shareCardNode) {
        const message = t('simulator.share.notReady');
        failShareAction('download', message);
        showToastMessage(message);
        return;
      }

      try {
        const blob = await renderSimulatorShareCardToBlob(shareCardNode);
        updateShareAction('download', t('simulator.share.progress.saveLongImage'));
        const downloaded = downloadSimulatorShareCard(blob, sharePayload);
        const message = downloaded ? t('simulator.share.downloadSuccess') : t('simulator.share.downloadFailure');
        if (downloaded) {
          finishShareAction('download', message);
        } else {
          failShareAction('download', message);
        }
        showToastMessage(message);
      } catch {
        const message = t('simulator.share.generateFailure');
        failShareAction('download', message);
        showToastMessage(message);
      }
    },
    [beginShareAction, failShareAction, finishShareAction, sharePayload, showToastMessage, t, updateShareAction]
  );

  const handleCopyShareImage = useCallback(
    async (shareCardNode) => {
      if (!beginShareAction('copy-image', t('simulator.share.progress.generateCopyImage'))) {
        return;
      }

      if (!shareCardNode) {
        const message = t('simulator.share.notReady');
        failShareAction('copy-image', message);
        showToastMessage(message);
        return;
      }

      if (!supportsClipboardImageCopy) {
        const message = t('simulator.share.browserCopyUnsupported');
        failShareAction('copy-image', message);
        showToastMessage(message);
        return;
      }

      try {
        const blob = await renderSimulatorShareCardToBlob(shareCardNode);
        updateShareAction('copy-image', t('simulator.share.progress.writeClipboard'));
        const copied = await copyImageBlobToClipboard(blob);
        const message = copied ? t('simulator.share.copyImageSuccess') : t('simulator.share.copyImageFailure');
        if (copied) {
          finishShareAction('copy-image', message);
        } else {
          failShareAction('copy-image', message);
        }
        showToastMessage(message);
      } catch {
        const message = t('simulator.share.copyImageFailure');
        failShareAction('copy-image', message);
        showToastMessage(message);
      }
    },
    [
      beginShareAction,
      failShareAction,
      finishShareAction,
      showToastMessage,
      supportsClipboardImageCopy,
      t,
      updateShareAction,
    ]
  );

  const toggleTenPull = useCallback((id) => {
    setExpandedTenPulls((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return {
    availableFreePulls,
    adjustResourceAmount,
    canAffordSinglePull,
    canAffordTenPull,
    closeOriginiteConversionPrompt,
    closeResetDialog,
    confirmOriginiteConversionPrompt,
    confirmReset,
    currentPullCosts,
    currentPoolObj,
    currentPoolType,
    currentSimPool,
    currentSimPoolId,
    dashboardStats,
    effectivePityObj,
    expandedTenPulls,
    handleExportData,
    handleExportReport,
    handleCopyShareText,
    handleCopyShareImage,
    handleDownloadShareImage,
    handleInheritRealState,
    handlePull,
    handleReset,
    handleShareImage,
    historyGroups,
    infoBookTenPullAvailable,
    isAnimating,
    lastResults,
    pityInfoWithGuarantee,
    poolPullCounts,
    poolCharactersList,
    pullHistory,
    resourceLedger,
    resourceSettings,
    resetAllPools,
    resetKeepResources,
    resetSettings,
    shareActionFeedback,
    isShareActionBusy,
    setDisableOriginitePromptToday,
    setLastResults,
    setResourceSettings,
    setResetAllPools,
    setResetKeepResources,
    setResetSettings,
    setShowPoolMenu,
    setSkipAnimation,
    showOriginitePrompt,
    showPoolMenu,
    showResetConfirm,
    showToast,
    shareCardFileName: buildSimulatorShareCardFileName(sharePayload),
    sharePayload,
    shareTimelineSections,
    singlePullDisabledReason,
    simulator,
    simulatorPools,
    skipAnimation,
    supportsNativeImageShare,
    supportsClipboardImageCopy,
    switchPool,
    tenPullDisabledReason,
    toastMessage,
    toggleTenPull,
    toggleCnOriginiteDoubleBonus,
    toggleInfiniteResources,
    isWeaponPool,
    updateResourceSetting: adjustResourceAmount,
  };
}

export default useGachaSimulatorController;
