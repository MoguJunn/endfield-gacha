import {
  EXTRA_POOL_RULES,
  LIMITED_POOL_RULES,
  STANDARD_POOL_RULES,
  UNRESOLVED_POOL_RULES,
  WEAPON_POOL_RULES,
} from '../constants/index.js';
import {
  EXTRA_POOL_RULE_PROFILES,
  EXTRA_POOL_SUBTYPES,
} from '../../shared/extraPoolSubtype.js';

export const EXTRA_RULE_PROFILES = EXTRA_POOL_RULE_PROFILES;

export const POOL_RULE_KEYS = {
  LIMITED: 'LIMITED_POOL_RULES',
  WEAPON: 'WEAPON_POOL_RULES',
  STANDARD: 'STANDARD_POOL_RULES',
  EXTRA: 'EXTRA_POOL_RULES',
  UNRESOLVED: 'UNRESOLVED_POOL_RULES',
};

const RULES_BY_KEY = {
  [POOL_RULE_KEYS.LIMITED]: LIMITED_POOL_RULES,
  [POOL_RULE_KEYS.WEAPON]: WEAPON_POOL_RULES,
  [POOL_RULE_KEYS.STANDARD]: STANDARD_POOL_RULES,
  [POOL_RULE_KEYS.EXTRA]: EXTRA_POOL_RULES,
  [POOL_RULE_KEYS.UNRESOLVED]: UNRESOLVED_POOL_RULES,
};

function normalizeText(value) {
  return value == null ? '' : String(value).trim();
}

export function normalizeCapabilityPoolType(type) {
  if (type === 'limited_character' || type === 'limited') return 'limited';
  if (type === 'limited_weapon' || type === 'weapon') return 'weapon';
  if (type === 'standard_pool' || type === 'beginner' || type === 'standard') return 'standard';
  if (type === 'extra') return 'extra';
  return type || 'standard';
}

function createCapabilities({
  rawPoolType,
  entityType,
  basePoolType,
  rulesKey,
  targetMode,
  targetCount,
  targetScope = 'pool',
  pityScope,
  rewardScope,
  seriesKey = null,
  isResolved = true,
  extraSubtype = null,
  ruleProfile = null,
  freeTenPullMilestones = [],
  infoBookEnabled = false,
  bondQuotaPerPull = false,
  isLegacyFallback = false,
}) {
  return {
    entityType,
    basePoolType,
    rulesKey,
    rules: RULES_BY_KEY[rulesKey],
    targetMode,
    targetCount,
    targetScope,
    pityScope,
    rewardScope,
    seriesKey,
    isResolved,
    extraSubtype,
    ruleProfile,
    rawPoolType,
    freeTenPullMilestones,
    freeTenPullLimit: freeTenPullMilestones.length,
    infoBookEnabled,
    bondQuotaPerPull,
    isLegacyFallback,
  };
}

function resolveOrdinaryPoolCapabilities(rawPoolType) {
  switch (rawPoolType) {
    case 'limited':
      return createCapabilities({
        rawPoolType,
        entityType: 'character',
        basePoolType: 'limited',
        rulesKey: POOL_RULE_KEYS.LIMITED,
        targetMode: 'single-up',
        targetCount: 1,
        pityScope: 'shared',
        rewardScope: 'pool',
        freeTenPullMilestones: [30],
        infoBookEnabled: true,
      });
    case 'weapon':
      return createCapabilities({
        rawPoolType,
        entityType: 'weapon',
        basePoolType: 'weapon',
        rulesKey: POOL_RULE_KEYS.WEAPON,
        targetMode: 'single-up',
        targetCount: 1,
        pityScope: 'pool',
        rewardScope: 'pool',
      });
    case 'standard':
      return createCapabilities({
        rawPoolType,
        entityType: 'character',
        basePoolType: 'standard',
        rulesKey: POOL_RULE_KEYS.STANDARD,
        targetMode: 'none',
        targetCount: 0,
        pityScope: 'pool',
        rewardScope: 'pool',
      });
    default:
      return createCapabilities({
        rawPoolType,
        entityType: 'unknown',
        basePoolType: rawPoolType || 'standard',
        rulesKey: POOL_RULE_KEYS.UNRESOLVED,
        targetMode: 'none',
        targetCount: 0,
        pityScope: 'pool',
        rewardScope: 'pool',
        isResolved: false,
      });
  }
}

/**
 * 统一解析卡池的规则能力。附加寻访的基础规则与对象类型只认
 * extra_rule_profile；仅历史卡池 joint_1_2_2 可在 profile 缺失时回退为辉光庆典。
 */
export function resolvePoolCapabilities(pool) {
  const source = typeof pool === 'string' ? { type: pool } : (pool || {});
  const rawPoolType = normalizeCapabilityPoolType(source.type || source.pool_type);
  if (rawPoolType !== 'extra') {
    return resolveOrdinaryPoolCapabilities(rawPoolType);
  }

  const poolId = normalizeText(source.source_pool_id || source.sourcePoolId || source.id || source.pool_id);
  const explicitRuleProfile = normalizeText(
    source.extra_rule_profile ?? source.extraRuleProfile
  );
  const seriesKey = normalizeText(source.extra_series_key ?? source.extraSeriesKey) || null;
  const isLegacyFallback = !explicitRuleProfile && poolId === 'joint_1_2_2';
  const ruleProfile = isLegacyFallback
    ? EXTRA_RULE_PROFILES.BRILLIANCE_FESTIVAL
    : explicitRuleProfile || null;

  if (ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_CHARACTER) {
    return createCapabilities({
      rawPoolType,
      entityType: 'character',
      basePoolType: 'limited',
      rulesKey: POOL_RULE_KEYS.LIMITED,
      targetMode: 'single-up',
      targetCount: 1,
      targetScope: 'series',
      pityScope: 'series',
      rewardScope: 'series',
      seriesKey,
      extraSubtype: EXTRA_POOL_SUBTYPES.RECONSTRUCTION,
      ruleProfile,
      freeTenPullMilestones: [30, 60, 90],
    });
  }

  if (ruleProfile === EXTRA_RULE_PROFILES.RECONSTRUCTION_WEAPON) {
    return createCapabilities({
      rawPoolType,
      entityType: 'weapon',
      basePoolType: 'weapon',
      rulesKey: POOL_RULE_KEYS.WEAPON,
      targetMode: 'single-up',
      targetCount: 1,
      targetScope: 'series',
      pityScope: 'pool',
      rewardScope: 'series',
      seriesKey,
      extraSubtype: EXTRA_POOL_SUBTYPES.RECONSTRUCTION_CLAIM,
      ruleProfile,
    });
  }

  if (ruleProfile === EXTRA_RULE_PROFILES.BRILLIANCE_FESTIVAL) {
    return createCapabilities({
      rawPoolType,
      entityType: 'character',
      basePoolType: 'extra',
      rulesKey: POOL_RULE_KEYS.EXTRA,
      targetMode: 'four-target-equal',
      targetCount: 4,
      pityScope: 'pool',
      rewardScope: 'pool',
      seriesKey,
      extraSubtype: EXTRA_POOL_SUBTYPES.SPECIAL,
      ruleProfile,
      freeTenPullMilestones: [30],
      bondQuotaPerPull: true,
      isLegacyFallback,
    });
  }

  return createCapabilities({
    rawPoolType,
    entityType: 'unknown',
    basePoolType: 'extra',
    rulesKey: POOL_RULE_KEYS.UNRESOLVED,
    targetMode: 'none',
    targetCount: 0,
    pityScope: 'pool',
    rewardScope: 'pool',
    seriesKey,
    isResolved: false,
    extraSubtype: 'unclassified',
    ruleProfile,
  });
}

export function getRulesForPool(pool) {
  return resolvePoolCapabilities(pool).rules;
}

export default resolvePoolCapabilities;
