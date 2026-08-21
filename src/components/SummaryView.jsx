import React from 'react';
import {
  BarChart3,
  BookOpen,
  Cloud,
  Layers,
  RefreshCw,
  Star,
  Swords,
  User
} from 'lucide-react';
import { useAppStore, useAuthStore, useHistoryStore, usePoolStore } from '../stores';
import { useI18n } from '../i18n/index.js';
import {
  ChartSection,
  CharacterCatalogView,
  SummarySidebar
} from './summary';
import ResourceSummaryPanel from './resources/ResourceSummaryPanel';
import { useThemeDetection, getTooltipStyle, useSummaryViewState } from '../hooks/summary';
import { getCombinedCharacterAverageDisplay } from '../utils/summaryAverageDisplay.js';

function MetricCard({ icon: Icon, label, value, hint, tone = 'text-slate-900 dark:text-white' }) {
  return (
    <div className="relative min-w-0 overflow-hidden border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800/50 dark:bg-zinc-950/50">
      {Icon && <Icon size={38} className="absolute right-2 top-2 text-zinc-200 transition-transform group-hover/stat:scale-110 dark:text-zinc-800" />}
      <div className="relative z-10">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</div>
        <div className={`break-words font-mono text-2xl font-black leading-tight ${tone}`}>{value}</div>
        {hint && <div className="mt-1 text-[10px] font-mono text-zinc-500">{hint}</div>}
      </div>
    </div>
  );
}

function StatsHeader({
  dataSource,
  currentStats,
  contributorRegionStats,
  formatCount,
  tt
}) {
  return (
    <div className="mb-6 flex items-center justify-between border-b border-zinc-100 pb-4 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <div className={`rounded-sm p-2 ${
          dataSource === 'global'
            ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-500'
        }`}>
          {dataSource === 'global' ? <Cloud size={20} /> : <User size={20} />}
        </div>
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-wider text-slate-800 dark:text-white">
            {currentStats.title}
            <span className="rounded-sm border border-zinc-200 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-700">
              {dataSource === 'global' ? tt('summary.badge.global', '全服') : tt('summary.badge.local', '本地')}
            </span>
          </h2>
          <span className="mt-0.5 block font-mono text-xs text-zinc-500">
            {tt('summary.metric.scopeLabel', '范围')} // {currentStats.subtitle}
          </span>
        </div>
      </div>

      {currentStats.totalUsers ? (
        <div className="text-right">
          <span className="block font-mono text-[10px] uppercase tracking-widest text-zinc-400">{tt('summary.metric.contributors', '贡献者')}</span>
          <span className="font-mono text-xl font-bold text-slate-700 dark:text-zinc-300">
            {formatCount(currentStats.totalContributors || currentStats.totalUsers)}
          </span>
          {currentStats.totalContributors && currentStats.totalContributors !== currentStats.totalUsers && (
            <span className="block font-mono text-[10px] text-zinc-500">
              {tt('summary.metric.registered', '注册')}: {formatCount(currentStats.totalUsers)}
            </span>
          )}
          {contributorRegionStats && (
            <div className="mt-1 flex flex-wrap justify-end gap-1 font-mono text-[10px] text-zinc-500">
              <span>{tt('summary.metric.cn', '国服')}: {formatCount(contributorRegionStats.cn || 0)}</span>
              <span>{tt('summary.metric.intl', '国际服')}: {formatCount(contributorRegionStats.intl || 0)}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function OverviewAllPoolsLegacy({ currentStats, dataSource, ranking, formatCount, formatPercent, tt }) {
  const characterStats = currentStats.byType?.character || {};
  const weaponStats = currentStats.byType?.weapon || {};
  const limitedStats = currentStats.byType?.limited || {};
  const extraStats = currentStats.byType?.extra || {};
  const standardStats = currentStats.byType?.standard || {};

  const totalCharacterSix = Number(characterStats.six || 0);
  const totalCharacterTargets = Number(characterStats.sixStarLimited ?? characterStats.limitedSix ?? 0);
  // 真不歪率（对齐 gui.cpp 50/50）：分子分母均剔除硬保底强制 UP（spark）。
  // 展示的「不歪/歪」计数保持总数不变；仅此率为 50/50 条件率。
  // 注：全服数据来自服务端无 spark 字段 → spark=0，退化为旧口径（含保底），待 SQL 跟进。
  const characterSpark = Number(characterStats.sparkCount || 0);
  const characterTargetRate = (totalCharacterSix - characterSpark) > 0
    ? (Math.max(totalCharacterTargets - characterSpark, 0) / (totalCharacterSix - characterSpark)) * 100
    : 0;
  const weaponSix = Number(weaponStats.six || 0);
  const weaponTargets = Number(weaponStats.sixStarLimited ?? weaponStats.limitedSix ?? 0);
  const weaponSpark = Number(weaponStats.sparkCount || 0);
  const weaponTargetRate = (weaponSix - weaponSpark) > 0
    ? (Math.max(weaponTargets - weaponSpark, 0) / (weaponSix - weaponSpark)) * 100
    : 0;
  const characterSixDisplay = (() => {
    const extraSixTotal = Number(extraStats.six || 0);
    const limitedSixTotal = Number(limitedStats.six || 0);
    const standardSixTotal = Number(standardStats.six || 0);
    const totalSix = extraSixTotal + limitedSixTotal + standardSixTotal;
    const limitedSixExcludingFree = dataSource === 'global' ? ranking?.limited?.sixStarExcludingFree : undefined;

    if (limitedSixExcludingFree !== undefined && limitedSixExcludingFree !== null) {
      return extraSixTotal + Number(limitedSixExcludingFree || 0) + standardSixTotal;
    }

    return totalSix || totalCharacterSix;
  })();
  const characterSixWithFree = (() => {
    const extraSixTotal = Number(extraStats.six || 0);
    const limitedSixTotal = Number(limitedStats.six || 0);
    const standardSixTotal = Number(standardStats.six || 0);
    const totalSix = extraSixTotal + limitedSixTotal + standardSixTotal;
    const limitedSixExcludingFree = dataSource === 'global' ? ranking?.limited?.sixStarExcludingFree : undefined;

    if (limitedSixExcludingFree === undefined || limitedSixExcludingFree === null) {
      return null;
    }

    const totalExcludingFree = extraSixTotal + Number(limitedSixExcludingFree || 0) + standardSixTotal;
    return totalExcludingFree === totalSix ? null : totalSix;
  })();
  const characterAverageDisplay = getCombinedCharacterAverageDisplay({
    characterStats,
    extraStats,
    limitedStats,
    standardStats
  });

  return (
    <div className="space-y-4">
      <div className="group/stat relative overflow-hidden border border-zinc-100 bg-zinc-50 p-5 dark:border-zinc-800/50 dark:bg-zinc-950/50">
        <div className="absolute right-0 top-0 p-2 text-zinc-200 transition-transform group-hover/stat:scale-110 dark:text-zinc-800"><Layers size={40} /></div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{tt('summary.metric.totalPulls', '总抽数')}</div>
        <div className="font-mono text-3xl font-black text-slate-800 dark:text-white">{formatCount(currentStats.total || 0)}</div>
      </div>

      <div className="space-y-4">
        <div className="border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950/30">
          <div className="mb-4 flex items-center gap-2 border-b border-dashed border-zinc-200 pb-2 dark:border-zinc-800">
            <Star size={16} className="text-violet-500" />
            <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-zinc-300">{tt('summary.section.characterBannerData', '角色池数据')}</h4>
            <span className="ml-auto font-mono text-[10px] text-zinc-400">{tt('summary.section.characterBannerSubtitle', '附加 + 限定 + 常驻')}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-6">
            <LegacyStat label={tt('summary.metric.totalPulls', '总抽数')} value={formatCount(characterStats.total || 0)} tone="text-slate-700 dark:text-zinc-200" />
            <LegacyStat
              label={tt('summary.metric.sixStarCount', '6★ 数量')}
              value={<>{formatCount(characterSixDisplay)}{currentStats.charGift > 0 && <span className="ml-1 text-xs text-purple-500">+{formatCount(currentStats.charGift)}</span>}</>}
              hint={characterSixWithFree !== null ? <>{tt('summary.metric.withFree', '含免费')}: <span className="text-zinc-400">{formatCount(characterSixWithFree)}</span></> : null}
              tone="text-amber-500"
            />
            <LegacyStat
              label={tt('summary.metric.avgSixStarDrop', '六星平均出货')}
              value={characterAverageDisplay.value}
              hint={characterAverageDisplay.withFree !== null ? <>{tt('summary.metric.withFree', '含免费')}: <span className="text-zinc-400">{characterAverageDisplay.withFree}</span></> : tt('summary.metric.avgAllSixHint', '全部6★ 抽/个')}
              tone="text-indigo-500"
            />
            {(characterStats.avgPityUp || limitedStats.avgPityUp) && (
              <LegacyStat label={tt('summary.metric.avgTargetSixStarDrop', 'UP六星平均出货')} value={characterStats.avgPityUp || limitedStats.avgPityUp} hint={tt('summary.metric.avgTargetSixHint', '仅当期目标6★ 抽/个')} tone="text-emerald-500" />
            )}
            <LegacyStat label={tt('summary.metric.targetVsOff', '不歪/歪')} value={<><span className="text-emerald-500">{formatCount(totalCharacterTargets)}</span><span className="mx-1 text-zinc-400">/</span><span className="text-rose-500">{formatCount(Math.max(totalCharacterSix - totalCharacterTargets, 0))}</span><span className="ml-1 text-xs text-zinc-400">({formatPercent(characterTargetRate)})</span></>} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-3 font-mono text-xs text-zinc-500 dark:border-zinc-800/50 xl:grid-cols-3">
            <PoolBreakdownLine colorClass="bg-cyan-500/50" label={tt('summary.scope.extra', '附加寻访')} total={extraStats.total} avg={extraStats.avgPityExcludingFree || extraStats.avgPity} withFreeAvg={extraStats.avgPityExcludingFree && extraStats.avgPityExcludingFree !== extraStats.avgPity ? extraStats.avgPity : null} formatCount={formatCount} tt={tt} />
            <PoolBreakdownLine colorClass="bg-emerald-500/50" label={tt('summary.scope.limited', '限定角色池')} total={limitedStats.total} avg={limitedStats.avgPityExcludingFree || limitedStats.avgPity} withFreeAvg={limitedStats.avgPityExcludingFree && limitedStats.avgPityExcludingFree !== limitedStats.avgPity ? limitedStats.avgPity : null} formatCount={formatCount} tt={tt} />
            <PoolBreakdownLine colorClass="bg-indigo-500/50" label={tt('summary.scope.standard', '常驻池')} total={standardStats.total} avg={standardStats.avgPity} formatCount={formatCount} tt={tt} />
          </div>
        </div>

        <div className="border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950/30">
          <div className="mb-4 flex items-center gap-2 border-b border-dashed border-zinc-200 pb-2 dark:border-zinc-800">
            <Swords size={16} className="text-slate-500" />
            <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-zinc-300">{tt('summary.section.weaponBannerData', '武器池数据')}</h4>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-6">
            <LegacyStat label={tt('summary.metric.totalPulls', '总抽数')} value={formatCount(weaponStats.total || 0)} tone="text-slate-700 dark:text-zinc-200" />
            <LegacyStat label={tt('summary.metric.sixStarCount', '6★ 数量')} value={<>{formatCount(weaponStats.six || 0)}{(currentStats.weaponGiftLimited > 0 || currentStats.weaponGiftStandard > 0) && <span className="ml-1 text-xs text-purple-500">+{formatCount((currentStats.weaponGiftLimited || 0) + (currentStats.weaponGiftStandard || 0))}</span>}</>} tone="text-amber-500" />
            <LegacyStat label={tt('summary.metric.avgSixStarDrop', '六星平均出货')} value={weaponStats.avgPity || '-'} hint={tt('summary.metric.avgAllSixHint', '全部6★ 抽/个')} tone="text-indigo-500" />
            {weaponStats.avgPityUp && (
              <LegacyStat label={tt('summary.metric.avgTargetSixStarDrop', 'UP六星平均出货')} value={weaponStats.avgPityUp} hint={tt('summary.metric.avgTargetSixHint', '仅当期目标6★ 抽/个')} tone="text-emerald-500" />
            )}
            <LegacyStat label={tt('summary.metric.targetVsOff', '不歪/歪')} value={<><span className="text-emerald-500">{formatCount(weaponTargets)}</span><span className="mx-1 text-zinc-400">/</span><span className="text-rose-500">{formatCount(Math.max(weaponSix - weaponTargets, 0))}</span><span className="ml-1 text-xs text-zinc-400">({formatPercent(weaponTargetRate)})</span></>} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LegacyStat({ label, value, hint, tone = 'text-slate-800 dark:text-white', dot }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-zinc-400">
        {dot && <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dot}`} />}
        <span className="break-words leading-tight">{label}</span>
      </div>
      <div className={`font-mono text-xl font-bold leading-tight ${tone}`}>{value}</div>
      {hint && <div className="break-words font-mono text-[10px] leading-tight text-zinc-500">{hint}</div>}
    </div>
  );
}

function PoolBreakdownLine({ colorClass, label, total, avg, withFreeAvg, formatCount, tt }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-zinc-500">
      <span className={`h-2 w-2 flex-shrink-0 rounded-sm ${colorClass}`} />
      <span>{label}: {formatCount(total || 0)} {tt('summary.metric.pullsUnit', '抽')}</span>
      <span className="ml-auto flex items-center gap-1 text-right">
        <span className="text-slate-600 dark:text-zinc-300">{avg || '-'} {tt('summary.metric.averageShort', '平均')}</span>
        {withFreeAvg && (
          <span className="text-zinc-400">({tt('summary.metric.withFree', '含免费')}: {withFreeAvg})</span>
        )}
      </span>
    </div>
  );
}

function OverviewSinglePool({ currentStats, formatCount, formatPercent, tt }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4">
      <MetricCard
        label={tt('summary.metric.totalPulls', '总抽数')}
        value={formatCount(currentStats.total || 0)}
      />
      <MetricCard
        label={tt('summary.metric.sixStarCount', '6★ 数量')}
        value={formatCount(currentStats.sixStar || 0)}
        hint={`${tt('summary.metric.probability', '概率')}: ${currentStats.total > 0 ? formatPercent((currentStats.sixStar / currentStats.total) * 100, 2) : formatPercent(0, 2)}`}
        tone="text-amber-500"
      />
      <MetricCard
        label={tt('summary.metric.avgSixStarDrop', '六星平均出货')}
        value={currentStats.avgPityExcludingFree || currentStats.avgPity || '-'}
        hint={tt('summary.metric.avgAllSixHint', '全部6★ 抽/个')}
        tone="text-indigo-600 dark:text-indigo-400"
      />
      {currentStats.avgPityUp && (
        <MetricCard
          label={tt('summary.metric.avgTargetSixStarDrop', 'UP六星平均出货')}
          value={currentStats.avgPityUp}
          hint={tt('summary.metric.avgTargetSixHint', '仅当期目标6★ 抽/个')}
          tone="text-emerald-600 dark:text-emerald-400"
        />
      )}
      <MetricCard
        label={tt('summary.metric.targetVsOff', '不歪/歪')}
        value={`${formatCount(currentStats.sixStarLimited || 0)} / ${formatCount(currentStats.sixStarStandard || 0)}`}
        hint={`${tt('summary.metric.targetRate', '不歪率')}: ${
          (Number(currentStats.sixStar || 0) - Number(currentStats.sparkCount || 0)) > 0
            ? formatPercent((Math.max(Number(currentStats.sixStarLimited || 0) - Number(currentStats.sparkCount || 0), 0) / (Number(currentStats.sixStar || 0) - Number(currentStats.sparkCount || 0))) * 100)
            : formatPercent(0)
        }`}
        tone="text-slate-800 dark:text-white"
      />
    </div>
  );
}

function SummaryOverviewContent({
  currentStats,
  dataSource,
  poolTypeFilter,
  globalStatsLoading,
  globalStats,
  showGlobalStatsFallbackNotice,
  contributorRegionStats,
  chartDisplayData,
  tooltipStyle,
  isDark,
  ranking,
  formatCount,
  formatPercent,
  tt
}) {
  if (globalStatsLoading || (dataSource === 'global' && !globalStats)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 border border-zinc-200 bg-zinc-50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
        <RefreshCw size={32} className="animate-spin text-zinc-400" />
        <span className="font-mono text-sm uppercase tracking-widest text-zinc-500">{tt('summary.loading.data', '正在获取数据...')}</span>
      </div>
    );
  }

  if (!currentStats) {
    return (
      <div className="border border-zinc-800 bg-zinc-900 p-12 text-center font-mono text-zinc-500">
        {tt('summary.empty', '暂无数据')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="group relative overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:20px_20px] dark:bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)]" />
        <div className="h-1 w-full bg-endfield-yellow" />
        <div className="relative z-10 p-6">
          {showGlobalStatsFallbackNotice && (
            <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              {currentStats.meta.status === 'stale'
                ? tt('summary.notice.globalStale', '全服汇总暂时使用上次成功缓存，跨境网络较慢时请稍后重试。')
                : tt('summary.notice.globalUnavailable', '全服汇总暂时不可用，当前网络或数据库响应较慢；排行榜和本地统计仍可继续查看。')}
            </div>
          )}

          <StatsHeader
            dataSource={dataSource}
            currentStats={currentStats}
            contributorRegionStats={contributorRegionStats}
            formatCount={formatCount}
            tt={tt}
          />

          {poolTypeFilter === 'all' ? (
            <OverviewAllPoolsLegacy
              currentStats={currentStats}
              dataSource={dataSource}
              ranking={ranking}
              formatCount={formatCount}
              formatPercent={formatPercent}
              tt={tt}
            />
          ) : (
            <OverviewSinglePool
              currentStats={currentStats}
              formatCount={formatCount}
              formatPercent={formatPercent}
              tt={tt}
            />
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(0,0,0,0.05)_10px,rgba(0,0,0,0.05)_20px)] dark:bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.02)_10px,rgba(255,255,255,0.02)_20px)]" />
      </div>

      {currentStats.resources && (
        poolTypeFilter === 'all' ? (
          <ResourceSummaryPanel
            title={tt('summary.section.allResourceSummary', '全卡池资源统计')}
            resources={currentStats.resources}
            variant="all"
            layout="grouped"
          />
        ) : (
          <ResourceSummaryPanel
            title={poolTypeFilter === 'weapon'
              ? tt('summary.section.weaponResourceSummary', '武器池资源统计')
              : tt('summary.section.characterResourceSummary', '角色池资源统计')}
            resources={currentStats.resources}
            variant={poolTypeFilter === 'weapon' ? 'weapon' : 'character'}
          />
        )
      )}

      <div className="space-y-6">
        {chartDisplayData.charts.map((chart, index) => (
          <ChartSection
            key={index}
            title={chart.title}
            subtitle={chart.subtitle}
            color={chart.color}
            data={chart.data}
            isGlobal={chartDisplayData.isGlobal}
            tooltipStyle={tooltipStyle}
            isDark={isDark}
          />
        ))}
      </div>
    </div>
  );
}

const SummaryView = React.memo(() => {
  const { t, formatNumber } = useI18n();
  const tt = (key, fallback, params = {}) => t(key, params, fallback);
  const formatCount = (value) => formatNumber(Number(value) || 0);
  const formatPercent = (value, digits = 1) => `${formatNumber(Number(value) || 0, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`;
  const user = useAuthStore((state) => state.user);
  const pools = usePoolStore((state) => state.pools);
  const history = useHistoryStore((state) => state.history);
  const globalStats = useAppStore((state) => state.globalStats);
  const globalStatsLoading = useAppStore((state) => state.globalStatsLoading);
  const fetchGlobalStats = useAppStore((state) => state.fetchGlobalStats);
  const [activePage, setActivePage] = React.useState('overview');

  const isDark = useThemeDetection();
  const tooltipStyle = getTooltipStyle(isDark);
  const {
    dataSource,
    setDataSource,
    poolTypeFilter,
    setPoolTypeFilter,
    localStats,
    currentStats,
    chartDisplayData,
    ranking,
    isRankingLoading
  } = useSummaryViewState({
    history,
    pools,
    user,
    globalStats,
    fetchGlobalStats,
    variant: 'desktop'
  });

  const globalStatsMeta = dataSource === 'global' ? currentStats?.meta : null;
  const showGlobalStatsFallbackNotice = globalStatsMeta && globalStatsMeta.status && globalStatsMeta.status !== 'ready';
  const contributorRegionStats = dataSource === 'global' ? currentStats?.contributorsByRegion : null;

  const pageTabs = [
    { value: 'overview', label: tt('summary.page.overview', '统计概览'), icon: BarChart3 },
    { value: 'catalog', label: tt('characterCatalog.title', '角色图鉴'), icon: BookOpen }
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex min-w-0 gap-6">
        <SummarySidebar
          dataSource={dataSource}
          setDataSource={setDataSource}
          poolTypeFilter={poolTypeFilter}
          setPoolTypeFilter={setPoolTypeFilter}
          globalStats={globalStats}
          localStats={localStats}
        />

        <div className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-wrap gap-2 border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
            {pageTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActivePage(tab.value)}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-bold transition ${
                    activePage === tab.value
                      ? 'bg-slate-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                      : 'text-zinc-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activePage === 'catalog' ? (
            <CharacterCatalogView
              dataSource={dataSource}
              setDataSource={setDataSource}
              history={history}
              pools={pools}
              user={user}
              globalStats={globalStats}
              localStats={localStats}
              currentStats={currentStats}
              fetchGlobalStats={fetchGlobalStats}
              globalStatsLoading={globalStatsLoading}
              ranking={ranking}
              isRankingLoading={isRankingLoading}
            />
          ) : (
            <SummaryOverviewContent
              currentStats={currentStats}
              dataSource={dataSource}
              poolTypeFilter={poolTypeFilter}
              globalStatsLoading={globalStatsLoading}
              globalStats={globalStats}
              showGlobalStatsFallbackNotice={showGlobalStatsFallbackNotice}
              contributorRegionStats={contributorRegionStats}
              chartDisplayData={chartDisplayData}
              tooltipStyle={tooltipStyle}
              isDark={isDark}
              ranking={ranking}
              formatCount={formatCount}
              formatPercent={formatPercent}
              tt={tt}
            />
          )}
        </div>
      </div>
    </div>
  );
});

export default SummaryView;
