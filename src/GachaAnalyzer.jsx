import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Footer from './components/layout/Footer';
import { LoadingBar, NotificationCenter } from './components/ui';
import { useToast, useConfirm, useCloudSync, useNotificationBadges, useAppInitialization, useAuthenticatedSessionSync, usePoolOperations, useHistoryOperations, usePersonalGameAccounts, useDataExportImport, usePoolRealtimeSubscription, useUserRole, useScrollToHighlight, useDurableNotifications } from './hooks';
import { useAuthStore, useAppStore, usePoolStore, useUIStore } from './stores';
import { getDesktopPathForTab, getDesktopTabFromPath, normalizeAppTab } from './constants/appRoutes';
import AppHeader from './components/layout/AppHeader';
import DesktopAppRoutes from './components/app/DesktopAppRoutes';
import { extractDrawerFromPoolName } from './utils';
import { getPoolGroupType, isPoolGroupId } from './stores/usePoolStore';
import { getPreferredPool } from './utils/poolSelectionUtils';
import { getPoolTypeLabel } from './utils/poolSelectorDisplay.js';
import { STORAGE_KEYS, writeStorageValue } from './utils/storageUtils.js';
import { subscribePublicCacheWarnings } from './services/admin/publicCacheService.js';
import { buildPublicCacheWarningNotification } from './utils/notificationModel.js';
import { useI18n } from './i18n/index.js';
import { useOAuthCallbackNotice } from './hooks/auth/useOAuthCallbackNotice.js';
import {
  getGameAccountSelectionValue,
  isGameAccountSelectionMatch,
} from './utils/gameAccountMetadata.js';
import { useSummerLotterySsoContinuation } from './hooks/auth/useSummerLotterySsoContinuation.js';

const GachaModals = React.lazy(() => import('./components/modals/GachaModals'));
const DataImportWizardModal = React.lazy(() => import('./components/modals/DataImportWizardModal'));

export default function GachaAnalyzer() {
  // --- 从 Zustand Stores 获取状态 ---
  const location = useLocation();
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  // 认证状态
  const user = useAuthStore(state => state.user);
  const userRole = useAuthStore(state => state.userRole);
  const authResolved = useAuthStore(state => state.authResolved);
  const syncing = useAuthStore(state => state.syncing);
  const showAuthModal = useAuthStore(state => state.showAuthModal);
  const openAuthModal = useAuthStore(state => state.openAuthModal);
  const modalType = useUIStore(state => state.modalState.type);
  useSummerLotterySsoContinuation({ user, authResolved, openAuthModal });

  // 应用全局状态
  const globalStatsLoading = useAppStore(state => state.globalStatsLoading);
  // 卡池状态
  const currentPoolId = usePoolStore(state => state.currentPoolId);
  const currentGameUid = usePoolStore(state => state.currentGameUid);
  const pools = usePoolStore(state => state.pools);
  const switchPool = usePoolStore(state => state.switchPool);
  const switchGameAccount = usePoolStore(state => state.switchGameAccount);
  const poolsArray = useMemo(() => (Array.isArray(pools) ? pools : []), [pools]);
  const currentPool = useMemo(() => {
    if (isPoolGroupId(currentPoolId)) {
      const groupType = getPoolGroupType(currentPoolId);
      return {
        id: currentPoolId,
        name: groupType === 'all'
          ? t('dashboard.timeline.title.overview')
          : t('pool.card.allGroupTitle', { label: getPoolTypeLabel(groupType, locale) }),
        type: groupType || 'all',
        isGroupMode: true,
        isAllPoolsOverview: groupType === 'all',
        locked: true,
      };
    }

    return getPreferredPool(poolsArray, {
      preferredPoolId: currentPoolId,
      includeDefaultPool: true,
    });
  }, [currentPoolId, locale, poolsArray, t]);
  const gameAccounts = usePersonalGameAccounts();

  const activeTab = getDesktopTabFromPath(location.pathname);
  const [editItemState, setEditItemState] = useState(null);

  const navigateToTab = useCallback((tab, options) => {
    navigate(getDesktopPathForTab(tab), options);
  }, [navigate]);

  // 本地 UI 状态（仍然使用 useState）

  // UX-006: 通知气泡状态 - 使用 Hook
  const {
    hasNewAnnouncement,
    setHasNewAnnouncement,
    unreadTicketsCount,
    setUnreadTicketsCount,
  } = useNotificationBadges();

  // 0.2 通用弹窗
  const { toasts, showToast, removeToast } = useToast();
  const {
    notifications: durableNotifications,
    unreadCount: durableUnreadCount,
    addNotification: addDurableNotification,
    markRead: markDurableNotificationRead,
    markAllRead: markAllDurableNotificationsRead,
    dismissNotification: dismissDurableNotification,
    clearRead: clearReadDurableNotifications,
  } = useDurableNotifications();
  const { confirmState, handleConfirm, handleCancel } = useConfirm();

  useEffect(() => subscribePublicCacheWarnings((event) => {
    addDurableNotification(buildPublicCacheWarningNotification(event, { locale }));
  }), [addDurableNotification, locale]);

  // 云同步 Hook - 提供所有云端数据操作函数
  const {
    refreshPersonalData,
    loadPublicPools,
    savePoolToCloud,
    saveHistoryToCloud,
    deleteHistoryFromCloud,
    deletePoolHistoryFromCloud,
    deletePoolFromCloud,
    deleteUserDataFromCloud,
    migrateLocalToCloud
  } = useCloudSync({ showToast });

  const { applySiteSession } = useAuthenticatedSessionSync({ refreshPersonalData });
  const handleOAuthSessionSynced = useCallback(async (siteSession) => {
    await applySiteSession(siteSession, {
      source: 'oauth_callback',
    });
    return true;
  }, [applySiteSession]);

  useOAuthCallbackNotice({
    location,
    navigate,
    addDurableNotification,
    onSessionSynced: handleOAuthSessionSynced,
  });

  // 应用初始化 Hook - 处理会话、全局统计、last_seen 更新
  useAppInitialization({ refreshPersonalData, loadPublicPools });
  const retryPersonalData = useCallback(async (retryOptions = {}) => {
    if (!user?.id) {
      return;
    }
    const automaticPhase = retryOptions?.automatic
      ? String(retryOptions.phase || '').trim()
      : '';
    const result = await refreshPersonalData(user, {
      kind: automaticPhase ? `${automaticPhase}-poll` : 'explicit',
      reason: automaticPhase ? `${automaticPhase}_poll` : 'dashboard_retry',
    });
    if (!result?.ok && !result?.stale) {
      showToast(
        result?.error?.message || '个人数据刷新失败',
        'error'
      );
    }
  }, [refreshPersonalData, showToast, user]);

  // 权限判断
  const canEdit = userRole === 'admin' || userRole === 'super_admin';
  const isSuperAdmin = userRole === 'super_admin';
  const isAuthPending = !authResolved || (Boolean(user) && userRole === null);

  // 如果当前选中卡池ID无效，则回退到默认池
  // 使用 ref 和防抖防止快速切换时的竞态条件
  const pendingSwitchRef = useRef(null);
  const lastSwitchTimeRef = useRef(0);

  useEffect(() => {
    // 卡池列表为空时不做任何操作
    if (poolsArray.length === 0) {
      return;
    }

    // 当前选中的卡池存在，无需回退
    const exists = poolsArray.some(p => p.id === currentPoolId);
    // FEAT-018: 池组虚拟ID也视为有效，不回退
    if (exists || (isPoolGroupId(currentPoolId) && currentGameUid)) {
      // 清除任何待处理的切换
      if (pendingSwitchRef.current) {
        clearTimeout(pendingSwitchRef.current);
        pendingSwitchRef.current = null;
      }
      return;
    }

    // currentPoolId 为空或无效，需要回退
    // 但要防止快速连续切换导致的循环
    const now = Date.now();
    const timeSinceLastSwitch = now - lastSwitchTimeRef.current;

    // 如果距离上次自动切换不到 500ms，跳过（防止循环）
    if (timeSinceLastSwitch < 500) {
      return;
    }

    // 清除之前的待处理切换
    if (pendingSwitchRef.current) {
      clearTimeout(pendingSwitchRef.current);
    }

    // 延迟执行回退，给用户操作留出时间
    pendingSwitchRef.current = setTimeout(() => {
      const fallback = getPreferredPool(poolsArray, {
        preferredPoolId: currentPoolId,
        includeDefaultPool: true
      });
      const shouldSwitch = fallback && currentPoolId !== fallback.id;
      if (shouldSwitch) {
        lastSwitchTimeRef.current = Date.now();
        switchPool(fallback.id);
      }
      pendingSwitchRef.current = null;
    }, 100);

    return () => {
      if (pendingSwitchRef.current) {
        clearTimeout(pendingSwitchRef.current);
        pendingSwitchRef.current = null;
      }
    };
  }, [poolsArray, currentGameUid, currentPoolId, switchPool]);

  // 当前卡池是否可编辑（锁定的卡池只有超管能改）
  const canEditCurrentPool = useMemo(() => {
    if (!canEdit) return false;
    if (currentPool?.locked && !isSuperAdmin) return false;
    return true;
  }, [canEdit, currentPool?.locked, isSuperAdmin]);

  // 获取所有已知的抽卡人列表
  const knownDrawers = useMemo(() => {
    const drawers = new Set();
    poolsArray.forEach(pool => {
      const drawer = extractDrawerFromPoolName(pool.name);
      if (drawer) {
        drawers.add(drawer);
      }
    });
    return Array.from(drawers).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [poolsArray]);

  // 组合 cloudSync 函数为对象，供其他 hooks 使用
  const cloudSync = {
    loadPublicPools, refreshPersonalData,
    savePoolToCloud, saveHistoryToCloud,
    deletePoolFromCloud, deletePoolHistoryFromCloud, deleteHistoryFromCloud,
    deleteUserDataFromCloud
  };

  // 卡池操作 Hook
  const {
    confirmCreatePool,
    confirmEditPool,
    confirmDeletePool,
    confirmDeleteData,
    deleteAllUserData
  } = usePoolOperations({ showToast, cloudSync });

  // 历史记录操作 Hook
  const {
    closeModalAndClear,
    handleUpdateItem,
    handleDeleteItem,
    confirmRealDeleteItem,
    handleDeleteGroup,
    confirmRealDeleteGroup
  } = useHistoryOperations({
    showToast,
    cloudSync,
    currentPool,
    clearEditItemState: () => setEditItemState(null)
  });

  // 数据导入导出 Hook
  const {
    pendingImport,
    setPendingImport,
    importWizardOpen,
    openImportWizard,
    closeImportWizard,
    handleExportJSON,
    handleExportCSV,
    handleExportEndfieldGachaUserDataZip,
    handleExportEndfieldGachaHelperJSON,
    handleExportEndfieldGachaHelperCSV,
    handleExportEndfieldGachaHelperUserDataZip,
    handleExportEndgachaKwerTopPlainJSON,
    handleExportEndgachaKwerTopPlainTXT,
    handleImportFile,
    confirmImport
  } = useDataExportImport({ showToast, cloudSync, addDurableNotification });

  // --- Effects ---

  // 兼容旧的 `?tab=` 链接，统一切到真实路由
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const legacyTab = searchParams.get('tab');
    if (!legacyTab) return;

    const targetPath = getDesktopPathForTab(normalizeAppTab(legacyTab));
    if (location.pathname !== targetPath || location.search) {
      navigate(targetPath, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const requestedGameUid = String(searchParams.get('gameUid') || '').trim();
    const requestedPoolId = String(searchParams.get('poolId') || '').trim();

    if (requestedGameUid && requestedGameUid !== currentGameUid) {
      const requestedAccount = gameAccounts.find((account) => isGameAccountSelectionMatch(account, requestedGameUid));
      if (requestedAccount) {
        switchGameAccount(getGameAccountSelectionValue(requestedAccount) || requestedGameUid);
      }
    }

    if (requestedPoolId && requestedPoolId !== currentPoolId) {
      const requestedPoolExists = poolsArray.some((pool) => pool.id === requestedPoolId);
      if (requestedPoolExists) {
        switchPool(requestedPoolId);
      }
    }
  }, [currentGameUid, currentPoolId, gameAccounts, location.search, poolsArray, switchGameAccount, switchPool]);

  useEffect(() => {
    if (activeTab === 'admin' && isAuthPending) {
      return;
    }

    if (activeTab === 'admin' && !isSuperAdmin) {
      navigateToTab('home', { replace: true });
      return;
    }

    if (activeTab === 'home' && location.pathname !== getDesktopPathForTab('home') && !location.search) {
      navigateToTab('home', { replace: true });
    }
  }, [activeTab, isAuthPending, isSuperAdmin, location.pathname, location.search, navigateToTab]);

  // 实时监听卡池变化
  usePoolRealtimeSubscription({ showToast });

  // 获取用户角色
  useUserRole();

  // 导航后滚动到目标元素并高亮
  useScrollToHighlight();

  // 注意：公告加载和未读工单数量已移至 useNotificationBadges hook

  // 登出处理
  const signOut = useAuthStore(state => state.signOut);
  const handleLogout = async () => {
    await signOut();
  };

  // 迁移弹窗状态
  const [showMigrateModal, setShowMigrateModal] = useState(false);
  const shouldMountModalHost = Boolean(
    showAuthModal
    || modalType
    || pendingImport
    || showMigrateModal
    || confirmState.isOpen
    || toasts.length > 0
  );

  // 注意：历史记录和卡池列表不再保存到 localStorage，只存储在服务器端
  // 仅保留 UI 状态（当前选中卡池ID）在 localStorage

  useEffect(() => {
    writeStorageValue(STORAGE_KEYS.CURRENT_POOL_ID, currentPoolId, { raw: true });
  }, [currentPoolId]);

  // --- 组件 ---

  return (
    <div data-testid="desktop-app-shell" className="min-h-screen bg-slate-50 dark:bg-zinc-950 text-slate-800 dark:text-zinc-100 font-sans pb-20 md:pb-10 relative">
      {/* 全局加载进度条 */}
      <LoadingBar isLoading={syncing || globalStatsLoading} />

      {/* 顶部导航 */}
      <AppHeader
        user={user}
        userRole={userRole}
        activeTab={activeTab}
        hasNewAnnouncement={hasNewAnnouncement}
        setHasNewAnnouncement={setHasNewAnnouncement}
        unreadTicketsCount={unreadTicketsCount}
        setUnreadTicketsCount={setUnreadTicketsCount}
        setActiveTab={navigateToTab}
        openAuthModal={openAuthModal}
        handleLogout={handleLogout}
      />

      <main className="w-full max-w-[1440px] mx-auto px-4 py-8">
        <DesktopAppRoutes
          user={user}
          userRole={userRole}
          authResolved={authResolved}
          showToast={showToast}
          onRetryPersonalData={retryPersonalData}
          isSuperAdmin={isSuperAdmin}
          currentPool={currentPool}
          canEdit={canEdit}
          canEditCurrentPool={canEditCurrentPool}
          deleteAllUserData={deleteAllUserData}
          editItemState={editItemState}
          setEditItemState={setEditItemState}
          handleUpdateItem={handleUpdateItem}
          handleDeleteItem={handleDeleteItem}
          handleDeleteGroup={handleDeleteGroup}
          openImportWizard={openImportWizard}
          handleExportJSON={handleExportJSON}
          handleExportCSV={handleExportCSV}
          handleExportEndfieldGachaUserDataZip={handleExportEndfieldGachaUserDataZip}
          handleExportEndfieldGachaHelperJSON={handleExportEndfieldGachaHelperJSON}
          handleExportEndfieldGachaHelperCSV={handleExportEndfieldGachaHelperCSV}
          handleExportEndfieldGachaHelperUserDataZip={handleExportEndfieldGachaHelperUserDataZip}
          handleExportEndgachaKwerTopPlainJSON={handleExportEndgachaKwerTopPlainJSON}
          handleExportEndgachaKwerTopPlainTXT={handleExportEndgachaKwerTopPlainTXT}
          addDurableNotification={addDurableNotification}
        />
      </main>

      {/* 全局页脚 */}
      <Footer />

      {/* --- 全局弹窗 --- */}
      {importWizardOpen && (
        <React.Suspense fallback={null}>
          <DataImportWizardModal
            isOpen={importWizardOpen}
            onClose={closeImportWizard}
            onImportFile={handleImportFile}
          />
        </React.Suspense>
      )}

      {shouldMountModalHost && (
        <React.Suspense fallback={null}>
          <GachaModals
            knownDrawers={knownDrawers}
            showToast={showToast}
            toasts={toasts}
            removeToast={removeToast}
            confirmState={confirmState}
            handleConfirm={handleConfirm}
            handleCancel={handleCancel}
            closeModalAndClear={closeModalAndClear}
            confirmCreatePool={confirmCreatePool}
            confirmEditPool={confirmEditPool}
            confirmDeletePool={confirmDeletePool}
            confirmDeleteData={confirmDeleteData}
            confirmRealDeleteItem={confirmRealDeleteItem}
            confirmRealDeleteGroup={confirmRealDeleteGroup}
            pendingImport={pendingImport}
            setPendingImport={setPendingImport}
            confirmImport={confirmImport}
            addDurableNotification={addDurableNotification}
            showMigrateModal={showMigrateModal}
            setShowMigrateModal={setShowMigrateModal}
            migrateLocalToCloud={migrateLocalToCloud}
            canEdit={canEdit}
          />
        </React.Suspense>
      )}

      <NotificationCenter
        notifications={durableNotifications}
        unreadCount={durableUnreadCount}
        onMarkRead={markDurableNotificationRead}
        onMarkAllRead={markAllDurableNotificationsRead}
        onDismiss={dismissDurableNotification}
        onClearRead={clearReadDurableNotifications}
      />

      <style>{`
        /* 组件特有样式 - 通用动画已移至 index.css */
        .shine-effect-rainbow {
          background-image: linear-gradient(
            120deg,
            rgba(255,255,255,0) 30%,
            rgba(255, 215, 0, 0.5) 40%,
            rgba(255, 0, 128, 0.5) 50%,
            rgba(0, 255, 255, 0.5) 60%,
            rgba(255,255,255,0) 70%
          );
          background-size: 200% 100%;
          animation: shine 3s infinite linear;
        }

        .glow-border {
           box-shadow: 0 0 8px rgba(255, 165, 0, 0.6);
        }
      `}</style>
    </div>
  );
}
