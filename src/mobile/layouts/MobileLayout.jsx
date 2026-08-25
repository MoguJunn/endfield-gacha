import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import MobileHeader from '../components/MobileHeader';
import MobileTabBar from '../components/MobileTabBar';
import { getMobilePathForTab, getMobileTabFromPath } from '../../constants/appRoutes';

import useAuthStore from '../../stores/useAuthStore';
import { NotificationCenter } from '../../components/ui';
import { useDurableNotifications } from '../../hooks';
import { useScrollToHighlight } from '../../hooks/app/useScrollToHighlight';
import { useI18n } from '../../i18n/index.js';
import { useOAuthCallbackNotice } from '../../hooks/auth/useOAuthCallbackNotice.js';
import { useSummerLotterySsoContinuation } from '../../hooks/auth/useSummerLotterySsoContinuation.js';
import PersonalDataBoundary from '../../components/app/PersonalDataBoundary.jsx';
import ContributorDemoBanner from '../../components/dev/ContributorDemoBanner.jsx';

const DeveloperApiDocsPage = lazy(() => import('../../components/docs/DeveloperApiDocsPage'));
const SummerLotteryOperatorPage = lazy(() => import('../../components/admin/SummerLotteryOperatorPage'));
const MobileDrawer = lazy(() => import('../components/MobileDrawer'));
const AuthModal = lazy(() => import('../../AuthModal'));
const MobileHomePageView = lazy(() => import('../views/MobileHomePageView'));
const MobileDashboardView = lazy(() => import('../views/MobileDashboardView'));
const MobileOverviewView = lazy(() => import('../views/MobileOverviewView'));
const MobileStatsView = lazy(() => import('../views/MobileStatsView'));
const MobileSimulatorView = lazy(() => import('../views/MobileSimulatorView'));
const MobileSettingsView = lazy(() => import('../views/MobileSettingsView'));
const MobileAboutView = lazy(() => import('../views/MobileAboutView'));
const MobileAdminView = lazy(() => import('../views/MobileAdminView'));
const MobileTicketView = lazy(() => import('../views/MobileTicketView'));
const MobileAnnouncementsView = lazy(() => import('../views/MobileAnnouncementsView'));
const MobileMechanicsView = lazy(() => import('../views/MobileMechanicsView'));
const MobileRoadmapView = lazy(() => import('../views/MobileRoadmapView'));

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
function MobileLayout({ onOAuthSessionSynced, onRetryPersonalData }) {
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
    <div data-testid="mobile-app-shell" className="flex flex-col h-[100dvh] w-full overflow-hidden bg-ef-light dark:bg-ef-dark text-slate-900 dark:text-white font-sans transition-colors duration-300">
      <MobileHeader onMenuClick={() => setIsDrawerOpen(true)} activeTab={activeTab} />
      <ContributorDemoBanner />

      <main className="flex-1 relative overflow-hidden flex flex-col">
        <Suspense fallback={<MobileRouteFallback label={t('common.loading')} />}>
          <Routes>
            <Route index element={<MobileHomePageView />} />
            <Route path="announcements" element={<MobileAnnouncementsView />} />
            <Route path="mechanics" element={<MobileMechanicsView />} />
            <Route path="roadmap" element={<MobileRoadmapView />} />
            <Route
              path="overview"
              element={(
                <PersonalDataBoundary user={user} onRetry={onRetryPersonalData}>
                  <MobileOverviewView />
                </PersonalDataBoundary>
              )}
            />
            <Route
              path="details"
              element={(
                <PersonalDataBoundary user={user} onRetry={onRetryPersonalData}>
                  <MobileDashboardView />
                </PersonalDataBoundary>
              )}
            />
            <Route
              path="stats"
              element={(
                <PersonalDataBoundary user={user} onRetry={onRetryPersonalData}>
                  <MobileStatsView />
                </PersonalDataBoundary>
              )}
            />
            <Route path="summary" element={<Navigate to={getMobilePathForTab('overview')} replace />} />
            <Route path="dashboard" element={<Navigate to={getMobilePathForTab('details')} replace />} />
            <Route path="simulator" element={<MobileSimulatorView />} />
            <Route path="settings" element={<MobileSettingsView />} />
            <Route path="developer-api" element={<DeveloperApiDocsPage />} />
            <Route path="about" element={<MobileAboutView />} />
            <Route
              path="lottery-contacts"
              element={
                isResolvingRole ? (
                  <MobileRouteFallback label="正在校验兑奖权限..." />
                ) : user ? (
                  <div className="flex-1 overflow-y-auto p-4">
                    <SummerLotteryOperatorPage />
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
        </Suspense>
      </main>

      <MobileTabBar activeTab={activeTab} onSelect={(tab) => navigate(getMobilePathForTab(tab))} />

      {isDrawerOpen && (
        <Suspense fallback={null}>
          <MobileDrawer
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            activeTab={activeTab}
            setActiveTab={(tab) => navigate(getMobilePathForTab(tab))}
          />
        </Suspense>
      )}

      {showAuthModal && (
        <Suspense fallback={null}>
          <AuthModal
            isOpen={showAuthModal}
            onClose={closeAuthModal}
            onAuthSuccess={setUser}
            addDurableNotification={addDurableNotification}
          />
        </Suspense>
      )}

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
