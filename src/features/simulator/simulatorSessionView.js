import { getPoolState, giftProgress } from '../../../shared/simulator/engine.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { calculateExpectedPulls } from '../../utils/probabilityEngine.js';

export function buildSimulatorDescriptors(pools = []) {
  const normalized = pools.map((pool) => ({
    ...pool,
    id: pool.source_pool_id || pool.sourcePoolId || String(pool.id).replace(/^sim_/, ''),
  }));
  const limited = normalized
    .filter((pool) => resolvePoolCapabilities(pool).infoBookEnabled)
    .sort((a, b) => new Date(a.start_time || a.created_at || 0) - new Date(b.start_time || b.created_at || 0));
  return Object.fromEntries(
    normalized.map((pool) => {
      const capabilities = resolvePoolCapabilities(pool);
      const index = limited.findIndex((p) => p.id === pool.id);
      return [
        pool.id,
        { id: pool.id, pool, capabilities, nextPoolId: index >= 0 ? limited[index + 1]?.id || null : null },
      ];
    })
  );
}

export function buildSessionStatistics(session, descriptor) {
  const state = getPoolState(session, descriptor);
  const c = descriptor.capabilities;
  const progress = c.rewardScope === 'series' ? state.seriesRewardPulls || 0 : state.totalPulls;
  const earned = c.freeTenPullMilestones.filter((x) => progress >= x).length;
  const next = c.freeTenPullMilestones[earned] || null;
  return {
    ...state,
    sixStarRate: state.totalPulls ? ((100 * state.sixStarCount) / state.totalPulls).toFixed(2) : '0.00',
    fiveStarRate: state.totalPulls ? ((100 * state.fiveStarCount) / state.totalPulls).toFixed(2) : '0.00',
    upRate: state.sixStarCount ? ((100 * state.upSixStarCount) / state.sixStarCount).toFixed(1) : '0.0',
    avgPullsPerSixStar: state.upSixStarCount ? (state.totalPulls / state.upSixStarCount).toFixed(1) : '-',
    currentPity: state.sixStarPity,
    expectedPulls: calculateExpectedPulls(state.sixStarPity, c.rules),
    gifts: giftProgress(descriptor, progress, state.giftsReceived),
    freeTenPulls: {
      count: earned,
      received: state.freeTenPullsReceived,
      available: Math.max(0, earned - state.freeTenPullsReceived),
      nextGiftAt: next,
      remainingPulls: next ? Math.max(next - progress, 0) : 0,
    },
  };
}

export function buildSessionPity(session, descriptor) {
  const state = getPoolState(session, descriptor);
  const r = descriptor.capabilities.rules;
  const meter = (current, max) => ({
    current,
    max,
    percentage: max ? ((100 * current) / max).toFixed(1) : '0.0',
    remaining: Math.max((max || 0) - current, 0),
  });
  return {
    sixStar: meter(state.sixStarPity, r.sixStarPity),
    fiveStar: meter(state.fiveStarPity, r.fiveStarPity),
    guaranteedUp: {
      ...meter(state.guaranteedLimitedPity, r.guaranteedLimitedPity),
      isActive: false,
      hasReceived: state.hasReceivedGuaranteedLimited,
    },
  };
}

/** Read-only facade for the existing presentation components. It never writes session state. */
export function createSessionView(session, descriptor, pullHistory = []) {
  const state = { ...getPoolState(session, descriptor), pullHistory };
  return {
    poolType: descriptor.capabilities.basePoolType,
    rawPoolType: descriptor.capabilities.rawPoolType,
    poolInfo: descriptor.pool,
    capabilities: descriptor.capabilities,
    rules: descriptor.capabilities.rules,
    state,
    getState: () => state,
    exportState: () => state,
    getStatistics: () => buildSessionStatistics(session, descriptor),
    getPityInfo: () => buildSessionPity(session, descriptor),
    getCurrentUpCharacter: () => descriptor.pool.up_character || null,
  };
}
