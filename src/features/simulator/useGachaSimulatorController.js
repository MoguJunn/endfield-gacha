import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyCommand,
  createSession,
  getResourceLedger,
  replayHistoryEvent,
  seriesKey,
  validateSession,
} from '../../../shared/simulator/engine.js';
import { compareRecords, toDisplayRecord } from '../../../shared/simulator/records.js';
import { useAuthStore, useHistoryStore, usePoolStore } from '../../stores/index.js';
import { usePersonalGameAccounts } from '../../hooks/app/usePersonalGameAccounts.js';
import { loadSimulatorInheritance } from '../../services/accountGachaDataService.js';
import { getBootstrapVisiblePools } from '../../services/bootstrapService.js';
import { loadAllPoolsForCatalog, loadVisiblePools, mergePoolCollections } from '../../services/poolReadService.js';
import {
  buildSimulatorStorageScope,
  clearSimulatorSkipAnimationPreference,
  clearSimulatorMultipleFreeTenPreference,
  downloadAnalysisReport,
  downloadSimulatorData,
  loadSimulatorSkipAnimationPreference,
  saveSimulatorSkipAnimationPreference,
  loadSimulatorOriginitePromptSuppressDate,
  saveSimulatorOriginitePromptSuppressDate,
} from '../../utils/simulatorStorage.js';
import {
  DEFAULT_SIMULATOR_RESOURCE_SETTINGS,
  canAffordSimulatorPull,
  getOriginiteConversionPlanForJadeCost,
  getSimulatorPullCost,
  normalizeResourceSettings,
} from '../../utils/resourceEconomy.js';
import { buildSimulatorSharePayload } from '../../utils/simulatorShare.js';
import { buildSinglePoolTimelineSection } from '../../utils/poolTimelineView.js';
import { buildDashboardStats, buildPityInfoWithGuarantee, processHistoryGroups } from './simulatorViewUtils.js';
import { normalizeSimulatorPoolType } from './simulatorInheritance.js';
import { resolvePoolRosterBuckets } from '../../utils/poolRoster.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { getPoolFeaturedLead } from '../../utils/poolFeaturedResolver.js';
import { getGameAccountSelectionValue, isGameAccountSelectionMatch } from '../../utils/gameAccountMetadata.js';
import { useI18n } from '../../i18n/index.js';
import { buildSimulatorDescriptors, createSessionView } from './simulatorSessionView.js';
import { readLegacySimulatorSession } from './simulatorLegacyMigration.js';
import { commitSimulatorSession, loadSimulatorSession } from './simulatorRepository.js';
import { useSimulatorSharing } from './useSimulatorSharing.js';
import { buildSimulatorCatalogSignature, buildSimulatorInheritanceProjection } from './inheritanceProjection.js';

export function buildSimulatorCurrentPoolView({
  currentSimPool,
  simulator,
  resolvedRoster = null,
  fallbackName = '',
} = {}) {
  const pool = currentSimPool || {};
  const c = resolvePoolCapabilities(
    currentSimPool || simulator?.poolInfo || { type: simulator?.poolType || 'limited' }
  );
  const effective = normalizeSimulatorPoolType(simulator?.poolType || c.basePoolType);
  return {
    ...pool,
    type: pool.type || c.rawPoolType,
    source_pool_id: pool.source_pool_id || pool.sourcePoolId || pool.id || null,
    effectivePoolType: effective,
    effective_pool_type: effective,
    basePoolType: c.basePoolType,
    base_pool_type: c.basePoolType,
    extra_subtype: pool.extra_subtype ?? pool.extraSubtype ?? c.extraSubtype,
    extra_rule_profile: pool.extra_rule_profile ?? pool.extraRuleProfile ?? c.ruleProfile,
    extra_series_key: pool.extra_series_key ?? pool.extraSeriesKey ?? c.seriesKey,
    extra_series_phase: pool.extra_series_phase ?? pool.extraSeriesPhase ?? null,
    isLimitedWeapon: pool.isLimitedWeapon !== false,
    name: pool.original_name || pool.name || fallbackName,
    name_en: pool.name_en || null,
    up_character: pool.up_character,
    featured_characters: pool.featured_characters || null,
    resolved_roster: resolvedRoster || pool.resolved_roster || null,
  };
}

const EMPTY = createSession();
const EMPTY_HISTORIES = {};
const EMPTY_HISTORY = [];
const FALLBACK = buildSimulatorDescriptors([{ id: 'unselected', type: 'limited' }]).unselected;
const realId = (id) => String(id || '').replace(/^sim_/, '');
function normalizeRoster(roster) {
  if (!roster) return null;
  const rows = roster.items || [];
  const entries = (items, rarity) =>
    (items || []).map((item) => (typeof item === 'string' ? { id: item, name: item, rarity } : item));
  return {
    up: entries(roster.up, 6),
    offBanner: entries(roster.offBanner, 6),
    fiveStar: entries(
      rows.filter((x) => Number(x.rarity) === 5).length ? rows.filter((x) => Number(x.rarity) === 5) : roster.fiveStar,
      5
    ),
    fourStar: entries(
      rows.filter((x) => Number(x.rarity) === 4).length ? rows.filter((x) => Number(x.rarity) === 4) : roster.fourStar,
      4
    ),
  };
}

export function useGachaSimulatorController() {
  const { t, locale } = useI18n();
  const currentUserId = useAuthStore((s) => s.user?.id || null);
  const localHistory = useHistoryStore((s) => (currentUserId ? EMPTY_HISTORY : s.history));
  const storePools = usePoolStore((s) => s.pools);
  const currentGameUid = usePoolStore((s) => s.currentGameUid);
  const switchGameAccount = usePoolStore((s) => s.switchGameAccount);
  const accounts = usePersonalGameAccounts();
  const selectedAccount =
    accounts.find((a) => getGameAccountSelectionValue(a) === currentGameUid) ||
    (accounts.filter((a) => isGameAccountSelectionMatch(a, currentGameUid)).length === 1
      ? accounts.find((a) => isGameAccountSelectionMatch(a, currentGameUid))
      : null);
  const canonicalAccount = getGameAccountSelectionValue(selectedAccount || {}) || currentGameUid;
  const ambiguousAccount = Boolean(
    currentGameUid &&
    !selectedAccount &&
    accounts.filter((a) => isGameAccountSelectionMatch(a, currentGameUid)).length > 1
  );
  const scope = useMemo(
    () => buildSimulatorStorageScope({ currentUserId, currentGameUid: canonicalAccount }),
    [currentUserId, canonicalAccount]
  );
  const [publicPools, setPublicPools] = useState([]);
  const pools = storePools.length ? storePools : publicPools;
  const simulatorPools = useMemo(
    () =>
      pools
        .filter((p) => !String(p.id).startsWith('__group_') && !/汇总|总览|概览|^全部/.test(p.name || ''))
        .slice()
        .sort((a, b) => new Date(a.start_time || 8640000000000000) - new Date(b.start_time || 8640000000000000))
        .map((p) => ({
          ...p,
          source_pool_id: p.id,
          id: `sim_${p.id}`,
          original_name: p.name,
          name: `${p.name} [模拟]`,
          isSimulator: true,
        })),
    [pools]
  );
  const descriptors = useMemo(() => buildSimulatorDescriptors(simulatorPools), [simulatorPools]);
  const catalogKey = useMemo(
    () => JSON.stringify(Object.values(descriptors).map((d) => [d.id, d.capabilities, d.nextPoolId])),
    [descriptors]
  );
  const runtime = useRef(null);
  const generation = useRef(0);
  const operation = useRef(null);
  const animationTimer = useRef(null);
  const toastTimer = useRef(null);
  const [view, setView] = useState(null);
  const [storageFailure, setStorageFailure] = useState(false);
  const [currentSimPoolId, setCurrentSimPoolId] = useState(null);
  const [poolCharactersList, setPoolCharactersList] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isInheritingRealState, setIsInheritingRealState] = useState(false);
  const [lastResults, setLastResults] = useState(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [expandedTenPulls, setExpandedTenPulls] = useState(new Set());
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetAllPools, setResetAllPools] = useState(false);
  const [resetKeepResources, setResetKeepResources] = useState(false);
  const [resetSettings, setResetSettings] = useState(false);
  const [showOriginitePrompt, setShowOriginitePrompt] = useState(null);
  const [disableOriginitePromptToday, setDisableOriginitePromptToday] = useState(false);
  const [skipAnimation, setSkipAnimation] = useState(loadSimulatorSkipAnimationPreference);
  const showToastMessage = useCallback((message) => {
    clearTimeout(toastTimer.current);
    setToastMessage(message);
    setShowToast(true);
    toastTimer.current = setTimeout(() => setShowToast(false), 3000);
  }, []);
  const showFailure = useCallback(
    (error) => {
      const code = error?.code || error?.message;
      const key =
        code === 'simulator_revision_conflict'
          ? 'simulator.toast.stateConflict'
          : code === 'simulator_legacy_version'
            ? 'simulator.toast.legacyUnavailable'
            : code === 'simulator_unresolved_pool' || code === 'simulator_unresolved_series'
              ? 'simulator.toast.rulesUnavailable'
              : code === 'simulator_incomplete_roster'
                ? 'simulator.toast.syncingPool'
                : 'simulator.toast.saveFailed';
      showToastMessage(t(key));
    },
    [showToastMessage, t]
  );

  useEffect(() => {
    if (storePools.length) return;
    let cancelled = false;
    (async () => {
      const visible = await getBootstrapVisiblePools().catch(() => loadVisiblePools().catch(() => []));
      const catalog = await loadAllPoolsForCatalog().catch(() => []);
      if (!cancelled) setPublicPools(mergePoolCollections(visible || [], catalog));
    })();
    return () => {
      cancelled = true;
    };
  }, [storePools.length]);

  useEffect(() => {
    if (!Object.keys(descriptors).length) return;
    const token = ++generation.current;
    runtime.current = null;
    operation.current = null;
    clearTimeout(animationTimer.current);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setView(null);
        setIsAnimating(false);
        setIsInheritingRealState(false);
        setPoolCharactersList(null);
        setStorageFailure(false);
        setLastResults(null);
        setShowOriginitePrompt(null);
      }
    });
    (async () => {
      try {
        let loaded = await loadSimulatorSession(scope);
        if (!loaded.session) {
          loaded = readLegacySimulatorSession(scope, descriptors);
          loaded.session.currentPoolId = descriptors[loaded.session.currentPoolId]
            ? loaded.session.currentPoolId
            : Object.values(descriptors).find((d) => d.capabilities.rawPoolType === 'limited')?.id ||
              Object.keys(descriptors)[0];
          loaded.session.revision = 0;
          try {
            await commitSimulatorSession({
              scope,
              session: loaded.session,
              expectedRevision: null,
              replaceHistories: loaded.histories,
            });
          } catch (error) {
            if (error.code !== 'simulator_revision_conflict') throw error;
            loaded = await loadSimulatorSession(scope);
          }
        }
        validateSession(loaded.session);
        if (cancelled || generation.current !== token) return;
        const poolId = descriptors[loaded.session.currentPoolId]
          ? loaded.session.currentPoolId
          : Object.keys(descriptors)[0];
        runtime.current = { ...loaded, scope, token };
        setView(runtime.current);
        setCurrentSimPoolId(`sim_${poolId}`);
        setExpandedTenPulls(new Set());
      } catch (error) {
        if (!cancelled) {
          setStorageFailure(true);
          showFailure(error);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (generation.current === token) generation.current = token + 1;
      clearTimeout(animationTimer.current);
    };
    // Catalog fingerprint is stable across unrelated store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, catalogKey]);

  const currentSimPool = simulatorPools.find((p) => p.id === currentSimPoolId);
  const descriptor = descriptors[realId(currentSimPoolId)] || FALLBACK;
  const session = view?.scope === scope ? view.session : EMPTY;
  const histories = view?.scope === scope ? view.histories : EMPTY_HISTORIES;
  const pullHistory = useMemo(() => (histories[descriptor.id] || []).map(toDisplayRecord), [histories, descriptor.id]);
  const simulator = useMemo(
    () => createSessionView(session, descriptor, pullHistory),
    [session, descriptor, pullHistory]
  );
  const stats = simulator.getStatistics();
  const pityInfo = simulator.getPityInfo();
  const state = simulator.getState();
  const currentPoolType = descriptor.capabilities.basePoolType;
  const resourceSettings = session.resourceSettings;
  const resourceLedger = useMemo(() => getResourceLedger(session), [session]);
  const availableFreePulls = stats.freeTenPulls.available;
  const infoBookTenPullAvailable = state.infoBookTenPullAvailable;
  const isWeaponPool = descriptor.capabilities.entityType === 'weapon';
  const rulesReady =
    descriptor.capabilities.isResolved &&
    (!['pityScope', 'targetScope', 'rewardScope'].some((k) => descriptor.capabilities[k] === 'series') ||
      Boolean(seriesKey(descriptor.capabilities)));
  const ready = Boolean(
    view &&
    view.scope === scope &&
    rulesReady &&
    !storageFailure &&
    !isAnimating &&
    !isInheritingRealState &&
    !ambiguousAccount
  );
  useEffect(() => {
    if (!currentSimPool || !descriptor.capabilities.isResolved) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setPoolCharactersList(null);
    });
    resolvePoolRosterBuckets({
      poolId: descriptor.id,
      expectedType: descriptor.capabilities.entityType,
      currentUpName: getPoolFeaturedLead(currentSimPool),
      poolType: isWeaponPool ? 'weapon' : currentPoolType === 'standard' ? 'standard' : 'limited',
      poolInfo: currentSimPool,
      mergeStrategy: currentPoolType === 'limited' || currentPoolType === 'extra' ? 'fill-missing' : 'append',
    })
      .then((roster) => {
        if (!cancelled) setPoolCharactersList(normalizeRoster(roster));
      })
      .catch(() => {
        if (!cancelled) setPoolCharactersList(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentSimPool,
    descriptor.id,
    descriptor.capabilities.isResolved,
    descriptor.capabilities.entityType,
    currentPoolType,
    isWeaponPool,
  ]);
  useEffect(() => {
    saveSimulatorSkipAnimationPreference(skipAnimation);
  }, [skipAnimation]);
  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
    },
    []
  );

  const commit = async (nextSession, appendEvents = [], replaceHistories = null, target = runtime.current) => {
    if (!target) throw new Error('simulator_not_ready');
    const saved = { ...nextSession, scope: target.scope, revision: target.session.revision + 1 };
    validateSession(saved);
    await commitSimulatorSession({
      scope: target.scope,
      session: saved,
      expectedRevision: target.session.revision,
      appendEvents,
      replaceHistories,
    });
    if (generation.current !== target.token || runtime.current?.scope !== target.scope) return null;
    const nextHistories = replaceHistories || { ...target.histories };
    if (!replaceHistories)
      for (const event of appendEvents)
        nextHistories[event.poolId] = [...(nextHistories[event.poolId] || []), event.record];
    const updated = { ...target, session: saved, histories: nextHistories };
    runtime.current = updated;
    setView(updated);
    return updated;
  };
  const mutate = async (transform) => {
    if (operation.current || !runtime.current) return;
    const target = runtime.current;
    operation.current = target;
    try {
      await commit(transform(target.session), [], null, target);
    } catch (error) {
      showFailure(error);
    } finally {
      if (operation.current === target) operation.current = null;
    }
  };
  const executePull = async (type, expectedPoolId = descriptor.id) => {
    if (operation.current || !runtime.current || expectedPoolId !== realId(currentSimPoolId) || !poolCharactersList)
      return;
    const target = runtime.current;
    operation.current = target;
    setIsAnimating(true);
    setLastResults(null);
    try {
      const result = applyCommand(
        target.session,
        { type, poolId: expectedPoolId },
        {
          descriptors: {
            ...descriptors,
            [expectedPoolId]: { ...descriptors[expectedPoolId], roster: poolCharactersList },
          },
          random: Math.random,
          now: Date.now(),
        }
      );
      const saved = await commit(result.session, result.events, null, target);
      if (!saved) return;
      const complete = () => {
        if (generation.current !== target.token) return;
        setLastResults(result.events.map((e) => toDisplayRecord(e.record)));
        setIsAnimating(false);
        if (operation.current === target) operation.current = null;
      };
      if (skipAnimation) complete();
      else animationTimer.current = setTimeout(complete, 2500);
    } catch (error) {
      if (generation.current === target.token) {
        setIsAnimating(false);
        showFailure(error);
      }
      if (operation.current === target) operation.current = null;
    }
  };
  const currentPullCosts = {
    settings: resourceSettings,
    single: getSimulatorPullCost({ poolType: currentPoolType, settings: resourceSettings }),
    ten: getSimulatorPullCost({
      poolType: currentPoolType,
      pullType: 'ten',
      settings: resourceSettings,
      isFree: availableFreePulls > 0,
      isInfoBook: infoBookTenPullAvailable,
    }),
  };
  const disabledReason = (cost) =>
    !rulesReady
      ? t('simulator.toast.rulesUnavailable')
      : !ready
        ? t(
            ambiguousAccount
              ? 'simulator.toast.selectAccount'
              : storageFailure
                ? 'simulator.toast.saveFailed'
                : 'simulator.toast.animating'
          )
        : !poolCharactersList
          ? t('simulator.toast.syncingPool')
          : !canAffordSimulatorPull(resourceLedger, cost)
            ? t(
                cost.resource === 'arsenalQuota'
                  ? 'simulator.toast.arsenalShortfall'
                  : 'simulator.toast.fullJadeShortfall',
                {
                  count: Math.max(
                    0,
                    cost.amount -
                      (cost.resource === 'arsenalQuota'
                        ? resourceLedger.arsenalBalance
                        : resourceLedger.availableJadeBudget)
                  ).toLocaleString(locale),
                }
              )
            : '';
  const handlePull = (type) => {
    if (!ready || operation.current) return;
    const kind =
      type === 'ten' ? (infoBookTenPullAvailable ? 'info_book' : availableFreePulls ? 'free' : 'ten') : 'single';
    const cost = currentPullCosts[type === 'ten' ? 'ten' : 'single'];
    if (disabledReason(cost)) {
      showToastMessage(disabledReason(cost));
      return;
    }
    const conversion = getOriginiteConversionPlanForJadeCost({
      ledger: resourceLedger,
      jadeCost: cost.resource === 'jade' ? cost.amount : 0,
      settings: resourceSettings,
    });
    const today = new Date().toISOString().slice(0, 10);
    if (
      conversion.canConvert &&
      conversion.originiteNeeded > 0 &&
      loadSimulatorOriginitePromptSuppressDate() !== today
    ) {
      setShowOriginitePrompt({
        type: kind,
        poolId: descriptor.id,
        token: runtime.current.token,
        message: t('simulator.toast.originiteConfirmMessage', {
          actionLabel: t(type === 'ten' ? 'simulator.toast.action.ten' : 'simulator.toast.action.single'),
          originite: conversion.originiteNeeded.toLocaleString(locale),
          jade: (conversion.originiteNeeded * conversion.rate).toLocaleString(locale),
        }),
      });
      return;
    }
    executePull(kind);
  };
  const closeOriginiteConversionPrompt = () => {
    setShowOriginitePrompt(null);
    setDisableOriginitePromptToday(false);
  };
  const confirmOriginiteConversionPrompt = () => {
    const prompt = showOriginitePrompt;
    closeOriginiteConversionPrompt();
    if (!prompt || prompt.token !== runtime.current?.token) return;
    if (disableOriginitePromptToday) saveSimulatorOriginitePromptSuppressDate(new Date().toISOString().slice(0, 10));
    executePull(prompt.type, prompt.poolId);
  };

  const handleInheritRealState = async (account = null) => {
    if (operation.current || !runtime.current) return;
    const selected = account || selectedAccount || (accounts.length === 1 ? accounts[0] : null);
    const accountKey = getGameAccountSelectionValue(selected || {});
    if (!accountKey) {
      showToastMessage(t('simulator.toast.selectAccount'));
      return;
    }
    const targetScope = buildSimulatorStorageScope({ currentUserId, currentGameUid: accountKey });
    const target = runtime.current;
    operation.current = target;
    setIsInheritingRealState(true);
    try {
      const result = currentUserId
        ? await loadSimulatorInheritance({ accountKey })
        : {
            availability: 'ready',
            meta: {},
            simulatorInheritance: buildSimulatorInheritanceProjection({
              history: localHistory.filter((record) => isGameAccountSelectionMatch(record, accountKey)),
              pools,
            }),
          };
      if (generation.current !== target.token) return;
      const projection = result.projection || result.scope?.simulatorInheritance || result.simulatorInheritance;
      if (result.availability !== 'ready' || projection?.contractVersion !== 2) {
        showToastMessage(t('simulator.toast.inheritBuilding'));
        return;
      }
      if (projection.catalogSignature !== buildSimulatorCatalogSignature({ pools })) {
        showToastMessage(t('simulator.toast.inheritBuilding'));
        return;
      }
      if (!Object.keys(projection.session.pools).length) {
        showToastMessage(t('simulator.toast.noRealHistory', { name: selected.nickName || selected.gameUid }));
        return;
      }
      const targetLoaded =
        targetScope === scope
          ? target
          : { ...(await loadSimulatorSession(targetScope)), scope: targetScope, token: target.token };
      const resourceBase = targetLoaded.session?.resourceSettings || normalizeResourceSettings();
      const inherited = {
        ...structuredClone(projection.session),
        scope: targetScope,
        currentPoolId: descriptor.id,
        resourceSettings: resourceBase,
      };
      const ledger = getResourceLedger(inherited);
      if (ledger.arsenalBalance < 0)
        inherited.resourceSettings = {
          ...resourceBase,
          baseArsenalQuota: resourceBase.baseArsenalQuota - ledger.arsenalBalance,
        };
      inherited.inheritance = {
        contractVersion: 2,
        accountKey,
        generatedAt: result.meta?.generatedAt,
        revision: result.meta?.scopeSnapshotRevision,
      };
      if (targetScope === scope) await commit(inherited, [], projection.histories, target);
      else {
        inherited.revision = targetLoaded.session ? targetLoaded.session.revision + 1 : 0;
        await commitSimulatorSession({
          scope: targetScope,
          session: inherited,
          expectedRevision: targetLoaded.session?.revision ?? null,
          replaceHistories: projection.histories,
        });
        if (generation.current !== target.token) return;
        switchGameAccount(accountKey);
      }
      setLastResults(null);
      setExpandedTenPulls(new Set());
      showToastMessage(t('simulator.toast.inheritAllSuccess', { name: selected.nickName || selected.gameUid }));
    } catch (error) {
      if (generation.current === target.token) showFailure(error);
    } finally {
      if (operation.current === target) operation.current = null;
      if (generation.current === target.token) setIsInheritingRealState(false);
    }
  };
  const switchPool = async (id) => {
    const targetId = realId(id);
    if (!descriptors[targetId] || operation.current || id === currentSimPoolId) return;
    await mutate((s) => ({ ...s, currentPoolId: targetId }));
    if (runtime.current?.session.currentPoolId === targetId) {
      setCurrentSimPoolId(id);
      setLastResults(null);
      setPoolCharactersList(null);
    }
  };
  const adjustResourceAmount = (key, mode, amount) =>
    mutate((s) => {
      const value = Math.max(0, Math.floor(Number(amount) || 0));
      const balance = getResourceLedger(s);
      const settings = { ...s.resourceSettings };
      if (key === 'jade' && mode === 'convertOriginite') {
        if (value > balance.originiteBalance) {
          showToastMessage(
            t('simulator.toast.availableOriginiteShortfall', { count: balance.originiteBalance.toLocaleString(locale) })
          );
          return s;
        }
        settings.manualConvertedOriginite += value;
      } else if (key === 'jade')
        settings.baseJade =
          mode === 'add' ? settings.baseJade + value : value + balance.jadeSpent - balance.convertedJade;
      else if (key === 'originite')
        settings.baseOriginite = mode === 'add' ? settings.baseOriginite + value : value + balance.originiteSpent;
      else if (key === 'arsenalQuota')
        settings.baseArsenalQuota =
          mode === 'add' ? settings.baseArsenalQuota + value : value + balance.arsenalSpent - balance.arsenalGained;
      return { ...s, resourceSettings: normalizeResourceSettings(settings) };
    });
  const toggleCnOriginiteDoubleBonus = () =>
    mutate((s) => ({
      ...s,
      resourceSettings: {
        ...s.resourceSettings,
        cnOriginiteDoubleBonusEnabled: !s.resourceSettings.cnOriginiteDoubleBonusEnabled,
      },
    }));
  const toggleInfiniteResources = () =>
    mutate((s) => ({
      ...s,
      resourceSettings: { ...s.resourceSettings, infiniteResources: !s.resourceSettings.infiniteResources },
    }));
  const closeResetDialog = () => {
    setShowResetConfirm(false);
    setResetAllPools(false);
    setResetKeepResources(false);
    setResetSettings(false);
  };
  const confirmReset = async () => {
    if (operation.current || !runtime.current) return;
    const target = runtime.current;
    operation.current = target;
    try {
      const settings = resetKeepResources
        ? target.session.resourceSettings
        : {
            ...target.session.resourceSettings,
            baseJade: 0,
            baseOriginite: 0,
            baseArsenalQuota: 0,
            manualConvertedOriginite: 0,
            infiniteResources: DEFAULT_SIMULATOR_RESOURCE_SETTINGS.infiniteResources,
            cnOriginiteDoubleBonusEnabled: DEFAULT_SIMULATOR_RESOURCE_SETTINGS.cnOriginiteDoubleBonusEnabled,
          };
      const keep = resetAllPools
        ? {}
        : Object.fromEntries(
            Object.entries(target.histories).filter(
              ([id]) => descriptors[id]?.capabilities.basePoolType !== currentPoolType
            )
          );
      let next = createSession({ scope, resourceSettings: settings });
      Object.entries(keep)
        .flatMap(([id, records]) => records.map((record) => ({ id, record })))
        .sort((a, b) => compareRecords(a.record, b.record))
        .forEach(({ id, record }) => {
          if (
            descriptors[id]?.capabilities.isResolved &&
            [4, 5, 6].includes(record.rarity) &&
            Number.isFinite(record.timestamp)
          )
            next = replayHistoryEvent(next, record, descriptors[id]);
        });
      next.currentPoolId = descriptor.id;
      await commit(next, [], keep, target);
      if (resetSettings) {
        setSkipAnimation(false);
        clearSimulatorSkipAnimationPreference();
        clearSimulatorMultipleFreeTenPreference();
      }
      setLastResults(null);
      setExpandedTenPulls(new Set());
      closeResetDialog();
      showToastMessage(
        t(resetAllPools ? 'simulator.toast.resetAllSuccess' : 'simulator.toast.resetTypeSuccess', {
          typeName: t(`simulator.poolTypeName.${currentPoolType}`),
        })
      );
    } catch (error) {
      showFailure(error);
    } finally {
      if (operation.current === target) operation.current = null;
    }
  };
  const dashboardStats = buildDashboardStats(stats, pityInfo, simulator, locale);
  const pityInfoWithGuarantee = buildPityInfoWithGuarantee(stats, simulator);
  const currentPoolObj = buildSimulatorCurrentPoolView({
    currentSimPool,
    simulator,
    resolvedRoster: poolCharactersList,
  });
  const sharePayload = buildSimulatorSharePayload(
    { currentPoolObj, dashboardStats, pityInfoWithGuarantee, resourceLedger },
    locale
  );
  const sharing = useSimulatorSharing(sharePayload, showToastMessage);
  const shareTimelineSections = useMemo(() => {
    const section = buildSinglePoolTimelineSection({
      pool: currentPoolObj,
      history: pullHistory,
      currentPityOverride: pityInfo.sixStar.current,
      currentPity5Override: pityInfo.fiveStar.current,
      locale,
    });
    return section ? [section] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, pullHistory, descriptor.id, locale, poolCharactersList]);
  return {
    ...sharing,
    adjustResourceAmount,
    availableFreePulls,
    canAffordSinglePull: !isWeaponPool && !disabledReason(currentPullCosts.single),
    canAffordTenPull: !disabledReason(currentPullCosts.ten),
    singlePullDisabledReason: isWeaponPool
      ? t('simulator.toast.weaponSingleDisabled')
      : disabledReason(currentPullCosts.single),
    tenPullDisabledReason: disabledReason(currentPullCosts.ten),
    closeOriginiteConversionPrompt,
    confirmOriginiteConversionPrompt,
    disableOriginitePromptToday,
    setDisableOriginitePromptToday,
    showOriginitePrompt,
    closeResetDialog,
    confirmReset,
    currentPullCosts,
    currentPoolObj,
    currentPoolType,
    currentSimPool,
    currentSimPoolId,
    dashboardStats,
    effectivePityObj: {
      pity6: state.sixStarPity,
      pity5: state.fiveStarPity,
      isInherited: Boolean(
        session.inheritance &&
        descriptor.capabilities.pityScope === 'shared' &&
        session.sharedPityState.lastSixPoolId !== descriptor.id &&
        state.sixStarPity > 0
      ),
    },
    expandedTenPulls,
    toggleTenPull: (id) =>
      setExpandedTenPulls((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    handleExportData: (format) => {
      downloadSimulatorData(
        pullHistory,
        currentSimPoolId,
        currentSimPool?.name || t('simulator.defaultPoolName'),
        currentPoolType,
        format
      );
      showToastMessage(t('simulator.toast.exportData', { format: format.toUpperCase() }));
    },
    handleExportReport: () => {
      downloadAnalysisReport(stats, pityInfo, currentPoolType);
      showToastMessage(t('simulator.toast.exportReport'));
    },
    handleInheritRealState,
    handlePull,
    handleReset: () => setShowResetConfirm(true),
    historyGroups: processHistoryGroups(pullHistory),
    infoBookTenPullAvailable,
    isInheritingRealState,
    isAnimating,
    isWeaponPool,
    lastResults,
    setLastResults,
    pityInfoWithGuarantee,
    poolCharactersList,
    poolPullCounts: Object.fromEntries(
      simulatorPools.map((p) => [p.id, session.pools[realId(p.id)]?.sequenceCount || 0])
    ),
    pullHistory,
    resourceLedger,
    resourceSettings,
    resetAllPools,
    resetKeepResources,
    resetSettings,
    setResetAllPools,
    setResetKeepResources,
    setResetSettings,
    setSkipAnimation,
    sharePayload,
    shareTimelineSections,
    showResetConfirm,
    showToast,
    simulator,
    simulatorPools,
    skipAnimation,
    switchPool,
    toastMessage,
    toggleCnOriginiteDoubleBonus,
    toggleInfiniteResources,
  };
}
