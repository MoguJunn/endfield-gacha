import React, { useCallback, useMemo, useState } from 'react';
import { CalendarRange, Filter, RotateCcw } from 'lucide-react';
import { useHistoryStore, useAuthStore } from '../../stores';
import { useCurrentPoolData, useCurrentPoolGroupedHistory } from '../../hooks';
import BatchCard from '../BatchCard';
import { useI18n } from '../../i18n/index.js';
import { localizePoolName } from '../../utils/gameDataI18n.js';
import {
  isFreeHistoryPull,
  isGiftHistoryPull,
  isInfoBookHistoryPull,
} from '../../utils/historyInfoBook.js';
import HistoryAnomalyReview from './HistoryAnomalyReview.jsx';

const DEFAULT_RECORD_FILTERS = {
  dateFrom: '',
  dateTo: '',
  rarity: 'all',
  method: 'all',
  pullMode: 'all',
  poolType: 'all'
};

function toDateTimeInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function buildDatePresetRange(preset) {
  const now = new Date();

  if (preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
      dateFrom: toDateTimeInputValue(start),
      dateTo: toDateTimeInputValue(now)
    };
  }

  if (preset === '7d' || preset === '30d') {
    const days = preset === '7d' ? 7 : 30;
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    return {
      dateFrom: toDateTimeInputValue(start),
      dateTo: toDateTimeInputValue(now)
    };
  }

  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return {
      dateFrom: toDateTimeInputValue(start),
      dateTo: toDateTimeInputValue(now)
    };
  }

  return {
    dateFrom: '',
    dateTo: ''
  };
}

function isGuaranteedHistoryPull(item) {
  return item?.specialType === 'guaranteed' || item?.special_type === 'guaranteed';
}

function getRecordMethod(item) {
  if (isGiftHistoryPull(item)) return 'gift';
  if (isFreeHistoryPull(item)) return 'free';
  if (isInfoBookHistoryPull(item)) return 'infobook';
  if (isGuaranteedHistoryPull(item)) return 'guaranteed';
  return 'normal';
}

function buildFilterStats(groupedHistory = []) {
  const stats = {
    groups: groupedHistory.length,
    pulls: 0,
    rarity: { 6: 0, 5: 0, 4: 0 },
    methods: {
      normal: 0,
      free: 0,
      infobook: 0,
      guaranteed: 0,
      gift: 0
    },
    pullMode: {
      singleGroups: 0,
      batchGroups: 0,
      singlePulls: 0,
      batchPulls: 0
    }
  };

  groupedHistory.forEach((group) => {
    const isBatch = group.length > 1;
    if (isBatch) {
      stats.pullMode.batchGroups += 1;
      stats.pullMode.batchPulls += group.length;
    } else {
      stats.pullMode.singleGroups += 1;
      stats.pullMode.singlePulls += group.length;
    }

    group.forEach((item) => {
      stats.pulls += 1;
      const rarity = Number(item?.rarity);
      if (stats.rarity[rarity] !== undefined) {
        stats.rarity[rarity] += 1;
      }

      const method = getRecordMethod(item);
      stats.methods[method] = (stats.methods[method] || 0) + 1;
    });
  });

  return stats;
}

/**
 * 记录列表组件
 * 显示历史抽卡记录，支持筛选、导入、导出、分页
 */
const RecordsView = ({
  onEdit,
  onDeleteItem,
  onDeleteGroup
}) => {
  const { t, formatNumber, locale } = useI18n();
  // 从 stores 获取状态
  const visibleHistoryCount = useHistoryStore(state => state.visibleHistoryCount);
  const loadMoreHistory = useHistoryStore(state => state.loadMoreHistory);
  const setVisibleHistoryCount = useHistoryStore(state => state.setVisibleHistoryCount);

  const user = useAuthStore(state => state.user);
  const canEdit = Boolean(user);

  const {
    currentPool,
    normalizedCurrentPoolHistory,
    poolsArray
  } = useCurrentPoolData();

  const canEditCurrentPool = canEdit;
  const isAllPoolsOverview = currentPool?.isAllPoolsOverview === true;
  const shouldShowRecordPoolName = isAllPoolsOverview || currentPool?.isGroupMode === true;
  const poolMetaById = useMemo(() => {
    const map = new Map();
    (Array.isArray(poolsArray) ? poolsArray : []).forEach((pool) => {
      const poolIds = [pool?.id, pool?.pool_id].filter(Boolean);
      if (poolIds.length === 0) {
        return;
      }
      const poolName = localizePoolName(pool, { locale }) || pool?.name || pool?.display_name || '';
      if (!poolName) {
        return;
      }
      poolIds.forEach((poolId) => {
        map.set(String(poolId), {
          name: poolName,
          type: pool?.type || pool?.pool_type || 'standard'
        });
      });
    });
    return map;
  }, [locale, poolsArray]);
  const [recordFilters, setRecordFilters] = useState(DEFAULT_RECORD_FILTERS);
  const effectiveRecordFilters = useMemo(() => (
    isAllPoolsOverview ? recordFilters : { ...recordFilters, poolType: 'all' }
  ), [isAllPoolsOverview, recordFilters]);

  const {
    groupedHistory,
    filteredGroupedHistory
  } = useCurrentPoolGroupedHistory(normalizedCurrentPoolHistory, {
    filters: effectiveRecordFilters,
    poolsArray
  });

  const updateRecordFilter = useCallback((key, value) => {
    setRecordFilters(prev => ({
      ...prev,
      [key]: value
    }));
    setVisibleHistoryCount(20);
  }, [setVisibleHistoryCount]);

  const resetRecordFilters = useCallback(() => {
    setRecordFilters(DEFAULT_RECORD_FILTERS);
    setVisibleHistoryCount(20);
  }, [setVisibleHistoryCount]);

  const applyDatePreset = useCallback((preset) => {
    const range = buildDatePresetRange(preset);
    setRecordFilters(prev => ({
      ...prev,
      ...range
    }));
    setVisibleHistoryCount(20);
  }, [setVisibleHistoryCount]);
  const hasActiveRecordFilters = useMemo(() => (
    Object.entries(recordFilters).some(([key, value]) => {
      if (key === 'poolType' && !isAllPoolsOverview) {
        return false;
      }
      return value && value !== 'all';
    })
  ), [isAllPoolsOverview, recordFilters]);
  const displayedGroupCount = Math.min(visibleHistoryCount, filteredGroupedHistory.length);
  const filterStats = useMemo(
    () => buildFilterStats(filteredGroupedHistory),
    [filteredGroupedHistory]
  );
  const filterSummaryChips = useMemo(() => {
    const chips = [
      {
        key: 'groups',
        label: t('records.filter.stat.groups'),
        value: t('records.filter.stat.groupsValue', {
          shown: formatNumber(displayedGroupCount),
          total: formatNumber(filterStats.groups),
          source: formatNumber(groupedHistory.length)
        }),
        className: 'text-slate-500 dark:text-zinc-400'
      },
      {
        key: 'pulls',
        label: t('records.filter.stat.pulls'),
        value: t('records.filter.stat.pullsValue', { count: formatNumber(filterStats.pulls) }),
        className: 'text-cyan-600 dark:text-cyan-300'
      },
      {
        key: 'rarity6',
        label: '6★',
        value: formatNumber(filterStats.rarity[6]),
        className: 'text-yellow-600 dark:text-yellow-400'
      },
      {
        key: 'rarity5',
        label: '5★',
        value: formatNumber(filterStats.rarity[5]),
        className: 'text-purple-600 dark:text-purple-300'
      },
      {
        key: 'rarity4',
        label: '4★',
        value: formatNumber(filterStats.rarity[4]),
        className: 'text-blue-600 dark:text-blue-300'
      },
      {
        key: 'single',
        label: t('records.filter.stat.single'),
        value: t('records.filter.stat.pullAndGroupValue', {
          pulls: formatNumber(filterStats.pullMode.singlePulls),
          groups: formatNumber(filterStats.pullMode.singleGroups)
        }),
        className: 'text-slate-500 dark:text-zinc-400'
      },
      {
        key: 'batch',
        label: t('records.filter.stat.batch'),
        value: t('records.filter.stat.pullAndGroupValue', {
          pulls: formatNumber(filterStats.pullMode.batchPulls),
          groups: formatNumber(filterStats.pullMode.batchGroups)
        }),
        className: 'text-slate-500 dark:text-zinc-400'
      }
    ];

    [
      ['free', t('records.filter.methodFree'), 'text-blue-600 dark:text-blue-300'],
      ['infobook', t('records.filter.methodInfoBook'), 'text-amber-600 dark:text-amber-300'],
      ['guaranteed', t('records.filter.methodGuaranteed'), 'text-pink-600 dark:text-pink-300'],
      ['gift', t('records.filter.methodGift'), 'text-purple-600 dark:text-purple-300']
    ].forEach(([key, label, className]) => {
      const count = filterStats.methods[key] || 0;
      if (count > 0 || recordFilters.method === key) {
        chips.push({
          key: `method-${key}`,
          label,
          value: t('records.filter.stat.pullsValue', { count: formatNumber(count) }),
          className
        });
      }
    });

    return chips;
  }, [displayedGroupCount, filterStats, formatNumber, groupedHistory.length, recordFilters.method, t]);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-none shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-fade-in relative">
      <HistoryAnomalyReview
        history={normalizedCurrentPoolHistory}
        currentPool={currentPool}
        user={user}
        onEdit={onEdit}
        onDeleteItem={onDeleteItem}
        className="border-x-0 border-t-0"
      />
      <div className="border-b border-zinc-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
            <Filter size={14} />
            <span>{t('records.filter.title')}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-1 normal-case tracking-normal">
              {filterSummaryChips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-none border border-zinc-200 bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-500 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <span className="text-slate-400 dark:text-zinc-500">{chip.label}</span>
                  <span className={`font-black ${chip.className}`}>{chip.value}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {['today', '7d', '30d', 'month'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyDatePreset(preset)}
                className="border border-zinc-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition-colors hover:border-yellow-500 hover:text-yellow-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-yellow-500 dark:hover:text-endfield-yellow"
              >
                {t(`records.filter.preset.${preset}`)}
              </button>
            ))}
            <button
              type="button"
              onClick={resetRecordFilters}
              className="inline-flex items-center gap-1 border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition-colors hover:border-red-400 hover:text-red-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
            >
              <RotateCcw size={12} />
              {t('records.filter.reset')}
            </button>
          </div>
        </div>

        <div className={`grid gap-3 sm:grid-cols-2 ${isAllPoolsOverview ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
              <CalendarRange size={12} />
              {t('records.filter.dateFrom')}
            </span>
            <input
              type="datetime-local"
              value={recordFilters.dateFrom}
              onChange={(event) => updateRecordFilter('dateFrom', event.target.value)}
              className="w-full border border-zinc-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-colors focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            />
          </label>

          <label className="space-y-1">
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
              <CalendarRange size={12} />
              {t('records.filter.dateTo')}
            </span>
            <input
              type="datetime-local"
              value={recordFilters.dateTo}
              onChange={(event) => updateRecordFilter('dateTo', event.target.value)}
              className="w-full border border-zinc-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-colors focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
              {t('records.filter.rarity')}
            </span>
            <select
              value={recordFilters.rarity}
              onChange={(event) => updateRecordFilter('rarity', event.target.value)}
              className="w-full border border-zinc-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-colors focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            >
              <option value="all">{t('records.filter.allRarity')}</option>
              <option value="6">{t('records.filter.sixStar')}</option>
              <option value="5">{t('records.filter.fiveStar')}</option>
              <option value="4">{t('records.filter.fourStar')}</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
              {t('records.filter.method')}
            </span>
            <select
              value={recordFilters.method}
              onChange={(event) => updateRecordFilter('method', event.target.value)}
              className="w-full border border-zinc-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-colors focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            >
              <option value="all">{t('records.filter.methodAll')}</option>
              <option value="normal">{t('records.filter.methodNormal')}</option>
              <option value="free">{t('records.filter.methodFree')}</option>
              <option value="infobook">{t('records.filter.methodInfoBook')}</option>
              <option value="guaranteed">{t('records.filter.methodGuaranteed')}</option>
              <option value="gift">{t('records.filter.methodGift')}</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
              {t('records.filter.pullMode')}
            </span>
            <select
              value={recordFilters.pullMode}
              onChange={(event) => updateRecordFilter('pullMode', event.target.value)}
              className="w-full border border-zinc-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-colors focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            >
              <option value="all">{t('records.filter.pullModeAll')}</option>
              <option value="single">{t('records.filter.pullModeSingle')}</option>
              <option value="batch">{t('records.filter.pullModeBatch')}</option>
            </select>
          </label>

          {isAllPoolsOverview && (
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
                {t('records.filter.poolType')}
              </span>
              <select
                value={recordFilters.poolType}
                onChange={(event) => updateRecordFilter('poolType', event.target.value)}
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-colors focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
              >
                <option value="all">{t('records.filter.poolTypeAll')}</option>
                <option value="limited">{t('records.filter.poolTypeLimited')}</option>
                <option value="extra">{t('records.filter.poolTypeExtra')}</option>
                <option value="standard">{t('records.filter.poolTypeStandard')}</option>
                <option value="weapon">{t('records.filter.poolTypeWeapon')}</option>
              </select>
            </label>
          )}
        </div>
      </div>

      {/* 记录列表 */}
      <div className="max-h-[800px] overflow-y-auto bg-slate-50 dark:bg-zinc-950/50">
        {filteredGroupedHistory.length === 0 ? (
          <div className="p-12 text-center text-slate-400 dark:text-zinc-500">
            {hasActiveRecordFilters ? t('records.empty.filtered') : t('records.empty.all')}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredGroupedHistory.slice(0, visibleHistoryCount).map((group, idx) => (
              <BatchCard
                key={idx}
                group={group}
                onEdit={onEdit}
                onDeleteGroup={onDeleteGroup}
                poolType={currentPool?.type}
                canEdit={canEditCurrentPool}
                showPoolName={shouldShowRecordPoolName}
                poolMetaById={poolMetaById}
              />
            ))}

            {/* 加载更多按钮 */}
            {visibleHistoryCount < filteredGroupedHistory.length && (
              <div className="p-4 flex justify-center">
                <button
                  onClick={loadMoreHistory}
                  className="text-sm text-slate-500 dark:text-zinc-500 hover:text-yellow-600 dark:hover:text-endfield-yellow font-medium px-6 py-2 rounded-sm border border-zinc-200 dark:border-zinc-800 hover:border-yellow-200 dark:hover:border-yellow-800 bg-white dark:bg-zinc-900 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-all shadow-sm"
                >
                  {t('records.loadMore', { count: filteredGroupedHistory.length - visibleHistoryCount })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RecordsView;
