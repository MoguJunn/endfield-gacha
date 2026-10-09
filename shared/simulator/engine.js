import { classifyRecord } from './records.js';

export const SIMULATOR_VERSION = 2;
const EMPTY_QUOTA = {
  aicQuotaDirect: 0,
  aicQuotaConvertible: 0,
  aicQuotaTotalPotential: 0,
  bondQuotaDirect: 0,
  endpointQuotaConvertible: 0,
  trustTokensGained: 0,
  excessTrustTokens: 0,
};
const DEFAULT_SETTINGS = {
  baseJade: 50000,
  baseOriginite: 120,
  baseArsenalQuota: 19800,
  manualConvertedOriginite: 0,
  cnOriginiteDoubleBonusEnabled: true,
  infiniteResources: false,
  characterPullJadeCost: 500,
  weaponPullQuotaCost: 1980,
  originiteToJadeRate: 75,
  arsenalReward4: 20,
  arsenalReward5: 200,
  arsenalReward6: 2000,
};

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
const finite = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const count = (n) => Math.max(0, Math.trunc(finite(n)));
const emptyCounts = () => ({ 4: 0, 5: 0, 6: 0, '6_std': 0 });
const quota = () => ({ ...EMPTY_QUOTA });

export function createSession({ scope = '', resourceSettings = {} } = {}) {
  return {
    version: SIMULATOR_VERSION,
    revision: 0,
    scope,
    currentPoolId: null,
    pools: {},
    sharedPityState: { sixStarPity: 0, fiveStarPity: 0, lastSixPoolId: null },
    seriesStates: {},
    infoBooks: {},
    resourceSettings: { ...DEFAULT_SETTINGS, ...resourceSettings },
    ledger: {
      characterPulls: 0,
      weaponPulls: 0,
      characterCounts: emptyCounts(),
      weaponCounts: emptyCounts(),
      characterQuota: quota(),
      weaponQuota: quota(),
      quotaCharacters: {},
    },
  };
}

export function seriesKey(capabilities) {
  return capabilities.ruleProfile && capabilities.seriesKey
    ? `${encodeURIComponent(capabilities.ruleProfile)}::${encodeURIComponent(capabilities.seriesKey)}`
    : null;
}

export function createPoolState(descriptor) {
  return {
    poolType: descriptor.capabilities.basePoolType,
    extraRuleProfile: descriptor.capabilities.ruleProfile,
    extraSeriesKey: descriptor.capabilities.seriesKey,
    sixStarPity: 0,
    fiveStarPity: 0,
    guaranteedLimitedPity: 0,
    hasReceivedGuaranteedLimited: false,
    isGuaranteedUp: false,
    totalPulls: 0,
    sequenceCount: 0,
    sixStarCount: 0,
    fiveStarCount: 0,
    upSixStarCount: 0,
    giftsReceived: 0,
    freeTenPullsReceived: 0,
    freeResults: 0,
    hasReceivedInfoBook: false,
    hasReceivedSelectGift: false,
    seriesRewardPulls: null,
    claimResults: 0,
    claimHasSix: false,
    sixStarHistory: [],
    inherited: false,
  };
}

/** All entry points use this selector: zero-pull pools still get shared/series progress. */
export function getPoolState(session, descriptor) {
  const c = descriptor.capabilities;
  const state = { ...createPoolState(descriptor), ...session.pools[descriptor.id] };
  if (c.pityScope === 'shared') Object.assign(state, session.sharedPityState);
  const series = session.seriesStates[seriesKey(c)];
  if (series) {
    if (c.pityScope === 'series')
      Object.assign(state, { sixStarPity: series.sixStarPity, fiveStarPity: series.fiveStarPity });
    if (c.targetScope === 'series')
      Object.assign(state, {
        guaranteedLimitedPity: series.guaranteedLimitedPity,
        hasReceivedGuaranteedLimited: series.hasReceivedGuaranteedLimited,
      });
    if (c.rewardScope === 'series')
      Object.assign(state, {
        seriesRewardPulls: series.seriesRewardPulls,
        giftsReceived: series.giftsReceived,
        freeTenPullsReceived: series.freeTenPullsReceived,
        freeResults: series.freeResults || 0,
      });
  }
  const books = Object.values(session.infoBooks);
  state.infoBookTenPullAvailable = c.infoBookEnabled && books.some((b) => b.targetPoolId === descriptor.id && !b.used);
  state.hasUsedInfoBookTenPull = books.some((b) => b.targetPoolId === descriptor.id && b.used);
  state.hasUnactivatedInfoBook = Boolean(session.infoBooks[descriptor.id] && !session.infoBooks[descriptor.id].used);
  return state;
}

function storePoolState(session, descriptor, state) {
  const c = descriptor.capabilities;
  const poolState = { ...state };
  delete poolState.pullHistory;
  delete poolState.infoBookTenPullAvailable;
  delete poolState.hasUsedInfoBookTenPull;
  delete poolState.hasUnactivatedInfoBook;
  if (c.pityScope === 'shared') {
    session.sharedPityState = {
      sixStarPity: state.sixStarPity,
      fiveStarPity: state.fiveStarPity,
      lastSixPoolId: state.lastSixPoolId ?? session.sharedPityState.lastSixPoolId,
    };
    delete poolState.sixStarPity;
    delete poolState.fiveStarPity;
    delete poolState.lastSixPoolId;
  }
  const key = seriesKey(c);
  if (key) {
    const series = { ...session.seriesStates[key] };
    if (c.pityScope === 'series') {
      series.sixStarPity = state.sixStarPity;
      series.fiveStarPity = state.fiveStarPity;
      delete poolState.sixStarPity;
      delete poolState.fiveStarPity;
    }
    if (c.targetScope === 'series') {
      series.guaranteedLimitedPity = state.guaranteedLimitedPity;
      series.hasReceivedGuaranteedLimited = state.hasReceivedGuaranteedLimited;
      delete poolState.guaranteedLimitedPity;
      delete poolState.hasReceivedGuaranteedLimited;
    }
    if (c.rewardScope === 'series') {
      series.seriesRewardPulls = state.seriesRewardPulls;
      series.giftsReceived = state.giftsReceived;
      series.freeTenPullsReceived = state.freeTenPullsReceived;
      series.freeResults = state.freeResults;
      delete poolState.seriesRewardPulls;
      delete poolState.giftsReceived;
      delete poolState.freeTenPullsReceived;
      delete poolState.freeResults;
    }
    session.seriesStates = { ...session.seriesStates, [key]: series };
  }
  session.pools = { ...session.pools, [descriptor.id]: poolState };
}

/** Known legacy counters can be restored without accepting their pool identity or history schema. */
export function restorePoolCounters(session, descriptor, saved = {}) {
  const next = { ...session };
  const state = getPoolState(session, descriptor);
  for (const key of [
    'sixStarPity',
    'fiveStarPity',
    'guaranteedLimitedPity',
    'totalPulls',
    'sixStarCount',
    'fiveStarCount',
    'upSixStarCount',
    'giftsReceived',
    'freeTenPullsReceived',
    'seriesRewardPulls',
  ]) {
    if (saved[key] != null) state[key] = count(saved[key]);
  }
  for (const key of ['hasReceivedGuaranteedLimited', 'hasReceivedInfoBook', 'hasReceivedSelectGift', 'inherited']) {
    if (typeof saved[key] === 'boolean') state[key] = saved[key];
  }
  state.sequenceCount = Math.max(state.sequenceCount, count(saved.sequenceCount), state.totalPulls + state.freeResults);
  if (descriptor.capabilities.entityType === 'weapon' && saved.totalPulls != null) {
    state.claimResults = state.totalPulls % Number(descriptor.capabilities.rules.claimSize || 10);
    if (state.claimResults === 0) state.claimHasSix = false;
  }
  storePoolState(next, descriptor, state);
  return next;
}

export function giftProgress(descriptor, progress, received = 0) {
  const c = descriptor.capabilities;
  const r = c.rules;
  if (c.basePoolType === 'limited') {
    const value = Math.floor(progress / Number(r.giftInterval || Infinity));
    const next = (value + 1) * Number(r.giftInterval || Infinity);
    return {
      count: value,
      isNewGift: value > received,
      nextGiftAt: next,
      remainingPulls: next - progress,
      giftType: 'limited_character',
    };
  }
  if (c.basePoolType === 'weapon') {
    if ((descriptor.pool?.isLimitedWeapon ?? descriptor.pool?.is_limited_weapon) === false) {
      return { count: 0, standardCount: 0, limitedCount: 0, nextGiftAt: null, remainingPulls: 0, isNewGift: false };
    }
    const first = Number(r.firstStandardGift);
    const second = Number(r.firstLimitedGift);
    const interval = Number(r.giftAlternateInterval);
    const cycles = progress >= second ? Math.floor((progress - second) / interval) : 0;
    const standardCount = (progress >= first ? 1 : 0) + Math.ceil(cycles / 2);
    const limitedCount = (progress >= second ? 1 : 0) + Math.floor(cycles / 2);
    const nextGiftAt = progress < first ? first : progress < second ? second : second + (cycles + 1) * interval;
    return {
      count: standardCount + limitedCount,
      standardCount,
      limitedCount,
      nextGiftAt,
      nextGiftType: progress < first || (progress >= second && cycles % 2 === 0) ? 'standard_weapon' : 'limited_weapon',
      remainingPulls: nextGiftAt - progress,
      isNewGift: standardCount + limitedCount > received,
    };
  }
  if (c.basePoolType === 'standard') {
    const value = progress >= Number(r.selectGiftThreshold) ? 1 : 0;
    return {
      count: value,
      nextGiftAt: value ? null : r.selectGiftThreshold,
      remainingPulls: value ? 0 : r.selectGiftThreshold - progress,
      giftType: 'select_six_star',
      isNewGift: value > received,
    };
  }
  return { count: 0, isNewGift: false, nextGiftAt: null, remainingPulls: 0 };
}

function addQuota(target, delta) {
  const next = { ...target };
  Object.keys(EMPTY_QUOTA).forEach((key) => {
    next[key] = finite(next[key]) + finite(delta[key]);
  });
  next.aicQuotaTotalPotential = next.aicQuotaDirect + next.aicQuotaConvertible;
  return next;
}

function accumulateLedger(ledger, record, descriptor) {
  const c = descriptor.capabilities;
  const weapon = c.entityType === 'weapon';
  const kind = classifyRecord(record);
  const next = { ...ledger };
  if (kind === 'paid') next[weapon ? 'weaponPulls' : 'characterPulls'] += 1;
  const delta = quota();
  if (weapon) {
    if (kind !== 'gift') delta.aicQuotaDirect = record.rarity === 6 ? 50 : record.rarity === 5 ? 10 : 0;
  } else {
    const key = record.characterId || record.characterName;
    const old = ledger.quotaCharacters[key] || {
      id: key,
      name: record.characterName,
      rarity: record.rarity,
      acquisitionCount: 0,
      quota: quota(),
      firstAcquiredAt: record.timestamp,
      firstAcquiredPoolId: descriptor.id,
    };
    const copies = old.acquisitionCount + 1;
    if (kind !== 'gift') {
      if (copies === 1) delta.aicQuotaDirect = 30;
      if (copies > 1) {
        delta.trustTokensGained = 1;
        delta.bondQuotaDirect = record.rarity === 6 ? 50 : record.rarity === 5 ? 10 : 0;
      }
      if (copies > 6) {
        delta.excessTrustTokens = 1;
        if (record.rarity === 6) delta.endpointQuotaConvertible = 10;
        else delta.aicQuotaConvertible = record.rarity === 5 ? 20 : 5;
      }
      if (c.bondQuotaPerPull && kind !== 'info_book') delta.bondQuotaDirect += 1;
    }
    next.quotaCharacters = {
      ...ledger.quotaCharacters,
      [key]: {
        ...old,
        acquisitionCount: copies,
        potentialLevel: Math.min(copies - 1, 5),
        owned: true,
        lastAcquiredAt: record.timestamp,
        lastAcquiredPoolId: descriptor.id,
        trustTokensGained: Math.max(copies - 1, 0),
        excessTrustTokens: Math.max(copies - 6, 0),
        quota: addQuota(old.quota, delta),
      },
    };
  }
  const quotaKey = weapon ? 'weaponQuota' : 'characterQuota';
  next[quotaKey] = addQuota(ledger[quotaKey], delta);
  if (kind !== 'gift') {
    const countsKey = weapon ? 'weaponCounts' : 'characterCounts';
    const rarityKey = record.rarity === 6 && !record.isUp ? '6_std' : record.rarity;
    next[countsKey] = { ...ledger[countsKey], [rarityKey]: ledger[countsKey][rarityKey] + 1 };
  }
  return next;
}

/** Replay recorded outcomes, never re-roll them. Used once for inheritance and known legacy saves. */
export function replayHistoryEvent(session, record, descriptor) {
  const c = descriptor.capabilities;
  if (!c.isResolved) fail('simulator_unresolved_pool');
  const kind = classifyRecord(record);
  if (!['paid', 'free', 'info_book', 'gift'].includes(kind) || ![4, 5, 6].includes(Number(record.rarity)))
    fail('simulator_invalid_record');
  const next = { ...session, infoBooks: { ...session.infoBooks } };
  const state = getPoolState(session, descriptor);
  state.sequenceCount = Math.max(state.sequenceCount + 1, count(record.sequenceIndex));
  const counted = kind === 'paid' || kind === 'info_book';
  if (counted) {
    const before = state.sixStarPity;
    state.totalPulls += 1;
    if (record.rarity === 6) {
      state.sixStarCount += 1;
      if (record.isUp) state.upSixStarCount += 1;
      state.lastSixPoolId = descriptor.id;
      const previous = state.sixStarHistory.at(-1);
      const weaponInterval =
        previous?.paidIndex != null ? state.totalPulls - previous.paidIndex : before + state.claimResults + 1;
      state.sixStarHistory = [
        ...state.sixStarHistory,
        {
          ...record,
          pullNumber: state.sequenceCount,
          paidIndex: state.totalPulls,
          pityWhenPulled:
            c.entityType === 'weapon' ? weaponInterval : record.pityBefore != null ? record.pityBefore + 1 : before + 1,
        },
      ];
    }
    if (record.rarity === 5) state.fiveStarCount += 1;
    if (c.basePoolType === 'weapon') {
      state.claimResults += 1;
      state.claimHasSix ||= record.rarity === 6;
      if (state.claimResults >= Number(c.rules.claimSize || 10)) {
        state.sixStarPity = state.claimHasSix ? 0 : state.sixStarPity + Number(c.rules.claimSize || 10);
        state.fiveStarPity = 0;
        state.claimResults = 0;
        state.claimHasSix = false;
      }
    } else {
      state.sixStarPity = record.rarity === 6 ? 0 : state.sixStarPity + 1;
      state.fiveStarPity = record.rarity >= 5 ? 0 : state.fiveStarPity + 1;
    }
    if (Number(c.rules.guaranteedLimitedPity) > 0 && !state.hasReceivedGuaranteedLimited) {
      state.guaranteedLimitedPity = Math.min(state.guaranteedLimitedPity + 1, c.rules.guaranteedLimitedPity);
      if (record.rarity === 6 && record.isUp) state.hasReceivedGuaranteedLimited = true;
    }
    if (c.rewardScope === 'series') state.seriesRewardPulls = (state.seriesRewardPulls ?? 0) + 1;
    const progress = c.rewardScope === 'series' ? state.seriesRewardPulls : state.totalPulls;
    state.giftsReceived = giftProgress(descriptor, progress).count;
    state.hasReceivedSelectGift = c.basePoolType === 'standard' && state.giftsReceived > 0;
    if (c.infoBookEnabled && progress >= Number(c.rules.infoBookThreshold)) {
      state.hasReceivedInfoBook = true;
      if (!next.infoBooks[descriptor.id])
        next.infoBooks[descriptor.id] = { targetPoolId: descriptor.nextPoolId || null, used: false };
    }
    if (kind === 'info_book') {
      const sourceId = Object.keys(next.infoBooks).find(
        (id) => next.infoBooks[id].targetPoolId === descriptor.id && !next.infoBooks[id].used
      );
      if (sourceId) next.infoBooks[sourceId] = { ...next.infoBooks[sourceId], used: true };
    }
  } else if (kind === 'free') {
    state.freeResults += 1;
    if (state.freeResults % 10 === 0) state.freeTenPullsReceived += 1;
  }
  next.ledger = accumulateLedger(session.ledger, record, descriptor);
  storePoolState(next, descriptor, state);
  return next;
}

export function getResourceLedger(session) {
  const a = session.ledger;
  const s = session.resourceSettings;
  const characterCounts = a.characterCounts;
  const weaponCounts = a.weaponCounts;
  const jadeSpent = a.characterPulls * s.characterPullJadeCost;
  const arsenalSpent = (a.weaponPulls * s.weaponPullQuotaCost) / 10;
  const arsenalGained =
    characterCounts[4] * s.arsenalReward4 +
    characterCounts[5] * s.arsenalReward5 +
    (characterCounts[6] + characterCounts['6_std']) * s.arsenalReward6;
  const manual = Math.min(s.baseOriginite, s.manualConvertedOriginite);
  const needed = Math.max(jadeSpent - s.baseJade - manual * s.originiteToJadeRate, 0);
  const automatic = Math.min(Math.max(s.baseOriginite - manual, 0), Math.ceil(needed / s.originiteToJadeRate));
  const originiteSpent = manual + automatic;
  const convertedJade = originiteSpent * s.originiteToJadeRate;
  const jadeBalance = Math.max(s.baseJade + convertedJade - jadeSpent, 0);
  const originiteBalance = Math.max(s.baseOriginite - originiteSpent, 0);
  const arsenalBalance = s.baseArsenalQuota + arsenalGained - arsenalSpent;
  const counts = Object.fromEntries(Object.keys(characterCounts).map((k) => [k, characterCounts[k] + weaponCounts[k]]));
  const allQuota = addQuota(a.characterQuota, a.weaponQuota);
  return {
    ...s,
    ...allQuota,
    counts,
    characterPulls: a.characterPulls,
    weaponPulls: a.weaponPulls,
    chargedCharacterPulls: a.characterPulls,
    chargedWeaponPulls: a.weaponPulls,
    jadeSpent,
    arsenalSpent,
    arsenalGained,
    arsenalNet: arsenalGained - arsenalSpent,
    originiteEquivalent: jadeSpent / s.originiteToJadeRate,
    originiteSpent,
    convertedJade,
    manualConvertedJade: manual * s.originiteToJadeRate,
    jadeBalance: s.infiniteResources ? Infinity : jadeBalance,
    originiteBalance: s.infiniteResources ? Infinity : originiteBalance,
    arsenalBalance: s.infiniteResources ? Infinity : arsenalBalance,
    jadeShortfall: s.infiniteResources ? 0 : Math.max(jadeSpent - s.baseJade - convertedJade, 0),
    arsenalShortfall: s.infiniteResources ? 0 : Math.max(-arsenalBalance, 0),
    availableJadeBudget: s.infiniteResources ? Infinity : jadeBalance + originiteBalance * s.originiteToJadeRate,
    characterQuota: a.characterQuota,
    weaponQuota: a.weaponQuota,
    quotaCharacters: Object.values(a.quotaCharacters),
  };
}

export function sixStarProbability(pity, rules) {
  if (pity >= rules.sixStarPity) return 1;
  if (rules.hasSoftPity === false || pity < rules.sixStarSoftPityStart) return rules.sixStarBaseProbability;
  return Math.min(
    1,
    rules.sixStarBaseProbability + (pity - rules.sixStarSoftPityStart + 1) * rules.sixStarSoftPityIncrease
  );
}

function randomValue(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) fail('simulator_invalid_random');
  return value;
}

function chooseOutcome(rarity, isUp, descriptor, random) {
  const bucket = rarity === 6 ? (isUp ? 'up' : 'offBanner') : rarity === 5 ? 'fiveStar' : 'fourStar';
  const choices = descriptor.roster?.[bucket];
  if (!Array.isArray(choices) || !choices.length) fail('simulator_incomplete_roster');
  const item = choices[Math.floor(randomValue(random) * choices.length)];
  return {
    rarity,
    isUp,
    characterName: typeof item === 'string' ? item : item.name,
    characterId: typeof item === 'string' ? item : item.id,
    avatarUrl: item.avatarUrl || item.avatar_url || null,
  };
}

function characterOutcome(state, descriptor, random, free) {
  const c = descriptor.capabilities;
  const r = c.rules;
  const guaranteed =
    !free &&
    Number(r.guaranteedLimitedPity) > 0 &&
    !state.hasReceivedGuaranteedLimited &&
    state.guaranteedLimitedPity + 1 >= r.guaranteedLimitedPity;
  if (guaranteed) return chooseOutcome(6, true, descriptor, random);
  const p6 = free ? r.sixStarBaseProbability : sixStarProbability(state.sixStarPity + 1, r);
  if (randomValue(random) < p6) {
    const isUp =
      c.targetMode === 'four-target-equal' || (c.targetMode === 'single-up' && randomValue(random) < r.upProbability);
    return chooseOutcome(6, isUp, descriptor, random);
  }
  const p5 = !free && state.fiveStarPity + 1 >= r.fiveStarPity ? 1 : r.fiveStarBaseProbability;
  return chooseOutcome(randomValue(random) < p5 ? 5 : 4, false, descriptor, random);
}

/** @param {object} session @param {object} command @param {{descriptors:object,random:function,now:number}} context */
export function applyCommand(session, command, context) {
  if (session.version !== SIMULATOR_VERSION) fail('simulator_contract_mismatch');
  const descriptor = context.descriptors[command.poolId];
  if (!descriptor?.capabilities.isResolved) fail('simulator_unresolved_pool');
  const c = descriptor.capabilities;
  const r = c.rules;
  if ((c.pityScope === 'series' || c.targetScope === 'series' || c.rewardScope === 'series') && !seriesKey(c))
    fail('simulator_unresolved_series');
  const state = getPoolState(session, descriptor);
  if (!['single', 'ten', 'free', 'info_book'].includes(command.type)) fail('simulator_invalid_command');
  if (command.type === 'single' && c.entityType === 'weapon') fail('simulator_weapon_single_disabled');
  const amount = command.type === 'single' ? 1 : 10;
  const kind = command.type === 'free' ? 'free' : command.type === 'info_book' ? 'info_book' : 'paid';
  const progress = c.rewardScope === 'series' ? state.seriesRewardPulls || 0 : state.totalPulls;
  if (kind === 'free' && c.freeTenPullMilestones.filter((x) => progress >= x).length <= state.freeTenPullsReceived)
    fail('simulator_free_unavailable');
  if (kind === 'info_book' && !state.infoBookTenPullAvailable) fail('simulator_info_book_unavailable');
  const balance = getResourceLedger(session);
  const cost =
    kind === 'paid'
      ? c.entityType === 'weapon'
        ? session.resourceSettings.weaponPullQuotaCost
        : amount * session.resourceSettings.characterPullJadeCost
      : 0;
  if (
    !session.resourceSettings.infiniteResources &&
    cost > (c.entityType === 'weapon' ? balance.arsenalBalance : balance.availableJadeBudget)
  )
    fail('simulator_resource_shortfall');
  if (!Number.isFinite(context.now)) fail('simulator_invalid_time');
  const random = context.random;
  const batchId = amount === 10 ? `${session.scope}:${session.revision + 1}:${descriptor.id}` : null;
  let next = session;
  if (c.entityType === 'weapon' && state.claimResults) {
    // Legacy histories can end mid-claim. Begin the next complete claim using
    // completed-claim pity, preserving every recorded outcome and target count.
    state.sixStarPity = state.claimHasSix ? 0 : Math.floor(state.sixStarPity / amount) * amount;
    state.claimResults = 0;
    state.claimHasSix = false;
    next = { ...session };
    storePoolState(next, descriptor, state);
  }
  const results = [];
  if (c.entityType === 'weapon') {
    const forced = state.sixStarPity + amount >= r.sixStarPity ? Math.floor(randomValue(random) * amount) : -1;
    for (let i = 0; i < amount; i++) {
      let rarity;
      let isUp = false;
      if (i === forced || randomValue(random) < r.sixStarBaseProbability) {
        rarity = 6;
        isUp = c.targetMode === 'single-up' && randomValue(random) < r.upProbability;
      } else rarity = randomValue(random) < r.fiveStarBaseProbability ? 5 : 4;
      results.push(chooseOutcome(rarity, isUp, descriptor, random));
    }
    if (
      Number(r.guaranteedLimitedPity) > 0 &&
      !state.hasReceivedGuaranteedLimited &&
      state.guaranteedLimitedPity + amount >= r.guaranteedLimitedPity &&
      !results.some((x) => x.rarity === 6 && x.isUp)
    ) {
      const existing = results.findIndex((x) => x.rarity === 6);
      results[existing < 0 ? Math.floor(randomValue(random) * amount) : existing] = chooseOutcome(
        6,
        true,
        descriptor,
        random
      );
    }
    if (!results.some((x) => x.rarity >= 5)) results[amount - 1] = chooseOutcome(5, false, descriptor, random);
  }
  const events = [];
  for (let i = 0; i < amount; i++) {
    const before = getPoolState(next, descriptor);
    let outcome =
      c.entityType === 'weapon' ? results[i] : characterOutcome(before, descriptor, random, kind === 'free');
    if (kind === 'free' && i === amount - 1 && !events.some((e) => e.record.rarity >= 5) && outcome.rarity < 5)
      outcome = chooseOutcome(5, false, descriptor, random);
    const record = {
      ...outcome,
      poolId: descriptor.id,
      eventId: `${session.scope}:${session.revision + 1}:${descriptor.id}:${i}`,
      sequenceIndex: before.sequenceCount + 1,
      paidIndex: before.totalPulls + (kind === 'paid' || kind === 'info_book' ? 1 : 0),
      kind,
      timestamp: context.now + i,
      batchId,
      batchIndex: amount === 10 ? i : undefined,
      pityBefore: before.sixStarPity,
    };
    next = replayHistoryEvent(next, record, descriptor);
    events.push({ poolId: descriptor.id, record });
  }
  next = { ...next, currentPoolId: descriptor.id, revision: session.revision + 1 };
  return { session: next, events };
}

export function validateSession(session) {
  if (
    !session ||
    session.version !== SIMULATOR_VERSION ||
    !session.pools ||
    !session.ledger ||
    !Number.isInteger(session.revision) ||
    session.revision < 0
  )
    fail('simulator_invalid_session');
  for (const value of ['characterPullJadeCost', 'weaponPullQuotaCost', 'baseOriginite', 'originiteToJadeRate']) {
    if (!Number.isFinite(session.resourceSettings[value]) || session.resourceSettings[value] < 0)
      fail('simulator_invalid_settings');
  }
  if (session.resourceSettings.originiteToJadeRate === 0) fail('simulator_invalid_settings');
  return session;
}

export const engineInternals = { count, finite };
