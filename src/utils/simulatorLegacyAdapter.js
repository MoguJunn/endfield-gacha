import { applyCommand, createSession, getPoolState, restorePoolCounters } from '../../shared/simulator/engine.js';
import { getCharacterName, getCurrentUpCharacter } from '../constants/characterPools.js';
import { EXTRA_RULE_PROFILES, resolvePoolCapabilities } from './poolCapabilities.js';

// Only the old pool-type API accepts bare "extra" as a brilliance festival.
export function resolveLegacySimulatorCapabilities(pool) {
  return resolvePoolCapabilities(
    pool === 'extra'
      ? {
          type: 'extra',
          extra_rule_profile: EXTRA_RULE_PROFILES.BRILLIANCE_FESTIVAL,
        }
      : pool
  );
}

export function assertLegacySimulatorDescriptor(descriptor) {
  const c = descriptor.capabilities;
  if (!c.isResolved) throw new Error('当前附加寻访规则尚未识别，模拟器已停止抽取');
  if ((c.pityScope === 'series' || c.targetScope === 'series' || c.rewardScope === 'series') && !c.seriesKey) {
    throw new Error('当前附加寻访缺少系列标识，模拟器已停止抽取');
  }
}

function legacyNameBucket(poolType, rarity, isUp, currentUpCharacter) {
  let name;
  return [
    {
      get name() {
        name = getCharacterName(poolType, rarity, isUp, currentUpCharacter);
        return name;
      },
      get id() {
        return name;
      },
    },
  ];
}

/** Explicit rosters stay strict. Only omitted old-API rosters use the existing name resolver. */
export function buildLegacySimulatorDescriptor(pool, rules = null, currentUpCharacter = null, roster = null) {
  const source = typeof pool === 'object' && pool ? pool : { type: pool };
  let capabilities = resolveLegacySimulatorCapabilities(pool);
  if (rules) capabilities = { ...capabilities, rules };
  if (capabilities.entityType === 'weapon' && (source.isLimitedWeapon ?? source.is_limited_weapon) === false) {
    capabilities = {
      ...capabilities,
      targetMode: 'none',
      rules: {
        ...capabilities.rules,
        upProbability: 0,
        guaranteedLimitedPity: 0,
      },
    };
  }
  const up =
    currentUpCharacter ||
    source.up_character ||
    source.upCharacter ||
    (capabilities.entityType === 'character' && capabilities.targetMode === 'single-up'
      ? getCurrentUpCharacter()
      : null);
  return {
    id: String(source.source_pool_id || source.sourcePoolId || source.id || source.pool_id || 'legacy-simulator'),
    pool: source,
    capabilities,
    roster: roster ?? {
      up: legacyNameBucket(capabilities.basePoolType, 6, true, up),
      offBanner: legacyNameBucket(capabilities.basePoolType, 6, false, up),
      fiveStar: legacyNameBucket(capabilities.basePoolType, 5, false, null),
      fourStar: legacyNameBucket(capabilities.basePoolType, 4, false, null),
    },
  };
}

export function restoreLegacySimulatorCounters(session, descriptor, saved = {}) {
  const counters = { ...saved };
  if (
    descriptor.capabilities.rewardScope === 'series' &&
    counters.seriesRewardPulls == null &&
    getPoolState(session, descriptor).seriesRewardPulls == null &&
    counters.totalPulls != null
  ) {
    counters.seriesRewardPulls = counters.totalPulls;
  }
  return restorePoolCounters(session, descriptor, counters);
}

export function createLegacySimulatorSession(descriptor, saved = {}) {
  return restoreLegacySimulatorCounters(
    createSession({
      scope: 'legacy',
      resourceSettings: { infiniteResources: true },
    }),
    descriptor,
    saved
  );
}

export function executeLegacySimulatorCommand(session, descriptor, type) {
  if (descriptor.capabilities.isResolved && descriptor.capabilities.entityType === 'weapon' && type === 'single') {
    throw new Error('武器池按申领进行，每次申领固定获得10件武器');
  }
  assertLegacySimulatorDescriptor(descriptor);
  try {
    return applyCommand(
      session,
      { type, poolId: descriptor.id },
      {
        descriptors: { [descriptor.id]: descriptor },
        random: Math.random,
        now: Date.now(),
      }
    );
  } catch (error) {
    if (error.code === 'simulator_weapon_single_disabled')
      throw new Error('武器池按申领进行，每次申领固定获得10件武器');
    if (error.code === 'simulator_info_book_unavailable') throw new Error('情报书十连不可用');
    if (error.code === 'simulator_free_unavailable') throw new Error('免费十连不可用或已领取完毕');
    throw error;
  }
}
