import { useEffect, useRef, useState } from 'react';
import { getCharacterRankingStats, getUserRankingStats } from '../../services/statsService';
import { useSnapshotVersion } from '../app/useSnapshotVersion.js';

/**
 * 排名数据加载 Hook
 * 根据数据源和用户信息加载全服或个人排名数据
 *
 * @param {string} dataSource - 'global' | 'local'
 * @param {Object|null} user - 用户对象
 * @returns {Object} 排名数据和加载状态
 */
export function useRankingData(dataSource, user, refreshKey = null) {
  const versions = useSnapshotVersion();
  const rankingVersion = versions?.public?.character_ranking;
  // 全服角色排名统计
  const [characterRanking, setCharacterRanking] = useState(null);
  const [rankingLoading, setRankingLoading] = useState(false);

  // 用户个人排名统计
  const [userRanking, setUserRanking] = useState(null);
  const [userRankingLoading, setUserRankingLoading] = useState(false);
  const attemptedUserRankingRef = useRef(null);
  const resolvedUserRankingRef = useRef(null);
  const globalRequestTokenRef = useRef(0);
  const userRequestTokenRef = useRef(0);

  // Re-read on published changes and after overview refreshes; the service
  // still reuses payloads when their published revision is unchanged.
  useEffect(() => {
    if (dataSource !== 'global') {
      globalRequestTokenRef.current += 1;
      queueMicrotask(() => setRankingLoading(false));
      return;
    }

    const requestToken = ++globalRequestTokenRef.current;
    queueMicrotask(() => {
      if (globalRequestTokenRef.current !== requestToken) return;
      setRankingLoading(true);
      getCharacterRankingStats()
        .then(data => { if (globalRequestTokenRef.current === requestToken) setCharacterRanking(data); })
        .finally(() => { if (globalRequestTokenRef.current === requestToken) setRankingLoading(false); });
    });
    return () => { globalRequestTokenRef.current += 1; };
  }, [dataSource, rankingVersion, refreshKey]);

  // 加载用户个人排名统计（只加载一次）
  useEffect(() => {
    const currentUserId = user?.id ?? null;

    if (dataSource !== 'local') {
      userRequestTokenRef.current += 1;
      attemptedUserRankingRef.current = null;
      queueMicrotask(() => setUserRankingLoading(false));
      return;
    }

    if (!currentUserId) {
      userRequestTokenRef.current += 1;
      attemptedUserRankingRef.current = null;
      resolvedUserRankingRef.current = null;
      queueMicrotask(() => {
        setUserRanking(null);
        setUserRankingLoading(false);
      });
      return;
    }

    const alreadyRequestedCurrentUser = attemptedUserRankingRef.current === currentUserId;
    const alreadyResolvedCurrentUser = resolvedUserRankingRef.current === currentUserId;

    if (!alreadyRequestedCurrentUser && !(alreadyResolvedCurrentUser && userRanking)) {
      const requestToken = userRequestTokenRef.current + 1;
      userRequestTokenRef.current = requestToken;
      attemptedUserRankingRef.current = currentUserId;
      queueMicrotask(() => {
        setUserRankingLoading(true);

        getUserRankingStats(currentUserId)
          .then(data => {
            if (userRequestTokenRef.current !== requestToken) return;
            resolvedUserRankingRef.current = currentUserId;
            setUserRanking(data);
          })
          .finally(() => {
            if (userRequestTokenRef.current !== requestToken) return;
            setUserRankingLoading(false);
          });
      });
    }
  }, [dataSource, user?.id, userRanking]);

  // 当用户变更时重置个人排名
  useEffect(() => {
    userRequestTokenRef.current += 1;
    attemptedUserRankingRef.current = null;
    resolvedUserRankingRef.current = null;
    queueMicrotask(() => {
      setUserRanking(null);
      setUserRankingLoading(false);
    });
  }, [user?.id]);

  return {
    characterRanking,
    rankingLoading,
    userRanking,
    userRankingLoading
  };
}

export default useRankingData;
