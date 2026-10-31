// A damped performance index, not a probability, percentile or player ranking.
// UP and six-star outcomes overlap; the weights express product preferences.
export const GRADE_LABELS = { S: '非常欧', 'A+': '很欧', A: '手气不错', B: '中规中矩', C: '有点不顺' };
export const GRADE_THRESHOLDS = Object.freeze({ S: 2, 'A+': 1, A: .25, C: -.8 });
const FIELDS = ['sample', 'actual', 'expected', 'upActual', 'upExpected'];
export const sumLuckWindows = windows => ({
  ...Object.fromEntries(FIELDS.map(key => [key, windows.reduce((sum, item) => sum + item[key], 0)])),
  inferredSample: windows.reduce((sum, item) => sum + (item.inferredSample || 0), 0),
  observed: windows.reduce((sum, item) => sum + (item.observed ?? item.sample), 0),
});

export function evaluateLuckWindow(stats, entity = 'character') {
  const valid = FIELDS.every(key => Number.isFinite(stats[key]) && stats[key] >= 0)
    && stats.upActual <= stats.actual && stats.actual <= stats.sample
    && stats.upExpected <= stats.expected && stats.expected <= stats.sample;
  const sixScore = valid ? (stats.actual - stats.expected) / Math.sqrt(stats.expected + 4) : 0;
  const upScore = valid ? (stats.upActual - stats.upExpected) / Math.sqrt(stats.upExpected + 4) : 0;
  const score = .4 * sixScore + .6 * upScore;
  const eligible = valid && stats.sample > 0;
  const smallSample = eligible && stats.sample < (entity === 'weapon' ? 80 : 160);
  const inferred = eligible && stats.inferredSample > 0;
  const provisional = smallSample || inferred;
  const provisionalNote = inferred ? smallSample ? '样本较少，且部分进度按奖励节点推定。' : '部分进度按奖励节点推定，待原始记录确认。'
    : smallSample ? '样本较少，只代表这几次的表现。' : '';
  const grade = !eligible ? null : score >= GRADE_THRESHOLDS.S ? 'S' : score >= GRADE_THRESHOLDS['A+'] ? 'A+'
    : score >= GRADE_THRESHOLDS.A ? 'A' : score > GRADE_THRESHOLDS.C ? 'B' : 'C';
  const label = grade ? GRADE_LABELS[grade] : valid ? '暂无可用记录' : '数据待核对';
  const review = eligible ? [sixScore, upScore].map(value => value >= .5 ? '比预期多' : value <= -.5 ? '比预期少' : '和预期差不多') : [label, label];
  let detail = grade === 'S' ? '这段表现远超预期，出货很亮眼。' : grade === 'A+' ? '这段比预期好不少，抽得很顺。'
    : grade === 'A' ? '这段比预期顺一些。' : grade === 'B' ? '合起来看，这段和预期差不多。' : '这段抽得有点吃力，整体低于预期。';
  let tag = label;
  if (!eligible) { tag = '暂不评价'; detail = valid ? '当前范围没有能用于评分的记录。' : '当前数量不符合计算条件，需要先核对记录。'; }
  else if (sixScore >= .5 && upScore <= -.5) { tag = '出金多，但总歪'; detail = '六星出得多，不过 UP 偏少，综合等级会打个折。'; }
  else if (sixScore <= -.5 && upScore >= .5) { tag = '出金慢，UP 挺准'; detail = '六星出得偏少，好在 UP 表现不错。'; }
  else if (Math.abs(sixScore) < .5 && upScore >= .5) { tag = '出金一般，UP 很准'; detail = '出金速度比较普通，但想要的 UP 出得多。'; }
  return { ...stats, valid, eligible, provisional, smallSample, inferred, provisionalNote, score, sixScore, upScore, grade, label, tag, detail, review };
}

export function evaluateLuckTimeline(timeline, entity, unassignedVersion = sumLuckWindows([])) {
  const overall = evaluateLuckWindow(sumLuckWindows([unassignedVersion, ...timeline]), entity);
  const periods = timeline.map(period => evaluateLuckWindow(period, entity));
  const recentPeriods = periods.slice(-3), previousPeriods = periods.slice(-6, -3);
  const recent = evaluateLuckWindow(sumLuckWindows(recentPeriods), entity);
  const previous = evaluateLuckWindow(sumLuckWindows(previousPeriods), entity);
  let trend = { id: 'steady', title: '最近比较稳定', note: '最近三个版本和此前三个版本的表现接近。' };
  if (!recent.eligible) trend = { id: 'insufficient', title: '最近还看不准', note: '最近三个版本没有可评分的记录，暂不判断变化。' };
  else if (previousPeriods.length < 3 || !previous.eligible) trend = { id: 'no-baseline', title: '先看看这段表现', note: '此前三个版本或可用记录不足，暂时没法判断变化。' };
  else {
    const swings = recentPeriods.slice(1).map((period, index) => period.score - recentPeriods[index].score);
    const volatile = recentPeriods.every(period => period.eligible) && swings.length === 2
      && swings.every(delta => Math.abs(delta) >= 1) && swings[0] * swings[1] < 0;
    const delta = recent.score - previous.score;
    if (volatile) trend = { id: 'volatile', title: '一阵欧，一阵非', note: '最近三个版本之间起伏较大，可以分别看看每个版本的表现。' };
    else if (delta >= 1 && previous.grade === 'C' && recent.score >= GRADE_THRESHOLDS.A) trend = { id: 'comeback', title: '最近转欧了', note: '此前三个版本不太顺，最近三个版本出货明显好起来了。' };
    else if (delta <= -1 && previous.score >= GRADE_THRESHOLDS.A && recent.grade === 'C') trend = { id: 'downturn', title: '最近有点背', note: '此前三个版本比较顺，最近三个版本明显变差了。' };
    else if (delta >= .65 && previous.grade === 'C' && recent.grade === 'B') trend = { id: 'recovering', title: '手气在回暖', note: '此前三个版本比较吃力，最近三个版本已经回到正常水平。' };
    else if (delta <= -.65 && previous.score >= GRADE_THRESHOLDS.A && recent.grade === 'B') trend = { id: 'cooling', title: '回到平常手气', note: '此前三个版本比较顺，最近三个版本回到了正常水平。' };
    else if (delta >= .65) trend = { id: 'rising', title: '最近更顺了', note: '和此前三个版本相比，最近三个版本的表现更好。' };
    else if (delta <= -.65) trend = { id: 'falling', title: '最近没那么顺', note: '和此前三个版本相比，最近三个版本的表现有所回落。' };
  }
  trend.provisional = recent.eligible && previous.eligible && previousPeriods.length === 3
    && (recent.provisional || previous.provisional || trend.id === 'volatile' && recentPeriods.some(period => period.provisional));
  return { overall, recent, previous, periods, recentPeriods, previousPeriods, trend };
}
