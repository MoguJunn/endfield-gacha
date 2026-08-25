import { getAppLocale, getMessage } from '../i18n/index.js';
import {
  buildQuotaLedgerFromSimulatorStates,
  calculateWeaponQuotaFromCounts,
  normalizeQuotaSummary
} from './quotaEconomy.js';
import { isInfoBookHistoryPull } from './historyInfoBook.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';

const JADE_ICON_URL = '/resource-icons/item_diamond.webp';
const ORIGINITE_ICON_URL = '/resource-icons/item_originium_recharge.webp';
const ARSENAL_ICON_URL = '/resource-icons/item_gachabyproducts_weapongold.webp';
const AIC_QUOTA_ICON_URL = '/resource-icons/item_gachabyproducts_weaponticket.png';
const BOND_QUOTA_ICON_URL = '/resource-icons/item_gachabyproducts_charticket.png';
const ENDPOINT_QUOTA_ICON_URL = '/resource-icons/item_gachabyproducts_potentialticket.png';

export const RESOURCE_ICON_URLS = {
  jade: JADE_ICON_URL,
  originite: ORIGINITE_ICON_URL,
  arsenalQuota: ARSENAL_ICON_URL,
  aicQuota: AIC_QUOTA_ICON_URL,
  bondQuota: BOND_QUOTA_ICON_URL,
  endpointQuota: ENDPOINT_QUOTA_ICON_URL
};

export const RESOURCE_LABELS = {
  jade: '嵌金玉',
  originite: '衍质源石',
  arsenalQuota: '武库配额',
  aicQuota: '集成配额 / AIC Quota',
  bondQuota: '保障配额 / Bond Quota',
  endpointQuota: '终点配额 / Endpoint Quota',
  trustToken: '信物'
};

export function getLocalizedResourceLabel(resourceKey, locale = getAppLocale()) {
  if (resourceKey === 'jade') {
    return getMessage('resource.jade', {}, locale);
  }

  if (resourceKey === 'originite') {
    return getMessage('resource.originite', {}, locale);
  }

  if (resourceKey === 'arsenalQuota') {
    return getMessage('resource.arsenalQuota', {}, locale);
  }

  if (resourceKey === 'aicQuota') {
    return getMessage('resource.aicQuota', {}, locale);
  }

  if (resourceKey === 'bondQuota') {
    return getMessage('resource.bondQuota', {}, locale);
  }

  if (resourceKey === 'endpointQuota') {
    return getMessage('resource.endpointQuota', {}, locale);
  }

  if (resourceKey === 'trustToken') {
    return getMessage('resource.trustToken', {}, locale);
  }

  return RESOURCE_LABELS[resourceKey] || resourceKey;
}

export const DEFAULT_RESOURCE_RULES = {
  characterPullJadeCost: 500,
  weaponPullQuotaCost: 1980,
  originiteToJadeRate: 75,
  arsenalReward4: 20,
  arsenalReward5: 200,
  arsenalReward6: 2000
};

export const DEFAULT_SIMULATOR_RESOURCE_SETTINGS = {
  ...DEFAULT_RESOURCE_RULES,
  baseJade: 50000,
  baseOriginite: 120,
  baseArsenalQuota: 19800,
  manualConvertedOriginite: 0,
  cnOriginiteDoubleBonusEnabled: true,
  infiniteResources: false
};

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === 'false' || value === '0' || value === 0) {
    return false;
  }

  return fallback;
}

function normalizePoolType(poolType) {
  if (poolType === 'extra') {
    return 'extra';
  }

  if (poolType === 'limited' || poolType === 'limited_character') {
    return 'limited';
  }

  if (poolType === 'weapon' || poolType === 'limited_weapon') {
    return 'weapon';
  }

  if (poolType === 'standard' || poolType === 'standard_pool' || poolType === 'beginner') {
    return 'standard';
  }

  return poolType || 'standard';
}

export function normalizeResourceSettings(partialSettings = {}) {
  const merged = {
    ...DEFAULT_SIMULATOR_RESOURCE_SETTINGS,
    ...(partialSettings || {})
  };

  return {
    // 允许内部基数为负，以便“设为当前余额”在已有换玉/配额净增时仍能准确成立。
    baseJade: toFiniteNumber(merged.baseJade, DEFAULT_SIMULATOR_RESOURCE_SETTINGS.baseJade),
    baseOriginite: toNonNegativeNumber(merged.baseOriginite, DEFAULT_SIMULATOR_RESOURCE_SETTINGS.baseOriginite),
    baseArsenalQuota: toFiniteNumber(merged.baseArsenalQuota, DEFAULT_SIMULATOR_RESOURCE_SETTINGS.baseArsenalQuota),
    manualConvertedOriginite: toNonNegativeNumber(merged.manualConvertedOriginite, DEFAULT_SIMULATOR_RESOURCE_SETTINGS.manualConvertedOriginite),
    cnOriginiteDoubleBonusEnabled: toBoolean(
      merged.cnOriginiteDoubleBonusEnabled,
      DEFAULT_SIMULATOR_RESOURCE_SETTINGS.cnOriginiteDoubleBonusEnabled
    ),
    infiniteResources: toBoolean(
      merged.infiniteResources,
      DEFAULT_SIMULATOR_RESOURCE_SETTINGS.infiniteResources
    ),
    characterPullJadeCost: toNonNegativeNumber(merged.characterPullJadeCost, DEFAULT_RESOURCE_RULES.characterPullJadeCost),
    weaponPullQuotaCost: toNonNegativeNumber(merged.weaponPullQuotaCost, DEFAULT_RESOURCE_RULES.weaponPullQuotaCost),
    originiteToJadeRate: Math.max(1, toNonNegativeNumber(merged.originiteToJadeRate, DEFAULT_RESOURCE_RULES.originiteToJadeRate)),
    arsenalReward4: toNonNegativeNumber(merged.arsenalReward4, DEFAULT_RESOURCE_RULES.arsenalReward4),
    arsenalReward5: toNonNegativeNumber(merged.arsenalReward5, DEFAULT_RESOURCE_RULES.arsenalReward5),
    arsenalReward6: toNonNegativeNumber(merged.arsenalReward6, DEFAULT_RESOURCE_RULES.arsenalReward6)
  };
}

export function getCombinedSixStarCount(counts = {}) {
  return toNonNegativeNumber(counts[6] ?? counts['6'], 0) + toNonNegativeNumber(counts['6_std'], 0);
}

export function calculateArsenalQuotaGainFromCounts(counts = {}, settings = DEFAULT_RESOURCE_RULES) {
  const normalizedSettings = normalizeResourceSettings(settings);
  const fourStarCount = toNonNegativeNumber(counts[4] ?? counts['4'], 0);
  const fiveStarCount = toNonNegativeNumber(counts[5] ?? counts['5'], 0);
  const sixStarCount = getCombinedSixStarCount(counts);

  return (
    fourStarCount * normalizedSettings.arsenalReward4 +
    fiveStarCount * normalizedSettings.arsenalReward5 +
    sixStarCount * normalizedSettings.arsenalReward6
  );
}

export function calculateArsenalQuotaRewardForRarity(rarity, settings = DEFAULT_RESOURCE_RULES) {
  const normalizedSettings = normalizeResourceSettings(settings);
  const normalizedRarity = Number(rarity) || 0;

  if (normalizedRarity >= 6) {
    return normalizedSettings.arsenalReward6;
  }

  if (normalizedRarity === 5) {
    return normalizedSettings.arsenalReward5;
  }

  if (normalizedRarity === 4) {
    return normalizedSettings.arsenalReward4;
  }

  return 0;
}

export function getWeaponSingleQuotaCost(settings = DEFAULT_RESOURCE_RULES) {
  const normalizedSettings = normalizeResourceSettings(settings);
  return normalizedSettings.weaponPullQuotaCost / 10;
}

export function buildResourceSummaryFromAggregates({
  characterPulls = 0,
  weaponPulls = 0,
  chargedCharacterPulls = characterPulls,
  chargedWeaponPulls = weaponPulls,
  counts = {},
  arsenalGainCounts = counts,
  quotaLedger = null,
  quotaSummary = null,
  settings = DEFAULT_RESOURCE_RULES
} = {}) {
  const normalizedSettings = normalizeResourceSettings(settings);
  const normalizedCharacterPulls = toNonNegativeNumber(characterPulls, 0);
  const normalizedWeaponPulls = toNonNegativeNumber(weaponPulls, 0);
  const normalizedChargedCharacterPulls = toNonNegativeNumber(chargedCharacterPulls, normalizedCharacterPulls);
  const normalizedChargedWeaponPulls = toNonNegativeNumber(chargedWeaponPulls, normalizedWeaponPulls);
  const jadeSpent = normalizedChargedCharacterPulls * normalizedSettings.characterPullJadeCost;
  const originiteEquivalent = jadeSpent / normalizedSettings.originiteToJadeRate;
  const arsenalSpent = normalizedChargedWeaponPulls * getWeaponSingleQuotaCost(normalizedSettings);
  const arsenalGained = calculateArsenalQuotaGainFromCounts(arsenalGainCounts, normalizedSettings);
  const normalizedQuota = normalizeQuotaSummary(quotaSummary || quotaLedger?.quota || quotaLedger || {});

  return {
    characterPulls: normalizedCharacterPulls,
    weaponPulls: normalizedWeaponPulls,
    chargedCharacterPulls: normalizedChargedCharacterPulls,
    chargedWeaponPulls: normalizedChargedWeaponPulls,
    jadeSpent,
    originiteEquivalent,
    arsenalSpent,
    arsenalGained,
    arsenalNet: arsenalGained - arsenalSpent,
    ...normalizedQuota
  };
}

export function buildWeaponQuotaSummaryFromCounts(counts = {}) {
  return calculateWeaponQuotaFromCounts(counts);
}

export function buildPoolResourceSummary({
  poolType,
  totalPulls = 0,
  chargedPulls = totalPulls,
  counts = {},
  quotaLedger = null,
  settings = DEFAULT_RESOURCE_RULES
} = {}) {
  const normalizedPoolType = normalizePoolType(poolType);

  return buildResourceSummaryFromAggregates({
    characterPulls: normalizedPoolType === 'weapon' ? 0 : totalPulls,
    weaponPulls: normalizedPoolType === 'weapon' ? totalPulls : 0,
    chargedCharacterPulls: normalizedPoolType === 'weapon' ? 0 : chargedPulls,
    chargedWeaponPulls: normalizedPoolType === 'weapon' ? chargedPulls : 0,
    counts,
    arsenalGainCounts: normalizedPoolType === 'weapon' ? {} : counts,
    quotaLedger,
    settings
  });
}

function getResourceHistoryPoolId(record) {
  return record?.poolId || record?.pool_id || null;
}

function isResourceGiftRecord(record) {
  return record?.specialType === 'gift' || record?.special_type === 'gift';
}

function isResourceFreeRecord(record) {
  return record?.isFree === true
    || record?.is_free === true
    || record?.isFreePull === true
    || record?.is_free_pull === true;
}

function isResourceInfoBookRecord(record) {
  return isInfoBookHistoryPull(record)
    || record?.isInfoBookPull === true
    || record?.is_info_book_pull === true
    || record?.specialType === 'info_book'
    || record?.special_type === 'info_book';
}

/**
 * 聚合目录必须按每条记录所属真实池的 capabilities 拆分角色/武器资源，
 * 不能让合成的 extra/all 卡池对象替代来源池规则。
 */
export function buildCapabilityAwarePoolResourceSummary({
  history = [],
  pools = [],
  includeFreePulls = false,
  quotaLedger = null,
  settings = DEFAULT_RESOURCE_RULES,
} = {}) {
  const poolLookup = new Map(
    (Array.isArray(pools) ? pools : [])
      .flatMap((pool) => [pool?.id, pool?.pool_id].map((poolId) => [String(poolId || ''), pool]))
      .filter(([poolId]) => Boolean(poolId))
  );
  const aggregate = {
    characterPulls: 0,
    weaponPulls: 0,
    chargedCharacterPulls: 0,
    chargedWeaponPulls: 0,
    characterCounts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
  };

  (Array.isArray(history) ? history : []).forEach((record) => {
    if (isResourceGiftRecord(record)) {
      return;
    }

    const isFree = isResourceFreeRecord(record);
    if (isFree && !includeFreePulls) {
      return;
    }

    const poolId = getResourceHistoryPoolId(record);
    const sourcePool = poolLookup.get(String(poolId || '')) || {
      ...record,
      id: poolId,
      type: record?.poolType || record?.pool_type || record?.type,
    };
    const capabilities = resolvePoolCapabilities(sourcePool);
    const isWeapon = capabilities.entityType === 'weapon' || capabilities.basePoolType === 'weapon';
    const isCharged = !isFree && !isResourceInfoBookRecord(record);

    if (isWeapon) {
      aggregate.weaponPulls += 1;
      if (isCharged) {
        aggregate.chargedWeaponPulls += 1;
      }
      return;
    }

    aggregate.characterPulls += 1;
    if (isCharged) {
      aggregate.chargedCharacterPulls += 1;
    }

    const rarity = Number(record?.rarity) || 0;
    if (rarity >= 6) {
      aggregate.characterCounts[record?.isStandard ? '6_std' : 6] += 1;
    } else if (rarity === 5) {
      aggregate.characterCounts[5] += 1;
    } else if (rarity > 0) {
      aggregate.characterCounts[4] += 1;
    }
  });

  return buildResourceSummaryFromAggregates({
    characterPulls: aggregate.characterPulls,
    weaponPulls: aggregate.weaponPulls,
    chargedCharacterPulls: aggregate.chargedCharacterPulls,
    chargedWeaponPulls: aggregate.chargedWeaponPulls,
    counts: aggregate.characterCounts,
    arsenalGainCounts: aggregate.characterCounts,
    quotaLedger,
    settings,
  });
}

function countHistoryRarities(history = []) {
  return history.reduce((accumulator, record) => {
    const rarity = Number(record?.rarity) || 0;
    if (rarity <= 0) {
      return accumulator;
    }

    if (rarity >= 6) {
      if (record?.isUp === false) {
        accumulator['6_std'] += 1;
      } else {
        accumulator[6] += 1;
      }
      return accumulator;
    }

    if (rarity === 5) {
      accumulator[5] += 1;
      return accumulator;
    }

    accumulator[4] += 1;
    return accumulator;
  }, { 6: 0, '6_std': 0, 5: 0, 4: 0 });
}

function countPaidHistory(history = []) {
  return history.filter((record) => !record?.isFreePull && !record?.isInfoBookPull).length;
}

export function buildSimulatorResourceLedger(simulatorStates = [], settings = DEFAULT_SIMULATOR_RESOURCE_SETTINGS) {
  const normalizedSettings = normalizeResourceSettings(settings);
  const quotaLedger = buildQuotaLedgerFromSimulatorStates(simulatorStates);

  const aggregate = simulatorStates.reduce((accumulator, state) => {
    const poolType = resolvePoolCapabilities({
      id: state?.poolId || state?.id,
      type: state?.poolType,
      extra_rule_profile: state?.extraRuleProfile || state?.extra_rule_profile,
      extra_series_key: state?.extraSeriesKey || state?.extra_series_key,
    }).basePoolType;
    const pullHistory = Array.isArray(state?.pullHistory) ? state.pullHistory : [];
    const counts = countHistoryRarities(pullHistory);

    if (poolType === 'weapon') {
      accumulator.weaponPulls += countPaidHistory(pullHistory);
      accumulator.weaponCounts[6] += counts[6];
      accumulator.weaponCounts['6_std'] += counts['6_std'];
      accumulator.weaponCounts[5] += counts[5];
      accumulator.weaponCounts[4] += counts[4];
    } else {
      accumulator.characterPulls += countPaidHistory(pullHistory);
      accumulator.characterCounts[6] += counts[6];
      accumulator.characterCounts['6_std'] += counts['6_std'];
      accumulator.characterCounts[5] += counts[5];
      accumulator.characterCounts[4] += counts[4];
    }

    return accumulator;
  }, {
    characterPulls: 0,
    weaponPulls: 0,
    characterCounts: { 6: 0, '6_std': 0, 5: 0, 4: 0 },
    weaponCounts: { 6: 0, '6_std': 0, 5: 0, 4: 0 }
  });

  const totalCounts = {
    6: aggregate.characterCounts[6] + aggregate.weaponCounts[6],
    '6_std': aggregate.characterCounts['6_std'] + aggregate.weaponCounts['6_std'],
    5: aggregate.characterCounts[5] + aggregate.weaponCounts[5],
    4: aggregate.characterCounts[4] + aggregate.weaponCounts[4]
  };

  const summary = buildResourceSummaryFromAggregates({
    characterPulls: aggregate.characterPulls,
    weaponPulls: aggregate.weaponPulls,
    counts: totalCounts,
    arsenalGainCounts: aggregate.characterCounts,
    quotaLedger,
    settings: normalizedSettings
  });

  const manualConvertedOriginite = Math.min(
    normalizedSettings.baseOriginite,
    normalizedSettings.manualConvertedOriginite
  );
  const manualConvertedJade = manualConvertedOriginite * normalizedSettings.originiteToJadeRate;
  const remainingOriginiteBudget = Math.max(normalizedSettings.baseOriginite - manualConvertedOriginite, 0);
  const originiteNeeded = Math.max(summary.jadeSpent - (normalizedSettings.baseJade + manualConvertedJade), 0);
  const autoOriginiteSpentRaw = Math.ceil(originiteNeeded / normalizedSettings.originiteToJadeRate);
  const autoOriginiteSpent = Math.min(remainingOriginiteBudget, autoOriginiteSpentRaw);
  const originiteSpent = manualConvertedOriginite + autoOriginiteSpent;
  const convertedJade = manualConvertedJade + autoOriginiteSpent * normalizedSettings.originiteToJadeRate;
  const jadeBudgetAfterConversion = normalizedSettings.baseJade + convertedJade;
  const jadeShortfall = Math.max(summary.jadeSpent - jadeBudgetAfterConversion, 0);
  const jadeBalance = Math.max(jadeBudgetAfterConversion - summary.jadeSpent, 0);
  const originiteBalance = Math.max(normalizedSettings.baseOriginite - originiteSpent, 0);
  const arsenalBalance = normalizedSettings.baseArsenalQuota + summary.arsenalGained - summary.arsenalSpent;
  const arsenalShortfall = Math.max(-arsenalBalance, 0);
  const availableJadeBudget = jadeBalance + originiteBalance * normalizedSettings.originiteToJadeRate;
  const infiniteResources = Boolean(normalizedSettings.infiniteResources);

  return {
    ...summary,
    counts: totalCounts,
    baseJade: normalizedSettings.baseJade,
    baseOriginite: normalizedSettings.baseOriginite,
    baseArsenalQuota: normalizedSettings.baseArsenalQuota,
    characterQuota: quotaLedger.characterQuota,
    weaponQuota: quotaLedger.weaponQuota,
    quotaCharacters: quotaLedger.characterRows,
    manualConvertedOriginite,
    manualConvertedJade,
    originiteSpent,
    convertedJade,
    jadeBalance: infiniteResources ? Number.POSITIVE_INFINITY : jadeBalance,
    originiteBalance: infiniteResources ? Number.POSITIVE_INFINITY : originiteBalance,
    arsenalBalance: infiniteResources ? Number.POSITIVE_INFINITY : arsenalBalance,
    jadeShortfall: infiniteResources ? 0 : jadeShortfall,
    arsenalShortfall: infiniteResources ? 0 : arsenalShortfall,
    availableJadeBudget: infiniteResources ? Number.POSITIVE_INFINITY : availableJadeBudget,
    infiniteResources
  };
}

export function getSimulatorPullCost({
  poolType,
  pullType = 'single',
  settings = DEFAULT_SIMULATOR_RESOURCE_SETTINGS,
  isFree = false,
  isInfoBook = false
} = {}) {
  if (isFree || isInfoBook) {
    return {
      resource: null,
      amount: 0
    };
  }

  const normalizedSettings = normalizeResourceSettings(settings);
  const normalizedPoolType = normalizePoolType(poolType);
  const multiplier = pullType === 'ten' ? 10 : 1;

  if (normalizedPoolType === 'weapon') {
    const weaponSingleQuotaCost = getWeaponSingleQuotaCost(normalizedSettings);
    return {
      resource: 'arsenalQuota',
      amount: pullType === 'ten'
        ? normalizedSettings.weaponPullQuotaCost
        : weaponSingleQuotaCost
    };
  }

  return {
    resource: 'jade',
    amount: normalizedSettings.characterPullJadeCost * multiplier
  };
}

export function getOriginiteConversionPlanForJadeCost({
  ledger,
  jadeCost = 0,
  settings = DEFAULT_SIMULATOR_RESOURCE_SETTINGS
} = {}) {
  if (ledger?.infiniteResources) {
    return {
      jadeShortfall: 0,
      originiteNeeded: 0,
      canConvert: false,
      rate: normalizeResourceSettings(settings).originiteToJadeRate
    };
  }

  const normalizedSettings = normalizeResourceSettings(settings);
  const currentJadeBalance = Math.max(Number(ledger?.jadeBalance || 0), 0);
  const currentOriginiteBalance = Math.max(Number(ledger?.originiteBalance || 0), 0);
  const normalizedJadeCost = Math.max(Number(jadeCost) || 0, 0);
  const jadeShortfall = Math.max(normalizedJadeCost - currentJadeBalance, 0);
  const originiteNeeded = Math.ceil(jadeShortfall / normalizedSettings.originiteToJadeRate);

  return {
    jadeShortfall,
    originiteNeeded,
    canConvert: originiteNeeded > 0 && originiteNeeded <= currentOriginiteBalance,
    rate: normalizedSettings.originiteToJadeRate
  };
}

export function canAffordSimulatorPull(ledger, cost) {
  if (ledger?.infiniteResources) {
    return true;
  }

  if (!cost?.resource || !cost?.amount) {
    return true;
  }

  if (cost.resource === 'arsenalQuota') {
    return Math.max(ledger?.arsenalBalance || 0, 0) >= cost.amount;
  }

  return Math.max(ledger?.availableJadeBudget || 0, 0) >= cost.amount;
}

export function formatOriginiteEquivalent(value) {
  const numericValue = Number(value) || 0;
  if (Number.isInteger(numericValue)) {
    return `${numericValue}`;
  }

  return numericValue.toFixed(1);
}

export default {
  RESOURCE_ICON_URLS,
  RESOURCE_LABELS,
  getLocalizedResourceLabel,
  DEFAULT_RESOURCE_RULES,
  DEFAULT_SIMULATOR_RESOURCE_SETTINGS,
  normalizeResourceSettings,
  getCombinedSixStarCount,
  calculateArsenalQuotaGainFromCounts,
  calculateArsenalQuotaRewardForRarity,
  buildResourceSummaryFromAggregates,
  buildPoolResourceSummary,
  buildWeaponQuotaSummaryFromCounts,
  buildSimulatorResourceLedger,
  getOriginiteConversionPlanForJadeCost,
  getSimulatorPullCost,
  getWeaponSingleQuotaCost,
  canAffordSimulatorPull,
  formatOriginiteEquivalent
};
