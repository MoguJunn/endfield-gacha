/** The old class API is a facade over the shared session, with separate display history. */
import { getPoolState, giftProgress, replayHistoryEvent } from '../../shared/simulator/engine.js';
import { recordTimestamp, toDisplayRecord } from '../../shared/simulator/records.js';
import { buildSessionPity, buildSessionStatistics } from '../features/simulator/simulatorSessionView.js';
import { getCurrentUpCharacter } from '../constants/characterPools.js';
import { EXTRA_POOL_RULES, LIMITED_POOL_RULES, STANDARD_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import { checkInfoBookAvailable } from './probabilityEngine.js';
import {
  assertLegacySimulatorDescriptor,
  buildLegacySimulatorDescriptor,
  createLegacySimulatorSession,
  executeLegacySimulatorCommand,
  resolveLegacySimulatorCapabilities,
  restoreLegacySimulatorCounters,
} from './simulatorLegacyAdapter.js';

export function createInitialState(poolType = 'limited_character', capabilities = resolvePoolCapabilities(poolType)) {
  const descriptor = { id: 'legacy-simulator', capabilities };
  return {
    ...getPoolState(createLegacySimulatorSession(descriptor), descriptor),
    poolType,
    syntheticJade: 0,
    pullTickets: 0,
    pullHistory: [],
    isAnimating: false,
    lastPullResult: null,
  };
}

export function getRulesByPoolType(pool) {
  if (pool && typeof pool === 'object') return resolvePoolCapabilities(pool).rules;
  switch (pool) {
    case 'extra':
      return EXTRA_POOL_RULES;
    case 'weapon':
    case 'limited_weapon':
      return WEAPON_POOL_RULES;
    case 'standard':
    case 'standard_pool':
      return STANDARD_POOL_RULES;
    default:
      return LIMITED_POOL_RULES;
  }
}

export class GachaSimulator {
  constructor(pool = 'limited_character', customRules = null, currentUpCharacter = null, poolCharactersList = null) {
    this.pool = pool;
    this.poolInfo = typeof pool === 'object' ? pool : { type: pool };
    this.capabilities = resolveLegacySimulatorCapabilities(pool);
    this.rawPoolType = this.capabilities.rawPoolType;
    this.poolType = this.capabilities.basePoolType;
    this.rules = customRules || this.capabilities.rules;
    this.currentUpCharacter = currentUpCharacter;
    this.poolCharactersList = poolCharactersList;
    this.listeners = [];
    this.pullHistory = [];
    this.uiState = { isAnimating: false, lastPullResult: null };
    this.session = createLegacySimulatorSession(this.descriptor);
  }

  get descriptor() {
    return buildLegacySimulatorDescriptor(this.pool, this.rules, this.currentUpCharacter, this.poolCharactersList);
  }

  get state() {
    return {
      ...getPoolState(this.session, this.descriptor),
      pullHistory: this.pullHistory,
      syntheticJade: this.session.resourceSettings.legacySyntheticJade || 0,
      pullTickets: this.session.resourceSettings.legacyPullTickets || 0,
      ...this.uiState,
    };
  }

  assertResolved() {
    assertLegacySimulatorDescriptor(this.descriptor);
  }
  setCurrentUpCharacter(characterName) {
    this.currentUpCharacter = characterName;
  }
  setPoolCharactersList(list) {
    this.poolCharactersList = list;
  }
  getCurrentUpCharacter() {
    return this.currentUpCharacter || this.poolInfo.up_character || getCurrentUpCharacter();
  }

  resolvePullAvatarUrl(characterName) {
    const name = String(characterName || '').trim();
    for (const bucket of ['items', 'up', 'offBanner', 'fiveStar', 'fourStar']) {
      const item = this.poolCharactersList?.[bucket]?.find(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (String(entry.name || '').trim() === name || String(entry.id || '').trim() === name)
      );
      if (item?.avatarUrl || item?.avatar_url) return item.avatarUrl || item.avatar_url;
    }
    return null;
  }

  addListener(listener) {
    this.listeners.push(listener);
  }
  removeListener(listener) {
    this.listeners = this.listeners.filter((item) => item !== listener);
  }
  notifyListeners() {
    const state = this.state;
    this.listeners.forEach((listener) => listener(state));
  }

  updateState(updates = {}) {
    const descriptor = this.descriptor;
    this.session = restoreLegacySimulatorCounters(this.session, descriptor, updates);
    if (Array.isArray(updates.pullHistory)) this.pullHistory = [...updates.pullHistory];
    for (const key of ['isAnimating', 'lastPullResult']) {
      if (key in updates) this.uiState = { ...this.uiState, [key]: updates[key] };
    }
    for (const key of ['syntheticJade', 'pullTickets']) {
      if (key in updates)
        this.session = {
          ...this.session,
          resourceSettings: {
            ...this.session.resourceSettings,
            [key === 'syntheticJade' ? 'legacySyntheticJade' : 'legacyPullTickets']: updates[key],
          },
        };
    }
    this.restoreInfoBookFlags(updates);
    this.notifyListeners();
  }

  restoreInfoBookFlags(updates) {
    const id = this.descriptor.id;
    const source = `legacy-info-book:${id}`;
    const books = { ...this.session.infoBooks };
    if (updates.hasUnactivatedInfoBook === true) books[id] = { targetPoolId: null, used: false };
    if (updates.hasUnactivatedInfoBook === false && books[id]?.targetPoolId == null) delete books[id];
    if (updates.infoBookTenPullAvailable === true) {
      if (books[id]?.targetPoolId == null) delete books[id];
      books[source] = { targetPoolId: id, used: false };
    }
    if (updates.hasUsedInfoBookTenPull === true) {
      books[source] = { targetPoolId: id, used: true };
      Object.keys(books).forEach((key) => {
        if (books[key].targetPoolId === id) books[key] = { ...books[key], used: true };
      });
    }
    if (updates.infoBookTenPullAvailable === false) {
      Object.keys(books).forEach((key) => {
        if (books[key].targetPoolId === id && !books[key].used) delete books[key];
      });
    }
    this.session = { ...this.session, infoBooks: books };
  }

  execute(type) {
    const descriptor = this.descriptor;
    const before = getPoolState(this.session, descriptor);
    const outcome = executeLegacySimulatorCommand(this.session, descriptor, type);
    const records = outcome.events.map(({ record }, index) => ({
      ...toDisplayRecord(record),
      pullNumber: record.kind === 'free' ? before.totalPulls + index + 1 : record.paidIndex,
    }));
    this.session = outcome.session;
    this.pullHistory = [...this.pullHistory, ...records];
    const result = type === 'single' ? records[0] : records;
    this.uiState = { ...this.uiState, lastPullResult: result };
    this.notifyListeners();
    return result;
  }

  pullSingle() {
    return this.execute('single');
  }
  pullTen() {
    return this.execute('ten');
  }
  pullWeaponClaim() {
    return this.execute('ten');
  }
  pullFreeTen() {
    return this.execute('free');
  }
  pullInfoBookTen() {
    return this.execute('info_book');
  }

  getRewardPullCount(nextPoolTotalPulls = this.state.totalPulls) {
    const state = this.state;
    if (this.capabilities.rewardScope !== 'series') return Number(nextPoolTotalPulls || 0);
    return (
      (state.seriesRewardPulls ?? state.totalPulls) + Math.max(Number(nextPoolTotalPulls || 0) - state.totalPulls, 0)
    );
  }

  checkFreeTenPulls(totalPulls) {
    const progress = this.getRewardPullCount(totalPulls);
    const state = this.state;
    const milestones = this.capabilities.freeTenPullMilestones;
    const count = this.capabilities.isResolved ? milestones.filter((value) => progress >= value).length : 0;
    const nextGiftAt = milestones[count] || null;
    return {
      count,
      received: state.freeTenPullsReceived,
      available: Math.max(count - state.freeTenPullsReceived, 0),
      isNewGift: count > state.freeTenPullsReceived,
      nextGiftAt,
      remainingPulls: nextGiftAt ? Math.max(nextGiftAt - progress, 0) : 0,
      giftType: 'free_ten_pull',
    };
  }

  checkGifts(totalPulls) {
    return giftProgress(this.descriptor, totalPulls, this.state.giftsReceived);
  }
  checkInfoBook(state) {
    return this.capabilities.infoBookEnabled && checkInfoBookAvailable(state, this.rules);
  }

  activateInfoBook() {
    if (!this.state.hasUnactivatedInfoBook || this.state.hasUsedInfoBookTenPull) return false;
    this.updateState({ hasUnactivatedInfoBook: false, infoBookTenPullAvailable: true });
    return true;
  }

  reset() {
    this.session = createLegacySimulatorSession(this.descriptor);
    this.pullHistory = [];
    this.uiState = { isAnimating: false, lastPullResult: null };
    this.notifyListeners();
  }

  importState(savedState = {}) {
    const descriptor = this.descriptor;
    this.session = createLegacySimulatorSession(descriptor);
    this.pullHistory = Array.isArray(savedState?.pullHistory) ? [...savedState.pullHistory] : [];
    if (descriptor.capabilities.isResolved) {
      for (const record of this.pullHistory) {
        this.session = replayHistoryEvent(this.session, { ...record, timestamp: recordTimestamp(record) }, descriptor);
      }
    }
    this.uiState = { isAnimating: false, lastPullResult: null };
    const saved = savedState || {};
    this.updateState(
      descriptor.capabilities.rewardScope === 'series' && saved.seriesRewardPulls == null && saved.totalPulls != null
        ? { ...saved, seriesRewardPulls: saved.totalPulls }
        : saved
    );
  }

  exportState() {
    return {
      ...this.state,
      isAnimating: undefined,
      lastPullResult: undefined,
      hasUnactivatedInfoBook: undefined,
      infoBookTenPullAvailable: undefined,
      hasUsedInfoBookTenPull: undefined,
    };
  }

  getStatistics() {
    return {
      ...buildSessionStatistics(this.session, this.descriptor),
      freeTenPulls: this.checkFreeTenPulls(this.state.totalPulls),
    };
  }

  getPityInfo() {
    return buildSessionPity(this.session, this.descriptor);
  }
  getState() {
    return this.state;
  }
}

export function createSimulator(pool, customRules = null, currentUpCharacter = null, poolCharactersList = null) {
  return new GachaSimulator(pool, customRules, currentUpCharacter, poolCharactersList);
}

export default { GachaSimulator, createSimulator, createInitialState };
