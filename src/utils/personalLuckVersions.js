import { normalizeHomeVersionTimeline } from './homeVersionTimeline.js';
import { sumLuckWindows } from './personalLuckRating.js';

export function getStartedLuckVersions(config, asOf) {
  const parsed = typeof config === 'string' ? JSON.parse(config) : config;
  if (!(Array.isArray(parsed) ? parsed : parsed?.versions)?.length || !Number.isFinite(Date.parse(asOf))) {
    throw new Error('Missing version timeline or snapshot time');
  }
  const versions = normalizeHomeVersionTimeline(parsed);
  return versions.map((version, index) => ({
    versionId: version.id, versionName: version.name, startsAt: version.startsAt,
    endsAt: versions[index + 1]?.startsAt || version.endsAt,
  })).filter(version => Date.parse(version.startsAt) <= Date.parse(asOf));
}

export function groupLuckUnitsByVersion(units, versions) {
  const groups = versions.map(() => []), unassigned = [];
  for (const unit of units) {
    const start = Date.parse(unit.startAt), end = Date.parse(unit.endAt);
    const index = versions.findIndex(version => start >= Date.parse(version.startsAt)
      && (!version.endsAt || end < Date.parse(version.endsAt)));
    // Keep a whole weapon claim together; release boundaries never reset pity.
    (index >= 0 ? groups[index] : unassigned).push(unit);
  }
  return { timeline: versions.map((version, index) => ({ ...sumLuckWindows(groups[index]), ...version })),
    unassignedVersion: sumLuckWindows(unassigned) };
}
