import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, Star, Layers, Swords, User, Lock, Check, Upload, Search, X
} from 'lucide-react';
import { usePoolStore, useHistoryStore, useAuthStore } from '../../stores';
import { isPoolGroupId, POOL_GROUP_PREFIX } from '../../stores/usePoolStore';
import ImportManager from '../../features/import/ImportManager';
import { getImportAnomalyCount } from '../../features/import/importCompletionPolicy.js';
import {
  formatFreshnessAbsolute,
  formatFreshnessRelative,
  getFreshnessTone,
  getLatestHistoryTimestampMs
} from '../../utils/dataFreshness.js';
import { getAccountLastImportTimestamp } from '../../utils/accountFreshness.js';
import { getPreferredPool } from '../../utils/poolSelectionUtils';
import {
  buildPoolSelectorGroups,
  getPoolFeaturedLabel,
  shouldShowPoolFeaturedSummary,
  getPoolSelectorFeaturedCharacters,
  getPoolTypeLabel
} from '../../utils/poolSelectorDisplay';
import { getMobilePathForTab } from '../../constants/appRoutes';
import { useI18n } from '../../i18n/index.js';
import { MobileGlassPanel, MobileStatusBadge } from './ux/MobilePrimitives.jsx';
import { localizeEntityName, localizePoolName } from '../../utils/gameDataI18n.js';
import { localizeGameAccountServerTag } from '../../utils/gameAccountMetadata.js';
import { filterHistoryForEffectiveGameUid, resolveEffectiveGameUid } from '../../utils/accountScopeUtils.js';

function getFreshnessToneClasses(tone) {
  switch (tone) {
    case 'fresh':
      return 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300';
    case 'notice':
      return 'border-amber-500/30 bg-amber-500/12 text-amber-300';
    case 'stale':
      return 'border-red-500/30 bg-red-500/12 text-red-300';
    default:
      return 'border-white/8 bg-white/[0.03] text-zinc-400';
  }
}

/**
 * 移动端卡池选择器 - 完整版
 * 包含：卡池选择、账号切换、导入功能
 * 参考桌面端 PoolSelector.jsx 实现
 */
function MobilePoolSelector() {
  const { t, locale, formatNumber } = useI18n();
  const navigate = useNavigate();
  // Store 状态
  const pools = usePoolStore(state => state.pools);
  const currentPoolId = usePoolStore(state => state.currentPoolId);
  const switchPool = usePoolStore(state => state.switchPool);
  const currentGameUid = usePoolStore(state => state.currentGameUid);
  const switchGameAccount = usePoolStore(state => state.switchGameAccount);
  const history = useHistoryStore(state => state.history);
  const getGameAccountsFromHistory = useHistoryStore(state => state.getGameAccountsFromHistory);
  const user = useAuthStore(state => state.user);

  // UI 状态
  const [isPoolOpen, setIsPoolOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [showImportManager, setShowImportManager] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hideZeroPullPools, setHideZeroPullPools] = useState(true);

  const poolDropdownRef = useRef(null);
  const accountDropdownRef = useRef(null);

  // 获取所有游戏账号
  const gameAccounts = useMemo(() => {
    void history;
    return getGameAccountsFromHistory();
  }, [history, getGameAccountsFromHistory]);

  const effectiveGameUid = useMemo(() => resolveEffectiveGameUid({
    currentGameUid,
    gameAccounts,
    historyRecords: history,
  }), [currentGameUid, gameAccounts, history]);

  // 根据当前有效账号过滤历史记录；跨账号汇总入口重开前不做隐式合并分析。
  const filteredHistory = useMemo(() => (
    filterHistoryForEffectiveGameUid(history, effectiveGameUid)
  ), [history, effectiveGameUid]);

  // 计算每个卡池的抽数
  const poolPullCounts = useMemo(() => {
    const counts = {};
    filteredHistory.forEach(h => {
      const poolId = h.poolId || h.pool_id;
      if (poolId) {
        counts[poolId] = (counts[poolId] || 0) + 1;
      }
    });
    return counts;
  }, [filteredHistory]);

  const zeroPullPoolCount = useMemo(() => (
    pools.filter((pool) => (poolPullCounts[pool.id] || 0) === 0).length
  ), [poolPullCounts, pools]);

  const selectorPools = useMemo(() => (
    pools.filter((pool) => (
      !hideZeroPullPools ||
      (poolPullCounts[pool.id] || 0) > 0 ||
      pool.id === currentPoolId
    ))
  ), [currentPoolId, hideZeroPullPools, poolPullCounts, pools]);

  // 当前选中的卡池（或池组）
  const selectedPool = useMemo(() => {
    if (!pools || pools.length === 0) return null;
    if (isPoolGroupId(currentPoolId)) {
      const groupType = currentPoolId.slice(POOL_GROUP_PREFIX.length);
      return {
        id: currentPoolId,
        name: groupType === 'all'
          ? t('pool.selector.allOverview')
          : t('pool.card.allGroupTitle', { label: getPoolTypeLabel(groupType, locale) }),
        isGroupMode: true,
        isAllPoolsOverview: groupType === 'all',
        type: groupType
      };
    }
    return getPreferredPool(selectorPools, {
      preferredPoolId: currentPoolId,
      includeDefaultPool: true
    });
  }, [currentPoolId, locale, pools, selectorPools, t]);
  const selectedPoolDisplayName = selectedPool?.displayName
    || localizePoolName(selectedPool, { locale })
    || selectedPool?.name
    || t('pool.selector.selectPool');
  const selectedPoolDisplayUp = selectedPool?.displayUpCharacter
    || getPoolSelectorFeaturedCharacters(selectedPool, { locale }).join(' / ')
    || localizeEntityName(selectedPool?.up_character || selectedPool?.upCharacter || '', {
      locale,
      type: selectedPool?.type === 'weapon' ? 'weapon' : 'character'
    })
    || selectedPool?.up_character
    || selectedPool?.upCharacter
    || '';
  const selectedPoolFeaturedLabel = getPoolFeaturedLabel(selectedPool, { locale, short: true });
  const showSelectedPoolFeaturedSummary = shouldShowPoolFeaturedSummary(selectedPool);

  // 当前选中的账号
  const currentAccount = useMemo(() => {
    if (effectiveGameUid) {
      return gameAccounts.find((account) => account.gameUid === effectiveGameUid) || null;
    }

    if (gameAccounts.length === 1) {
      return gameAccounts[0];
    }

    return null;
  }, [effectiveGameUid, gameAccounts]);
  const currentAccountServerTag = currentAccount?.serverTag
    ? localizeGameAccountServerTag(currentAccount.serverTag, locale)
    : null;

  // 按类型分组并排序的卡池
  const sortedPoolsWithGroups = useMemo(() => {
    return buildPoolSelectorGroups({
      pools: selectorPools,
      poolPullCounts,
      searchQuery,
      locale,
    });
  }, [locale, poolPullCounts, searchQuery, selectorPools]);

  // 统计
  const totalPools = pools?.length || 0;
  const visiblePools = selectorPools.length;
  const totalPulls = Object.values(poolPullCounts).reduce((a, b) => a + b, 0);
  const showOverviewOptions = Boolean(effectiveGameUid);
  const allOverviewId = `${POOL_GROUP_PREFIX}all`;

  const currentViewLatestRecordAt = useMemo(() => {
    const latestTimestamp = getLatestHistoryTimestampMs(filteredHistory);
    return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
  }, [filteredHistory]);

  const currentPoolLatestRecordAt = useMemo(() => {
    if (!currentPoolId || isPoolGroupId(currentPoolId)) {
      return currentViewLatestRecordAt;
    }

    const latestTimestamp = getLatestHistoryTimestampMs(
      filteredHistory.filter((record) => (record.poolId || record.pool_id) === currentPoolId)
    );

    return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
  }, [currentPoolId, currentViewLatestRecordAt, filteredHistory]);

  const currentPoolFreshnessLabel = selectedPool?.isGroupMode
    ? t('pool.selector.currentFilter')
    : t('pool.selector.currentBanner', { name: selectedPoolDisplayName || t('common.unknown') });

  const totalPart = visiblePools !== totalPools ? `/${formatNumber(totalPools)}` : '';
  const summaryLabel = t('pool.selector.summary', {
    visible: formatNumber(visiblePools),
    totalPart,
    pulls: formatNumber(totalPulls)
  });

  useEffect(() => {
    if (!effectiveGameUid) {
      return;
    }

    if (currentGameUid !== effectiveGameUid) {
      switchGameAccount(effectiveGameUid);
    }
  }, [currentGameUid, effectiveGameUid, switchGameAccount]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (poolDropdownRef.current && !poolDropdownRef.current.contains(e.target)) {
        setIsPoolOpen(false);
      }
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(e.target)) {
        setIsAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (showOverviewOptions || !isPoolGroupId(currentPoolId)) {
      return;
    }

    const fallbackPool = getPreferredPool(pools, {
      preferredPoolId: null,
      includeDefaultPool: true
    });

    if (fallbackPool?.id) {
      switchPool(fallbackPool.id);
    }
  }, [currentPoolId, pools, showOverviewOptions, switchPool]);

  const handleSelectPool = (poolId) => {
    switchPool(poolId);
    setIsPoolOpen(false);
    setSearchQuery('');
  };

  const switchToPoolGroup = usePoolStore(state => state.switchToPoolGroup);

  const handleSelectGroup = (groupType) => {
    switchToPoolGroup(groupType);
    setIsPoolOpen(false);
    setSearchQuery('');
  };

  const handleSelectAccount = (gameUid) => {
    switchGameAccount(gameUid);
    setIsAccountOpen(false);
  };

  // 获取卡池类型配置
  const getPoolTypeConfig = (pool) => {
    let poolType = pool.type || 'standard';
    if (poolType === 'limited_character') poolType = 'limited';
    if (poolType === 'limited_weapon') poolType = 'weapon';

    const configs = {
      extra: { icon: Star, color: 'text-cyan-300', bg: 'bg-cyan-500/12' },
      limited: { icon: Star, color: 'text-orange-300', bg: 'bg-orange-500/12' },
      standard: { icon: Layers, color: 'text-amber-300', bg: 'bg-amber-500/12' },
      weapon: { icon: Swords, color: 'text-slate-300', bg: 'bg-slate-500/12' },
      beginner: { icon: User, color: 'text-emerald-300', bg: 'bg-emerald-500/12' }
    };
    return configs[poolType] || configs.standard;
  };

  const config = selectedPool ? getPoolTypeConfig(selectedPool) : null;
  const TypeIcon = config?.icon || Layers;
  const pullCount = selectedPool ? (poolPullCounts[selectedPool.id] || 0) : 0;

  return (
    <div className="space-y-3">
      {/* 顶部工具栏：导入按钮 + 账号切换 */}
      <div className="flex items-center gap-2">
        {/* 导入按钮 */}
        {user ? (
          <button
            onClick={() => setShowImportManager(true)}
            className="flex items-center gap-2 rounded-full bg-endfield-yellow px-3 py-2 text-xs font-bold uppercase tracking-wider text-black transition-all touch-feedback hover:bg-yellow-300"
          >
            <Upload size={14} />
            {t('pool.selector.import')}
          </button>
        ) : (
          <div className="text-[10px] text-zinc-500">
            {t('pool.selector.loginToImport')}
          </div>
        )}

        {/* 账号切换器 */}
        {gameAccounts.length > 1 && (
          <div className="relative flex-1" ref={accountDropdownRef}>
            <button
              onClick={() => setIsAccountOpen(!isAccountOpen)}
              className="w-full flex items-center justify-between gap-2 rounded-[1rem] border border-white/8 bg-white/[0.04] px-3 py-2 text-xs transition-colors touch-feedback hover:border-white/14 hover:bg-white/[0.06]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <User size={14} className="text-zinc-500 shrink-0" />
                <span className="text-zinc-200 truncate">
                  {currentAccount?.nickName || t('pool.selector.selectAccount')}
                </span>
                {currentAccountServerTag && (
                  <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                    {currentAccountServerTag}
                  </span>
                )}
              </div>
              <ChevronDown size={12} className={`text-zinc-500 transition-transform shrink-0 ${isAccountOpen ? 'rotate-180' : ''}`} />
            </button>

            {isAccountOpen && (
              <div className="mobile-ux-dropdown absolute top-full left-0 right-0 z-50 mt-2 max-h-60 overflow-y-auto animate-scale-up">
                {/* 账号列表 */}
                {gameAccounts.map(account => (
                  <button
                    key={account.gameUid}
                    onClick={() => handleSelectAccount(account.gameUid)}
                    className={`w-full px-3 py-2.5 text-left transition-colors touch-feedback ${
                      effectiveGameUid === account.gameUid
                        ? 'bg-endfield-yellow/10'
                        : 'hover:bg-white/5'
                    }`}
                    >
                    <div className="flex items-center gap-2">
                      <div className={`text-xs font-bold ${
                        effectiveGameUid === account.gameUid ? 'text-endfield-yellow' : 'text-zinc-200'
                      }`}>
                        {account.nickName}
                      </div>
                      {account.serverTag && (
                        <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                          {localizeGameAccountServerTag(account.serverTag, locale)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {t('pool.selector.accountRecordCount', {
                        uid: account.gameUid,
                        count: formatNumber(account.recordCount || 0)
                      })}
                    </div>
                    <div className="mt-0.5 text-[10px] text-zinc-500">
                      {t('settings.lastImport', {
                        value: formatFreshnessRelative(getAccountLastImportTimestamp(account), t('common.timeUnknown'), locale)
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 统计信息 */}
        <MobileStatusBadge className="shrink-0 whitespace-nowrap">{summaryLabel}</MobileStatusBadge>
      </div>

      {(currentAccount || gameAccounts.length > 1 || currentPoolLatestRecordAt) && (
        <div className="grid gap-2">
          <MobileGlassPanel compact>
            <div className="flex flex-col items-start gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {t('pool.selector.accountStatus')}
                </div>
                <div className="mt-1 text-sm font-bold leading-tight text-zinc-100 break-words">
                  {currentAccount ? `${currentAccount.nickName} · ${currentAccount.gameUid}` : t('pool.selector.selectAccount')}
                </div>
              </div>
              <span className={`self-start px-2 py-1 text-[10px] font-bold border whitespace-nowrap ${getFreshnessToneClasses(getFreshnessTone(getAccountLastImportTimestamp(currentAccount)))}`}>
                {currentAccount ? formatFreshnessRelative(getAccountLastImportTimestamp(currentAccount), t('common.importTimeUnknown'), locale) : t('pool.selector.switchAccountHint')}
              </span>
            </div>
            <div className="mt-2 text-[10px] leading-tight text-zinc-500 break-words">
              {currentAccount
                ? t('pool.selector.meta.imported', {
                    value: formatFreshnessAbsolute(getAccountLastImportTimestamp(currentAccount), null, locale, { includeYear: false })
                  })
                : t('pool.selector.multiAccountDetail')}
            </div>
            {currentAccount?.latestRecordAt ? (
              <div className="mt-1 text-[10px] leading-tight text-zinc-500 break-words">
                {t('pool.selector.meta.latestRecord', {
                  value: formatFreshnessAbsolute(currentAccount.latestRecordAt, null, locale, { includeYear: false })
                })}
              </div>
            ) : null}
          </MobileGlassPanel>

          <MobileGlassPanel compact>
            <div className="flex flex-col items-start gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {t('pool.selector.poolStatus')}
                </div>
                <div className="mt-1 text-sm font-bold leading-tight text-zinc-100 break-words">
                  {currentPoolFreshnessLabel}
                </div>
              </div>
              <span className={`self-start px-2 py-1 text-[10px] font-bold border whitespace-nowrap ${getFreshnessToneClasses(getFreshnessTone(currentPoolLatestRecordAt))}`}>
                {formatFreshnessRelative(currentPoolLatestRecordAt, t('pool.selector.noRecords'), locale)}
              </span>
            </div>
            <div className="mt-2 text-[10px] leading-tight text-zinc-500 break-words">
              {t('pool.selector.meta.latestRecord', {
                value: formatFreshnessAbsolute(currentPoolLatestRecordAt, null, locale, { includeYear: false })
              })}
            </div>
            {!selectedPool?.isGroupMode && selectedPool?.id ? (
              <div className="mt-1 text-[10px] leading-tight text-zinc-500 break-words">
                {t('pool.selector.currentPullsShort', { count: formatNumber(poolPullCounts[selectedPool.id] || 0) })}
              </div>
            ) : null}
          </MobileGlassPanel>
        </div>
      )}

      {/* 卡池选择器 */}
      {(!pools || pools.length === 0) ? (
        <div className="rounded-[1rem] border border-dashed border-white/10 bg-white/[0.03] py-4 text-center text-sm text-zinc-500">
          {user ? t('pool.selector.noPoolDataImport') : t('pool.selector.noPoolData')}
        </div>
      ) : (
        <div className="relative" ref={poolDropdownRef}>
          {/* 当前选中卡池卡片 */}
          <button
            onClick={() => setIsPoolOpen(!isPoolOpen)}
            className={`w-full flex items-center gap-3 p-3 border transition-all touch-feedback ${
              isPoolOpen
                ? 'rounded-[1rem] border-endfield-yellow bg-endfield-yellow/5'
                : 'rounded-[1rem] border-white/8 bg-white/[0.04] hover:border-white/14'
            }`}
          >
            {/* 类型图标 */}
            <div className={`rounded-[0.9rem] p-2 ${config?.bg}`}>
              <TypeIcon size={18} className={config?.color} />
            </div>

            {/* 卡池信息 */}
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-bold text-zinc-100 truncate">
                {selectedPoolDisplayName}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                {showSelectedPoolFeaturedSummary && selectedPoolDisplayUp && (
                  <>
                    <span>{selectedPoolFeaturedLabel}: {selectedPoolDisplayUp}</span>
                    <span className="text-zinc-300 dark:text-zinc-700">|</span>
                  </>
                )}
                <span>{t('pool.card.pulls', { count: formatNumber(pullCount) })}</span>
              </div>
            </div>

            {/* 展开图标 */}
            <ChevronDown
              size={18}
              className={`text-zinc-400 transition-transform ${isPoolOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* 下拉列表 */}
          {isPoolOpen && (
            <div className="mobile-ux-dropdown absolute top-full left-0 right-0 mt-2 z-50 max-h-80 overflow-hidden animate-scale-up">
              {/* 搜索框（卡池较多时显示） */}
              {(totalPools > 5 || zeroPullPoolCount > 0) && (
                <div className="sticky top-0 border-b border-white/8 bg-black/90 p-2 backdrop-blur-xl">
                  <div className="flex items-center gap-2">
                    {zeroPullPoolCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setHideZeroPullPools((value) => !value)}
                        className={`flex items-center gap-1.5 px-2 py-2 border text-[10px] whitespace-nowrap transition-colors ${
                          hideZeroPullPools
                            ? 'rounded-full border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                            : 'rounded-full border-white/8 bg-white/[0.03] text-zinc-400'
                        }`}
                        title={hideZeroPullPools ? t('pool.selector.hideZeroTitle') : t('pool.selector.showZeroTitle')}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${hideZeroPullPools ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-500'}`} />
                        <span>{hideZeroPullPools ? t('pool.selector.hideZeroLabel') : t('pool.selector.showZeroLabel')}</span>
                      </button>
                    )}

                    {totalPools > 5 && (
                      <div className="relative flex-1">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={t('pool.selector.searchPlaceholder')}
                          className="mobile-ux-input py-2 pl-8 pr-8 text-xs"
                        />
                        {searchQuery && (
                          <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 卡池列表 */}
              <div className="max-h-64 overflow-y-auto">
                {sortedPoolsWithGroups.length > 0 ? (
                  <>
                    {showOverviewOptions && (
                      <button
                        onClick={() => handleSelectGroup('all')}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors touch-feedback border-b border-dashed border-zinc-100 dark:border-zinc-800 ${
                          currentPoolId === allOverviewId
                            ? 'bg-endfield-yellow/10 border-l-2 border-l-endfield-yellow'
                            : 'hover:bg-white/5 border-l-2 border-l-transparent'
                        }`}
                      >
                        <div className="rounded-[0.85rem] bg-white/6 p-1.5">
                          <Layers size={14} className="text-zinc-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium ${
                            currentPoolId === allOverviewId ? 'text-zinc-100' : 'text-zinc-300'
                          }`}>
                            {t('pool.selector.allOverview')}
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            {t('pool.card.groupStats', { pools: formatNumber(visiblePools), pulls: formatNumber(totalPulls) })}
                          </div>
                        </div>
                        {currentPoolId === allOverviewId && <Check size={16} className="text-endfield-yellow flex-shrink-0" />}
                      </button>
                    )}

                    {sortedPoolsWithGroups.map((group) => (
                      <div key={group.type}>
                      {/* 分组标题 */}
                      <div className="sticky top-0 border-b border-white/8 bg-black/88 px-3 py-2 backdrop-blur-xl">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          group.type === 'extra' ? 'text-cyan-500' :
                          group.type === 'limited' ? 'text-orange-500' :
                          group.type.includes('weapon') ? 'text-slate-500' :
                          group.type === 'standard' ? 'text-amber-500' :
                          'text-green-500'
                        }`}>
                          {group.label}
                        </span>
                      </div>

                      {/* 池组聚合按钮（仅该分组 > 1 个池时显示） */}
                      {showOverviewOptions && group.pools.length > 1 && (() => {
                        const groupId = POOL_GROUP_PREFIX + group.type;
                        const isGroupSelected = currentPoolId === groupId;
                        const totalGroupPulls = group.pools.reduce((sum, p) => sum + (poolPullCounts[p.id] || 0), 0);
                        return (
                          <button
                            onClick={() => handleSelectGroup(group.type)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors touch-feedback border-b border-dashed border-zinc-100 dark:border-zinc-800 ${
                              isGroupSelected
                                ? 'bg-endfield-yellow/10 border-l-2 border-l-endfield-yellow'
                                : 'hover:bg-white/5 border-l-2 border-l-transparent'
                            }`}
                          >
                            <div className="rounded-[0.85rem] bg-white/6 p-1.5">
                              <Layers size={14} className="text-zinc-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium ${isGroupSelected ? 'text-zinc-100' : 'text-zinc-300'}`}>
                                {t('pool.card.allGroupTitle', { label: group.label })}
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                {t('pool.card.groupStats', { pools: formatNumber(group.pools.length), pulls: formatNumber(totalGroupPulls) })}
                              </div>
                            </div>
                            {isGroupSelected && <Check size={16} className="text-endfield-yellow flex-shrink-0" />}
                          </button>
                        );
                      })()}

                      {/* 卡池列表 */}
                      {group.pools.map((pool) => {
                        const isSelected = pool.id === currentPoolId;
                        const poolConfig = getPoolTypeConfig(pool);
                        const PoolIcon = poolConfig.icon;
                        const count = poolPullCounts[pool.id] || 0;
                        const poolFeaturedLabel = getPoolFeaturedLabel(pool, { locale, short: true });
                        const showPoolFeaturedSummary = shouldShowPoolFeaturedSummary(pool);

                        return (
                          <button
                            key={pool.id}
                            onClick={() => handleSelectPool(pool.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors touch-feedback ${
                              isSelected
                                ? 'bg-endfield-yellow/10 border-l-2 border-endfield-yellow'
                                : 'hover:bg-white/5 border-l-2 border-transparent'
                            }`}
                          >
                            {/* 类型图标 */}
                            <div className={`rounded-[0.85rem] p-1.5 ${poolConfig.bg}`}>
                              <PoolIcon size={14} className={poolConfig.color} />
                            </div>

                            {/* 卡池信息 */}
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium truncate ${
                                isSelected ? 'text-zinc-100' : 'text-zinc-300'
                              }`}>
                                {pool.displayName || localizePoolName(pool, { locale }) || pool.name}
                                {pool.locked && <Lock size={10} className="inline ml-1 text-amber-500" />}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                                {showPoolFeaturedSummary && (pool.displayUpCharacter || pool.up_character || pool.upCharacter) && (
                                  <span>
                                    {poolFeaturedLabel}: {pool.displayUpCharacter || getPoolSelectorFeaturedCharacters(pool, { locale }).join(' / ') || localizeEntityName(pool.up_character || pool.upCharacter || '', {
                                      locale,
                                      type: pool.type === 'weapon' ? 'weapon' : 'character'
                                    }) || pool.up_character || pool.upCharacter}
                                  </span>
                                )}
                                <span>{t('pool.card.pulls', { count: formatNumber(count) })}</span>
                              </div>
                            </div>

                            {/* 选中标识 */}
                            {isSelected && (
                              <Check size={16} className="text-endfield-yellow flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    ))}
                  </>
                ) : (
                  <div className="py-8 text-center text-sm text-zinc-500">
                    {searchQuery ? t('pool.selector.noMatches') : t('pool.selector.noBanners')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 导入管理器弹窗 */}
      {showImportManager && (
        <ImportManager
          isOpen={showImportManager}
          onClose={() => {
            setShowImportManager(false);
          }}
          onImportComplete={(result) => {
            navigate(getMobilePathForTab('details'), {
              state: {
                openHistoryAnomalies: getImportAnomalyCount(result) > 0,
              },
            });
          }}
        />
      )}
    </div>
  );
}

export default MobilePoolSelector;
