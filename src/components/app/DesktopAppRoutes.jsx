import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useI18n } from '../../i18n/index.js';
import PersonalDataBoundary from './PersonalDataBoundary.jsx';

const HomePage = lazy(() => import('../home/HomePage'));
const DesktopHomeDemo = import.meta.env.DEV ? lazy(() => import('../home/DesktopHomeDemo.jsx')) : null;
const DesktopPageMotion = import.meta.env.DEV ? lazy(() => import('./DesktopPageMotion.jsx')) : null;
const DesktopPersonalWorkspace = import.meta.env.DEV ? lazy(() => import('./DesktopPersonalWorkspace.jsx')) : null;
const DesktopDashboardWorkspace = lazy(() => import('./DesktopDashboardWorkspace'));
const GachaSimulator = lazy(() => import('../../features/simulator/GachaSimulator'));
const SummaryView = lazy(() => import('../SummaryView'));
const AdminPanel = lazy(() => import('../AdminPanel'));
const SummerLotteryOperatorPage = lazy(() => import('../admin/SummerLotteryOperatorPage'));
const SettingsPanel = lazy(() => import('../SettingsPanel'));
const DeveloperApiDocsPage = lazy(() => import('../docs/DeveloperApiDocsPage'));
const AboutPanel = lazy(() => import('../AboutPanel'));
const TicketPanel = lazy(() => import('../TicketPanel'));

function TabPanelFallback({ label = '正在加载模块...' }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-none p-10 text-center animate-fade-in">
      <div className="inline-flex items-center gap-3 text-sm font-medium text-slate-500 dark:text-zinc-400">
        <div className="w-4 h-4 border-2 border-slate-300 dark:border-zinc-600 border-t-transparent rounded-full animate-spin"></div>
        <span>{label}</span>
      </div>
    </div>
  );
}

function RouteContent({ fallback, children }) {
  const location = useLocation();
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get('home-demo') === 'unified';
  return (
    <Suspense fallback={fallback}>
      {preview ? <DesktopPageMotion>{children}</DesktopPageMotion> : children}
    </Suspense>
  );
}

function PersonalWorkspace({ preview, children, ...props }) {
  return preview ? <DesktopPersonalWorkspace {...props}>{children}</DesktopPersonalWorkspace> : children;
}

export default function DesktopAppRoutes({
  desktopNotifications,
  desktopUnreadCount,
  onOpenMessages,
  user,
  userRole,
  authResolved,
  showToast,
  onRetryPersonalData,
  isSuperAdmin,
  currentPool,
  canEdit,
  canEditCurrentPool,
  deleteAllUserData,
  editItemState,
  setEditItemState,
  handleUpdateItem,
  handleDeleteItem,
  handleDeleteGroup,
  openImportWizard,
  handleExportJSON,
  handleExportCSV,
  handleExportEndfieldGachaUserDataZip,
  handleExportEndfieldGachaHelperJSON,
  handleExportEndfieldGachaHelperCSV,
  handleExportEndfieldGachaHelperUserDataZip,
  handleExportEndgachaKwerTopPlainJSON,
  handleExportEndgachaKwerTopPlainTXT,
  addDurableNotification
}) {
  const location = useLocation();
  const previewHome = import.meta.env.DEV && new URLSearchParams(location.search).get('home-demo') === 'unified';
  const { isEnglish } = useI18n();
  const tt = (zh, en) => (isEnglish ? en : zh);
  const isResolvingRole = !authResolved || (Boolean(user) && userRole === null);

  return (
    <Routes>
      <Route
        index
        element={
          <RouteContent fallback={<TabPanelFallback label={tt('正在加载首页...', 'Loading home...')} />}>
            {previewHome ? <DesktopHomeDemo notifications={desktopNotifications} unreadCount={desktopUnreadCount} onOpenMessages={onOpenMessages} /> : <HomePage />}
          </RouteContent>
        }
      />
      <Route
        path="summary"
        element={
          <RouteContent fallback={<TabPanelFallback label={tt('正在加载统计...', 'Loading summary...')} />}>
            {previewHome ? <SummaryView lockedDataSource="global" /> : <PersonalDataBoundary user={user} onRetry={onRetryPersonalData}>
              <SummaryView />
            </PersonalDataBoundary>}
          </RouteContent>
        }
      />
      <Route
        path="dashboard"
        element={
          <RouteContent fallback={<TabPanelFallback label={tt('正在加载卡池工作台...', 'Loading gacha workspace...')} />}>
            <PersonalWorkspace preview={previewHome} user={user} onRetryPersonalData={onRetryPersonalData}>
            <DesktopDashboardWorkspace
              user={user}
              showToast={showToast}
              onRetryPersonalData={onRetryPersonalData}
              canEdit={canEdit}
              canEditCurrentPool={canEditCurrentPool}
              currentPool={currentPool}
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
            />
            </PersonalWorkspace>
          </RouteContent>
        }
      />
      <Route
        path="simulator"
        element={
          <RouteContent fallback={<TabPanelFallback label={tt('正在加载模拟器...', 'Loading simulator...')} />}>
            <GachaSimulator />
          </RouteContent>
        }
      />
      <Route
        path="settings"
        element={
          <RouteContent fallback={<TabPanelFallback label={tt('正在加载设置...', 'Loading settings...')} />}>
            <SettingsPanel onDeleteAllData={deleteAllUserData} />
          </RouteContent>
        }
      />
      <Route
        path="developer-api"
        element={
          <RouteContent fallback={<TabPanelFallback label={tt('正在加载 API 文档...', 'Loading API docs...')} />}>
            <DeveloperApiDocsPage />
          </RouteContent>
        }
      />
      <Route
        path="about"
        element={
          <RouteContent fallback={<TabPanelFallback label={tt('正在加载关于页...', 'Loading about...')} />}>
            <AboutPanel />
          </RouteContent>
        }
      />
      <Route
        path="tickets"
        element={
          <RouteContent fallback={<TabPanelFallback label={tt('正在加载工单...', 'Loading tickets...')} />}>
            <TicketPanel
              user={user}
              userRole={userRole}
              showToast={showToast}
              addDurableNotification={addDurableNotification}
            />
          </RouteContent>
        }
      />
      <Route
        path="lottery-contacts"
        element={
          isResolvingRole ? (
            <TabPanelFallback label={tt('正在校验兑奖权限...', 'Checking lottery access...')} />
          ) : user ? (
            <RouteContent fallback={<TabPanelFallback label={tt('正在加载兑奖工作台...', 'Loading lottery workspace...')} />}>
              <SummerLotteryOperatorPage showToast={showToast} />
            </RouteContent>
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="admin"
        element={
          isResolvingRole ? (
            <TabPanelFallback label={tt('正在校验管理权限...', 'Checking admin access...')} />
          ) : isSuperAdmin ? (
            <RouteContent fallback={<TabPanelFallback label={tt('正在加载管理后台...', 'Loading admin panel...')} />}>
              <AdminPanel
                user={user}
                userRole={userRole}
                showToast={showToast}
                addDurableNotification={addDurableNotification}
              />
            </RouteContent>
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
