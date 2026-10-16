import { getPoolTimingMeta } from './poolSelectorDisplay.js';

export function closeWeaponTimelineStage(entry, locale = 'zh-CN') {
  const english = locale === 'en-US';
  const summary = entry.pulls == null
    ? english ? 'Banner ended. Remaining pity is unknown.' : '卡池已结束，收池时的保底结余未知。'
    : english ? `Banner ended with ${entry.pulls} pulls since the last 6★.` : `卡池已结束，末次六星后结余 ${entry.pulls} 抽。`;
  return { ...entry, isCurrentStage: false, isClosedStage: true, stageKind: 'closed',
    stageLabel: english ? 'Final remainder' : '收池结余', dateLabel: english ? 'Ended' : '已结束',
    resultSummary: summary, resultSummaryWithoutFiveStar: summary, tags: [english ? 'Ended' : '已结束'] };
}

/** Presentation only: preserve all calculations and chronology within a banner. */
export function prepareTimelineSections(sections = [], pools = [], { order = 'desc', selectedIds = null, now = new Date(), locale = 'zh-CN' } = {}) {
  const byId = new Map(pools.map(pool => [String(pool.id || pool.pool_id), pool]));
  return sections.filter(section => selectedIds === null || selectedIds.includes(section.id)).map(section => {
    const pool = byId.get(String(section.id));
    const startTime = pool?.start_time || section.startTime || section.status?.start || null;
    const endTime = pool?.end_time || section.endTime || section.status?.end || null;
    const status = startTime && endTime
      ? getPoolTimingMeta({ start_time: startTime, end_time: endTime }, now, locale)
      : section.status || getPoolTimingMeta({}, now, locale);
    return { ...section, startTime, endTime, status,
      entries: (section.entries || []).flatMap(entry => {
        if (!entry.isCurrentStage || !status.isTimed || status.isActive) return [entry];
        return section.type === 'weapon' && status.isExpired && (entry.pulls > 0 || entry.dropBadges?.length)
          ? [closeWeaponTimelineStage(entry, locale)] : [];
      }),
    };
  }).sort((left, right) => {
    const a = Date.parse(left.startTime) || 0, b = Date.parse(right.startTime) || 0;
    // Permanent banners have no start date and stay after dated banners.
    if (!a || !b) return a ? -1 : b ? 1 : String(left.id).localeCompare(String(right.id));
    return (order === 'asc' ? a - b : b - a) || String(left.id).localeCompare(String(right.id));
  });
}
