/** Probability calculations and compatibility entry points for the shared simulator. */
import { LIMITED_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { getPoolState, replayHistoryEvent, sixStarProbability } from '../../shared/simulator/engine.js';
import {
  buildLegacySimulatorDescriptor,
  createLegacySimulatorSession,
  executeLegacySimulatorCommand,
} from './simulatorLegacyAdapter.js';
import { calculateWeaponSixStarPityTargetProbability } from './weaponPoolProbability.js';

export function calculateSixStarProbability(currentPity, rules = LIMITED_POOL_RULES) {
  return sixStarProbability(currentPity, rules);
}

export function calculateFiveStarProbability(currentPity, rules = LIMITED_POOL_RULES) {
  return currentPity >= rules.fiveStarPity ? 1 : rules.fiveStarBaseProbability;
}

export function rollProbability(probability) {
  return Math.random() < probability;
}

function simulateLegacyCommand(state, descriptor, type) {
  const initial = createLegacySimulatorSession(descriptor, state);
  const outcome = executeLegacySimulatorCommand(initial, descriptor, type);
  let replayed = initial;
  const results = outcome.events.map(({ record }) => {
    // The old ten-pull API exposes each intermediate counter snapshot.
    replayed = replayHistoryEvent(replayed, record, descriptor);
    return { ...getPoolState(replayed, descriptor), ...record, isLimited: record.isUp };
  });
  return { results, nextState: getPoolState(outcome.session, descriptor) };
}

export function simulateSinglePull(
  state,
  rules = LIMITED_POOL_RULES,
  poolType = 'limited',
  currentUpCharacter = null,
  poolCharactersList = null
) {
  const descriptor = buildLegacySimulatorDescriptor(poolType, rules, currentUpCharacter, poolCharactersList);
  return simulateLegacyCommand(state, descriptor, 'single').results[0];
}

export function simulateTenPull(
  state,
  rules = LIMITED_POOL_RULES,
  poolType = 'limited',
  currentUpCharacter = null,
  poolCharactersList = null
) {
  const descriptor = buildLegacySimulatorDescriptor(poolType, rules, currentUpCharacter, poolCharactersList);
  return simulateLegacyCommand(state, descriptor, 'ten').results;
}

export function simulateWeaponTenClaim(state, rules = {}, currentUpCharacter = null, poolCharactersList = null) {
  const descriptor = buildLegacySimulatorDescriptor(
    'weapon',
    { ...WEAPON_POOL_RULES, ...rules },
    currentUpCharacter,
    poolCharactersList
  );
  const { results, nextState } = simulateLegacyCommand(state, descriptor, 'ten');
  return {
    results,
    nextState: {
      sixStarPity: nextState.sixStarPity,
      fiveStarPity: nextState.fiveStarPity,
      guaranteedLimitedPity: nextState.guaranteedLimitedPity,
      hasReceivedGuaranteedLimited: nextState.hasReceivedGuaranteedLimited,
    },
  };
}

export function simulateCharacterFreeTen(
  rules = LIMITED_POOL_RULES,
  poolType = 'limited',
  currentUpCharacter = null,
  poolCharactersList = null
) {
  const descriptor = buildLegacySimulatorDescriptor(poolType, rules, currentUpCharacter, poolCharactersList);
  // This stateless legacy generator has no reward receipt context. A fresh session
  // supplies exactly one allowance; the stateful class always uses real milestones.
  descriptor.capabilities = { ...descriptor.capabilities, freeTenPullMilestones: [0], freeTenPullLimit: 1 };
  return simulateLegacyCommand({}, descriptor, 'free').results.map((result) => ({ ...result, isFree: true }));
}

export function checkGuaranteedLimitedTrigger(state, rules = LIMITED_POOL_RULES) {
  return state.guaranteedLimitedPity >= rules.guaranteedLimitedPity && !state.hasReceivedGuaranteedLimited;
}

export function checkGiftAvailable(totalPulls, rules = LIMITED_POOL_RULES) {
  return totalPulls > 0 && totalPulls % rules.giftInterval === 0;
}

export function checkInfoBookAvailable(state, rules = LIMITED_POOL_RULES) {
  return !state.hasReceivedInfoBook && state.totalPulls >= rules.infoBookThreshold;
}

export function calculateExpectedPulls(currentPity = 0, rules = LIMITED_POOL_RULES) {
  let expectedPulls = 0;
  let totalProbability = 0;
  for (let pity = currentPity + 1; pity <= rules.sixStarPity; pity++) {
    const prob = calculateSixStarProbability(pity, rules);
    const pullsNeeded = pity - currentPity;
    expectedPulls += pullsNeeded * prob * (1 - totalProbability);
    totalProbability += prob * (1 - totalProbability);
    if (totalProbability >= 0.9999) break;
  }
  return Math.ceil(expectedPulls);
}

export function runSimulationBatch(
  iterations = 1000,
  pullsPerIteration = 100,
  rules = LIMITED_POOL_RULES,
  poolType = 'limited'
) {
  const descriptor = buildLegacySimulatorDescriptor(poolType, rules);
  const weapon = descriptor.capabilities.entityType === 'weapon';
  if (weapon && pullsPerIteration % 10 !== 0) throw new Error('武器池按申领进行，每次申领固定获得10件武器');
  const results = {
    totalIterations: iterations,
    pullsPerIteration,
    avgSixStarCount: 0,
    avgFiveStarCount: 0,
    avgSixStarPity: 0,
    minSixStarPity: Infinity,
    maxSixStarPity: 0,
    sixStarDistribution: {},
  };
  let totalSixStars = 0;
  let totalFiveStars = 0;
  let totalSixStarPity = 0;
  for (let i = 0; i < iterations; i++) {
    let session = createLegacySimulatorSession(descriptor);
    for (let j = 0; j < pullsPerIteration; j += weapon ? 10 : 1) {
      const outcome = executeLegacySimulatorCommand(session, descriptor, weapon ? 'ten' : 'single');
      for (const { record } of outcome.events) {
        if (record.rarity !== 6) continue;
        const pityWhenPulled = record.pityBefore + 1;
        results.sixStarDistribution[pityWhenPulled] = (results.sixStarDistribution[pityWhenPulled] || 0) + 1;
        results.minSixStarPity = Math.min(results.minSixStarPity, pityWhenPulled);
        results.maxSixStarPity = Math.max(results.maxSixStarPity, pityWhenPulled);
        totalSixStarPity += pityWhenPulled;
      }
      session = outcome.session;
    }
    const state = getPoolState(session, descriptor);
    totalSixStars += state.sixStarCount;
    totalFiveStars += state.fiveStarCount;
  }
  results.avgSixStarCount = (totalSixStars / iterations).toFixed(2);
  results.avgFiveStarCount = (totalFiveStars / iterations).toFixed(2);
  results.avgSixStarPity = totalSixStars > 0 ? (totalSixStarPity / totalSixStars).toFixed(2) : 0;
  return results;
}

export default {
  calculateSixStarProbability,
  calculateFiveStarProbability,
  rollProbability,
  simulateSinglePull,
  simulateTenPull,
  simulateCharacterFreeTen,
  calculateWeaponSixStarPityTargetProbability,
  simulateWeaponTenClaim,
  checkGuaranteedLimitedTrigger,
  checkGiftAvailable,
  checkInfoBookAvailable,
  calculateExpectedPulls,
  runSimulationBatch,
};
