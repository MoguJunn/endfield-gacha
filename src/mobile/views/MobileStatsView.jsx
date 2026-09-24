import React from 'react';
import { BarChart3, BookOpen, Cloud, Globe, Layers, User } from 'lucide-react';
import usePoolStore from '../../stores/usePoolStore';
import useHistoryStore from '../../stores/useHistoryStore';
import useAppStore from '../../stores/useAppStore';
import useAuthStore from '../../stores/useAuthStore';
import ResourceSummaryPanel from '../../components/resources/ResourceSummaryPanel.jsx';
import { CharacterCatalogView, ChartSection } from '../../components/summary';
import { getTooltipStyle, useSummaryViewState, useThemeDetection } from '../../hooks/summary';
import { useI18n } from '../../i18n/index.js';
import { useHorizontalWheelScroll } from '../../hooks/useHorizontalWheelScroll.js';

function StatCard({ icon: Icon, label, value, hint, tone = 'text-slate-900 dark:text-white' }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white/80 p-3 shadow-sm backdrop-blur-xl dark:border-zinc-800/50 dark:bg-zinc-900/70">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-500">
        {Icon && <Icon size={12} />}
        {label}
      </div>
      <div className={`mt-1.5 break-words font-mono text-xl font-black leading-tight ${tone}`}>{value}</div>
      {hint && <div className="mt-1 text-[9px] leading-tight text-slate-500 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}

function TypeCard({ title, total, six, avgPity, avgPityUp, targetVsOff, targetRate, subtitle, breakdownLines }) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-zinc-200 bg-white/80 p-3 shadow-sm backdrop-blur-xl dark:border-zinc-800/50 dark:bg-zinc-900/70">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-dashed border-zinc-200 pb-2.5 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="truncate text-xs font-black text-slate-900 dark:text-white">{title}</div>
          {subtitle ? <div className="mt-0.5 truncate text-[9px] font-mono text-slate-500 dark:text-zinc-500">{subtitle}</div> : null}
        </div>
        <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">6★</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatCard label={t('summary.metric.totalPulls')} value={total} />
        <StatCard label="6★" value={six} tone="text-amber-600 dark:text-amber-400" />
        <StatCard label={t('stats.avgSix')} value={avgPity} tone="text-indigo-600 dark:text-indigo-400" />
        <StatCard label={t('stats.avgTarget')} value={avgPityUp} tone="text-emerald-600 dark:text-emerald-400" />
        {targetVsOff ? (
          <StatCard
            label={t('summary.metric.targetVsOff', {}, '不歪/歪')}
            value={targetVsOff}
            hint={targetRate ? `${t('summary.metric.targetRate', {}, '不歪率')}: ${targetRate}` : undefined}
            tone="text-slate-900 dark:text-white"
          />
        ) : null}
      </div>
      {breakdownLines?.length ? (
        <div className="mt-3 space-y-1.5 border-t border-zinc-200 pt-2.5 font-mono text-[9px] text-slate-500 dark:border-zinc-800 dark:text-zinc-500">
          {breakdownLines.map((line) => (
            <div key={line.label} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-sm ${line.colorClass}`} />
              <span className="min-w-0 flex-1 truncate">{line.label}: {line.total}</span>
              <span className="shrink-0 text-slate-700 dark:text-zinc-300">{line.avg}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatAverageValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric.toFixed(1) : '-';
}

function getPoolAverageSixValue(poolStats) {
  const avgExcludingFree = Number(poolStats?.avgPityExcludingFree);
  if (Number.isFinite(avgExcludingFree) && avgExcludingFree > 0) {
    return avgExcludingFree;
  }

  const avgWithFree = Number(poolStats?.avgPity);
  return Number.isFinite(avgWithFree) && avgWithFree > 0 ? avgWithFree : null;
}

function formatPercentValue(formatNumber, value, digits = 1) {
  return `${formatNumber(Number(value) || 0, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`;
}

function MobileStatsView() {
  const user = useAuthStore((state) => state.user);
  const pools = usePoolStore((state) => state.pools);
  const history = useHistoryStore((state) => state.history);
  const globalStats = useAppStore((state) => state.globalStats);
  const globalStatsLoading = useAppStore((state) => state.globalStatsLoading);
  const fetchGlobalStats = useAppStore((state) => state.fetchGlobalStats);
  const { t, formatNumber } = useI18n();
  const isDark = useThemeDetection();
  const tooltipStyle = React.useMemo(() => getTooltipStyle(isDark), [isDark]);
  const [activePage, setActivePage] = React.useState('overview');
  const pageTabsRef = useHorizontalWheelScroll();
  const poolTypeTabsRef = useHorizontalWheelScroll();
  const sourceTabsRef = useHorizontalWheelScroll();
  const {
    dataSource,
    setDataSource,
    poolTypeFilter,
    setPoolTypeFilter,
    localStats,
    currentStats,
    chartDisplayData,
    ranking,
    isRankingLoading,
    filterOptions
  } = useSummaryViewState({
    history,
    pools,
    user,
    globalStats,
    fetchGlobalStats,
    variant: 'mobile',
    initialDataSource: 'global',
    initialPoolTypeFilter: 'all'
  });

  const loading = dataSource === 'global' ? (globalStatsLoading || !currentStats) : !currentStats;
  const totalContributors = Number(currentStats?.totalContributors ?? currentStats?.totalUsers ?? 0) || 0;
  const contributorRegionStats = currentStats?.contributorsByRegion || null;
  const activeUsers30d = Number(currentStats?.activeUsers30d || 0);
  const newUsers30d = Number(currentStats?.newUsers30d || 0);
  const hasContributorActivityStats = activeUsers30d > 0 || newUsers30d > 0;
  const pageOptions = [
    { value: 'overview', label: t('summary.page.overview', {}, '统计概览'), icon: BarChart3 },
    { value: 'catalog', label: t('characterCatalog.title', {}, '角色图鉴'), icon: BookOpen }
  ];
  const sourceOptions = [
    { value: 'global', label: t('summary.source.global', {}, '全服数据'), icon: Cloud },
    { value: 'local', label: t('summary.source.local', {}, '我的数据'), icon: User }
  ];
  const characterStats = currentStats?.byType?.character || {};
  const weaponStats = currentStats?.byType?.weapon || {};
  const extraStats = currentStats?.byType?.extra || {};
  const limitedStats = currentStats?.byType?.limited || {};
  const standardStats = currentStats?.byType?.standard || {};
  const formatCount = React.useCallback((value) => formatNumber(Number(value) || 0), [formatNumber]);
  const formatPercent = React.useCallback((value, digits = 1) => formatPercentValue(formatNumber, value, digits), [formatNumber]);
  const renderChartSections = () => (
    chartDisplayData?.charts?.length ? (
      <div className="space-y-3">
        {chartDisplayData.charts.map((chart, index) => (
          <ChartSection
            key={`${chart.title}-${index}`}
            title={chart.title}
            subtitle={chart.subtitle}
            color={chart.color}
            data={chart.data}
            isGlobal={chartDisplayData.isGlobal}
            tooltipStyle={tooltipStyle}
            isDark={isDark}
            mobile
          />
        ))}
      </div>
    ) : null
  );

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-x-hidden overflow-y-auto pb-20 slide-right-enter scroll-smooth">
      <div className="shrink-0 border-b border-zinc-200 bg-white/95 px-3 pb-2.5 pt-4 backdrop-blur-xl dark:border-zinc-800/50 dark:bg-ef-dark/95">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-black tracking-wider text-slate-900 dark:text-white">{t('nav.stats')}</h1>
        </div>

        <div
          ref={pageTabsRef}
          className="mb-1.5 flex overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900/80"
        >
          {pageOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setActivePage(option.value)}
                className={`flex min-w-[6rem] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold transition-all ${
                  activePage === option.value
                    ? 'bg-zinc-200 text-slate-900 shadow-sm dark:bg-zinc-800 dark:text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-300'
                }`}
              >
                <Icon size={12} />
                {option.label}
              </button>
            );
          })}
        </div>

        {activePage === 'overview' ? (
          <div
            ref={poolTypeTabsRef}
            className="flex overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900/80"
          >
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPoolTypeFilter(option.value)}
                className={`min-w-[62px] flex-1 shrink-0 rounded-md px-2 py-1 text-[10px] font-bold transition-all ${
                  poolTypeFilter === option.value
                    ? 'bg-zinc-200 text-slate-900 shadow-sm dark:bg-zinc-800 dark:text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <div
            ref={sourceTabsRef}
            className="flex overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900/80"
          >
            {sourceOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDataSource(option.value)}
                  className={`flex min-w-[6rem] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold transition-all ${
                    dataSource === option.value
                      ? 'bg-zinc-200 text-slate-900 shadow-sm dark:bg-zinc-800 dark:text-white'
                      : 'text-slate-500 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-300'
                  }`}
                >
                <Icon size={12} />
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6 pt-3">
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
            mobile
          />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-2 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-indigo-100 p-1.5 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                  <Globe size={14} />
                </div>
                <div>
                  <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                    {dataSource === 'global' ? t('summary.source.global', {}, '全服数据') : t('summary.source.local', {}, '我的数据')}
                  </h2>
                  <span className="mt-0.5 block font-mono text-[9px] text-slate-500 dark:text-zinc-500">
                    TARGET // {filterOptions.find((option) => option.value === poolTypeFilter)?.label || 'ALL'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="block font-mono text-[8px] uppercase tracking-widest text-slate-500 dark:text-zinc-500">{t('stats.contributors')}</span>
                <span className="font-mono text-xs font-bold text-slate-700 dark:text-zinc-300">{formatNumber(totalContributors)}</span>
                {contributorRegionStats ? (
                  <div className="mt-1 flex flex-wrap justify-end gap-1 font-mono text-[9px] text-slate-500 dark:text-zinc-500">
                    <span>{t('summary.metric.cn')}: {formatNumber(contributorRegionStats.cn || 0)}</span>
                    <span>{t('summary.metric.intl')}: {formatNumber(contributorRegionStats.intl || 0)}</span>
                  </div>
                ) : null}
                {hasContributorActivityStats ? (
                  <div className="mt-1 flex flex-wrap justify-end gap-1 font-mono text-[9px] text-slate-500 dark:text-zinc-500">
                    <span>{t('summary.metric.activeUsers30d', {}, '30日活跃')}: {formatNumber(activeUsers30d)}</span>
                    <span>{t('summary.metric.newUsers30d', {}, '30日新增')}: {formatNumber(newUsers30d)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center font-mono text-sm text-slate-500 dark:text-zinc-500">{t('common.loading')}</div>
            ) : poolTypeFilter === 'all' ? (
              <div className="space-y-3">
                <StatCard
                  icon={Layers}
                  label={t('summary.metric.totalPulls')}
                  value={formatNumber(currentStats?.total || 0)}
                />

                <div className="grid grid-cols-1 gap-3">
                  <TypeCard
                    title={t('summary.section.characterBannerData', {}, '角色池数据')}
                    subtitle={t('summary.section.characterBannerSubtitle', {}, '附加 + 限定 + 常驻')}
                    total={formatNumber(characterStats.total || 0)}
                    six={<>{formatCount(characterStats.six || 0)}{currentStats.charGift > 0 ? <span className="ml-1 text-xs text-purple-500">+{formatCount(currentStats.charGift)}</span> : null}</>}
                    avgPity={formatAverageValue(getPoolAverageSixValue(characterStats))}
                    avgPityUp={formatAverageValue(characterStats.avgPityUp || characterStats.avgPityTarget)}
                    targetVsOff={<><span className="text-emerald-500">{formatCount(characterStats.limitedSix ?? characterStats.sixStarLimited ?? 0)}</span><span className="mx-1 text-zinc-400">/</span><span className="text-rose-500">{formatCount(Math.max(Number(characterStats.six || 0) - Number(characterStats.limitedSix ?? characterStats.sixStarLimited ?? 0), 0))}</span></>}
                    targetRate={formatPercent(Number(characterStats.six || 0) > 0 ? (Number(characterStats.limitedSix ?? characterStats.sixStarLimited ?? 0) / Number(characterStats.six || 0)) * 100 : 0)}
                    breakdownLines={[
                      { colorClass: 'bg-cyan-500/60', label: t('summary.scope.extra', {}, '附加寻访'), total: `${formatCount(extraStats.total || 0)} ${t('summary.metric.pullsUnit', {}, '抽')}`, avg: `${formatAverageValue(getPoolAverageSixValue(extraStats))} ${t('summary.metric.averageShort', {}, '平均')}` },
                      { colorClass: 'bg-emerald-500/60', label: t('summary.scope.limited', {}, '限定角色池'), total: `${formatCount(limitedStats.total || 0)} ${t('summary.metric.pullsUnit', {}, '抽')}`, avg: `${formatAverageValue(getPoolAverageSixValue(limitedStats))} ${t('summary.metric.averageShort', {}, '平均')}` },
                      { colorClass: 'bg-indigo-500/60', label: t('summary.scope.standard', {}, '常驻池'), total: `${formatCount(standardStats.total || 0)} ${t('summary.metric.pullsUnit', {}, '抽')}`, avg: `${formatAverageValue(getPoolAverageSixValue(standardStats))} ${t('summary.metric.averageShort', {}, '平均')}` }
                    ]}
                  />
                  <TypeCard
                    title={t('summary.section.weaponBannerData', {}, '武器池数据')}
                    total={formatNumber(weaponStats.total || 0)}
                    six={<>{formatCount(weaponStats.six || 0)}{(currentStats.weaponGiftLimited > 0 || currentStats.weaponGiftStandard > 0) ? <span className="ml-1 text-xs text-purple-500">+{formatCount((currentStats.weaponGiftLimited || 0) + (currentStats.weaponGiftStandard || 0))}</span> : null}</>}
                    avgPity={formatAverageValue(getPoolAverageSixValue(weaponStats))}
                    avgPityUp={formatAverageValue(weaponStats.avgPityUp || weaponStats.avgPityTarget)}
                    targetVsOff={<><span className="text-emerald-500">{formatCount(weaponStats.limitedSix ?? weaponStats.sixStarLimited ?? 0)}</span><span className="mx-1 text-zinc-400">/</span><span className="text-rose-500">{formatCount(Math.max(Number(weaponStats.six || 0) - Number(weaponStats.limitedSix ?? weaponStats.sixStarLimited ?? 0), 0))}</span></>}
                    targetRate={formatPercent(Number(weaponStats.six || 0) > 0 ? (Number(weaponStats.limitedSix ?? weaponStats.sixStarLimited ?? 0) / Number(weaponStats.six || 0)) * 100 : 0)}
                  />
                </div>

                {currentStats?.resources && (
                  <ResourceSummaryPanel
                    title={t('summary.section.allResourceSummary', {}, '全卡池资源统计')}
                    resources={currentStats.resources}
                    variant="all"
                    mobile
                  />
                )}
                {renderChartSections()}
              </div>
            ) : (
              <div className="space-y-3">
                <TypeCard
                  title={filterOptions.find((option) => option.value === poolTypeFilter)?.label || poolTypeFilter}
                  total={formatNumber(currentStats?.byType?.[poolTypeFilter]?.total || 0)}
                  six={formatNumber(currentStats?.byType?.[poolTypeFilter]?.six || 0)}
                  avgPity={formatAverageValue(getPoolAverageSixValue(currentStats?.byType?.[poolTypeFilter]))}
                  avgPityUp={formatAverageValue(currentStats?.byType?.[poolTypeFilter]?.avgPityUp)}
                  targetVsOff={<><span className="text-emerald-500">{formatCount(currentStats?.byType?.[poolTypeFilter]?.limitedSix ?? currentStats?.byType?.[poolTypeFilter]?.sixStarLimited ?? 0)}</span><span className="mx-1 text-zinc-400">/</span><span className="text-rose-500">{formatCount(Math.max(Number(currentStats?.byType?.[poolTypeFilter]?.six || 0) - Number(currentStats?.byType?.[poolTypeFilter]?.limitedSix ?? currentStats?.byType?.[poolTypeFilter]?.sixStarLimited ?? 0), 0))}</span></>}
                  targetRate={formatPercent(Number(currentStats?.byType?.[poolTypeFilter]?.six || 0) > 0 ? (Number(currentStats?.byType?.[poolTypeFilter]?.limitedSix ?? currentStats?.byType?.[poolTypeFilter]?.sixStarLimited ?? 0) / Number(currentStats?.byType?.[poolTypeFilter]?.six || 0)) * 100 : 0)}
                />
                {currentStats?.resources && (
                  <ResourceSummaryPanel
                    title={poolTypeFilter === 'weapon'
                      ? t('summary.section.weaponResourceSummary', {}, '武器池资源统计')
                      : t('summary.section.characterResourceSummary', {}, '角色池资源统计')}
                    resources={currentStats.resources}
                    variant={poolTypeFilter === 'weapon' ? 'weapon' : 'character'}
                    mobile
                  />
                )}
                {renderChartSections()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default MobileStatsView;
