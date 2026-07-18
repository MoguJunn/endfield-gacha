import { characterCache } from './characterUtils.js';
import { isFreeHistoryPull, isGiftHistoryPull, isInfoBookHistoryPull } from './historyInfoBook.js';
import { getPoolTimingMeta, normalizePoolGroupType } from './poolSelectorDisplay.js';
import { compareHistoryTimelineAsc, getHistoryTimelineTimestampMs } from './historyTimelineSort.js';
import { EXTRA_POOL_RULES, LIMITED_POOL_RULES, STANDARD_POOL_RULES, WEAPON_POOL_RULES } from '../constants/index.js';
import { getAppLocale, isEnglishLocale } from '../i18n/index.js';
import {
  localizeEntityName,
  localizeHistoryItemName,
  localizePoolFeaturedName,
  localizePoolName,
} from './gameDataI18n.js';

function normalizePoolType(type) {
  if (type === 'extra') return 'extra';
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  if (type === 'beginner') return 'standard';
  return type || 'standard';
}

function getPoolSixStarPity(poolType) {
  if (poolType === 'weapon') {
    return WEAPON_POOL_RULES.sixStarPity;
  }

  if (poolType === 'limited') {
    return LIMITED_POOL_RULES.sixStarPity;
  }

  if (poolType === 'extra') {
    return EXTRA_POOL_RULES.sixStarPity;
  }

  return STANDARD_POOL_RULES.sixStarPity;
}

function getHistoryPoolId(item) {
  return item?.poolId || item?.pool_id || null;
}

function getHistorySeqId(item) {
  return parseInt(item?.seqId || item?.seq_id || '0', 10) || 0;
}

function getHistoryRecordKey(item) {
  return String(item?.id || item?.record_id || '');
}

function getHistoryTimestamp(item) {
  if (typeof item?.timestamp === 'number') {
    return item.timestamp;
  }

  const parsed = new Date(item?.timestamp || item?.gacha_time || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getHistoryBatchKey(item) {
  const explicitBatchId = item?.batchId || item?.batch_id;
  if (explicitBatchId !== null && explicitBatchId !== undefined && String(explicitBatchId).trim()) {
    return `batch:${String(explicitBatchId).trim()}`;
  }

  const timestamp = getHistoryTimelineTimestampMs(item);
  return timestamp > 0 ? `time:${timestamp}` : null;
}

function sortHistoryAsc(left, right) {
  const timelineDiff = compareHistoryTimelineAsc(left, right);
  if (timelineDiff !== 0) {
    return timelineDiff;
  }
  return getHistorySeqId(left) - getHistorySeqId(right);
}

function sanitizeTimelineDomId(value) {
  return encodeURIComponent(String(value || 'unknown')).replace(/%/g, '_');
}

export function getTimelineStageElementId(sectionId, entryId) {
  return `timeline-stage-${sanitizeTimelineDomId(sectionId)}-${sanitizeTimelineDomId(entryId)}`;
}

function getSourceRecordKeys(items = []) {
  return (Array.isArray(items) ? items : []).map(getHistoryRecordKey).filter(Boolean);
}

function isGuaranteedHistoryPull(item) {
  return (
    item?.specialType === 'guaranteed' ||
    item?.special_type === 'guaranteed' ||
    item?.isSpark === true ||
    item?.isGuaranteed === true
  );
}

function shouldExcludeFromWinRate(item, poolType) {
  return normalizePoolType(poolType) === 'limited' && isGuaranteedHistoryPull(item);
}

function roundScaleMax(value, minimum) {
  return Math.max(minimum, Math.ceil(Math.max(value, 0) / 10) * 10);
}

function formatDateLabel(input) {
  const timestamp = getHistoryTimestamp({ timestamp: input });
  if (!timestamp) {
    return '--';
  }

  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatPeriod(pool, locale = getAppLocale()) {
  if (!pool?.start_time || !pool?.end_time) {
    return isEnglishLocale(locale) ? 'Always available' : '长期开放';
  }

  return `${formatDateLabel(pool.start_time)} - ${formatDateLabel(pool.end_time)}`;
}

function getItemName(item, locale = getAppLocale()) {
  return localizeHistoryItemName(item, { locale });
}

function formatPrimaryDropLabel(item, fallback = null, locale = getAppLocale()) {
  const label = getItemName(item, locale);
  return label || fallback || (isEnglishLocale(locale) ? 'Unknown target' : '未知目标');
}

function getAvatarUrl(name) {
  if (!name) {
    return null;
  }

  return characterCache.searchByName(name, false)?.avatar_url || null;
}

function isActuallyLimited(item) {
  const characterName = item?.item_name || item?.character_name || item?.characterName || item?.name || '';
  return Boolean(characterCache.searchByName(characterName, false)?.is_limited);
}

function createDropBadges(items, locale = getAppLocale()) {
  const badgeMap = new Map();

  items.forEach((item) => {
    const label = getItemName(item, locale);
    const existing = badgeMap.get(label);
    if (existing) {
      existing.count += 1;
      existing.rarity = Math.max(existing.rarity, Number(item?.rarity) || 0);
      return;
    }

    badgeMap.set(label, {
      label,
      rarity: Number(item?.rarity) || 0,
      count: 1,
      avatarUrl: getAvatarUrl(item?.item_name || item?.character_name || item?.characterName || item?.name),
    });
  });

  return Array.from(badgeMap.values())
    .sort((left, right) => {
      if (left.rarity !== right.rarity) {
        return right.rarity - left.rarity;
      }

      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label, locale);
    })
    .slice(0, 4);
}

function createLeadBadge(item, fallbackLabel = '?', locale = getAppLocale()) {
  if (!item) {
    return {
      label: fallbackLabel,
      rarity: 0,
      count: 1,
      avatarUrl: null,
    };
  }

  const label = getItemName(item, locale);
  return {
    label,
    rarity: Number(item?.rarity) || 0,
    count: 1,
    avatarUrl: getAvatarUrl(item?.item_name || item?.character_name || item?.characterName || item?.name),
  };
}

function formatQuotedLabel(label, locale = getAppLocale()) {
  return isEnglishLocale(locale) ? `"${label}"` : `「${label}」`;
}

function formatRepeatedCount(count, locale = getAppLocale()) {
  return isEnglishLocale(locale) ? ` and ${count} total` : ` 等 ${count} 次`;
}

function formatFiveStarAddon(count, locale = getAppLocale()) {
  if (!count) {
    return '';
  }

  return isEnglishLocale(locale) ? `, plus ${count} 5★` : `，附带 ${count} 次 5★`;
}

function buildGiftResultSummary(stageLabel, badges = [], locale = getAppLocale()) {
  const english = isEnglishLocale(locale);
  const badgeSummary = formatBadgeSummary(badges, locale);
  if (badgeSummary) {
    return english ? `${stageLabel} results: ${badgeSummary}` : `${stageLabel}结果：${badgeSummary}`;
  }

  return english ? `${stageLabel} results` : `${stageLabel}结果`;
}

function formatBadgeSummary(badges = [], locale = getAppLocale()) {
  if (!Array.isArray(badges) || badges.length === 0) {
    return '';
  }

  return badges
    .map(
      (badge) =>
        `${badge.rarity > 0 ? `${badge.rarity}★` : ''}${formatQuotedLabel(badge.label, locale)}${badge.count > 1 ? `x${badge.count}` : ''}`
    )
    .join(' / ');
}

function formatSecondarySixStarNames(items = [], locale = getAppLocale()) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  const badges = createDropBadges(
    items.filter((item) => Number(item?.rarity) >= 6),
    locale
  );
  if (badges.length === 0) {
    return '';
  }

  const labels = badges.map(
    (badge) => `${formatQuotedLabel(badge.label, locale)}${badge.count > 1 ? `x${badge.count}` : ''}`
  );
  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return labels.join(' / ');
  }

  return `${labels.slice(0, 2).join(' / ')}${formatRepeatedCount(items.length, locale)}`;
}

function formatSecondarySegment(prefix, items = [], locale = getAppLocale()) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const names = formatSecondarySixStarNames(items, locale);
  if (!names) {
    return `${prefix}${items.length}`;
  }

  return `${prefix}${names}`;
}

function classifySixStarStageKind(item) {
  if (!item || Number(item?.rarity) < 6) {
    return 'generic';
  }

  if (item?.isStandard !== true) {
    return 'up';
  }

  return isActuallyLimited(item) ? 'offLimited' : 'offStandard';
}

function mergeBadgeItems(...groups) {
  return groups.flatMap((group) => (Array.isArray(group) ? group : []));
}

function buildOrderedTimelineGroups(history = []) {
  const sorted = [...history].sort(sortHistoryAsc);
  const groups = [];
  let currentPaidGroup = [];
  let currentGiftGroup = [];

  const flushGiftGroup = () => {
    if (currentGiftGroup.length > 0) {
      groups.push(currentGiftGroup);
      currentGiftGroup = [];
    }
  };

  const flushPaidGroup = () => {
    if (currentPaidGroup.length > 0) {
      groups.push(currentPaidGroup);
      currentPaidGroup = [];
    }
  };

  sorted.forEach((item) => {
    const isGiftLike = isGiftHistoryPull(item) || isFreeHistoryPull(item);
    const isSixStar = Number(item?.rarity) >= 6;

    if (isGiftLike) {
      currentGiftGroup.push(item);
      return;
    }

    flushGiftGroup();
    currentPaidGroup.push(item);
    if (isSixStar) {
      flushPaidGroup();
    }
  });

  flushGiftGroup();
  flushPaidGroup();

  return groups;
}

function getInheritedLimitedPityForItem(item, crossPoolPityMap = null) {
  if (!(crossPoolPityMap instanceof Map)) {
    return null;
  }

  const recordKey = getHistoryRecordKey(item);
  if (!recordKey) {
    return null;
  }

  const pityInfo = crossPoolPityMap.get(recordKey);
  const pityValue = Number(pityInfo?.sixStarPity);
  return Number.isFinite(pityValue) && pityValue > 0 ? pityValue : null;
}

function calculateTimelineMetrics(history = [], { poolType = 'standard', crossPoolPityMap = null } = {}) {
  const validPulls = history.filter((item) => !isGiftHistoryPull(item) && !isFreeHistoryPull(item));
  const sixStars = validPulls.filter((item) => Number(item?.rarity) >= 6);
  const fiveStars = validPulls.filter((item) => Number(item?.rarity) === 5);
  const upSixStars = sixStars.filter((item) => item?.isStandard !== true);
  const winRateSixStars = sixStars.filter((item) => !shouldExcludeFromWinRate(item, poolType));
  const winRateUpSixStars = winRateSixStars.filter((item) => item?.isStandard !== true);
  const isLimitedPool = poolType === 'limited';
  const isExtraPool = poolType === 'extra';
  const currentPity = (() => {
    let pity = 0;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const item = history[index];
      if (isGiftHistoryPull(item) || isFreeHistoryPull(item)) {
        continue;
      }
      if (Number(item?.rarity) >= 6) {
        break;
      }
      pity += 1;
    }
    return pity;
  })();
  const currentPity5 = (() => {
    let pity = 0;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const item = history[index];
      if (isGiftHistoryPull(item) || isFreeHistoryPull(item)) {
        continue;
      }
      if (Number(item?.rarity) >= 5) {
        break;
      }
      pity += 1;
    }
    return pity;
  })();
  const sixStarIntervals = isLimitedPool
    ? sixStars
        .map((item) => getInheritedLimitedPityForItem(item, crossPoolPityMap))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const upSixStarIntervals = isLimitedPool
    ? upSixStars
        .map((item) => getInheritedLimitedPityForItem(item, crossPoolPityMap))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];

  return {
    totalPulls: validPulls.length,
    sixStarCount: sixStars.length,
    fiveStarCount: fiveStars.length,
    upSixStarCount: upSixStars.length,
    winRate: winRateSixStars.length > 0 ? (winRateUpSixStars.length / winRateSixStars.length) * 100 : 0,
    avgSixStarPulls:
      sixStars.length > 0
        ? isLimitedPool && sixStarIntervals.length === sixStars.length
          ? sixStarIntervals.reduce((sum, value) => sum + value, 0) / sixStarIntervals.length
          : validPulls.length / sixStars.length
        : Number.NaN,
    avgFiveStarPulls: fiveStars.length > 0 ? validPulls.length / fiveStars.length : Number.NaN,
    avgUpPulls:
      upSixStars.length > 0
        ? isLimitedPool && upSixStarIntervals.length === upSixStars.length
          ? upSixStarIntervals.reduce((sum, value) => sum + value, 0) / upSixStarIntervals.length
          : validPulls.length / upSixStars.length
        : Number.NaN,
    currentPity,
    currentPity5,
    isExtraPool,
  };
}

function summarizeGroup(group = []) {
  const sixStars = group.filter((item) => Number(item?.rarity) >= 6);
  const fiveStars = group.filter((item) => Number(item?.rarity) === 5);
  const highRarityItems = group.filter((item) => Number(item?.rarity) >= 5);
  const paidCount = group.filter((item) => !isGiftHistoryPull(item) && !isFreeHistoryPull(item)).length;
  const hasGift = group.some((item) => isGiftHistoryPull(item) || isFreeHistoryPull(item));
  const hasFreePulls = group.some((item) => isFreeHistoryPull(item));
  const hasGiftPulls = group.some((item) => isGiftHistoryPull(item));
  const hasInfoBook = group.some((item) => isInfoBookHistoryPull(item));
  const upSixStars = sixStars.filter((item) => item?.isStandard !== true);
  const offLimitedSixStars = sixStars.filter((item) => item?.isStandard === true && isActuallyLimited(item));
  const offStandardSixStars = sixStars.filter((item) => item?.isStandard === true && !isActuallyLimited(item));
  const primarySixStar = sixStars.length > 0 ? sixStars[sixStars.length - 1] : null;
  const primaryHighRarity = highRarityItems.length > 0 ? highRarityItems[highRarityItems.length - 1] : null;
  const timestampSource = primarySixStar || primaryHighRarity || group[group.length - 1] || group[0] || null;
  const sourceBatchKeys = Array.from(new Set(highRarityItems.map(getHistoryBatchKey).filter(Boolean)));

  return {
    paidCount,
    hasGift,
    hasFreePulls,
    hasGiftPulls,
    hasInfoBook,
    hasSixStar: sixStars.length > 0,
    hasFiveStar: fiveStars.length > 0,
    sixStars,
    fiveStars,
    upSixStars,
    offLimitedSixStars,
    offStandardSixStars,
    primarySixStar,
    primaryHighRarity,
    highRarityItems,
    dropBadges: createDropBadges(highRarityItems),
    groupSize: group.length,
    timestamp: timestampSource?.timestamp || timestampSource?.gacha_time || null,
    primaryBatchKey: getHistoryBatchKey(primarySixStar || primaryHighRarity),
    sourceBatchKeys,
  };
}

function resolveGiftHighlightStageKind(summary) {
  if (summary?.upSixStars?.length > 0) {
    return 'up';
  }

  if (summary?.hasSixStar) {
    return 'sixStar';
  }

  if (summary?.hasFiveStar) {
    return 'fiveStar';
  }

  return 'gift';
}

function buildMilestoneSummary(summary, poolType, locale = getAppLocale()) {
  const english = isEnglishLocale(locale);
  if (summary.hasGift) {
    const stageLabel = summary.hasFreePulls
      ? summary.groupSize >= 10
        ? english
          ? 'Urgent Recruitment'
          : '免费十连'
        : english
          ? 'Free Node'
          : '免费节点'
      : english
        ? 'Gift Node'
        : '赠送节点';
    const allBadges = createDropBadges(summary.highRarityItems, locale);
    const sixStarBadges = createDropBadges(summary.sixStars, locale);
    const highlightStageKind = resolveGiftHighlightStageKind(summary);
    return {
      stageLabel,
      resultSummary: buildGiftResultSummary(stageLabel, allBadges, locale),
      resultSummaryWithoutFiveStar: buildGiftResultSummary(stageLabel, sixStarBadges, locale),
      tags: [summary.hasFreePulls ? (english ? 'Free' : '免费') : english ? 'Gift' : '赠送'],
      stageKind: 'gift',
      highlightStageKind,
      highestRarity: Number(summary.primaryHighRarity?.rarity) || 0,
      leadBadge: summary.hasSixStar
        ? createLeadBadge(summary.primarySixStar, '?', locale)
        : createLeadBadge(summary.primaryHighRarity, '?', locale),
    };
  }

  const primaryStageKind = classifySixStarStageKind(summary.primarySixStar);
  const primaryLabel = formatPrimaryDropLabel(
    summary.primarySixStar,
    formatPrimaryDropLabel(summary.primaryHighRarity, null, locale),
    locale
  );
  if (poolType === 'standard') {
    const resultSummaryWithoutFiveStar = english
      ? `Pulled 6★ ${formatQuotedLabel(primaryLabel, locale)}${summary.sixStars.length > 1 ? formatRepeatedCount(summary.sixStars.length, locale) : ''}`
      : `获得 6★${formatQuotedLabel(primaryLabel, locale)}${summary.sixStars.length > 1 ? formatRepeatedCount(summary.sixStars.length, locale) : ''}`;
    return {
      stageLabel: english ? '6★ Milestone' : '6★ 节点',
      resultSummary: `${resultSummaryWithoutFiveStar}${formatFiveStarAddon(summary.fiveStars.length, locale)}`,
      resultSummaryWithoutFiveStar,
      tags: [],
      stageKind: primaryStageKind === 'offLimited' ? 'offLimited' : 'offStandard',
      highestRarity: 6,
      leadBadge: createLeadBadge(summary.primarySixStar, '?', locale),
    };
  }

  const secondarySegments = [];
  if (summary.upSixStars.length > 0 && primaryStageKind !== 'up') {
    secondarySegments.push(formatSecondarySegment('UP ', summary.upSixStars, locale));
  }
  if (summary.offLimitedSixStars.length > 0 && primaryStageKind !== 'offLimited') {
    secondarySegments.push(
      formatSecondarySegment(english ? 'Off Limited ' : '歪限定', summary.offLimitedSixStars, locale)
    );
  }
  if (summary.offStandardSixStars.length > 0 && primaryStageKind !== 'offStandard') {
    secondarySegments.push(
      formatSecondarySegment(english ? 'Off Standard ' : '歪常驻', summary.offStandardSixStars, locale)
    );
  }
  const secondarySummary =
    secondarySegments.filter(Boolean).length > 0
      ? english
        ? `, same batch includes ${secondarySegments.filter(Boolean).join(' / ')}`
        : `，同批含 ${secondarySegments.filter(Boolean).join(' / ')}`
      : '';

  if (primaryStageKind === 'up') {
    const resultSummaryWithoutFiveStar = `${english ? 'Hit target 6★' : '命中目标 6★'} ${formatQuotedLabel(primaryLabel, locale)}${summary.upSixStars.length > 1 ? formatRepeatedCount(summary.upSixStars.length, locale) : ''}${secondarySummary}`;
    return {
      stageLabel: english ? 'Hit Node' : '命中节点',
      resultSummary: `${resultSummaryWithoutFiveStar}${formatFiveStarAddon(summary.fiveStars.length, locale)}`,
      resultSummaryWithoutFiveStar,
      tags: ['UP'],
      stageKind: 'up',
      highestRarity: 6,
      leadBadge: createLeadBadge(summary.primarySixStar, '?', locale),
    };
  }

  if (primaryStageKind === 'offLimited') {
    const resultSummaryWithoutFiveStar = `${english ? 'Off-rate to other limited 6★' : '偏移到其他限定'} ${formatQuotedLabel(primaryLabel, locale)}${summary.offLimitedSixStars.length > 1 ? formatRepeatedCount(summary.offLimitedSixStars.length, locale) : ''}${secondarySummary}`;
    return {
      stageLabel: english ? 'Off-rate Node' : '偏移节点',
      resultSummary: `${resultSummaryWithoutFiveStar}${formatFiveStarAddon(summary.fiveStars.length, locale)}`,
      resultSummaryWithoutFiveStar,
      tags: [english ? 'Off-rate' : '偏移'],
      stageKind: 'offLimited',
      highestRarity: 6,
      leadBadge: createLeadBadge(summary.primarySixStar, '?', locale),
    };
  }

  if (primaryStageKind === 'offStandard') {
    const resultSummaryWithoutFiveStar = `${english ? 'Off-rate to standard 6★' : '偏移到常驻 6★'} ${formatQuotedLabel(primaryLabel, locale)}${summary.offStandardSixStars.length > 1 ? formatRepeatedCount(summary.offStandardSixStars.length, locale) : ''}${secondarySummary}`;
    return {
      stageLabel: english ? 'Off-rate Node' : '偏移节点',
      resultSummary: `${resultSummaryWithoutFiveStar}${formatFiveStarAddon(summary.fiveStars.length, locale)}`,
      resultSummaryWithoutFiveStar,
      tags: [english ? 'Off-rate' : '歪'],
      stageKind: 'offStandard',
      highestRarity: 6,
      leadBadge: createLeadBadge(summary.primarySixStar, '?', locale),
    };
  }

  return {
    stageLabel: english ? 'Stage Node' : '阶段节点',
    resultSummary: english ? 'Stage Node' : '阶段节点',
    resultSummaryWithoutFiveStar: english ? 'Stage Node' : '阶段节点',
    tags: [],
    stageKind: 'generic',
    highestRarity: Number(summary.primaryHighRarity?.rarity) || 0,
    leadBadge: createLeadBadge(summary.primaryHighRarity, '?', locale),
  };
}

function getStageTargetPulls(poolType, stageKind, stageSize = 0) {
  if (stageKind === 'gift') {
    return Math.max(stageSize || 10, 10);
  }

  return getPoolSixStarPity(poolType);
}

function buildCurrentStageEntry(
  pool,
  pendingPaidCount,
  currentPityValue,
  supportItems = [],
  currentTargetPullsOverride,
  locale = getAppLocale()
) {
  const english = isEnglishLocale(locale);
  const targetLabel = english ? '6★ milestone' : '6★ 节点';
  const displayPulls = Number.isFinite(currentPityValue) ? currentPityValue : pendingPaidCount;
  const normalizedType = normalizePoolType(pool?.type);
  const supportBadges = createDropBadges(
    supportItems.filter((item) => Number(item?.rarity) === 5),
    locale
  );

  return {
    id: `${pool?.id || 'pool'}-current-stage`,
    isCurrentStage: true,
    stageKind: 'current',
    dateLabel: english ? 'Now' : '至今',
    stageLabel: english ? 'Current Progress' : '当前推进',
    pulls: displayPulls,
    targetPulls: Number.isFinite(currentTargetPullsOverride)
      ? currentTargetPullsOverride
      : getStageTargetPulls(normalizedType, 'current'),
    resultSummary:
      displayPulls > 0
        ? english
          ? `Still progressing. No new ${targetLabel} has been triggered yet.`
          : `当前仍在推进，尚未触发新的 ${targetLabel}`
        : english
          ? 'No new high-rarity milestone has formed in the current stage.'
          : '当前阶段尚未形成新的高稀有节点',
    resultSummaryWithoutFiveStar:
      displayPulls > 0
        ? english
          ? `Still progressing. No new ${targetLabel} has been triggered yet.`
          : `当前仍在推进，尚未触发新的 ${targetLabel}`
        : english
          ? 'No new high-rarity milestone has formed in the current stage.'
          : '当前阶段尚未形成新的高稀有节点',
    metaSummary: null,
    tags: [english ? 'Current' : '当前'],
    leadBadge: createLeadBadge(
      null,
      localizePoolFeaturedName(pool, { locale }) ||
        localizeEntityName(pool?.up_character || pool?.upCharacter || '?', { locale }),
      locale
    ),
    dropBadges: supportBadges,
    highestRarity: supportBadges.some((badge) => Number(badge?.rarity) >= 5) ? 5 : 0,
    sourceRecordKeys: getSourceRecordKeys(supportItems),
  };
}

function buildStageEntries({
  history,
  pool,
  currentPityOverride,
  currentTargetPullsOverride,
  crossPoolPityMap,
  showCurrentStage = true,
  locale = getAppLocale(),
}) {
  const ascendingGroups = buildOrderedTimelineGroups(history);
  const stages = [];
  let pendingPaidCount = 0;
  let pendingSupportItems = [];

  ascendingGroups.forEach((group) => {
    const summary = summarizeGroup(group);
    pendingPaidCount += summary.paidCount;
    const normalizedType = normalizePoolType(pool?.type);

    if (summary.hasGift) {
      const milestone = buildMilestoneSummary(summary, normalizedType, locale);
      stages.push({
        id: `${pool?.id || 'pool'}-stage-${stages.length + 1}`,
        stageKind: milestone.stageKind,
        dateLabel: formatDateLabel(summary.timestamp),
        stageLabel: milestone.stageLabel,
        pulls: Math.max(group.length, summary.paidCount),
        targetPulls: getStageTargetPulls(normalizedType, milestone.stageKind, summary.groupSize),
        resultSummary: milestone.resultSummary,
        resultSummaryWithoutFiveStar: milestone.resultSummaryWithoutFiveStar || milestone.resultSummary,
        metaSummary: null,
        tags: milestone.tags,
        leadBadge:
          milestone.leadBadge ||
          createLeadBadge(
            summary.primaryHighRarity,
            localizePoolFeaturedName(pool, { locale }) ||
              localizeEntityName(pool?.up_character || pool?.upCharacter || '?', { locale }),
            locale
          ),
        dropBadges: createDropBadges(summary.highRarityItems, locale),
        highlightStageKind: milestone.highlightStageKind || milestone.stageKind,
        highestRarity: milestone.highestRarity || Number(summary.primaryHighRarity?.rarity) || 0,
        sourceRecordKeys: getSourceRecordKeys(group),
        sourceBatchKeys: summary.sourceBatchKeys,
        multiDropBatchKey: summary.primaryBatchKey,
      });
      return;
    }

    const shouldEmitMilestone = summary.hasSixStar;
    if (!shouldEmitMilestone) {
      if (summary.fiveStars.length > 0) {
        pendingSupportItems.push(...summary.fiveStars);
      }
      return;
    }

    const milestone = buildMilestoneSummary(summary, normalizedType, locale);
    const mergedSupportItems = mergeBadgeItems(pendingSupportItems, summary.fiveStars);
    const inheritedPulls =
      normalizedType === 'limited' ? getInheritedLimitedPityForItem(summary.primarySixStar, crossPoolPityMap) : null;
    stages.push({
      id: `${pool?.id || 'pool'}-stage-${stages.length + 1}`,
      stageKind: milestone.stageKind,
      dateLabel: formatDateLabel(summary.timestamp),
      stageLabel: milestone.stageLabel,
      pulls: inheritedPulls ?? pendingPaidCount,
      targetPulls: getStageTargetPulls(normalizedType, milestone.stageKind, summary.groupSize),
      resultSummary: milestone.resultSummary,
      resultSummaryWithoutFiveStar: milestone.resultSummaryWithoutFiveStar || milestone.resultSummary,
      metaSummary: null,
      tags: milestone.tags,
      leadBadge:
        milestone.leadBadge ||
        createLeadBadge(
          summary.primaryHighRarity,
          localizePoolFeaturedName(pool, { locale }) ||
            localizeEntityName(pool?.up_character || pool?.upCharacter || '?', { locale }),
          locale
        ),
      dropBadges: createDropBadges(mergedSupportItems, locale),
      highestRarity: milestone.highestRarity || 6,
      sourceRecordKeys: getSourceRecordKeys(mergeBadgeItems(pendingSupportItems, group)),
      sourceBatchKeys: summary.sourceBatchKeys,
      multiDropBatchKey: summary.primaryBatchKey,
    });
    pendingPaidCount = 0;
    pendingSupportItems = [];
  });

  const shouldAlwaysShowCurrentStage = normalizePoolType(pool?.type) === 'weapon';

  if (showCurrentStage && (pendingPaidCount > 0 || stages.length === 0 || shouldAlwaysShowCurrentStage)) {
    stages.push(
      buildCurrentStageEntry(
        pool,
        pendingPaidCount,
        currentPityOverride,
        pendingSupportItems,
        currentTargetPullsOverride,
        locale
      )
    );
  }

  return stages.reverse();
}

function buildTimelineSection({
  pool,
  history,
  currentPityOverride,
  currentPity5Override,
  currentTargetPullsOverride,
  crossPoolPityMap,
  disablePityState = false,
  locale = getAppLocale(),
}) {
  const normalizedType = normalizePoolType(pool?.type);
  const metrics = calculateTimelineMetrics(history, {
    poolType: normalizedType,
    crossPoolPityMap,
  });
  const timing = getPoolTimingMeta(pool, new Date(), locale);
  const beginnerProgressClosed = pool?.type === 'beginner' && metrics.totalPulls >= 40;
  const showCurrentStage =
    !disablePityState && !beginnerProgressClosed && (normalizedType === 'weapon' || !timing.isTimed || timing.isActive);
  const entries = buildStageEntries({
    history,
    pool,
    currentPityOverride,
    currentTargetPullsOverride,
    crossPoolPityMap,
    showCurrentStage,
    locale,
  });
  const maxEntryPulls = entries.reduce((maxValue, entry) => Math.max(maxValue, entry.pulls || 0), 0);
  const minimumScale = normalizedType === 'weapon' ? 40 : 60;

  return {
    id: pool?.id || 'pool-timeline',
    title: localizePoolName(pool, { locale }) || (isEnglishLocale(locale) ? 'Unknown Banner' : '未知卡池'),
    type: normalizedType,
    featured:
      localizePoolFeaturedName(pool, { locale }) ||
      localizeEntityName(pool?.up_character || pool?.upCharacter || null, {
        locale,
        type: normalizedType === 'weapon' ? 'weapon' : 'character',
      }) ||
      null,
    period: formatPeriod(pool, locale),
    status: timing,
    totalPulls: metrics.totalPulls,
    currentPity: disablePityState ? null : (currentPityOverride ?? metrics.currentPity),
    currentPity5: disablePityState ? null : (currentPity5Override ?? metrics.currentPity5),
    sixStarCount: metrics.sixStarCount,
    fiveStarCount: metrics.fiveStarCount,
    upSixStarCount: metrics.upSixStarCount,
    winRate: metrics.winRate,
    avgSixStarPulls: metrics.avgSixStarPulls,
    avgFiveStarPulls: metrics.avgFiveStarPulls,
    avgUpPulls: metrics.avgUpPulls,
    hidePityState: disablePityState,
    scaleMax: roundScaleMax(
      Math.max(maxEntryPulls, disablePityState ? 0 : (currentPityOverride ?? metrics.currentPity)),
      minimumScale
    ),
    entries,
  };
}

export function buildSinglePoolTimelineSection({
  pool,
  history = [],
  currentPityOverride,
  currentPity5Override,
  currentTargetPullsOverride,
  crossPoolPityMap = null,
  disablePityState = false,
  locale = getAppLocale(),
}) {
  if (!pool) {
    return null;
  }

  return buildTimelineSection({
    pool,
    history,
    currentPityOverride,
    currentPity5Override,
    currentTargetPullsOverride,
    crossPoolPityMap,
    disablePityState,
    locale,
  });
}

export function buildOverviewTimelineSections({
  pools = [],
  history = [],
  analysisPityByPoolId = null,
  crossPoolPityMap = null,
  disablePityState = false,
  locale = getAppLocale(),
}) {
  const historyByPoolId = new Map();

  history.forEach((item) => {
    const poolId = getHistoryPoolId(item);
    if (!poolId) {
      return;
    }

    if (!historyByPoolId.has(poolId)) {
      historyByPoolId.set(poolId, []);
    }
    historyByPoolId.get(poolId).push(item);
  });

  return (pools || [])
    .map((pool) => {
      const poolHistory = historyByPoolId.get(pool.id) || [];
      if (poolHistory.length === 0) {
        return null;
      }

      return buildTimelineSection({
        pool: {
          ...pool,
          selectorGroupType: normalizePoolGroupType(pool),
        },
        history: poolHistory,
        currentPityOverride: disablePityState ? null : analysisPityByPoolId?.get(pool.id)?.displayPity6,
        currentPity5Override: disablePityState ? null : analysisPityByPoolId?.get(pool.id)?.displayPity5,
        currentTargetPullsOverride: analysisPityByPoolId?.get(pool.id)?.maxPity6,
        crossPoolPityMap,
        disablePityState,
        locale,
      });
    })
    .filter(Boolean);
}

export function buildLimitedCrossPoolPityMap(history = []) {
  const sorted = [...(Array.isArray(history) ? history : [])].sort(sortHistoryAsc);
  const map = new Map();
  let sixPity = 0;
  let fivePity = 0;

  sorted
    .filter((item) => !isGiftHistoryPull(item))
    .forEach((item) => {
      const isFree = isFreeHistoryPull(item);
      const recordKey = getHistoryRecordKey(item);

      if (!isFree) {
        sixPity += 1;
        fivePity += 1;
      }

      if (Number(item?.rarity) >= 5 && recordKey) {
        map.set(recordKey, {
          sixStarPity: isFree ? 'free' : Number(item?.rarity) >= 6 ? sixPity : null,
          fiveStarPity: isFree ? 'free' : fivePity,
        });
      }

      if (!isFree) {
        if (Number(item?.rarity) >= 6) {
          sixPity = 0;
        }
        if (Number(item?.rarity) >= 5) {
          fivePity = 0;
        }
      }
    });

  return map;
}

export function buildTimelineAcquisitionIndex({
  pools = [],
  history = [],
  crossPoolPityMap = null,
  locale = getAppLocale(),
} = {}) {
  const sections = buildOverviewTimelineSections({
    pools,
    history,
    crossPoolPityMap,
    disablePityState: false,
    locale,
  });
  const recordByKey = new Map();
  (Array.isArray(history) ? history : []).forEach((item) => {
    const key = getHistoryRecordKey(item);
    if (key) {
      recordByKey.set(key, item);
    }
  });

  const byRecordKey = new Map();
  sections.forEach((section) => {
    (section.entries || []).forEach((entry) => {
      const elementId = getTimelineStageElementId(section.id, entry.id);
      (entry.sourceRecordKeys || []).forEach((recordKey) => {
        const record = recordByKey.get(recordKey);
        if (!record) {
          return;
        }

        let kind = 'normal';
        let pulls = entry.pulls;
        if (isFreeHistoryPull(record)) {
          kind = 'free';
          pulls = null;
        } else if (isGiftHistoryPull(record)) {
          kind = 'cycle';
        } else if (isGuaranteedHistoryPull(record)) {
          kind = 'pity';
        }

        byRecordKey.set(recordKey, {
          pulls,
          kind,
          timelineElementId: elementId,
          timelineEntryId: entry.id,
          timelineSectionId: section.id,
          poolId: section.id,
          poolName: section.title,
          timestamp: record?.timestamp || record?.gacha_time || null,
        });
      });
    });
  });

  return {
    sections,
    byRecordKey,
  };
}

export default {
  buildSinglePoolTimelineSection,
  buildOverviewTimelineSections,
  buildLimitedCrossPoolPityMap,
  buildTimelineAcquisitionIndex,
  getTimelineStageElementId,
};
