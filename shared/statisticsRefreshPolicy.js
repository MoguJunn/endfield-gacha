export const STATISTICS_SNAPSHOT_VERSION = 'public-statistics-v4';

// Activity measures uploads/edits now, never the in-game pull timestamp.
export function statisticsRefreshMinutes({ contributors10m = 0, changedRows10m = 0, changedRows60m = 0 } = {}) {
  if (contributors10m >= 5 || changedRows10m >= 1000) return 5;
  return changedRows60m > 0 ? 30 : 60;
}

export function statisticsRefreshMeta(snapshot, now = Date.now()) {
  if (!snapshot) return { availability: 'building', updatedAt: null, nextRefreshAt: null };
  return {
    availability: 'ready', updatedAt: snapshot.computed_at,
    nextRefreshAt: snapshot.next_refresh_at, refreshMinutes: snapshot.refresh_minutes,
    stale: now > Date.parse(snapshot.next_refresh_at), schemaVersion: snapshot.schema_version,
  };
}
