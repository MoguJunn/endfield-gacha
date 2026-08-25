import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { getPoolSeriesStateKey } from '../../utils/poolScopedHistory.js';

export function buildSimulatorSeriesState(pool, state = {}) {
  const capabilities = resolvePoolCapabilities(pool);
  const seriesStateKey = getPoolSeriesStateKey(capabilities);
  const usesSeriesState = capabilities.pityScope === 'series'
    || capabilities.targetScope === 'series'
    || capabilities.rewardScope === 'series';
  if (!seriesStateKey || !usesSeriesState) {
    return null;
  }

  const seriesState = {
    seriesStateKey,
    ruleProfile: capabilities.ruleProfile,
    seriesKey: capabilities.seriesKey,
  };

  if (capabilities.pityScope === 'series') {
    seriesState.sixStarPity = Number(state?.sixStarPity || 0);
    seriesState.fiveStarPity = Number(state?.fiveStarPity || 0);
  }

  if (capabilities.targetScope === 'series') {
    seriesState.guaranteedLimitedPity = Number(state?.guaranteedLimitedPity || 0);
    seriesState.hasReceivedGuaranteedLimited = Boolean(state?.hasReceivedGuaranteedLimited);
  }

  if (capabilities.rewardScope === 'series') {
    seriesState.seriesRewardPulls = Number(state?.seriesRewardPulls ?? state?.totalPulls ?? 0);
    seriesState.giftsReceived = Number(state?.giftsReceived || 0);
    seriesState.freeTenPullsReceived = Number(state?.freeTenPullsReceived || 0);
  }

  return seriesState;
}

export function applySimulatorSeriesState(pool, state = {}, seriesState = null) {
  const capabilities = resolvePoolCapabilities(pool);
  const expectedKey = getPoolSeriesStateKey(capabilities);
  const usesSeriesState = capabilities.pityScope === 'series'
    || capabilities.targetScope === 'series'
    || capabilities.rewardScope === 'series';
  if (!expectedKey || !usesSeriesState || seriesState?.seriesStateKey !== expectedKey) {
    return { ...state };
  }

  const nextState = { ...state };

  if (capabilities.pityScope === 'series') {
    nextState.sixStarPity = Number(seriesState.sixStarPity || 0);
    nextState.fiveStarPity = Number(seriesState.fiveStarPity || 0);
  }

  if (capabilities.targetScope === 'series') {
    nextState.guaranteedLimitedPity = Number(seriesState.guaranteedLimitedPity || 0);
    nextState.hasReceivedGuaranteedLimited = Boolean(seriesState.hasReceivedGuaranteedLimited);
  }

  if (capabilities.rewardScope === 'series') {
    nextState.seriesRewardPulls = Number(seriesState.seriesRewardPulls || 0);
    nextState.giftsReceived = Number(seriesState.giftsReceived || 0);
    nextState.freeTenPullsReceived = Number(seriesState.freeTenPullsReceived || 0);
  }

  return nextState;
}

export default {
  applySimulatorSeriesState,
  buildSimulatorSeriesState,
};
