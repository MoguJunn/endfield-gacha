import React from 'react';
import { Gamepad2, Globe, Home, ListFilter, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getMobilePathForTab, getMobileTabFromPath } from '../../constants/appRoutes';
import { useI18n } from '../../i18n/index.js';
import { preloadRouteOnIntent } from '../../services/appWarmupService.js';

const MOBILE_PRELOAD_ROUTE = {
  overview: 'mobileOverview',
  details: 'mobileDetails',
  stats: 'mobileStats',
  simulator: 'mobileSimulator',
};

function MobileTabBar({ activeTab: controlledActiveTab, onSelect }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = controlledActiveTab || getMobileTabFromPath(location.pathname);
  const { t } = useI18n();
  const tabs = [
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'overview', label: t('nav.overview'), icon: User },
    { id: 'details', label: t('nav.details'), icon: ListFilter },
    { id: 'stats', label: t('nav.stats'), icon: Globe },
    { id: 'simulator', label: t('nav.simulator'), icon: Gamepad2 }
  ];

  return (
    <nav className="mobile-ux-tabbar fixed bottom-0 left-0 right-0 z-40 w-full [padding-bottom:calc(env(safe-area-inset-bottom,0px)+0.45rem)] transition-colors duration-300">
      <div className="mx-auto flex h-16 w-full max-w-screen-sm items-center justify-around px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (typeof onSelect === 'function') {
                  onSelect(tab.id);
                } else {
                  navigate(getMobilePathForTab(tab.id));
                }
              }}
              onPointerDown={() => {
                void preloadRouteOnIntent(MOBILE_PRELOAD_ROUTE[tab.id] || tab.id);
              }}
              onFocus={() => {
                void preloadRouteOnIntent(MOBILE_PRELOAD_ROUTE[tab.id] || tab.id);
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl transition-all duration-300 touch-feedback ${
                isActive
                  ? '-translate-y-1 text-amber-600 dark:text-ef-yellow'
                  : 'text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'
              }`}
            >
              <div className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300 ${
                isActive
                  ? 'bg-amber-500/12 text-amber-600 shadow-[0_0_0_1px_rgba(255,250,0,0.18),0_0_24px_rgba(255,250,0,0.12)] dark:bg-ef-yellow/12 dark:text-ef-yellow'
                  : 'bg-transparent'
              }`}>
                <Icon size={18} className={isActive ? 'stroke-[2.4px]' : 'stroke-[1.9px]'} />
              </div>
              <span className={`max-w-full truncate px-1 text-[9px] font-bold tracking-[0.14em] transition-colors duration-300 ${
                isActive ? 'text-amber-600 dark:text-ef-yellow' : 'text-slate-500 dark:text-zinc-500'
              }`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default MobileTabBar;
