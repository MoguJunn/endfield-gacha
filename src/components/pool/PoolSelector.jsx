import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Download, Upload, User, Search, X, ChevronDown } from 'lucide-react';
import { usePoolStore, useAuthStore, useHistoryStore } from '../../stores';
import ImportManager from '../../features/import/ImportManager';
import PoolGroupCardRail from './PoolGroupCardRail';
import { buildPoolSelectorGroups, getPoolGroupId } from '../../utils/poolSelectorDisplay';
import { getPreferredPool } from '../../utils/poolSelectionUtils';
import {
  formatFreshnessAbsolute,
  formatFreshnessRelative,
  getFreshnessTone,
  getLatestHistoryTimestampMs
} from '../../utils/dataFreshness.js';
import { getAccountLastImportTimestamp } from '../../utils/accountFreshness.js';
import { isPoolGroupId } from '../../stores/usePoolStore';
import { getDesktopPathForTab } from '../../constants/appRoutes';
import { useI18n } from '../../i18n/index.js';
import { localizePoolName } from '../../utils/gameDataI18n.js';
import {
  getGameAccountSelectionValue,
  isGameAccountSelectionMatch,
  localizeGameAccountServerTag,
} from '../../utils/gameAccountMetadata.js';
import { filterHistoryForEffectiveGameUid, resolveEffectiveGameUid } from '../../utils/accountScopeUtils.js';

function getFreshnessToneClasses(tone) {
  switch (tone) {
    case 'fresh':
      return 'border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'notice':
      return 'border-amber-500/40 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300';
    case 'stale':
      return 'border-red-500/40 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300';
    default:
      return 'border-zinc-200 bg-zinc-50 text-slate-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400';
  }
}

function CompactFreshnessCard({
  label,
  title,
  badgeText,
  metaText,
  detailText,
  tone,
  fallback = false
}) {
  return (
    <div className="min-w-0 border border-zinc-200 bg-white/80 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-zinc-500">
            {label}
          </div>
          <div className="text-sm font-bold leading-tight text-slate-800 dark:text-zinc-100 break-words">
            {title}
          </div>
          <div className="text-[11px] leading-tight text-slate-500 dark:text-zinc-400 break-words">
            {metaText}
          </div>
          {detailText && (
            <div className="text-[10px] leading-tight text-slate-400 dark:text-zinc-500 break-words">
              {detailText}
            </div>
          )}
        </div>
        <span className={`mt-0.5 shrink-0 px-2 py-1 text-[10px] font-bold border whitespace-nowrap ${getFreshnessToneClasses(tone)} ${fallback ? 'opacity-80' : ''}`}>
          {badgeText}
        </span>
      </div>
    </div>
  );
}

/**
 * 卡池选择器组件 V3 (Technical Style)
 * 卡池管理功能已移至管理页面，仅超管可操作
 */
const PoolSelector = ({ onOpenImportWizard, onOpenExportOptions }) => {
  const { t, locale, formatNumber } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  // 从 stores 获取状态
  const pools = usePoolStore(state => state.pools);
  const currentPoolId = usePoolStore(state => state.currentPoolId);
  const switchPool = usePoolStore(state => state.switchPool);
  const currentGameUid = usePoolStore(state => state.currentGameUid);
  const switchGameAccount = usePoolStore(state => state.switchGameAccount);
  const history = useHistoryStore(state => state.history);
  const getGameAccountsFromHistory = useHistoryStore(state => state.getGameAccountsFromHistory);

  const user = useAuthStore(state => state.user);

  // UI状态
  const [showImportManager, setShowImportManager] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [hideZeroPullPools, setHideZeroPullPools] = useState(true);

  // 获取所有游戏账号（从历史记录）
  const gameAccounts = useMemo(() => {
    void history;
    return getGameAccountsFromHistory();
  }, [history, getGameAccountsFromHistory]); // 依赖history而不是pools

  const effectiveGameUid = useMemo(() => resolveEffectiveGameUid({
    currentGameUid,
    gameAccounts,
    historyRecords: history,
  }), [currentGameUid, gameAccounts, history]);

  // 根据当前有效账号过滤历史记录；跨账号汇总入口重开前不做隐式合并分析。
  const filteredHistory = useMemo(() => (
    filterHistoryForEffectiveGameUid(history, effectiveGameUid)
  ), [effectiveGameUid, history]);

  // 直接使用所有卡池（不再按账号筛选）
  const filteredPools = pools;

  // 计算每个卡池的抽数（根据当前账号过滤）
  const poolPullCounts = useMemo(() => {
    const counts = {};
    filteredHistory.forEach(h => {
      counts[h.poolId] = (counts[h.poolId] || 0) + 1;
    });
    return counts;
  }, [filteredHistory]);

  const zeroPullPoolCount = useMemo(() => (
    filteredPools.filter((pool) => (poolPullCounts[pool.id] || 0) === 0).length
  ), [filteredPools, poolPullCounts]);

  const selectorPools = useMemo(() => (
    filteredPools.filter((pool) => (
      !hideZeroPullPools ||
      (poolPullCounts[pool.id] || 0) > 0 ||
      pool.id === currentPoolId
    ))
  ), [currentPoolId, filteredPools, hideZeroPullPools, poolPullCounts]);

  // 按类型分组并排序的卡池
  const sortedPoolsWithGroups = useMemo(() => {
    return buildPoolSelectorGroups({
      pools: selectorPools,
      poolPullCounts,
      searchQuery,
      locale,
    });
  }, [locale, poolPullCounts, searchQuery, selectorPools]);

  const totalPools = pools.length;
  const visiblePools = selectorPools.length;
  const totalPulls = Object.values(poolPullCounts).reduce((a, b) => a + b, 0);
  const allOverviewId = getPoolGroupId('all');
  const showOverviewOptions = Boolean(effectiveGameUid);

  const switchToPoolGroup = usePoolStore(state => state.switchToPoolGroup);

  const currentAccount = useMemo(() => {
    if (effectiveGameUid) {
      return gameAccounts.find((account) => isGameAccountSelectionMatch(account, effectiveGameUid)) || null;
    }

    if (gameAccounts.length === 1) {
      return gameAccounts[0];
    }

    return null;
  }, [effectiveGameUid, gameAccounts]);
  const currentAccountServerTag = currentAccount?.serverTag
    ? localizeGameAccountServerTag(currentAccount.serverTag, locale)
    : null;

  const currentPool = useMemo(() => {
    if (!currentPoolId || isPoolGroupId(currentPoolId)) {
      return null;
    }

    return pools.find((pool) => pool.id === currentPoolId) || null;
  }, [currentPoolId, pools]);

  const currentViewLatestRecordAt = useMemo(() => {
    const latestTimestamp = getLatestHistoryTimestampMs(filteredHistory);
    return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
  }, [filteredHistory]);

  const currentPoolLatestRecordAt = useMemo(() => {
    if (!currentPoolId || isPoolGroupId(currentPoolId)) {
      return currentViewLatestRecordAt;
    }

    const latestTimestamp = getLatestHistoryTimestampMs(
      filteredHistory.filter((record) => record.poolId === currentPoolId || record.pool_id === currentPoolId)
    );

    return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
  }, [currentPoolId, currentViewLatestRecordAt, filteredHistory]);

  const currentPoolFreshnessLabel = currentPool
    ? t('pool.selector.currentBanner', { name: localizePoolName(currentPool, { locale }) })
    : t('pool.selector.currentFilter');

  const totalPart = visiblePools !== totalPools ? `/${formatNumber(totalPools)}` : '';
  const summaryLabel = t('pool.selector.summary', {
    visible: formatNumber(visiblePools),
    totalPart,
    pulls: formatNumber(totalPulls)
  });
  const importRequestedByQuery = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get('import') === 'open';
  }, [location.search]);
  const isImportManagerOpen = showImportManager || importRequestedByQuery;

  useEffect(() => {
    if (!effectiveGameUid) {
      return;
    }

    if (currentGameUid !== effectiveGameUid) {
      switchGameAccount(effectiveGameUid);
    }
  }, [currentGameUid, effectiveGameUid, switchGameAccount]);

  useEffect(() => {
    if (showOverviewOptions || !isPoolGroupId(currentPoolId)) {
      return;
    }

    const fallbackPool = getPreferredPool(filteredPools, {
      preferredPoolId: null,
      includeDefaultPool: true
    });

    if (fallbackPool?.id) {
      switchPool(fallbackPool.id);
    }
  }, [currentPoolId, filteredPools, showOverviewOptions, switchPool]);

  const closeImportManager = useCallback(() => {
    setShowImportManager(false);

    if (!importRequestedByQuery) {
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    searchParams.delete('import');
    const nextSearch = searchParams.toString();

    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true }
    );
  }, [importRequestedByQuery, location.pathname, location.search, navigate]);

  const handleOpenFileImport = useCallback(() => {
    closeImportManager();
    if (typeof onOpenImportWizard === 'function') {
      onOpenImportWizard();
    }
  }, [closeImportManager, onOpenImportWizard]);

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-4">
        {/* 导入按钮 & 账号切换 */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <button
                id="guide-import-btn"
                onClick={() => setShowImportManager(true)}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black text-[11px] font-bold uppercase tracking-widest transition-all duration-300 hover:shadow-[0_0_15px_rgba(234,179,8,0.4)] active:scale-95 group relative overflow-hidden"
                style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
              >
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 ease-in-out" />
                <Upload size={14} className="group-hover:-translate-y-0.5 transition-transform duration-300 relative z-10" />
                <span className="relative z-10">{t('pool.selector.import')}</span>
              </button>
              {typeof onOpenExportOptions === 'function' && (
                <button
                  type="button"
                  onClick={onOpenExportOptions}
                  className="flex items-center gap-2 border border-zinc-300 bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-700 transition-all duration-300 hover:border-yellow-500 hover:text-yellow-600 hover:shadow-[0_0_15px_rgba(234,179,8,0.15)] active:scale-95 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-yellow-500 dark:hover:text-yellow-500"
                  style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
                >
                  <Download size={14} />
                  <span>{t('records.exportPoolFile')}</span>
                </button>
              )}
            </>
          ) : (
            <div id="guide-import-btn" className="text-xs text-slate-500 dark:text-zinc-400">
              {t('pool.selector.loginToImport')}
            </div>
          )}

          {/* 账号切换器 - 仅在有多个账号时显示 */}
          {gameAccounts.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                className="flex w-auto min-w-[140px] max-w-[224px] items-center justify-between gap-2 px-3 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 hover:border-yellow-500 dark:hover:border-yellow-500 text-xs transition-all duration-300 group hover:shadow-[0_0_15px_rgba(234,179,8,0.15)] relative overflow-hidden"
                style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)' }}
              >
                <div className="absolute inset-y-0 left-0 w-1 bg-yellow-500 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-bottom" />
                <div className="flex items-center gap-2 min-w-0 z-10 relative">
                  <User size={14} className="text-slate-400 dark:text-zinc-500 group-hover:text-yellow-600 dark:group-hover:text-yellow-500 transition-colors shrink-0" />
                  <span className="min-w-0 truncate text-slate-700 dark:text-zinc-300 font-bold group-hover:text-yellow-600 dark:group-hover:text-yellow-500 transition-colors">
                    {currentAccount?.nickName || t('pool.selector.selectAccount')}
                  </span>
                  {currentAccountServerTag && (
                    <span className="shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 group-hover:border-yellow-500/50 group-hover:text-yellow-600 dark:group-hover:text-yellow-500 transition-colors">
                      {currentAccountServerTag}
                    </span>
                  )}
                </div>
                <ChevronDown size={12} className={`text-slate-400 transition-transform duration-300 z-10 relative shrink-0 ml-1 ${showAccountDropdown ? 'rotate-180 text-yellow-500' : ''}`} />
              </button>

              {showAccountDropdown && (
                <div
                  className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl z-20"
                  style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)' }}
                >
                  {gameAccounts.map(account => {
                    const accountValue = getGameAccountSelectionValue(account);
                    const isSelectedAccount = isGameAccountSelectionMatch(account, effectiveGameUid);

                    return (
                    <button
                      key={accountValue || account.gameUid}
                      onClick={() => {
                        switchGameAccount(accountValue || account.gameUid);
                        setShowAccountDropdown(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors ${
                        isSelectedAccount ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-zinc-400'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 truncate font-bold">{account.nickName}</div>
                        {account.serverTag && (
                          <span className="shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300">
                            {localizeGameAccountServerTag(account.serverTag, locale)}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-slate-500 dark:text-zinc-400">
                        {t('pool.selector.accountRecordCount', {
                          uid: account.gameUid,
                          count: formatNumber(account.recordCount || 0)
                        })}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-zinc-500">
                        {t('settings.lastImport', {
                          value: formatFreshnessRelative(getAccountLastImportTimestamp(account), t('common.timeUnknown'), locale)
                        })}
                      </div>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 搜索与统计 */}
        <div className="ml-auto flex items-center gap-4">
          {/* 数据新鲜度与搜索 */}
          <div className="flex items-center gap-3">
            {/* 账号与卡池数据状态 (紧凑版) */}
            <div className="hidden md:flex items-center gap-2 border-r border-zinc-200 dark:border-zinc-800 pr-3">
              {(currentAccount || gameAccounts.length > 1) && (
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 border text-[10px] transition-colors ${getFreshnessToneClasses(getFreshnessTone(getAccountLastImportTimestamp(currentAccount)))}`}
                  style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
                  title={currentAccount
                    ? `${currentAccount.nickName} · ${t('pool.selector.meta.imported', { value: formatFreshnessAbsolute(getAccountLastImportTimestamp(currentAccount), null, locale, { includeYear: false }) })}`
                    : t('pool.selector.switchAccountHint')}
                >
                  <span className={`w-1.5 h-1.5 ${!currentAccount ? 'bg-zinc-400' : getFreshnessTone(getAccountLastImportTimestamp(currentAccount)) === 'fresh' ? 'bg-emerald-500 animate-pulse' : getFreshnessTone(getAccountLastImportTimestamp(currentAccount)) === 'notice' ? 'bg-amber-500' : 'bg-red-500'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 2px), calc(100% - 2px) 100%, 0 100%)' }} />
                  <span className="hidden xl:inline font-bold tracking-widest uppercase">{t('pool.selector.accountStatus', 'ACCOUNT')}:</span>
                  <span>{currentAccount ? formatFreshnessRelative(getAccountLastImportTimestamp(currentAccount), t('common.importTimeUnknown'), locale) : t('pool.selector.switchAccountHint')}</span>
                </div>
              )}
              {currentPoolLatestRecordAt && (
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 border text-[10px] transition-colors ${getFreshnessToneClasses(getFreshnessTone(currentPoolLatestRecordAt))}`}
                  style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
                  title={`${currentPoolFreshnessLabel} · ${t('pool.selector.meta.latestRecord', { value: formatFreshnessAbsolute(currentPoolLatestRecordAt, null, locale, { includeYear: false }) })}`}
                >
                  <span className={`w-1.5 h-1.5 ${getFreshnessTone(currentPoolLatestRecordAt) === 'fresh' ? 'bg-emerald-500 animate-pulse' : getFreshnessTone(currentPoolLatestRecordAt) === 'notice' ? 'bg-amber-500' : 'bg-red-500'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 2px), calc(100% - 2px) 100%, 0 100%)' }} />
                  <span className="hidden xl:inline font-bold tracking-widest uppercase">{t('pool.selector.poolStatus', 'POOL')}:</span>
                  <span>{formatFreshnessRelative(currentPoolLatestRecordAt, t('pool.selector.noRecords'), locale)}</span>
                </div>
              )}
            </div>

            {zeroPullPoolCount > 0 && (
              <button
                type="button"
                onClick={() => setHideZeroPullPools((value) => !value)}
                className={`flex items-center gap-2 px-3 py-1.5 border text-[11px] font-bold tracking-wider uppercase transition-all duration-300 relative overflow-hidden group ${
                  hideZeroPullPools
                    ? 'border-yellow-500 bg-yellow-500 text-black shadow-[0_0_12px_rgba(234,179,8,0.4)]'
                    : 'border-zinc-200 bg-white/50 text-slate-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400 hover:border-yellow-500/50 hover:text-yellow-600 dark:hover:text-yellow-500'
                }`}
                style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
                title={hideZeroPullPools ? t('pool.selector.hideZeroTitle') : t('pool.selector.showZeroTitle')}
              >
                <div className={`absolute inset-0 bg-yellow-500/10 transition-transform duration-300 ease-out origin-left ${hideZeroPullPools ? 'hidden' : 'scale-x-0 group-hover:scale-x-100'}`} />
                <span className={`h-2 w-2 transition-colors duration-300 relative z-10 ${hideZeroPullPools ? 'bg-black' : 'bg-zinc-300 dark:bg-zinc-700 group-hover:bg-yellow-500'}`} style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)' }} />
                <span className="relative z-10 transition-colors duration-300">{hideZeroPullPools ? t('pool.selector.hideZeroLabel') : t('pool.selector.showZeroLabel')}</span>
              </button>
            )}

            {totalPools > 5 && (
              <div className="relative group flex items-center">
                <Search size={14} className="absolute left-2.5 text-slate-400 dark:text-zinc-500 group-focus-within:text-yellow-500 transition-colors z-10" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('pool.selector.searchPlaceholder')}
                  className="w-40 pl-8 pr-8 py-1.5 text-[11px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:border-yellow-500 dark:focus:border-yellow-500/50 outline-none text-slate-700 dark:text-zinc-300 placeholder:text-slate-300 dark:placeholder:text-zinc-600 transition-all duration-300 focus:w-48 hover:border-zinc-300 dark:hover:border-zinc-600 focus:shadow-[0_0_12px_rgba(234,179,8,0.15)]"
                  style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)' }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-yellow-500 z-10 transition-colors"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 统计 */}
          <div className="text-xs text-slate-500 dark:text-zinc-400">
            {summaryLabel}
          </div>
        </div>
      </div>

      {/* 卡池列表 */}
      {sortedPoolsWithGroups.length > 0 ? (
        <PoolGroupCardRail
          groups={sortedPoolsWithGroups}
          currentSelectionId={currentPoolId}
          onSelectGroup={showOverviewOptions ? switchToPoolGroup : undefined}
          onSelectPool={switchPool}
          showGroupOverviewCards={showOverviewOptions}
          leadingOverview={showOverviewOptions ? {
            title: t('pool.selector.allOverview'),
            totalPools: visiblePools,
            totalPulls,
            isSelected: currentPoolId === allOverviewId,
            onClick: () => switchToPoolGroup('all')
          } : null}
        />
      ) : (
        <div className="text-center py-12 border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="text-slate-400 dark:text-zinc-500 text-sm">
            {searchQuery ? t('pool.selector.noMatches') : (user ? t('pool.selector.noPoolDataImport') : t('pool.selector.noPoolData'))}
          </div>
        </div>
      )}

      {/* 导入管理器 */}
      {isImportManagerOpen && (
        <ImportManager
          isOpen={isImportManagerOpen}
          onClose={closeImportManager}
          onOpenFileImport={handleOpenFileImport}
          onImportComplete={() => {
            closeImportManager();
            navigate(getDesktopPathForTab('dashboard'));
          }}
        />
      )}
    </div>
  );
};

export default PoolSelector;
