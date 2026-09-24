/** Inverse empirical CDF: the first recorded cost reaching the requested share. */
export function observationQuantile(summary, share) {
  if (!summary?.sampleCount) return null;
  const rank = Math.ceil(summary.sampleCount * share);
  let count = 0;
  for (const point of summary.points) {
    count += point.count;
    if (count >= rank) return point.cost;
  }
  return null;
}

export function observationCostInterval(summary) {
  return {
    q25: observationQuantile(summary, .25),
    median: observationQuantile(summary, .5),
    q75: observationQuantile(summary, .75),
    p90: observationQuantile(summary, .9),
  };
}

/** Uses all completed samples, independently of the chart's visible range. */
export function observationShareWithin(summary, cost) {
  if (!summary?.sampleCount) return null;
  return summary.points.reduce((count, point) => count + (point.cost <= cost ? point.count : 0), 0) / summary.sampleCount;
}

/** Bins are anchored at result 1 (1–10, 11–20, ...), clipped to the visible range. */
export function observationFrequencyBins(summary, start, end, size) {
  if (![1, 10, 20].includes(size) || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end < start || end - start > 2000) throw new Error('Invalid frequency range');
  const bins = [];
  const first = Math.max(1, start);
  let index = 0;
  const points = summary?.points || [];
  while (index < points.length && points[index].cost < first) index++;
  for (let low = first; low <= end;) {
    const high = Math.min(end, (Math.floor((low - 1) / size) + 1) * size);
    let count = 0;
    while (index < points.length && points[index].cost <= high) count += points[index++].count;
    bins.push({ cost: high, from: low, to: high, count });
    low = high + 1;
  }
  return bins;
}

/** Account coverage is independent of acquisition count and cost completeness. */
export function observationAccountCoverage(item, accounts) {
  if (!item || !accounts) return null;
  const obtained = accounts - item.nonObtainingAccounts;
  return { obtained, notRecorded: item.nonObtainingAccounts, total: accounts, rate: obtained / accounts };
}
