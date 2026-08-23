import React, { useCallback } from 'react';
import MobileLayout from './layouts/MobileLayout';
import ErrorBoundary from '../components/ErrorBoundary';
import AppStartupGate from '../components/app/AppStartupGate.jsx';
import { Toast } from '../components/ui';
import { useCloudSync, useAppInitialization, useAuthenticatedSessionSync, useNotificationBadges } from '../hooks/app';
import { useToast } from '../hooks';
import { ThemeProvider } from '../contexts/ThemeContext';
import { useAuthStore } from '../stores';

/**
 * 移动端应用入口
 * 与桌面端 App.jsx + GachaAnalyzer.jsx 保持一致的初始化逻辑
 */
function MobileApplicationShell() {
  // 初始化 Toast（用于 useCloudSync）
  const { toasts, showToast, removeToast } = useToast();
  const user = useAuthStore((state) => state.user);

  // 云同步 Hook - 统一通过全局协调器刷新个人数据
  const { refreshPersonalData, loadPublicPools } = useCloudSync({ showToast });
  const { applySiteSession } = useAuthenticatedSessionSync({ refreshPersonalData });
  const handleOAuthSessionSynced = useCallback(async (siteSession) => {
    await applySiteSession(siteSession, {
      source: 'oauth_callback',
    });
    return true;
  }, [applySiteSession]);

  // 应用初始化 Hook - 处理会话、加载云端数据到 stores
  useAppInitialization({ refreshPersonalData, loadPublicPools });

  // 通知徽标 Hook - 加载公告与工单等
  useNotificationBadges();
  const retryPersonalData = useCallback(async () => {
    if (!user?.id) {
      return;
    }
    const result = await refreshPersonalData(user, {
      kind: 'explicit',
      reason: 'mobile_retry',
    });
    if (!result?.ok && !result?.stale) {
      showToast(result?.error?.message || '个人数据刷新失败', 'error');
    }
  }, [refreshPersonalData, showToast, user]);

  return (
    <>
      <MobileLayout
        onOAuthSessionSynced={handleOAuthSessionSynced}
        onRetryPersonalData={retryPersonalData}
      />
      <Toast toasts={toasts} onRemove={removeToast} />
    </>
  );
}

function MobileApp() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppStartupGate isMobile>
          <MobileApplicationShell />
        </AppStartupGate>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default MobileApp;
