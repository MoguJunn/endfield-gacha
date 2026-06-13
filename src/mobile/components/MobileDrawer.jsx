import React, { useEffect, useMemo, useRef } from 'react';
import { Home, User, ListFilter, Globe, Gamepad2, MessageSquare, Settings, Info, Shield, LogOut, ChevronDown, X, LogIn } from 'lucide-react';
import PlatformSwitcher from '../../components/common/PlatformSwitcher.jsx';
import useAuthStore from '../../stores/useAuthStore';
import usePoolStore from '../../stores/usePoolStore';
import useHistoryStore from '../../stores/useHistoryStore';
import { useI18n } from '../../i18n/index.js';
import { buildUsernameHandle, getPreferredUsername } from '../../utils/usernameValidation.js';
import {
  isGameAccountSelectionMatch,
  localizeGameAccountServerTag,
} from '../../utils/gameAccountMetadata.js';

// eslint-disable-next-line no-unused-vars
function DrawerNavButton({ icon: Icon, label, active = false, tone = 'default', onClick, trailing = null }) {
  const toneClass = tone === 'danger'
    ? 'text-rose-600 dark:text-red-400 hover:bg-rose-50 dark:hover:bg-red-500/10'
    : active
      ? 'text-amber-600 dark:text-ef-yellow bg-amber-500/10 dark:bg-amber-400 dark:bg-ef-yellow/10'
      : 'text-slate-600 dark:text-zinc-400 hover:bg-zinc-100 dark:bg-zinc-900 hover:text-slate-900 dark:text-white';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`touch-feedback mx-3 my-1 px-4 py-3 rounded-lg flex w-[calc(100%-1.5rem)] items-center justify-between text-sm font-medium transition-colors ${toneClass}`}
    >
      <span className="flex items-center gap-4">
        <Icon size={18} className="shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      {trailing}
    </button>
  );
}

function MobileDrawer({ isOpen, onClose, activeTab, setActiveTab }) {
  const { user, signOut, userRole, openAuthModal } = useAuthStore();
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const getGameAccountsFromHistory = useHistoryStore((state) => state.getGameAccountsFromHistory);
  const { t, locale } = useI18n();
  const drawerRef = useRef(null);
  const isSuperAdmin = userRole === 'super_admin';
  
  const accounts = getGameAccountsFromHistory();
  const currentAccount = useMemo(() => {
    if (currentGameUid) {
      return accounts.find((account) => isGameAccountSelectionMatch(account, currentGameUid)) || null;
    }
    return accounts[0] || null;
  }, [accounts, currentGameUid]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (isOpen && drawerRef.current && !drawerRef.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const jumpTo = (tab) => {
    setActiveTab(tab);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm transition-opacity animate-overlay-fade-in" onClick={onClose} />
      
      <aside
        ref={drawerRef}
        className="relative w-[85%] max-w-[320px] h-full bg-ef-light dark:bg-ef-dark border-r border-zinc-200 dark:border-zinc-800 flex flex-col animate-slide-in-left shadow-2xl safe-area-top safe-area-bottom"
      >
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800/50 bg-gradient-to-b from-zinc-100 dark:from-zinc-900 to-transparent shrink-0">
          <div className="flex items-center justify-between mb-6">
            <div className="font-mono font-bold tracking-[0.2em] text-amber-600 dark:text-ef-yellow">G.ANALYZER</div>
            <button onClick={onClose} className="p-2 text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:text-white transition-colors touch-feedback">
              <X size={20} />
            </button>
          </div>
          
          <div className="bg-white/80 dark:bg-zinc-900/70 backdrop-blur-xl border border-zinc-200 dark:border-white/5 shadow-sm p-3 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 text-slate-900 flex items-center justify-center font-bold text-lg border-2 border-amber-500 dark:border-ef-yellow shadow-sm dark:shadow-[0_0_10px_rgba(255,250,0,0.3)] shrink-0">
                {user?.user_metadata?.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} alt={t('common.avatar')} className="h-full w-full rounded-full object-cover" />
                ) : (
                  (getPreferredUsername(user) || user?.email || '?')[0].toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-slate-900 dark:text-white truncate flex items-center flex-wrap gap-1">
                  <span className="truncate max-w-[140px]">
                    {currentAccount?.nickName || (user ? buildUsernameHandle(user, t('nav.guest')) : t('nav.guest'))}
                  </span>
                  {currentAccount?.serverTag && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-500/50 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded ml-1 shrink-0">{localizeGameAccountServerTag(currentAccount.serverTag, locale)}</span>}
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-500 font-mono mt-0.5 truncate">
                  {currentAccount?.gameUid ? `UID: ${currentAccount.gameUid}` : (user?.email || t('header.guestMode'))}
                </div>
              </div>
            </div>
            {!user ? (
               <button
                 onClick={() => {
                   onClose();
                   openAuthModal();
                 }}
                 className="p-1.5 ml-2 rounded-full bg-amber-100 dark:bg-ef-yellow/20 text-amber-600 dark:text-ef-yellow touch-feedback shrink-0"
               >
                 <LogIn size={16} />
               </button>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 scroll-smooth">
          <div className="px-6 py-2 text-[10px] font-bold tracking-widest text-slate-400 dark:text-zinc-600 mt-2 uppercase">{t('drawer.section.main')}</div>
          
          <DrawerNavButton icon={Home} label={t('nav.home')} active={activeTab === 'home'} onClick={() => jumpTo('home')} />
          <DrawerNavButton icon={User} label={t('nav.overview')} active={activeTab === 'overview'} onClick={() => jumpTo('overview')} />
          <DrawerNavButton icon={ListFilter} label={t('nav.details')} active={activeTab === 'details'} onClick={() => jumpTo('details')} />
          <DrawerNavButton icon={Globe} label={t('nav.stats')} active={activeTab === 'stats'} onClick={() => jumpTo('stats')} />
          <DrawerNavButton icon={Gamepad2} label={t('nav.simulator')} active={activeTab === 'simulator'} onClick={() => jumpTo('simulator')} />

          <div className="px-6 py-2 text-[10px] font-bold tracking-widest text-slate-400 dark:text-zinc-600 mt-4 uppercase">{t('drawer.section.system')}</div>
          
          <DrawerNavButton icon={MessageSquare} label={t('nav.tickets')} active={activeTab === 'tickets'} onClick={() => jumpTo('tickets')} />
          <DrawerNavButton icon={Settings} label={t('nav.settings')} active={activeTab === 'settings'} onClick={() => jumpTo('settings')} />
          <DrawerNavButton icon={Info} label={t('nav.about')} active={activeTab === 'about'} onClick={() => jumpTo('about')} />
          
          {isSuperAdmin && (
            <DrawerNavButton
              icon={Shield}
              label={t('nav.admin')}
              active={activeTab === 'admin'}
              onClick={() => jumpTo('admin')}
              trailing={<span className="text-[9px] border border-red-500/30 bg-red-500/10 px-1 py-0.5 rounded text-red-500 font-bold">ADMIN</span>}
            />
          )}

          <div className="px-6 py-2 text-[10px] font-bold tracking-widest text-slate-400 dark:text-zinc-600 mt-4 uppercase">{t('drawer.section.platform')}</div>
          <div className="mx-6 my-1">
            <PlatformSwitcher variant="menu-item" className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-1 bg-white/50 dark:bg-black/20" />
          </div>
        </div>

        {user ? (
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 shrink-0">
            <DrawerNavButton
              icon={LogOut}
              label={t('nav.logout')}
              tone="danger"
              onClick={async () => {
                await signOut();
                onClose();
              }}
            />
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export default MobileDrawer;
