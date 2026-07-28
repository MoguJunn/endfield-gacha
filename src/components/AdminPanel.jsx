import React, { Suspense, lazy } from 'react';
import { Shield, RefreshCw, ChevronRight, Users, Database, Layers, Star, Bell, Settings, KeyRound, Bot, Globe, Activity, Mail, MessageSquare, AlertTriangle, Gift } from 'lucide-react';
import { useAdminData, useUserDataViewer } from '../hooks/admin';

const CharacterManagement = lazy(() => import('./admin/CharacterManagement'));
const PoolManagement = lazy(() => import('./admin/PoolManagement'));
const UsersPanel = lazy(() => import('./admin/panels/UsersPanel'));
const UserDataPanel = lazy(() => import('./admin/panels/UserDataPanel'));
const AnnouncementsPanel = lazy(() => import('./admin/panels/AnnouncementsPanel'));
const AutomationPanel = lazy(() => import('./admin/panels/AutomationPanel'));
const SiteHealthPanel = lazy(() => import('./admin/panels/SiteHealthPanel'));
const MailStatusPanel = lazy(() => import('./admin/panels/MailStatusPanel'));
const SiteConfigPanel = lazy(() => import('./admin/panels/SiteConfigPanel'));
const AccountRecoveryPanel = lazy(() => import('./admin/panels/AccountRecoveryPanel'));
const DeveloperApiPanel = lazy(() => import('./admin/panels/DeveloperApiPanel'));
const TicketPanel = lazy(() => import('./TicketPanel'));
const HistoryAnomalyReviewPanel = lazy(() => import('./admin/panels/HistoryAnomalyReviewPanel'));
const SummerLotteryContactPanel = lazy(() => import('./admin/panels/SummerLotteryContactPanel'));

// 侧边栏菜单项配置
const MENU_ITEMS = [
  { id: 'siteHealth', label: '站点健康', icon: Activity },
  { id: 'mailStatus', label: '邮件状态', icon: Mail },
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'userData', label: '用户数据', icon: Database },
  { id: 'historyAnomalies', label: '异常日志审阅', icon: AlertTriangle },
  { id: 'summerLotteryContacts', label: '抽奖兑奖联系', icon: Gift },
  { id: 'pools', label: '卡池管理', icon: Layers },
  { id: 'characters', label: '角色管理', icon: Star },
  { id: 'announcements', label: '公告管理', icon: Bell },
  { id: 'automation', label: '运营自动化', icon: Bot },
  { id: 'tickets', label: '工单处理', icon: MessageSquare },
  { id: 'developerApi', label: '开发者 API', icon: Globe },
  { id: 'accountRecovery', label: '账号恢复', icon: KeyRound },
  { id: 'siteConfig', label: '站点配置', icon: Settings },
];

const AdminPanelFallback = () => (
  <div className="flex items-center justify-center py-16">
    <RefreshCw size={20} className="animate-spin text-slate-400 dark:text-zinc-500" />
  </div>
);

const AdminPanel = React.memo(({ user, userRole, showToast, addDurableNotification }) => {
  const [activeMenu, setActiveMenu] = React.useState('siteHealth');

  // 使用拆分后的 hooks
  const adminData = useAdminData(showToast, activeMenu);
  const userDataViewer = useUserDataViewer(showToast);

  const {
    users,
    announcements,
    accountRecoveryRequests,
    loading,
    actionLoading,
    saveUser,
    deleteUser,
    resetUserPassword,
    saveAnnouncement,
    toggleAnnouncementActive,
    deleteAnnouncement,
    updateAccountRecoveryRequest,
    resetRecoveryRequestPassword,
    reloadAdminData,
  } = adminData;

  const {
    selectedUserId,
    userPools,
    userHistory,
    userHistoryMeta,
    userDataLoading,
    expandedPools,
    actionLoading: userDataActionLoading,
    loadUserData,
    togglePoolExpand,
    getUserStats,
    getPoolStats,
    getPoolRecords,
    handleDeleteUserData,
    handleDeletePoolRecords,
    handleDeletePool,
  } = userDataViewer;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={24} className="animate-spin text-slate-400 dark:text-zinc-500" />
      </div>
    );
  }

  // 渲染当前面板内容
  const renderContent = () => {
    switch (activeMenu) {
      case 'siteHealth':
        return <SiteHealthPanel showToast={showToast} onNavigate={setActiveMenu} />;

      case 'mailStatus':
        return <MailStatusPanel showToast={showToast} />;

      case 'users':
        return (
          <UsersPanel
            users={users}
            actionLoading={actionLoading}
            onSaveUser={saveUser}
            onDeleteUser={deleteUser}
            onResetUserPassword={resetUserPassword}
          />
        );

      case 'userData':
        return (
          <UserDataPanel
            users={users}
            selectedUserId={selectedUserId}
            userPools={userPools}
            userHistory={userHistory}
            userHistoryMeta={userHistoryMeta}
            userDataLoading={userDataLoading}
            expandedPools={expandedPools}
            actionLoading={userDataActionLoading}
            onLoadUserData={loadUserData}
            onTogglePoolExpand={togglePoolExpand}
            getUserStats={getUserStats}
            getPoolStats={getPoolStats}
            getPoolRecords={getPoolRecords}
            onDeleteUserData={handleDeleteUserData}
            onDeletePoolRecords={handleDeletePoolRecords}
            onDeletePool={handleDeletePool}
          />
        );

      case 'historyAnomalies':
        return <HistoryAnomalyReviewPanel showToast={showToast} />;

      case 'summerLotteryContacts':
        return (
          <SummerLotteryContactPanel
            showToast={showToast}
            showPermissionManager
          />
        );

      case 'pools':
        return <PoolManagement showToast={showToast} />;

      case 'characters':
        return <CharacterManagement showToast={showToast} />;

      case 'announcements':
        return (
          <AnnouncementsPanel
            announcements={announcements}
            actionLoading={actionLoading}
            onSaveAnnouncement={saveAnnouncement}
            onToggleActive={toggleAnnouncementActive}
            onDeleteAnnouncement={deleteAnnouncement}
          />
        );

      case 'automation':
        return <AutomationPanel showToast={showToast} onNavigate={setActiveMenu} />;

      case 'tickets':
        return (
          <TicketPanel
            user={user}
            userRole={userRole}
            showToast={showToast}
            addDurableNotification={addDurableNotification}
          />
        );

      case 'siteConfig':
        return <SiteConfigPanel showToast={showToast} />;

      case 'developerApi':
        return (
          <DeveloperApiPanel
            showToast={showToast}
            addDurableNotification={addDurableNotification}
          />
        );

      case 'accountRecovery':
        return (
          <AccountRecoveryPanel
            requests={accountRecoveryRequests}
            actionLoading={actionLoading}
            onInspectUser={(request) => {
              if (!request?.matched_user_id) {
                showToast('该申请尚未匹配到站内账号', 'warning');
                return;
              }

              setActiveMenu('userData');
              loadUserData(request.matched_user_id);
            }}
            onRefresh={reloadAdminData}
            onResetPassword={resetRecoveryRequestPassword}
            onUpdateRequest={updateAccountRecoveryRequest}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="animate-fade-in">
      {/* 页面标题 */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 p-6 text-white shadow-lg mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-3">
          <Shield size={28} />
          超级管理员控制台
        </h2>
        <p className="text-red-100 mt-1">查看站点健康、邮件队列、内容更新，并管理用户、公告、角色、卡池与自动化任务</p>
      </div>

      {/* 侧边栏 + 内容布局 */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* 侧边栏 */}
        <div className="w-full md:w-56 shrink-0">
          <nav className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {MENU_ITEMS.map(item => {
              const Icon = item.icon;
              const isActive = activeMenu === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenu(item.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                    isActive
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-l-4 border-red-500'
                      : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800 border-l-4 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} />
                    <span className="font-medium">{item.label}</span>
                  </div>
                  <ChevronRight size={16} className={`transition-transform ${isActive ? 'rotate-90' : ''}`} />
                </button>
              );
            })}
          </nav>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 min-w-0">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6">
            <h3 className="text-lg font-bold text-slate-700 dark:text-zinc-300 mb-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
              {MENU_ITEMS.find(m => m.id === activeMenu)?.label}
            </h3>
            <Suspense fallback={<AdminPanelFallback />}>
              {renderContent()}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
});

export default AdminPanel;
