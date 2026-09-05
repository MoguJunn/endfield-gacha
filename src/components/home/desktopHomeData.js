import { getHomeRotationPoolSchedule } from '../../utils/poolTimeUtils.js';
import { parseHomeVersionTimestamp } from '../../utils/homeVersionTimeline.js';

export function getConfiguredVersionTarget(plan, timeline, legacyTarget) {
  let parsed = timeline;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  const versions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.versions) ? parsed.versions : [];
  // Accept the fields already understood by homeVersionTimeline, but do not
  // present its historical fallback date as newly announced information.
  const dates = [
    legacyTarget,
    ...versions.map((v) => v.starts_at || v.startsAt || v.start_time || v.startTime || v.target_at || v.targetAt),
  ]
    .map(parseHomeVersionTimestamp)
    .filter(Boolean);
  return dates.some((date) => new Date(date).getTime() === new Date(plan.targetAt).getTime()) ? plan.targetAt : null;
}

export function scheduleIsActive(pool, now) {
  const start = new Date(pool.startDate).getTime();
  const end = pool.endDate ? new Date(pool.endDate).getTime() : null;
  return Number.isFinite(start) && now >= start && (end === null || (Number.isFinite(end) && now < end));
}

// Keep the existing homepage's limited/extra/reconstruction scope, including
// its exclusion of weapon reconstruction claims. No new probability rules.
export function buildDesktopRotation(pools, now, sections = []) {
  const schedule = pools.length ? getHomeRotationPoolSchedule(pools) : [];
  const versionById = new Map(
    sections.flatMap((section) => (section.pools || []).map((pool) => [pool.id, section.name]))
  );
  const limited = schedule.filter((pool) => pool.poolType !== 'extra');
  const activeIndex = limited.findIndex((pool) => scheduleIsActive(pool, now));
  const base = activeIndex >= 0 ? activeIndex : limited.findIndex((pool) => now < new Date(pool.startDate));
  const activeRerun = schedule.some(
    (pool) => pool.homeNodeKind === 'reconstruction-character' && scheduleIsActive(pool, now)
  );
  return schedule
    .map((pool) => {
      const active = scheduleIsActive(pool, now);
      const upcoming = now < new Date(pool.startDate);
      const index = limited.indexOf(pool);
      const offset = base >= 0 && index >= 0 ? index - base : null;
      let status = active ? 'current' : upcoming ? 'upcoming' : 'ended';
      if (pool.homeNodeKind === 'reconstruction-character')
        status = active ? 'rerun' : upcoming ? 'nextRerun' : 'ended';
      else if (index >= 0 && activeIndex >= 0 && !activeRerun && offset === -2) status = 'leavesNext';
      else if (index >= 0 && activeIndex >= 0 && !activeRerun && offset === -1) status = 'leavesTwo';
      else if (index >= 0 && !active && offset !== null) {
        const displayOffset = activeIndex >= 0 ? offset : offset + 1;
        if (displayOffset === 1) status = 'next';
        if (displayOffset === 2) status = 'afterNext';
      }
      return { ...pool, status, versionName: versionById.get(pool.id), active, upcoming };
    })
    .filter((pool) => pool.status !== 'ended');
}

export const DESKTOP_ROTATION_LABELS = {
  current: ['当前 UP', 'Current UP'],
  upcoming: ['即将开放', 'Upcoming'],
  ended: ['已结束', 'Ended'],
  rerun: ['当前复刻', 'Current rerun'],
  nextRerun: ['下次复刻', 'Next rerun'],
  leavesNext: ['下次轮换移出', 'Leaves next'],
  leavesTwo: ['两次轮换后移出', 'Leaves in two'],
  next: ['下一 UP', 'Next UP'],
  afterNext: ['下下次 UP', 'UP after next'],
};
