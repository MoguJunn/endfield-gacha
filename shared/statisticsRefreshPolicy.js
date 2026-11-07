export const STATISTICS_SNAPSHOT_VERSION = 'public-statistics-v6';

// Activity measures uploads/edits now, never the in-game pull timestamp.
export function statisticsRefreshMinutes({ contributors10m = 0, changedRows10m = 0, changedRows60m = 0, personal = false } = {}) {
  if (contributors10m >= 5 || changedRows10m >= 1000) return personal ? 5 : 15;
  return changedRows60m > 0 ? 30 : 60;
}

export function statisticsRefreshMeta(snapshot, now = Date.now()) {
  if (!snapshot) return { availability: 'building', updatedAt: null, nextRefreshAt: null };
  // The RPC may return a future retry/lease time as next_refresh_at. Retrying
  // failed work never makes an old, changed snapshot fresh again.
  const overdueChanges = Boolean(snapshot.pending_changes)
    && now > Date.parse(snapshot.computed_at) + (Number(snapshot.refresh_minutes) || 60) * 60000;
  return {
    availability: 'ready', updatedAt: snapshot.computed_at,
    nextRefreshAt: snapshot.next_refresh_at, refreshMinutes: snapshot.refresh_minutes,
    stale: overdueChanges || now > Date.parse(snapshot.next_refresh_at), schemaVersion: snapshot.schema_version,
  };
}
