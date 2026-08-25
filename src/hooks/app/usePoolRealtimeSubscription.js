import { useEffect, useRef } from 'react';
import { isSupabaseRealtimeEnabled, supabase } from '../../supabaseClient';
import { usePoolStore, useAuthStore } from '../../stores';
import { formatVisiblePoolRecord } from '../../services/poolReadService';
import { isContributorDemoModeEnabled } from '../../dev/contributorDemoMode.js';

function mapRealtimePoolRecord(record) {
  return formatVisiblePoolRecord({
    ...record,
    name_en: record.name_en || null,
    creator_username: record.creator_username || null,
    creator_role: record.creator_role || null
  });
}

function mergePoolRecord(existingPool, incomingPool) {
  if (!existingPool) {
    return incomingPool;
  }

  return {
    ...existingPool,
    ...incomingPool,
    name_en: incomingPool.name_en ?? existingPool.name_en ?? null,
    creator_username: incomingPool.creator_username || existingPool.creator_username || null,
    creator_role: incomingPool.creator_role || existingPool.creator_role || null,
    up_character: incomingPool.up_character ?? existingPool.up_character ?? null,
    description: incomingPool.description ?? existingPool.description ?? null,
    banner_url: incomingPool.banner_url ?? existingPool.banner_url ?? null,
    start_time: incomingPool.start_time ?? existingPool.start_time ?? null,
    end_time: incomingPool.end_time ?? existingPool.end_time ?? null,
    featured_characters: incomingPool.featured_characters ?? existingPool.featured_characters ?? null
  };
}

/**
 * 卡池实时订阅 Hook
 * 监听 pools 表的变化，实时更新本地状态
 */
export function usePoolRealtimeSubscription({ showToast }) {
  const currentPoolId = usePoolStore(state => state.currentPoolId);
  const setPools = usePoolStore(state => state.setPools);
  const userRole = useAuthStore(state => state.userRole);

  const canEdit = userRole === 'admin' || userRole === 'super_admin';
  const isSuperAdmin = userRole === 'super_admin';

  // 使用 ref 存储会变化的值，避免重新订阅
  const currentPoolIdRef = useRef(currentPoolId);
  const canEditRef = useRef(canEdit);
  const isSuperAdminRef = useRef(isSuperAdmin);
  const showToastRef = useRef(showToast);

  // 更新 refs
  useEffect(() => {
    currentPoolIdRef.current = currentPoolId;
  }, [currentPoolId]);

  useEffect(() => {
    canEditRef.current = canEdit;
    isSuperAdminRef.current = isSuperAdmin;
  }, [canEdit, isSuperAdmin]);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // 订阅只在组件挂载时执行一次
  useEffect(() => {
    if (isContributorDemoModeEnabled() || !supabase || !canEdit || !isSupabaseRealtimeEnabled()) return;

    // 订阅 pools 表的所有变化
    const channel = supabase
      .channel('pools-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // 监听所有事件：INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'pools'
        },
        (payload) => {
          // 卡池数据变化监听
          if (payload.eventType === 'UPDATE') {
            // 更新本地卡池状态
            const updatedPool = mapRealtimePoolRecord(payload.new);
            const previousLocked = payload.old?.locked;
            const nextLocked = payload.new?.locked;
            const lockStateChanged = previousLocked !== nextLocked;
            setPools(prev => {
              const existingIndex = prev.findIndex(p => p.id === updatedPool.id);
              if (existingIndex < 0) {
                return [...prev, updatedPool];
              }

              return prev.map((pool, index) => (
                index === existingIndex ? mergePoolRecord(pool, updatedPool) : pool
              ));
            });

            // 如果更新的是当前卡池，显示通知（使用 ref 获取最新值）
            if (updatedPool.id === currentPoolIdRef.current && lockStateChanged) {
              if (updatedPool.locked && canEditRef.current && !isSuperAdminRef.current) {
                showToastRef.current(`卡池「${updatedPool.name}」已被超级管理员锁定`, 'warning', '卡池已锁定');
              } else if (!updatedPool.locked) {
                showToastRef.current(`卡池「${updatedPool.name}」已解锁`, 'success', '卡池已解锁');
              }
            }
          } else if (payload.eventType === 'INSERT') {
            // 新增卡池（其他用户创建）
            const newPool = mapRealtimePoolRecord(payload.new);
            setPools(prev => {
              const existingIndex = prev.findIndex(p => p.id === newPool.id);
              if (existingIndex >= 0) {
                return prev.map((pool, index) => (
                  index === existingIndex ? mergePoolRecord(pool, newPool) : pool
                ));
              }

              return [...prev, newPool];
            });
          } else if (payload.eventType === 'DELETE') {
            // 删除卡池
            const deletedPool = payload.old;
            setPools(prev => prev.filter(p => p.id !== deletedPool.pool_id));
          }
        }
      )
      .subscribe();

    // 清理订阅
    return () => {
      supabase.removeChannel(channel);
    };
  }, [canEdit, setPools]); // 编辑态才需要该订阅
}

export default usePoolRealtimeSubscription;
