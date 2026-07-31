import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import MobileHeader from '../components/MobileHeader';
import MobileTabBar from '../components/MobileTabBar';
import MobileDrawer from '../components/MobileDrawer';
import AuthModal from '../../AuthModal';
import { getMobilePathForTab, getMobileTabFromPath } from '../../constants/appRoutes';

// 移动端视图
import MobileHomePageView from '../views/MobileHomePageView';
import MobileDashboardView from '../views/MobileDashboardView';
import MobileOverviewView from '../views/MobileOverviewView';
import MobileStatsView from '../views/MobileStatsView';
import MobileSimulatorView from '../views/MobileSimulatorView';
import MobileSettingsView from '../views/MobileSettingsView';
import MobileAboutView from '../views/MobileAboutView';
import MobileAdminView from '../views/MobileAdminView';
import MobileTicketView from '../views/MobileTicketView';
import MobileAnnouncementsView from '../views/MobileAnnouncementsView';
import MobileMechanicsView from '../views/MobileMechanicsView';
import MobileRoadmapView from '../views/MobileRoadmapView';
import useAuthStore from '../../stores/useAuthStore';
import { NotificationCenter } from '../../components/ui';
import { useDurableNotifications } from '../../hooks';
import { useScrollToHighlight } from '../../hooks/app/useScrollToHighlight';
import { useI18n } from '../../i18n/index.js';
import { useOAuthCallbackNotice } from '../../hooks/auth/useOAuthCallbackNotice.js';
import { useSummerLotterySsoContinuation } from '../../hooks/auth/useSummerLotterySsoContinuation.js';

const DeveloperApiDocsPage = lazy(() => import('../../components/docs/DeveloperApiDocsPage'));
const SummerLotteryOperatorPage = lazy(() => import('../../components/admin/SummerLotteryOperatorPage'));

function MobileRouteFallback({ label }) {
  return (
    <div className="p-6 text-sm text-zinc-400">
      {label}
    </div>
  );
}

/**
 * 移动端主布局 (重构版)
 */
function MobileLayout({ onOAuthSessionSynced }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, userRole, authResolved, showAuthModal, openAuthModal, closeAuthModal, setUser } = useAuthStore();
  useSummerLotterySsoContinuation({ user, authResolved, openAuthModal });
  const { t } = useI18n();
  const activeTab = getMobileTabFromPath(location.pathname);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const isSuperAdmin = userRole === 'super_admin';
  const isResolvingRole = !authResolved || (Boolean(user) && userRole === null);
  const isHomeSubpage = /^\/m\/(announcements|mechanics|roadmap)$/u.test(location.pathname);
  const {
    notifications: durableNotifications,
    unreadCount: durableUnreadCount,
    addNotification: addDurableNotification,
    markRead: markDurableNotificationRead,
    markAllRead: markAllDurableNotificationsRead,
    dismissNotification: dismissDurableNotification,
    clearRead: clearReadDurableNotifications,
  } = useDurableNotifications();
  useScrollToHighlight();
  useOAuthCallbackNotice({
    location,
    navigate,
    addDurableNotification,
    onSessionSynced: onOAuthSessionSynced,
  });

  useEffect(() => {
    if (activeTab === 'home' && !isHomeSubpage && location.pathname !== getMobilePathForTab('home')) {
      navigate(getMobilePathForTab('home'), { replace: true });
    }
  }, [activeTab, isHomeSubpage, location.pathname, navigate]);

  return (
    <div className="flex flex-col h-[100dvh] w-full overflow-hidden bg-ef-light dark:bg-ef-dark text-slate-900 dark:text-white font-sans transition-colors duration-300">
      <MobileHeader onMenuClick={() => setIsDrawerOpen(true)} activeTab={activeTab} />

      <main className="flex-1 relative overflow-hidden flex flex-col">
        <Routes>
          <Route index element={<MobileHomePageView />} />
          <Route path="announcements" element={<MobileAnnouncementsView />} />
          <Route path="mechanics" element={<MobileMechanicsView />} />
          <Route path="roadmap" element={<MobileRoadmapView />} />
          <Route path="overview" element={<MobileOverviewView />} />
          <Route path="details" element={<MobileDashboardView />} />
          <Route path="stats" element={<MobileStatsView />} />
          <Route path="summary" element={<Navigate to={getMobilePathForTab('overview')} replace />} />
          <Route path="dashboard" element={<Navigate to={getMobilePathForTab('details')} replace />} />
          <Route path="simulator" element={<MobileSimulatorView />} />
          <Route path="settings" element={<MobileSettingsView />} />
          <Route
            path="developer-api"
            element={
              <Suspense fallback={<MobileRouteFallback label={t('common.loading')} />}>
                <DeveloperApiDocsPage />
              </Suspense>
            }
          />
          <Route path="about" element={<MobileAboutView />} />
          <Route
            path="lottery-contacts"
            element={
              isResolvingRole ? (
                <MobileRouteFallback label="正在校验兑奖权限..." />
              ) : user ? (
                <div className="flex-1 overflow-y-auto p-4">
                  <Suspense fallback={<MobileRouteFallback label="正在加载兑奖工作台..." />}>
                    <SummerLotteryOperatorPage />
                  </Suspense>
                </div>
              ) : (
                <Navigate to={getMobilePathForTab('home')} replace />
              )
            }
          />
          <Route
            path="admin"
            element={
              isResolvingRole ? (
                <div className="p-6 text-sm text-zinc-400">
                  {t('admin.checkingAccess')}
                </div>
              ) : isSuperAdmin ? (
                <MobileAdminView />
              ) : (
                <Navigate to={getMobilePathForTab('home')} replace />
              )
            }
          />
          <Route path="tickets" element={<MobileTicketView addDurableNotification={addDurableNotification} />} />
          <Route path="*" element={<Navigate to={getMobilePathForTab('home')} replace />} />
        </Routes>
      </main>

      <MobileTabBar activeTab={activeTab} setActiveTab={(tab) => navigate(getMobilePathForTab(tab))} />

      <MobileDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        activeTab={activeTab}
        setActiveTab={(tab) => navigate(getMobilePathForTab(tab))}
      />

      <AuthModal
        isOpen={showAuthModal}
        onClose={closeAuthModal}
        onAuthSuccess={setUser}
        addDurableNotification={addDurableNotification}
      />

      <NotificationCenter
        notifications={durableNotifications}
        unreadCount={durableUnreadCount}
        onMarkRead={markDurableNotificationRead}
        onMarkAllRead={markAllDurableNotificationsRead}
        onDismiss={dismissDurableNotification}
        onClearRead={clearReadDurableNotifications}
      />
    </div>
  );
}

export default MobileLayout;
