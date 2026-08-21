import { useCallback, useEffect, useMemo, useState } from 'react';
import { RARITY_CONFIG } from '../../constants';
import { useI18n } from '../../i18n/index.js';
import { useRankingData } from './useRankingData';
import { useSummaryStats } from './useSummaryStats';

function generateChartDataFromCounts(counts, labels) {
  if (!counts) {
    return [];
  }

  const rawData = [
    { key: 'six-limited', name: labels.sixLimited, value: counts[6] || counts['6'] || 0, color: RARITY_CONFIG[6].color },
    { key: 'six-standard', name: labels.sixStandard, value: counts['6_std'] || 0, color: RARITY_CONFIG['6_std'].color },
    { key: 'five', name: labels.fiveStar, value: counts[5] || counts['5'] || 0, color: RARITY_CONFIG[5].color },
    { key: 'four', name: labels.fourStar, value: counts[4] || counts['4'] || 0, color: RARITY_CONFIG[4].color }
  ].filter(item => item.value > 0);

  const totalValue = rawData.reduce((sum, item) => sum + item.value, 0);

  return rawData.map(item => {
    const currentPercent = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
    let minPercent = 0;

    if (item.key.startsWith('six')) {
      minPercent = 15;
    } else if (item.key === 'five') {
      minPercent = 20;
    }

    if (currentPercent < minPercent && totalValue > 0) {
      return {
        ...item,
        displayValue: Math.ceil(totalValue * minPercent / 100)
      };
    }

    return {
      ...item,
      displayValue: item.value
    };
  });
}

function mergeDistributions(...sources) {
  if (!sources.some((items) => items?.length)) {
    return [];
  }

  const merged = {};

  sources.forEach((items = []) => {
    items.forEach(item => {
      if (merged[item.range]) {
        merged[item.range].limited += item.limited || 0;
        merged[item.range].standard += item.standard || 0;
        return;
      }

      merged[item.range] = {
        range: item.range,
        limited: item.limited || 0,
        standard: item.standard || 0
      };
    });
  });

  return Object.values(merged)
    .map(item => ({ ...item, count: item.limited + item.standard }))
    .sort((a, b) => parseInt(a.range, 10) - parseInt(b.range, 10));
}

function getAveragePity(typeData) {
  if (typeData?.avgPity) {
    return typeData.avgPity;
  }

  if (typeData?.pityList?.length > 0) {
    return (typeData.pityList.reduce((sum, item) => sum + item.count, 0) / typeData.pityList.length).toFixed(1);
  }

  return '-';
}

export const SUMMARY_FILTER_OPTIONS = ['all', 'limited', 'extra', 'standard', 'weapon'];

export function useSummaryViewState({
  history,
  pools,
  user,
  globalStats,
  fetchGlobalStats,
  variant: _variant = 'desktop',
  initialDataSource = 'global',
  lockedDataSource = null,
  initialPoolTypeFilter = 'all'
}) {
  const { t } = useI18n();
  const tt = useCallback((key, fallback, params = {}) => t(key, params, fallback), [t]);
  const [dataSource, setDataSourceState] = useState(() => lockedDataSource || initialDataSource);
  const [poolTypeFilter, setPoolTypeFilter] = useState(() => initialPoolTypeFilter);

  const copy = useMemo(() => ({
    titleGlobal: tt('summary.source.global', '全服数据'),
    titleLocal: tt('summary.source.local', '我的数据'),
    subtitleAll: tt('summary.scope.all', '全部卡池'),
    typeNames: {
      character: tt('summary.scope.character', '角色池（附加+限定+常驻）'),
      extra: tt('summary.scope.extra', '附加寻访'),
      limited: tt('summary.scope.limited', '限定角色池'),
      weapon: tt('summary.scope.weapon', '武器池'),
      standard: tt('summary.scope.standard', '常驻池')
    }
  }), [tt]);
  const filterOptions = useMemo(() => (
    SUMMARY_FILTER_OPTIONS.map((value) => ({
      value,
      label: tt(`summary.filter.${value}`, value)
    }))
  ), [tt]);
  const chartLabels = useMemo(() => ({
    sixLimited: tt('summary.chart.sixLimited', '6★ (限定)'),
    sixStandard: tt('summary.chart.sixStandard', '6★ (常驻)'),
    fiveStar: tt('summary.chart.fiveStar', '5★'),
    fourStar: tt('summary.chart.fourStar', '4★')
  }), [tt]);
  const isGlobalSource = dataSource === 'global';

  const { characterRanking, rankingLoading, userRanking, userRankingLoading } = useRankingData(dataSource, user);
  const localStats = useSummaryStats(history, pools, user);

  useEffect(() => {
    if (!lockedDataSource) {
      return;
    }

    setDataSourceState(lockedDataSource);
  }, [lockedDataSource]);

  useEffect(() => {
    setPoolTypeFilter(initialPoolTypeFilter);
  }, [initialPoolTypeFilter]);

  useEffect(() => {
    if (!isGlobalSource || !fetchGlobalStats) {
      return;
    }

    fetchGlobalStats();
  }, [fetchGlobalStats, isGlobalSource]);

  const ranking = isGlobalSource ? characterRanking : userRanking;
  const isRankingLoading = isGlobalSource ? rankingLoading : userRankingLoading;

  const currentStats = useMemo(() => {
    const baseStats = isGlobalSource ? globalStats : localStats;

    if (isGlobalSource && !globalStats) {
      return null;
    }

    if (!baseStats) {
      return null;
    }

    if (poolTypeFilter === 'all') {
      return {
        title: isGlobalSource ? copy.titleGlobal : copy.titleLocal,
        subtitle: copy.subtitleAll,
        total: baseStats.totalPulls ?? baseStats.total,
        sixStar: baseStats.sixStarTotal ?? baseStats.sixStar,
        sixStarLimited: baseStats.sixStarLimited ?? baseStats.counts?.[6],
        sixStarStandard: baseStats.sixStarStandard ?? baseStats.counts?.['6_std'],
        // 硬保底强制 UP 次数（限定+武器）；用于真不歪率剔除。全服数据无此字段 → 0
        sparkCount: (baseStats.byType?.limited?.sparkCount || 0) + (baseStats.byType?.weapon?.sparkCount || 0),
        avgPity: baseStats.avgPity,
        counts: baseStats.counts,
        byType: baseStats.byType,
        totalUsers: baseStats.totalUsers,
        totalContributors: baseStats.totalContributors,
        contributorsByRegion: baseStats.contributorsByRegion || null,
        charGift: baseStats.charGift || 0,
        weaponGiftLimited: baseStats.weaponGiftLimited || 0,
        weaponGiftStandard: baseStats.weaponGiftStandard || 0,
        giftTotal: baseStats.giftTotal || 0,
        resources: baseStats.resources || null,
        meta: baseStats.meta || null
      };
    }

    const typeData = baseStats.byType?.[poolTypeFilter];
    if (!typeData) {
      return null;
    }

    let avgPityExcludingFree = null;
    if (poolTypeFilter === 'extra' || poolTypeFilter === 'limited' || poolTypeFilter === 'character') {
      if (typeData.avgPityExcludingFree) {
        avgPityExcludingFree = typeData.avgPityExcludingFree;
      } else if (typeData.pityListExcludingFree?.length > 0) {
        avgPityExcludingFree = (
          typeData.pityListExcludingFree.reduce((sum, item) => sum + item.count, 0) /
          typeData.pityListExcludingFree.length
        ).toFixed(1);
      }
    }

    return {
      title: isGlobalSource ? copy.titleGlobal : copy.titleLocal,
      subtitle: copy.typeNames[poolTypeFilter],
      total: typeData.total,
      sixStar: typeData.six ?? typeData.sixStar,
      sixStarLimited: typeData.limitedSix ?? typeData.sixStarLimited ?? typeData.counts?.[6],
      sixStarStandard: typeData.counts?.['6_std'] ?? typeData.sixStarStandard,
      sparkCount: typeData.sparkCount || 0,
      avgPity: getAveragePity(typeData),
      avgPityExcludingFree,
      avgPityUp: typeData.avgPityTarget || typeData.avgPityUp || null,
      counts: typeData.counts,
      distribution: typeData.distribution,
      chartData: generateChartDataFromCounts(typeData.counts, chartLabels),
      totalUsers: baseStats.totalUsers,
      totalContributors: baseStats.totalContributors,
      contributorsByRegion: baseStats.contributorsByRegion || null,
      byType: baseStats.byType,
      resources: typeData.resources || null,
      meta: baseStats.meta || null
    };
  }, [chartLabels, copy, globalStats, isGlobalSource, localStats, poolTypeFilter]);

  const chartDisplayData = useMemo(() => {
    const baseStats = isGlobalSource ? globalStats : localStats;

    if (!baseStats) {
      return { charts: [], isGlobal: isGlobalSource };
    }

    if (poolTypeFilter !== 'all') {
      const typeData = baseStats.byType?.[poolTypeFilter];
      if (!typeData) {
        return { charts: [], isGlobal: isGlobalSource };
      }

      const typeTitles = {
        character: tt('summary.scope.character', '角色池（附加+限定+常驻）'),
        extra: tt('summary.scope.extra', '附加寻访'),
        limited: tt('summary.scope.limited', '限定角色池'),
        weapon: tt('summary.scope.weapon', '武器池'),
        standard: tt('summary.scope.standard', '常驻池')
      };
      const typeColors = {
        character: 'rainbow-text',
        extra: 'text-cyan-500',
        limited: 'rainbow-text',
        weapon: 'text-slate-500',
        standard: 'text-indigo-500'
      };
      const typeDistributionVariants = {
        character: 'character',
        extra: 'character',
        limited: 'character',
        weapon: 'weapon',
        standard: 'standard'
      };

      return {
        isGlobal: isGlobalSource,
        charts: [{
          title: typeTitles[poolTypeFilter],
          color: typeColors[poolTypeFilter],
          data: {
            ...typeData,
            distributionVariant: typeDistributionVariants[poolTypeFilter] || 'character',
            chartData: generateChartDataFromCounts(typeData.counts, chartLabels)
          }
        }]
      };
    }

    const extraCounts = baseStats.byType?.extra?.counts || {};
    const limitedCounts = baseStats.byType?.limited?.counts || {};
    const standardCounts = baseStats.byType?.standard?.counts || {};
    const characterCounts = {
      6: (extraCounts[6] || 0) + (limitedCounts[6] || 0) + (standardCounts[6] || 0),
      '6_std': (extraCounts['6_std'] || 0) + (limitedCounts['6_std'] || 0) + (standardCounts['6_std'] || 0),
      5: (extraCounts[5] || 0) + (limitedCounts[5] || 0) + (standardCounts[5] || 0),
      4: (extraCounts[4] || 0) + (limitedCounts[4] || 0) + (standardCounts[4] || 0)
    };

    return {
      isGlobal: isGlobalSource,
      charts: [
        {
          title: tt('summary.section.characterBannerData', '角色池数据'),
          subtitle: tt('summary.section.characterBannerSubtitle', '附加 + 限定 + 常驻'),
          color: 'text-violet-500',
          data: {
            ...(baseStats.byType?.character || {
              total: (baseStats.byType?.extra?.total || 0) + (baseStats.byType?.limited?.total || 0) + (baseStats.byType?.standard?.total || 0),
              six: (baseStats.byType?.extra?.six || 0) + (baseStats.byType?.limited?.six || 0) + (baseStats.byType?.standard?.six || 0),
              counts: characterCounts,
              distribution: mergeDistributions(
                baseStats.byType?.extra?.distribution,
                baseStats.byType?.limited?.distribution,
                baseStats.byType?.standard?.distribution
              ),
              chartData: generateChartDataFromCounts(characterCounts, chartLabels)
            }),
            distributionVariant: 'character',
            chartData: generateChartDataFromCounts((baseStats.byType?.character || {}).counts || characterCounts, chartLabels)
          }
        },
        {
          title: tt('summary.section.weaponBannerData', '武器池数据'),
          color: 'text-slate-500',
          data: {
            ...(baseStats.byType?.weapon || { total: 0, six: 0, counts: {}, distribution: [] }),
            distributionVariant: 'weapon',
            chartData: generateChartDataFromCounts(baseStats.byType?.weapon?.counts, chartLabels)
          }
        }
      ]
    };
  }, [chartLabels, globalStats, isGlobalSource, localStats, poolTypeFilter, tt]);

  const setDataSource = useMemo(() => {
    if (lockedDataSource) {
      return () => {};
    }

    return (nextSource) => {
      setDataSourceState(nextSource);
    };
  }, [lockedDataSource]);

  return {
    dataSource,
    setDataSource,
    poolTypeFilter,
    setPoolTypeFilter,
    isGlobalSource,
    localStats,
    currentStats,
    chartDisplayData,
    ranking,
    isRankingLoading,
    filterOptions
  };
}

export default useSummaryViewState;
