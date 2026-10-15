import { statisticsHistory, statisticsScopeKey } from '../../shared/statisticsEligibility.js';
import { compareHistoryTimelineAsc, getHistoryTimelineTimestampMs } from './historyTimelineSort.js';
import { resolvePoolCapabilities } from './poolCapabilities.js';
import { getPoolSeriesStateKey, isPaidHistoryPull } from './poolScopedHistory.js';

const accountKey = row => JSON.stringify(JSON.parse(statisticsScopeKey(row)).slice(0, 3));
const poolId = row => String(row.pool_id ?? row.poolId ?? '');
const time = value => value == null ? null : getHistoryTimelineTimestampMs({ timestamp: value }) || null;

function pityScope(pool) {
  const c = resolvePoolCapabilities(pool);
  if (c.pityScope === 'shared') return 'shared';
  if (c.pityScope === 'series') return getPoolSeriesStateKey(pool)
    ? `series:${getPoolSeriesStateKey(pool)}` : `unresolved-series:${pool?.id ?? pool?.pool_id}`;
  return `pool:${pool?.id ?? pool?.pool_id}`;
}

/** Missing scopes supply only temporal boundaries, never outcomes or pull counts.
 * Missing timestamps conservatively keep the dependent state unknown. */
export function prepareStatisticsContinuity({ history = [], pools = [], exclusions = [], entries = [] } = {}) {
  const eligible = statisticsHistory(history, { exclusions, entries });
  const included = new Set(eligible);
  const poolsById = new Map(pools.filter(Boolean).flatMap(pool => [pool.id, pool.pool_id].filter(value => value != null)
    .map(value => [String(value), pool])));
  const scopeByPool = new Map([...poolsById].map(([id, pool]) => [id, pityScope(pool)]));
  const cumulativeScopeByPool = new Map([...poolsById].map(([id, pool]) => {
    const c = resolvePoolCapabilities(pool);
    return [id, c.targetScope === 'series' || c.rewardScope === 'series' ? getPoolSeriesStateKey(pool) : null];
  }));
  const characterPoolIds = new Set([...poolsById].filter(([, pool]) => resolvePoolCapabilities(pool).entityType !== 'weapon').map(([id]) => id));
  const missing = new Map(exclusions.map(row => [statisticsScopeKey(row), { ...row }]));
  for (const row of [...history.filter(row => !included.has(row)), ...entries]) {
    const key = statisticsScopeKey(row);
    const gap = missing.get(key) || { ...row, history_start_at: null, history_end_at: null };
    const start = time(row.timestamp ?? row.values?.rangeStart);
    const end = time(row.timestamp ?? row.values?.rangeEnd);
    if (start) gap.history_start_at = Math.min(time(gap.history_start_at) || start, start);
    if (end) gap.history_end_at = Math.max(time(gap.history_end_at) || end, end);
    missing.set(key, gap);
  }
  if (!missing.size) return { history: eligible, gaps: [] };
  const gaps = [...missing.values()].map(row => {
    const pool = poolsById.get(poolId(row));
    const starts = [time(row.history_start_at), time(pool?.start_time)].filter(Boolean);
    const ends = [time(row.history_end_at), time(pool?.end_time)].filter(Boolean);
    const start = starts.length ? Math.min(...starts) : -Infinity;
    const end = ends.length ? Math.max(...ends) : Infinity;
    return { account: accountKey(row), scope: pool ? pityScope(pool) : null, cumulativeScope: cumulativeScopeByPool.get(poolId(row)),
      character: !pool || resolvePoolCapabilities(pool).entityType !== 'weapon',
      start, end: row.history_time_unknown ? Infinity : Math.max(start, end), poolId: poolId(row) };
  });
  const byAccount = Map.groupBy(gaps, gap => gap.account);
  const annotatedRows = new Map();
  for (const [account, records] of Map.groupBy(eligible, accountKey)) {
    const accountGaps = byAccount.get(account);
    if (!accountGaps?.length) continue;
    const byScope = Map.groupBy(accountGaps, gap => gap.scope);
    for (const values of byScope.values()) values.sort((a, b) => a.start - b.start);
    const states = new Map();
    const scopeGapLists = new Map();
    const seen = new Set();
    const firstCopyGap = Math.min(...accountGaps.filter(gap => gap.character).map(gap => gap.start));
    const cumulativeStarts = new Map([...Map.groupBy(accountGaps.filter(gap => gap.cumulativeScope), gap => gap.cumulativeScope)]
      .map(([key, values]) => [key, Math.min(...values.map(gap => gap.start))]));
    for (const row of records.slice().sort(compareHistoryTimelineAsc)) {
      const pool = poolsById.get(poolId(row));
      const scope = scopeByPool.get(poolId(row)) || pityScope(pool);
      if (!scopeGapLists.has(scope)) scopeGapLists.set(scope,
        [...(byScope.get(scope) || []), ...(byScope.get(null) || [])].sort((a, b) => a.start - b.start));
      const scopeGaps = scopeGapLists.get(scope);
      const state = states.get(scope) || { cursor: 0, uncertainUntil: -Infinity, sixKnown: true, fiveKnown: true, six: 0, five: 0, interrupted: false };
      const at = getHistoryTimelineTimestampMs(row);
      if (!at) continue;
      while (state.cursor < scopeGaps.length && scopeGaps[state.cursor].start <= at) {
        state.uncertainUntil = Math.max(state.uncertainUntil, scopeGaps[state.cursor++].end);
        state.sixKnown = false; state.fiveKnown = false; state.six = 0; state.five = 0; state.interrupted = true;
      }
      const recordKey = String(row.record_id ?? row.id ?? '');
      const valid = Boolean(recordKey && getHistoryTimelineTimestampMs(row) && [4, 5, 6].includes(Number(row.rarity)) && !seen.has(recordKey));
      seen.add(recordKey);
      const paid = valid && isPaidHistoryPull(row);
      if (paid) { state.six += 1; state.five += 1; }
      const copyHistoryKnown = poolsById.has(poolId(row)) && !characterPoolIds.has(poolId(row)) || at < firstCopyGap;
      const cumulativeHistoryKnown = at < (cumulativeStarts.get(cumulativeScopeByPool.get(poolId(row))) ?? Infinity);
      const continuity = { sixStarKnown: state.sixKnown, fiveStarKnown: state.fiveKnown,
        sixStarPity: state.sixKnown ? state.six : null, fiveStarPity: state.fiveKnown ? state.five : null,
        copyHistoryKnown, interrupted: state.interrupted,
        cumulativeHistoryKnown };
      if (paid && Number(row.rarity) >= 6) { state.six = 0; if (at > state.uncertainUntil) state.sixKnown = true; }
      if (paid && Number(row.rarity) >= 5) { state.five = 0; if (at > state.uncertainUntil) state.fiveKnown = true; }
      continuity.sixStarKnownAfter = state.sixKnown;
      continuity.fiveStarKnownAfter = state.fiveKnown;
      continuity.currentPity6 = state.sixKnown ? state.six : null;
      continuity.currentPity5 = state.fiveKnown ? state.five : null;
      states.set(scope, state);
      if (state.interrupted || !copyHistoryKnown || !cumulativeHistoryKnown) annotatedRows.set(row, { ...row, statisticsContinuity: continuity });
    }
  }
  return { history: eligible.map(row => annotatedRows.get(row) || row), gaps };
}
