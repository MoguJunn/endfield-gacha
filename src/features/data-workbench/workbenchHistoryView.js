import { buildPaidTimelinePityMap, buildScopedPaidHistoryTimeline, calculatePaidTimelinePity } from '../../utils/poolScopedHistory.js';
import { compareHistoryTimelineAsc } from '../../utils/historyTimelineSort.js';

// The workspace receives all precise rows in one account scope. Reuse the
// dashboard's shared/series rules before filtering rows for display.
export function buildWorkbenchHistoryProgress(history, pools) {
  const result = new Map();
  for (const pool of pools) {
    const paid = buildScopedPaidHistoryTimeline({ history, pools, pool });
    const last = history.filter(row => String(row.poolId ?? row.pool_id) === String(pool.id)).sort(compareHistoryTimelineAsc).at(-1);
    result.set(String(pool.id), {
      intervals: buildPaidTimelinePityMap(paid),
      currentPity: last ? calculatePaidTimelinePity(paid.filter(row => compareHistoryTimelineAsc(row, last) <= 0)).sixStarPity : undefined,
    });
  }
  return result;
}
