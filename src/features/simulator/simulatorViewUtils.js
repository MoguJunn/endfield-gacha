import { calculateCurrentProbability } from '../../utils/validators.js';
import { getAppLocale, getMessage } from '../../i18n/index.js';
import { normalizeSimulatorPoolType } from './simulatorInheritance.js';
import { buildCurrentTargetProbabilityInfo } from './simulatorProbability.js';

export function processHistoryGroups(history) {
  const groups = [];
  let currentTenPull = null;

  for (let index = 0; index < history.length; index += 1) {
    const record = history[index];

    if (record.isTenPull) {
      if (record.batchIndex === 0) {
        if (currentTenPull && currentTenPull.pulls.length > 0) {
          groups.push(currentTenPull);
        }

        currentTenPull = {
          type: 'tenPull',
          id: record.timestamp,
          pulls: [record],
          startPullNumber: record.pullNumber
        };
      } else if (currentTenPull) {
        currentTenPull.pulls.push(record);
      } else {
        currentTenPull = {
          type: 'tenPull',
          id: record.timestamp,
          pulls: [record],
          startPullNumber: record.pullNumber
        };
      }
    } else {
      if (currentTenPull && currentTenPull.pulls.length > 0) {
        groups.push(currentTenPull);
        currentTenPull = null;
      }

      groups.push({
        type: 'single',
        ...record
      });
    }
  }

  if (currentTenPull && currentTenPull.pulls.length > 0) {
    groups.push(currentTenPull);
  }

  return groups.reverse();
}

export function buildDashboardStats(stats, pityInfo, simulator, locale = getAppLocale()) {
  const normalizedPoolType = normalizeSimulatorPoolType(simulator.poolType);
  const capabilities = simulator.capabilities;
  const probabilityInfo = capabilities?.isResolved
    ? calculateCurrentProbability(pityInfo.sixStar.current, simulator.poolInfo || normalizedPoolType)
    : null;
  const simulatorState = simulator?.getState?.() || {};
  const rewardPaidTotal = capabilities?.rewardScope === 'series'
    ? Number(simulatorState.seriesRewardPulls ?? stats.totalPulls ?? 0)
    : Number(stats.totalPulls || 0);
  const guaranteeState = simulator?.getPityInfo?.()?.guaranteedUp || null;
  const rawFreeTenPullCount = Number(stats.freeTenPulls?.count || 0);
  const freeTenPullCount = Math.max(
    Number.isFinite(rawFreeTenPullCount) ? Math.trunc(rawFreeTenPullCount) : 0,
    0
  );
  const rawFreeTenPullsReceived = Number(simulatorState.freeTenPullsReceived || 0);
  const freeTenPullsReceived = Math.min(
    3,
    Math.max(Number.isFinite(rawFreeTenPullsReceived) ? Math.trunc(rawFreeTenPullsReceived) : 0, 0)
  );
  const targetProbabilityInfo = buildCurrentTargetProbabilityInfo({
    guaranteedLimitedPity: simulatorState.guaranteedLimitedPity,
    hasReceivedGuaranteedLimited: simulatorState.hasReceivedGuaranteedLimited,
    currentPity: pityInfo?.sixStar?.current || 0,
    poolType: normalizedPoolType,
    customRules: simulator?.rules
  });

  return {
    total: stats.totalPulls,
    paidTotal: stats.totalPulls,
    rewardPaidTotal,
    seriesRewardPaidTotal: capabilities?.rewardScope === 'series' ? rewardPaidTotal : null,
    currentPity: pityInfo.sixStar.current,
    currentPity5: pityInfo.fiveStar.current,
    counts: {
      6: stats.sixStarCount,
      '6_std': 0,
      5: stats.fiveStarCount,
      4: Math.max(0, stats.totalPulls - stats.sixStarCount - stats.fiveStarCount)
    },
    winRate: stats.upRate || '0.00',
    upSixStarCount: stats.upSixStarCount || 0,
    sixStarCount: stats.sixStarCount || 0,
    avgPullCost: {
      6: stats.avgPullsPerSixStar === '-' ? 0 : parseFloat(stats.avgPullsPerSixStar) || 0,
      5: stats.fiveStarRate && parseFloat(stats.fiveStarRate) > 0
        ? (100 / parseFloat(stats.fiveStarRate)).toFixed(2)
        : 0
    },
    chartData: [
      { name: getMessage('simulator.chart.sixStar', {}, locale), value: stats.sixStarCount, color: '#FFFA00' },
      { name: getMessage('simulator.chart.fiveStar', {}, locale), value: stats.fiveStarCount, color: '#F59E0B' },
      {
        name: getMessage('simulator.chart.lowerRarity', {}, locale),
        value: Math.max(0, stats.totalPulls - stats.sixStarCount - stats.fiveStarCount),
        color: '#A855F7'
      }
    ],
    pityStats: {
      history: stats.sixStarHistory.map((item, index) => ({
        ...item,
        index: index + 1,
        isStandard: !item.isUp && simulator.poolType !== 'standard',
        count: item.pityWhenPulled || 1
      })),
      distribution: (() => {
        const isWeapon = normalizedPoolType === 'weapon';
        const ranges = isWeapon
          ? [
              { range: '1-5', min: 1, max: 5, limited: 0, standard: 0 },
              { range: '6-10', min: 6, max: 10, limited: 0, standard: 0 },
              { range: '11-15', min: 11, max: 15, limited: 0, standard: 0 },
              { range: '16-20', min: 16, max: 20, limited: 0, standard: 0 },
              { range: '21-25', min: 21, max: 25, limited: 0, standard: 0 },
              { range: '26-30', min: 26, max: 30, limited: 0, standard: 0 },
              { range: '31-35', min: 31, max: 35, limited: 0, standard: 0 },
              { range: '36-40', min: 36, max: 40, limited: 0, standard: 0 }
            ]
          : [
              { range: '1-10', min: 1, max: 10, limited: 0, standard: 0 },
              { range: '11-20', min: 11, max: 20, limited: 0, standard: 0 },
              { range: '21-30', min: 21, max: 30, limited: 0, standard: 0 },
              { range: '31-40', min: 31, max: 40, limited: 0, standard: 0 },
              { range: '41-50', min: 41, max: 50, limited: 0, standard: 0 },
              { range: '51-60', min: 51, max: 60, limited: 0, standard: 0 },
              { range: '61-70', min: 61, max: 70, limited: 0, standard: 0 },
              { range: '71-80', min: 71, max: 80, limited: 0, standard: 0 },
              { range: '81-90', min: 81, max: 90, limited: 0, standard: 0 }
            ];

        stats.sixStarHistory.forEach((item) => {
          const pity = item.pityWhenPulled || 0;
          const rangeItem = ranges.find((range) => pity >= range.min && pity <= range.max);
          if (!rangeItem) {
            return;
          }

          if (item.isUp) {
            rangeItem.limited += 1;
          } else {
            rangeItem.standard += 1;
          }
        });

        return ranges.map((range) => ({
          range: range.range,
          limited: range.limited,
          standard: range.standard
        }));
      })()
    },
    probabilityInfo,
    targetProbabilityInfo,
    guaranteeState,
    hasInfoBook: stats.hasReceivedInfoBook,
    pullsUntilInfoBook: capabilities?.infoBookEnabled && !stats.hasReceivedInfoBook
      ? Math.max(0, Number(capabilities.rules.infoBookThreshold || 0) - stats.totalPulls)
      : 0,
    freeTenPulls: {
      ...stats.freeTenPulls,
      count: freeTenPullCount,
      received: freeTenPullsReceived,
      available: Math.max(freeTenPullCount - freeTenPullsReceived, 0)
    },
    gifts: stats.gifts
  };
}

export function buildPityInfoWithGuarantee(stats, simulator) {
  void stats;
  const threshold = Number(simulator?.capabilities?.rules?.guaranteedLimitedPity || 0);
  if (threshold <= 0) {
    return {};
  }

  const guaranteedUp = simulator?.getPityInfo?.()?.guaranteedUp;
  if (!guaranteedUp) {
    return {};
  }

  return {
    guaranteedUp: {
      ...guaranteedUp,
      current: Math.min(Number(guaranteedUp.current || 0), threshold),
      max: threshold,
      hasReceived: Boolean(guaranteedUp.hasReceived),
    }
  };
}
