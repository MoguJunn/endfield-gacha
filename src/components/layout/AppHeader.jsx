import React from 'react';
import { BarChart3, LogIn, LogOut, Settings, Info, CloudOff, MessageSquare, Activity } from 'lucide-react';
import { NotificationBadge } from '../ui';
import HeaderPoolTimeInfo from './HeaderPoolTimeInfo';
import { isSupabaseConfigured } from '../../supabaseClient';
import { isContributorDemoModeEnabled } from '../../dev/contributorDemoMode.js';
import { buildUsernameHandle } from '../../utils/usernameValidation.js';
import { STORAGE_KEYS, markAsViewed } from '../../utils';
import LocaleSwitcher from '../common/LocaleSwitcher.jsx';
import { useI18n } from '../../i18n/index.js';
import { useHorizontalWheelScroll } from '../../hooks/useHorizontalWheelScroll.js';

const SITE_STATUS_PAGE_URL = 'https://endfield-status-page.vercel.app/';

const NavTab = ({ id, label, showDot, onClick, className = '', activeTab, setActiveTab }) => {
  const isActive = activeTab === id;
  const fallbackClick = typeof setActiveTab === 'function'
    ? () => setActiveTab(id)
    : undefined;

  return (
    <NotificationBadge showDot={showDot} className="h-full flex shrink-0">
      <button
        onClick={onClick || fallbackClick}
        className={`h-full px-4 sm:px-5 flex items-center text-xs sm:text-sm font-bold uppercase tracking-wider whitespace-nowrap transition-all duration-300 relative group ${
          isActive 
            ? 'text-amber-600 dark:text-endfield-yellow' 
            : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-50 dark:hover:bg-white/5'
        } ${className}`}
      >
        {label}
        {isActive && (
           <>
             <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-amber-500 dark:bg-endfield-yellow shadow-[0_0_8px_rgba(255,204,0,0.6)]"></div>
             <div className="absolute inset-0 bg-gradient-to-t from-amber-500/10 dark:from-endfield-yellow/10 to-transparent pointer-events-none"></div>
           </>
        )}
      </button>
    </NotificationBadge>
  );
};

/**
 * 应用顶部导航栏组件
 */
export default function AppHeader({
  // 状态
  user,
  userRole,
  activeTab,
  // 通知
  hasNewAnnouncement,
  setHasNewAnnouncement,
  unreadTicketsCount,
  setUnreadTicketsCount,
  // 操作
  setActiveTab,
  openAuthModal,
  handleLogout
}) {
  const isSuperAdmin = userRole === 'super_admin';
  const { t } = useI18n();
  const navScrollRef = useHorizontalWheelScroll();
  const handleTabChange = (tab) => {
    if (typeof setActiveTab === 'function') {
      setActiveTab(tab);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-40 shadow-sm transition-colors duration-300">
      {/* 背景装饰网格 */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none"></div>

      <div className="w-full max-w-[1600px] mx-auto h-14 sm:h-16 flex items-center justify-between relative z-10 px-3 sm:px-4">

        {/* 左侧：Logo + 标题 */}
        <div className="flex items-center h-full shrink-0">
          <div className="flex items-center gap-3 pr-4 sm:pr-6 relative h-full">
            <div 
              className="w-8 h-8 sm:w-9 sm:h-9 bg-endfield-yellow flex items-center justify-center rounded-sm shadow-sm dark:shadow-[0_0_12px_rgba(255,204,0,0.3)] shrink-0 cursor-pointer hover:scale-105 transition-transform" 
              onClick={() => handleTabChange('home')}
            >
              <BarChart3 className="text-black w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} />
            </div>
            <div className="hidden lg:flex flex-col justify-center h-full mt-0.5">
              <h1 className="text-base sm:text-lg font-black tracking-tighter text-slate-900 dark:text-white leading-none whitespace-nowrap">
                ENDFIELD <span className="text-amber-500 dark:text-endfield-yellow">GACHA</span>
              </h1>
              <div className="flex items-center gap-1.5 mt-1">
                 <div className="w-1 h-1 bg-amber-500 dark:bg-endfield-yellow rounded-full"></div>
                 <span className="text-[9px] sm:text-[10px] text-slate-400 dark:text-zinc-500 font-mono tracking-[0.25em] uppercase block whitespace-nowrap leading-none">{t('app.systemLabel')}</span>
              </div>
            </div>
            {/* Decorative slant line */}
            <div className="hidden lg:block absolute right-0 top-1/4 bottom-1/4 w-px bg-zinc-200 dark:bg-zinc-800 rotate-12"></div>
          </div>

          <div className="hidden md:flex items-center h-full pl-2 sm:pl-4">
            <HeaderPoolTimeInfo />
          </div>
        </div>

        {/* 中间：主导航 (全高Tab设计) */}
        <div
          ref={navScrollRef}
          className="flex-1 min-w-0 flex items-center h-full overflow-x-auto scrollbar-hide ml-2 sm:ml-4 mask-linear-fade"
        >
          <NavTab 
            id="home" 
            label={t('nav.home')} 
            showDot={hasNewAnnouncement}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
              onClick={() => {
              handleTabChange('home');
              if (hasNewAnnouncement) {
                markAsViewed(STORAGE_KEYS.ANNOUNCEMENT_LAST_VIEWED);
                setHasNewAnnouncement(false);
              }
            }}
          />
          <NavTab id="summary" label={t('nav.summary')} activeTab={activeTab} setActiveTab={setActiveTab} />
          <NavTab id="dashboard" label={t('nav.dashboard')} activeTab={activeTab} setActiveTab={setActiveTab} />
          <NavTab id="simulator" label={t('nav.simulator')} activeTab={activeTab} setActiveTab={setActiveTab} />
          
          {isSuperAdmin && (
            <NavTab 
              id="admin" 
              label={t('nav.admin')} 
              className="!text-red-600 dark:!text-red-500" 
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onClick={() => {
                handleTabChange('admin');
                markAsViewed(STORAGE_KEYS.ADMIN_LAST_VIEWED);
              }}
            />
          )}
          
          <div className="w-4 shrink-0"></div> {/* Scroll padding */}
        </div>

        {/* 右侧：操作区 */}
        <div className="flex items-center gap-1 sm:gap-3 shrink-0 h-full relative">
          {/* Decorative slant line */}
          <div className="hidden sm:block absolute left-0 top-1/4 bottom-1/4 w-px bg-zinc-200 dark:bg-zinc-800 -rotate-12"></div>

          <div className="flex items-center h-full pl-1 sm:pl-4 gap-1 sm:gap-1.5">
             <LocaleSwitcher compact className="hidden xl:flex items-center shrink-0 mr-1 sm:mr-2" />
             
             {user && (
              <NotificationBadge count={unreadTicketsCount}>
                <button
                  onClick={() => {
                    handleTabChange('tickets');
                    markAsViewed(STORAGE_KEYS.TICKETS_LAST_VIEWED);
                    setUnreadTicketsCount(0);
                  }}
                  className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-sm transition-all duration-200 ${
                    activeTab === 'tickets'
                      ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30'
                      : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 border border-transparent'
                  }`}
                  title={t('nav.tickets')}
                >
                  <MessageSquare size={16} />
                </button>
              </NotificationBadge>
             )}

             <button
                onClick={() => handleTabChange('settings')}
                className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-sm transition-all duration-200 ${
                  activeTab === 'settings'
                    ? 'bg-amber-50 dark:bg-endfield-yellow/10 text-amber-600 dark:text-endfield-yellow border border-amber-200 dark:border-endfield-yellow/30 shadow-[0_0_10px_rgba(255,204,0,0.1)]'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 border border-transparent'
                }`}
                title={t('nav.settings')}
              >
                <Settings size={16} />
              </button>
              
              <button
                onClick={() => handleTabChange('about')}
                className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-sm transition-all duration-200 ${
                  activeTab === 'about'
                    ? 'bg-zinc-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 border border-transparent'
                }`}
                title={t('nav.about')}
              >
                <Info size={16} />
              </button>

              <a
                href={SITE_STATUS_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-sm transition-all duration-200 text-slate-500 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 border border-transparent"
                title={t('nav.siteStatus')}
              >
                <Activity size={16} />
              </a>
          </div>

          {/* 登录/用户区域 */}
          <div className="flex items-center h-full pl-2 sm:pl-3 ml-1 sm:ml-2 border-l border-zinc-200 dark:border-zinc-800/50">
            {(isSupabaseConfigured() || isContributorDemoModeEnabled()) ? (
              user ? (
                <div className="flex items-center gap-2 sm:gap-3 group">
                  <div className="hidden lg:flex flex-col items-end justify-center">
                    <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 max-w-[110px] truncate leading-tight">
                      {buildUsernameHandle(user, user.email?.split('@')[0])}
                    </span>
                    <span className="text-[9px] text-amber-600 dark:text-endfield-yellow uppercase tracking-[0.15em] font-mono leading-tight mt-0.5">
                      {userRole === 'super_admin' ? 'SUPER-ENDMIN' : userRole === 'admin' ? 'ENDMIN' : 'GUEST'}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-sm text-slate-400 dark:text-zinc-500 hover:text-white hover:bg-red-500 transition-all border border-transparent hover:border-red-600 hover:shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                    title={t('nav.logout')}
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="hidden lg:flex flex-col items-end justify-center">
                    <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 leading-tight">{t('nav.guest')}</span>
                    <span className="text-[9px] text-slate-400 dark:text-zinc-500 uppercase tracking-[0.15em] font-mono leading-tight mt-0.5">
                      GUEST
                    </span>
                  </div>
                  <button
                    onClick={openAuthModal}
                    className="flex items-center gap-1.5 px-3 sm:px-5 h-8 sm:h-9 bg-slate-900 dark:bg-endfield-yellow hover:bg-black dark:hover:bg-yellow-400 text-white dark:text-black text-xs font-bold uppercase tracking-wider rounded-sm transition-all shadow-sm dark:shadow-[0_0_15px_rgba(255,204,0,0.2)] whitespace-nowrap"
                  >
                    <LogIn size={14} />
                    <span className="hidden sm:inline">{t('nav.login')}</span>
                  </button>
                </div>
              )
            ) : (
              <div className="px-3 h-8 sm:h-9 flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/80 rounded-sm border border-zinc-200 dark:border-zinc-700 border-dashed">
                 <CloudOff size={14} className="text-zinc-500" />
                 <span className="text-[10px] font-bold tracking-widest text-zinc-500 font-mono uppercase whitespace-nowrap hidden sm:inline">LOCAL</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
