import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, HelpCircle, Menu, Moon, Radio, Sun, User } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { useTheme } from '../../contexts/ThemeContext';
import { usePoolStore, useHistoryStore } from '../../stores';
import LocaleSwitcher from '../../components/common/LocaleSwitcher.jsx';
import { getMobilePathForTab } from '../../constants/appRoutes.js';
import { formatFreshnessRelative, getFreshnessTone } from '../../utils/dataFreshness.js';
import { getAccountLastImportTimestamp } from '../../utils/accountFreshness.js';
import {
  getGameAccountSelectionValue,
  isGameAccountSelectionMatch,
  localizeGameAccountServerTag,
} from '../../utils/gameAccountMetadata.js';

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

function freshnessToneClass(tone) {
  switch (tone) {
    case 'fresh':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'notice':
      return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300';
    case 'stale':
      return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300';
    default:
      return 'border-zinc-200 bg-zinc-50 text-slate-500 dark:border-white/8 dark:bg-white/6 dark:text-zinc-400';
  }
}

export default function MobileHeader({ onMenuClick, activeTab }) {
  const { t, locale } = useI18n();
  const { setThemeMode } = useTheme();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAccountHelp, setShowAccountHelp] = useState(false);

  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const switchGameAccount = usePoolStore((state) => state.switchGameAccount);
  const history = useHistoryStore((state) => state.history);
  const getGameAccountsFromHistory = useHistoryStore((state) => state.getGameAccountsFromHistory);

  const gameAccounts = useMemo(() => {
    void history;
    return getGameAccountsFromHistory();
  }, [getGameAccountsFromHistory, history]);

  const effectiveGameUid = useMemo(() => {
    const matchedAccount = gameAccounts.find((account) => isGameAccountSelectionMatch(account, currentGameUid));
    if (matchedAccount) {
      return getGameAccountSelectionValue(matchedAccount);
    }

    return getGameAccountSelectionValue(gameAccounts[0]);
  }, [currentGameUid, gameAccounts]);

  const currentAccount = useMemo(() => {
    if (effectiveGameUid) {
      return gameAccounts.find((account) => isGameAccountSelectionMatch(account, effectiveGameUid)) || null;
    }
    if (gameAccounts.length === 1) {
      return gameAccounts[0];
    }
    return null;
  }, [effectiveGameUid, gameAccounts]);

  const showAccountSwitcher = activeTab === 'details' || activeTab === 'overview';
  const canSwitchAccount = showAccountSwitcher && gameAccounts.length > 0;
  const currentAccountServerTag = currentAccount?.serverTag
    ? localizeGameAccountServerTag(currentAccount.serverTag, locale)
    : null;
  const accountLabel = currentAccount
    ? `${currentAccountServerTag ? `${currentAccountServerTag} · ` : ''}${currentAccount.nickName}`
    : t('pool.selector.selectAccount');

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains('dark');
    setThemeMode(isDark ? 'light' : 'dark');
  };

  const openServerLabelSettings = () => {
    setShowAccountHelp(false);
    setShowAccountMenu(false);
    navigate(getMobilePathForTab('settings'), {
      state: {
        scrollTo: 'settings-account-server-labels',
        _ts: Date.now(),
      },
    });
  };

  useEffect(() => {
    if (gameAccounts.length <= 1) {
      return;
    }

    if (effectiveGameUid && currentGameUid !== effectiveGameUid) {
      switchGameAccount(effectiveGameUid);
    }
  }, [currentGameUid, effectiveGameUid, gameAccounts.length, switchGameAccount]);

  useEffect(() => {
    if (!showAccountMenu && !showAccountHelp) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowAccountMenu(false);
        setShowAccountHelp(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showAccountHelp, showAccountMenu]);

  return (
    <header ref={menuRef} className="mobile-ux-topbar relative h-14 flex items-center justify-between px-4 shrink-0 z-40 safe-area-top transition-colors duration-300">
      <button
        onClick={onMenuClick}
        className="p-2 -ml-2 text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white transition-colors touch-feedback"
        aria-label={t('header.openMenu')}
      >
        <Menu size={20} />
      </button>

      {showAccountSwitcher ? (
        <div className="flex flex-1 justify-center">
          <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => canSwitchAccount && setShowAccountMenu((value) => !value)}
            className="mobile-ux-account-chip flex max-w-[240px] items-center gap-2 px-3 py-1.5"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${currentAccount ? 'bg-amber-400 dark:bg-ef-yellow shadow-[0_0_10px_rgba(255,204,0,0.45)]' : 'bg-zinc-500'}`} />
            <span className="truncate text-[11px] font-bold text-slate-700 dark:text-zinc-200">
              {accountLabel}
            </span>
            {canSwitchAccount ? <ChevronDown size={12} className={cx('shrink-0 text-slate-500 dark:text-zinc-400 transition-transform', showAccountMenu ? 'rotate-180' : '')} /> : null}
          </button>
          {canSwitchAccount ? (
            <div
              className="relative"
              onMouseEnter={() => setShowAccountHelp(true)}
              onMouseLeave={() => setShowAccountHelp(false)}
            >
              <button
                type="button"
                onClick={() => setShowAccountHelp((value) => !value)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-slate-500 transition-colors hover:text-amber-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500 dark:hover:text-ef-yellow"
                aria-label={t('pool.selector.serverHelpTitle')}
                title={t('pool.selector.serverHelpTitle')}
              >
                <HelpCircle size={14} />
              </button>
              {showAccountHelp ? (
                <div className="absolute left-1/2 top-[calc(100%+0.5rem)] z-50 w-72 -translate-x-1/2 rounded-xl border border-amber-300 bg-white p-3 text-left shadow-xl dark:border-ef-yellow/30 dark:bg-zinc-950">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-ef-yellow">
                    {t('pool.selector.serverHelpTitle')}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-zinc-300">
                    {t('pool.selector.serverHelpDesc')}
                  </p>
                  <button
                    type="button"
                    onClick={openServerLabelSettings}
                    className="mt-3 w-full rounded-lg border border-amber-400 bg-amber-400 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-amber-300 dark:border-ef-yellow dark:bg-ef-yellow dark:hover:bg-yellow-300"
                  >
                    {t('pool.selector.serverHelpAction')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 justify-center">
          <div className="mobile-ux-brand-chip flex items-center justify-center gap-2 px-3 py-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 dark:bg-ef-yellow shadow-[0_0_10px_rgba(255,204,0,0.5)]" />
          <Radio className="h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-ef-yellow/80" />
            <span className="truncate text-[10px] font-bold uppercase tracking-[0.24em] text-slate-700 dark:text-zinc-200">
            G.ANALYZER
          </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        <LocaleSwitcher variant="header" />
        <button
          onClick={toggleTheme}
          className="w-8 h-8 flex items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-white transition-colors touch-feedback"
          aria-label="Toggle Theme"
        >
          <Sun size={14} className="hidden dark:block" />
          <Moon size={14} className="block dark:hidden" />
        </button>
      </div>

      {showAccountMenu && canSwitchAccount ? (
        <div className="mobile-ux-dropdown absolute left-4 right-4 top-[calc(100%+0.5rem)] z-50 overflow-hidden">
          <div className="border-b border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-white/8 dark:bg-white/[0.03]">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-500">
              {t('pool.selector.switchAccountHint')}
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-3">
            {gameAccounts.map((account) => {
              const accountValue = getGameAccountSelectionValue(account);
              const isSelectedAccount = isGameAccountSelectionMatch(account, currentGameUid);

              return (
              <button
                key={accountValue || account.gameUid}
                type="button"
                onClick={() => {
                  switchGameAccount(accountValue || account.gameUid);
                  setShowAccountMenu(false);
                }}
                className={cx(
                  'mb-2 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left last:mb-0',
                  isSelectedAccount
                    ? 'border-endfield-yellow/30 bg-endfield-yellow/10 text-slate-900 dark:text-endfield-yellow'
                    : 'border-zinc-200 bg-white text-slate-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300'
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-100 text-slate-500 dark:border-zinc-800 dark:bg-[#111] dark:text-zinc-500">
                    <User size={13} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-bold">
                      {account.serverTag ? `${localizeGameAccountServerTag(account.serverTag, locale)} · ${account.nickName}` : account.nickName}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-zinc-500">{account.gameUid}</div>
                  </div>
                </div>
                <span className={cx('shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]', freshnessToneClass(getFreshnessTone(getAccountLastImportTimestamp(account))))}>
                  {formatFreshnessRelative(getAccountLastImportTimestamp(account), t('common.importTimeUnknown'), locale)}
                </span>
              </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </header>
  );
}
