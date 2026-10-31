import { normalizeHomeVersionTimeline } from './homeVersionTimeline.js';
import { sumLuckWindows } from './personalLuckRating.js';

export const PERSONAL_LUCK_CALCULATION_VERSION = 2;

// Site release dates use UTC+8. A maintenance may finish before its planned hour.
const releaseDay = timestamp => Math.floor((timestamp + 8 * 60 * 60 * 1000) / 86400000);

export function getStartedLuckVersions(config, asOf, observedPoolIds = []) {
  const parsed = typeof config === 'string' ? JSON.parse(config) : config;
  if (!(Array.isArray(parsed) ? parsed : parsed?.versions)?.length || !Number.isFinite(Date.parse(asOf))) {
    throw new Error('Missing version timeline or snapshot time');
  }
  const versions = normalizeHomeVersionTimeline(parsed);
  const observed = new Set(observedPoolIds);
  return versions.map((version, index) => ({
    versionId: version.id, versionName: version.name, startsAt: version.startsAt,
    endsAt: versions[index + 1]?.startsAt || version.endsAt, poolIds: version.poolIds,
  })).filter(version => Date.parse(version.startsAt) <= Date.parse(asOf)
    || releaseDay(Date.parse(version.startsAt)) === releaseDay(Date.parse(asOf))
      && version.poolIds.some(id => observed.has(id)));
}

export function groupLuckUnitsByVersion(units, versions) {
  const groups = versions.map(() => []), unassigned = [];
  for (const unit of units) {
    const start = Date.parse(unit.startAt), end = Date.parse(unit.endAt);
    const earlyRelease = versions.findIndex(version => version.poolIds?.includes(unit.versionPoolId)
      && start < Date.parse(version.startsAt) && end < Date.parse(version.startsAt)
      && releaseDay(start) === releaseDay(Date.parse(version.startsAt)));
    const index = earlyRelease >= 0 ? earlyRelease : versions.findIndex(version => start >= Date.parse(version.startsAt)
      && (!version.endsAt || end < Date.parse(version.endsAt)));
    // Keep a whole weapon claim together; release boundaries never reset pity.
    (index >= 0 ? groups[index] : unassigned).push(unit);
  }
  return { timeline: versions.map(({ poolIds: _poolIds, ...version }, index) => ({ ...sumLuckWindows(groups[index]), ...version })),
    unassignedVersion: sumLuckWindows(unassigned) };
}
