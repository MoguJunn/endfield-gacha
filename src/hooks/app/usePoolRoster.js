import { useEffect, useMemo, useState } from 'react';
import { resolvePoolRosterBucketsBatch } from '../../utils/poolRoster.js';

const EMPTY_ROSTER_MAP = new Map();

function getPoolId(pool) {
  return pool?.id || pool?.pool_id || null;
}

function normalizePoolId(value) {
  if (value == null) {
    return '';
  }

  return String(value).trim();
}

function normalizePoolType(type) {
  if (type === 'extra') {
    return 'extra';
  }

  if (type === 'limited_character') {
    return 'limited';
  }

  if (type === 'limited_weapon') {
    return 'weapon';
  }

  if (type === 'beginner') {
    return 'standard';
  }

  return type;
}

function getRosterExpectedType(poolType) {
  return poolType === 'weapon' ? 'weapon' : 'character';
}

function getRosterPoolType(poolType) {
  if (poolType === 'weapon') {
    return 'weapon';
  }

  if (poolType === 'limited' || poolType === 'extra') {
    return 'limited';
  }

  return 'standard';
}

export function getPoolRosterScopeIds(pools = []) {
  return Array.from(new Set(
    (Array.isArray(pools) ? pools : [])
      .map((pool) => normalizePoolId(getPoolId(pool)))
      .filter(Boolean)
  ));
}

export function buildPoolRosterRequests(pools = []) {
  const poolById = new Map();
  (Array.isArray(pools) ? pools : []).forEach((pool) => {
    const poolId = normalizePoolId(getPoolId(pool));
    if (!poolId || poolById.has(poolId)) {
      return;
    }

    poolById.set(poolId, pool);
  });

  return Array.from(poolById, ([poolId, pool]) => {
    const normalizedPoolType = normalizePoolType(pool?.type);
    return {
      poolId,
      expectedType: getRosterExpectedType(normalizedPoolType),
      currentUpName: pool?.up_character || pool?.upCharacter || null,
      poolType: getRosterPoolType(normalizedPoolType),
      poolInfo: pool,
      mergeStrategy: normalizedPoolType === 'limited' ? 'fill-missing' : 'append',
    };
  });
}

/**
 * 只加载当前分析范围（单池或当前池组）的 roster。
 */
export function usePoolRoster({ pools = [], enabled = true } = {}) {
  const requests = useMemo(() => buildPoolRosterRequests(pools), [pools]);
  const [poolRosterById, setPoolRosterById] = useState(() => new Map());

  useEffect(() => {
    let cancelled = false;

    if (!enabled || requests.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const loadPoolRosters = async () => {
      const resolvedByPoolId = await resolvePoolRosterBucketsBatch(requests).catch(() => new Map());
      if (cancelled) {
        return;
      }

      const rosterEntries = Array.from(resolvedByPoolId.entries())
        .filter(([, roster]) => Array.isArray(roster?.sixStar) && roster.sixStar.some(Boolean))
        .map(([poolId, roster]) => [poolId, { roster }]);
      setPoolRosterById(new Map(rosterEntries));
    };

    loadPoolRosters();

    return () => {
      cancelled = true;
    };
  }, [enabled, requests]);

  return enabled && requests.length > 0 ? poolRosterById : EMPTY_ROSTER_MAP;
}

export default usePoolRoster;
