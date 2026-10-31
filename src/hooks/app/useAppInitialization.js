import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuthStore, usePersonalDataStore } from '../../stores';
import useSiteConfigStore from '../../stores/useSiteConfigStore';
import { characterCache } from '../../utils/characterUtils';
import appLogger from '../../utils/appLogger.js';
import { getValidatedSupabaseSession } from '../../services/authFetchService.js';
import { getCurrentSiteSession } from '../../services/siteSessionService.js';
import { updateAccountLastSeen } from '../../services/accountLastSeenService.js';
import { useSessionRecovery } from './useSessionRecovery.js';
import {
  isContributorDemoModeEnabled,
  isContributorDemoSessionActive,
} from '../../dev/contributorDemoMode.js';
import { activateContributorDemoSession } from '../../dev/contributorDemoSession.js';
import {
  canUsePrivateCloudDataFromSiteSession,
  useAuthenticatedSessionSync
} from './useAuthenticatedSessionSync.js';

/**
 * 应用初始化 Hook
 * 处理会话获取、last_seen 更新、characterCache 预加载
 */
export function useAppInitialization({ refreshPersonalData, loadPublicPools }) {
  const setAuthResolved = useAuthStore(state => state.setAuthResolved);
  const siteSessionUserRef = useRef(null);

  // 只在首次建立 owner 或真实切换 owner 时更新最后在线时间。
  const updateLastSeen = useCallback(async () => {
    try {
      await updateAccountLastSeen();
    } catch {
      // 静默失败，不影响用户体验
    }
  }, []);

  const {
    applyAuthenticatedSession,
    applySiteSession,
    applySignedOut,
  } = useAuthenticatedSessionSync({
    refreshPersonalData,
    onUpdateLastSeen: updateLastSeen,
  });

  useSessionRecovery({
    applyAuthenticatedSession,
    applySiteSession,
    applySignedOut,
    siteSessionUserRef,
  });

  // 主初始化逻辑
  useEffect(() => {
    let isMounted = true;
    const isMountedRef = {
      get current() {
        return isMounted;
      },
    };

    const initializeApp = async () => {
      if (isContributorDemoModeEnabled()) {
        await Promise.allSettled([
          characterCache.load(),
          useSiteConfigStore.getState().loadConfig(),
          typeof loadPublicPools === 'function' ? loadPublicPools() : Promise.resolve(null),
        ]);
        if (isContributorDemoSessionActive()) {
          await activateContributorDemoSession();
        } else {
          setAuthResolved(true);
        }
        return;
      }

      if (!supabase) {
        setAuthResolved(true);
        if (typeof loadPublicPools === 'function') {
          void loadPublicPools();
        }
        return;
      }

      try {
        // 角色缓存与认证并行准备，不能继续阻塞身份判定和个人数据请求。
        const characterCachePromise = characterCache.load().catch(() => null);

        // 获取当前会话；Supabase 本地缓存必须先经过 Auth 服务验证。
        const [nativeResult, siteResult] = await Promise.allSettled([
          getValidatedSupabaseSession(),
          getCurrentSiteSession({ syncSupabase: false }),
        ]);
        const session = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
        const siteSession = siteResult.status === 'fulfilled' ? siteResult.value : null;
        const effectiveUser = siteSession?.authenticated && siteSession.user
          ? siteSession.user
          : (session?.user ?? null);
        if (!effectiveUser && [nativeResult, siteResult].some(result => result.status === 'rejected')) {
          throw new Error('暂时无法验证登录状态，请稍后重试');
        }
        const canLoadPrivateCloudData = canUsePrivateCloudDataFromSiteSession(siteSession, effectiveUser);

        if (siteSession?.authenticated && siteSession.user) {
          siteSessionUserRef.current = siteSession.user;
        } else {
          siteSessionUserRef.current = null;
        }

        if (!isMounted) {
          return;
        }

        // 站点配置和云端数据改为“限时等待 + 后台补齐”，避免首屏被慢请求长时间阻塞
        const startupTasks = [
          characterCachePromise,
          useSiteConfigStore.getState().loadConfig().catch(() => null)
        ];

        // 只有登录用户才加载历史记录和个人卡池数据
        if (effectiveUser && canLoadPrivateCloudData) {
          const cloudDataPromise = applyAuthenticatedSession(effectiveUser, {
            event: 'INITIAL_SESSION',
            canLoadPrivateCloudData,
            source: 'initial_session',
            isMountedRef,
          });

          startupTasks.push(cloudDataPromise);
        } else if (
          useAuthStore.getState().user?.id
          || usePersonalDataStore.getState().ownerId
        ) {
          // 认证事件可能比并行的初始化请求更早建立 owner。此时迟到的
          // 匿名初始化结果已经过期，不能反向清掉成功快照。
          setAuthResolved(true);
        } else {
          applySignedOut({ source: 'initial_session', event: 'SIGNED_OUT' });
          if (typeof loadPublicPools === 'function') {
            // 未登录时也加载公共卡池数据，供首页轮换计划和倒计时使用
            startupTasks.push(loadPublicPools().catch(() => null));
          }
        }

        // 这些任务已经不会遮挡应用挂载；等待仅用于保持错误归属清晰。
        await Promise.allSettled(startupTasks);
      } catch (error) {
        setAuthResolved(true);
        appLogger.error('[useAppInitialization] 初始化失败:', error);
      }
    };

    initializeApp();

    if (isContributorDemoModeEnabled()) {
      return () => {
        isMounted = false;
      };
    }

    const unsubscribeAuthStore = useAuthStore.subscribe((state, previousState) => {
      if (previousState?.user && !state.user) {
        applySignedOut({ source: 'auth_store', event: 'SIGNED_OUT' });
      }
    });

    // 监听登录状态变化
    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        // 首次身份解析由 initializeApp 统一协调 Supabase 与站点 Session。
        // SDK 的空 INITIAL_SESSION 可能先于站点 Session 返回，不能据此清空
        // 刚加载成功的个人快照。
        if (event === 'INITIAL_SESSION') {
          if (!session?.user && siteSessionUserRef.current) {
            setAuthResolved(true);
          }
          return;
        }

        queueMicrotask(async () => {
          if (!isMounted) {
            return;
          }

          if (event === 'SIGNED_OUT') {
            applySignedOut({ source: 'supabase_auth_change', event });
            if (typeof loadPublicPools === 'function') {
              await loadPublicPools().catch(() => null);
            }
            return;
          }

          if (!session?.user) {
            return;
          }

          const personalDataState = usePersonalDataStore.getState();
          const isSameOwnerSessionEvent = Boolean(
            session?.user?.id
            && personalDataState.ownerId === session.user.id
          );
          let verifiedSession;
          try {
            verifiedSession = isSameOwnerSessionEvent ? session : await getValidatedSupabaseSession();
            if (!verifiedSession?.user) {
              const siteSession = await getCurrentSiteSession({ syncSupabase: false });
              if (!isMounted) return;
              if (siteSession?.authenticated && siteSession.user) {
                siteSessionUserRef.current = siteSession.user;
                await applySiteSession(siteSession, { source: 'supabase_auth_change', isMountedRef });
                return;
              }
            }
          } catch {
            appLogger.warn('[useAppInitialization] 暂时无法验证认证事件，保留当前状态');
            return;
          }

          if (verifiedSession?.user) {
            siteSessionUserRef.current = null;
            await applyAuthenticatedSession(verifiedSession.user, {
              event,
              canLoadPrivateCloudData: true,
              source: 'supabase_auth_change',
              isMountedRef,
            });
            return;
          }

          applySignedOut({ source: 'supabase_auth_change', event: 'SIGNED_OUT' });
          if (typeof loadPublicPools === 'function') {
            await loadPublicPools().catch(() => null);
          }
        });
      });

      return () => {
        isMounted = false;
        unsubscribeAuthStore();
        subscription.unsubscribe();
      };
    }

    return () => {
      isMounted = false;
      unsubscribeAuthStore();
    };
  }, [applyAuthenticatedSession, applySignedOut, applySiteSession, loadPublicPools, setAuthResolved]);

  return {
    updateLastSeen
  };
}

export default useAppInitialization;
