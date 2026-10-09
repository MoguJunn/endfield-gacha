import { getPoolState } from '../../../shared/simulator/engine.js';
import { toDisplayRecord } from '../../../shared/simulator/records.js';
import { isGameAccountSelectionMatch } from '../../utils/gameAccountMetadata.js';
import { buildSimulatorInheritanceProjection } from './inheritanceProjection.js';
import { buildSimulatorDescriptors } from './simulatorSessionView.js';
import { buildSimulatorSeriesState } from './simulatorSeriesState.js';

function getSimulatorPoolId(realPoolId) {
  return realPoolId ? `sim_${realPoolId}` : null;
}

export function normalizeSimulatorPoolType(type) {
  if (type === 'extra') {
    return 'extra';
  }

  if (type === 'limited_character' || type === 'limited') {
    return 'limited';
  }

  if (type === 'limited_weapon' || type === 'weapon') {
    return 'weapon';
  }

  if (type === 'beginner' || type === 'standard' || type === 'standard_pool') {
    return 'standard';
  }

  return type || 'standard';
}

export function buildInheritedSimulatorSnapshot({
  history,
  realPools,
  currentGameUid,
  currentUserId,
  currentSimPoolId = null,
  includePullHistory = true,
}) {
  const poolsArray = Array.isArray(realPools) ? realPools : [];
  const selectedHistory = (Array.isArray(history) ? history : []).filter(
    (record) => !currentGameUid || isGameAccountSelectionMatch(record, currentGameUid)
  );
  // Legacy selectors accept either a UID or an account key. The selection is
  // already scoped above; let the projection retain the owner filter.
  const { session, histories } = buildSimulatorInheritanceProjection({
    history: selectedHistory,
    pools: poolsArray,
    currentUserId,
    accountKey: '',
  });
  const descriptors = buildSimulatorDescriptors(poolsArray);
  const statesByPoolId = {};
  const seriesStates = {};
  let hasSharedPity = false;

  Object.values(descriptors).forEach((descriptor) => {
    const state = getPoolState(session, descriptor);
    statesByPoolId[getSimulatorPoolId(descriptor.id)] = {
      ...state,
      pullHistory: includePullHistory ? (histories[descriptor.id] || []).map(toDisplayRecord) : [],
    };
    const seriesState = buildSimulatorSeriesState(descriptor.pool, state);
    if (seriesState && session.seriesStates[seriesState.seriesStateKey]) {
      seriesStates[seriesState.seriesStateKey] = seriesState;
    }
    if (descriptor.capabilities.pityScope === 'shared' && session.pools[descriptor.id]) {
      hasSharedPity = true;
    }
  });

  const infoBooks = Object.fromEntries(
    Object.entries(session.infoBooks).map(([poolId, book]) => [
      getSimulatorPoolId(poolId),
      {
        activated: false,
        used: book.used,
        targetPoolId: getSimulatorPoolId(book.targetPoolId),
        obtainedAt: book.obtainedAt ?? 0,
      },
    ])
  );

  return activateInheritedSimulatorSnapshot(
    {
      statesByPoolId,
      sharedPityState: hasSharedPity
        ? {
            sixStarPity: session.sharedPityState.sixStarPity,
            fiveStarPity: session.sharedPityState.fiveStarPity,
          }
        : null,
      seriesStates,
      infoBooks,
      hasAnyData: Object.values(histories).some((records) => records.length > 0),
    },
    currentSimPoolId
  );
}

export function activateInheritedSimulatorSnapshot(snapshot, currentSimPoolId = null) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const statesByPoolId = Object.fromEntries(
    Object.entries(snapshot.statesByPoolId || {}).map(([poolId, state]) => [poolId, { ...state }])
  );
  const infoBooks = Object.fromEntries(
    Object.entries(snapshot.infoBooks || {}).map(([poolId, state]) => [poolId, { ...state }])
  );

  if (currentSimPoolId) {
    Object.values(infoBooks).forEach((book) => {
      if (book?.targetPoolId === currentSimPoolId && book.used !== true) {
        book.activated = true;
        const currentState = statesByPoolId[currentSimPoolId];
        if (currentState) {
          statesByPoolId[currentSimPoolId] = {
            ...currentState,
            infoBookTenPullAvailable: true,
          };
        }
      }
    });
  }

  return {
    ...snapshot,
    statesByPoolId,
    infoBooks,
    seriesStates: Object.fromEntries(
      Object.entries(snapshot.seriesStates || {}).map(([key, state]) => [key, { ...state }])
    ),
    sharedPityState: snapshot.sharedPityState ? { ...snapshot.sharedPityState } : null,
    hasAnyData: snapshot.hasAnyData ?? Object.keys(statesByPoolId).length > 0,
  };
}

export function buildInheritedSimulatorState({ history, realPools, currentSimPool, currentGameUid, currentUserId }) {
  const realPoolId = currentSimPool?.id?.replace(/^sim_/, '');
  if (!realPoolId) {
    return null;
  }
  const snapshot = buildInheritedSimulatorSnapshot({
    history,
    realPools,
    currentGameUid,
    currentUserId,
    currentSimPoolId: currentSimPool?.id || null,
  });

  return snapshot.hasAnyData ? snapshot.statesByPoolId[currentSimPool.id] || null : null;
}

export default {
  activateInheritedSimulatorSnapshot,
  buildInheritedSimulatorSnapshot,
  buildInheritedSimulatorState,
  normalizeSimulatorPoolType,
};
