export const POOL_ROSTER_STATUSES = Object.freeze(['missing', 'partial', 'complete']);

export const POOL_ROSTER_STATUS_LABELS = Object.freeze({
  missing: '名单缺失',
  partial: '名单不完整',
  complete: '已确认完整',
});

// Legacy/non-empty rosters are never implicitly promoted to complete.
export function resolvePoolRosterStatus(status, rows = []) {
  if (POOL_ROSTER_STATUSES.includes(status)) return status;
  return Array.isArray(rows) && rows.length > 0 ? 'partial' : 'missing';
}
